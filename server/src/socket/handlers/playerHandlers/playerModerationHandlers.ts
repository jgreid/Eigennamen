import type { Server } from 'socket.io';
import type { Player } from '../../../types';
import type { GameSocket, RoomContext } from '../types';
import type { RoomStats } from '../../../services/playerService';

import * as playerService from '../../../services/playerService';
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

                // Get target player's socket ID
                const targetSocketId: string | null = await playerService.getSocketId(validated.targetSessionId);

                // Broadcast kick event before removing player
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_KICKED, {
                    sessionId: validated.targetSessionId,
                    nickname: targetPlayer.nickname,
                    kickedBy: ctx.player.nickname,
                });

                // Disconnect the target player's socket BEFORE removing data from Redis.
                // This prevents a window where the kicked player's socket can still emit
                // events that reference their now-deleted player data.
                if (targetSocketId) {
                    const targetSocket = io.sockets.sockets.get(targetSocketId) as GameSocket | undefined;
                    if (targetSocket) {
                        targetSocket.emit(SOCKET_EVENTS.ROOM_KICKED, {
                            reason: 'You were removed from the room by the host',
                        });
                        targetSocket.leave(`room:${ctx.roomCode}`);
                        targetSocket.roomCode = null;
                        targetSocket.disconnect(true);
                    }
                }

                // Invalidate reconnection token so kicked player cannot rejoin
                await playerService.invalidateRoomReconnectToken(validated.targetSessionId);

                // Remove player from room data (after socket is disconnected)
                await playerService.removePlayer(validated.targetSessionId);

                // Update player list for remaining players
                const remainingPlayers: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.ROOM_PLAYER_LEFT, {
                    sessionId: validated.targetSessionId,
                    newHost: null,
                    players: remainingPlayers || [],
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
