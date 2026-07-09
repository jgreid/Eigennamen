import type { Server } from 'socket.io';
import type { Player } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as playerService from '../../../services/playerService';
import * as botService from '../../../services/botService';
import { playerKickSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { SOCKET_EVENTS } from '../../../config/constants';
import { createHostHandler } from '../../contextHandler';
import { PlayerError, ValidationError } from '../../../errors/GameError';
import { sanitizeHtml } from '../../../utils/sanitize';
import { safeEmitToRoom } from '../../safeEmit';

interface PlayerKickInput {
    targetSessionId: string;
}

export default function playerModerationHandlers(io: Server, socket: GameSocket): void {
    /**
     * Kick a player from the room (host only)
     */
    socket.on(
        SOCKET_EVENTS.PLAYER_KICK,
        createHostHandler(
            socket,
            SOCKET_EVENTS.PLAYER_KICK,
            playerKickSchema,
            async (ctx: RoomContext, validated: PlayerKickInput) => {
                // Cannot kick yourself
                if (validated.targetSessionId === ctx.sessionId) {
                    throw new ValidationError('Cannot kick yourself');
                }

                // Get target player
                const targetPlayer: Player | null = await playerService.getPlayer(validated.targetSessionId);
                if (!targetPlayer || targetPlayer.roomCode !== ctx.roomCode) {
                    throw PlayerError.notFound(validated.targetSessionId);
                }

                // Broadcast kick event before removing player
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_KICKED, {
                    sessionId: validated.targetSessionId,
                    nickname: targetPlayer.nickname,
                    kickedBy: ctx.player.nickname,
                });

                // Disconnect the target's live socket(s) BEFORE removing data from
                // Redis, so a lingering socket can't emit events referencing
                // now-deleted player data. Target the `player:<sessionId>` room
                // (joined at room-join/reconnect) rather than the session→socket
                // mapping: that mapping has a 5-minute TTL and is never refreshed,
                // so getSocketId() returns null for anyone connected longer than it —
                // which left a kicked player's socket connected and still a member of
                // the room, receiving every broadcast for the game they were removed
                // from (A4).
                const targetSockets = await io.in(`player:${validated.targetSessionId}`).fetchSockets();
                for (const targetSocket of targetSockets) {
                    targetSocket.emit(SOCKET_EVENTS.ROOM_KICKED, {
                        reason: 'You were removed from the room by the host',
                    });
                    targetSocket.leave(`room:${ctx.roomCode}`);
                    targetSocket.disconnect(true);
                }

                // Invalidate reconnection token so kicked player cannot rejoin
                await playerService.invalidateRoomReconnectToken(validated.targetSessionId);

                // Remove player from room data (after socket is disconnected).
                // Bots carry a strategy config blob (bot:{sessionId}:cfg); route their
                // removal through botService so that key is cleaned up rather than
                // orphaned until its TTL expires.
                if (targetPlayer.isBot) {
                    await botService.removeBot(ctx.roomCode, validated.targetSessionId);
                } else {
                    await playerService.removePlayer(validated.targetSessionId);
                }

                // Update player list for remaining players
                const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                    sessionId: validated.targetSessionId,
                    newHost: null,
                    players: playerService.toPublicPlayers(remainingPlayers || []),
                });

                // Broadcast updated stats so clients refresh team counters
                const roomStats: RoomStats = await playerService.getRoomStats(ctx.roomCode);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

                logger.info(
                    `Host ${sanitizeHtml(ctx.player.nickname)} kicked player ${sanitizeHtml(targetPlayer.nickname)} from room ${ctx.roomCode}`
                );
            }
        )
    );
}
