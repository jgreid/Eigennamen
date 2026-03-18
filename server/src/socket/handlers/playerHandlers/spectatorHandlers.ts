import type { Server } from 'socket.io';
import type { Player } from '../../../types';
import type { GameSocket, RoomContext } from '../types';

import * as playerService from '../../../services/playerService';
import { spectatorJoinRequestSchema, spectatorJoinResponseSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler, createHostHandler } from '../../contextHandler';
import { PlayerError } from '../../../errors/GameError';
import { sanitizeHtml } from '../../../utils/sanitize';

export default function spectatorHandlers(io: Server, socket: GameSocket): void {
    // Spectator: Request to join a team
    socket.on(
        SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
            spectatorJoinRequestSchema,
            async (ctx: RoomContext, validated: { team: string }) => {
                // Only spectators can request to join
                if (ctx.player.team && ctx.player.role !== 'spectator') {
                    throw PlayerError.notAuthorized();
                }

                // Find the host to notify
                const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                const host = players.find((p: Player) => p.isHost);
                if (!host) {
                    throw new PlayerError(ERROR_CODES.NOT_HOST, 'No host found in room');
                }

                // Emit join request to the host (io captured from outer closure)
                const hostSockets = await io.in(host.sessionId).fetchSockets();
                if (hostSockets.length > 0) {
                    // Safe to cast: we just verified length > 0
                    const hostSocket = hostSockets[0] as (typeof hostSockets)[number];
                    hostSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_REQUEST, {
                        requesterId: ctx.sessionId,
                        requesterNickname: ctx.player.nickname,
                        team: validated.team,
                        timestamp: Date.now(),
                    });
                }

                logger.info(
                    `Spectator ${sanitizeHtml(ctx.player.nickname)} requested to join ${validated.team} team in room ${ctx.roomCode}`
                );
            }
        )
    );

    // Host: Approve or deny spectator join request
    socket.on(
        SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN,
        createHostHandler(
            socket,
            SOCKET_EVENTS.SPECTATOR_APPROVE_JOIN,
            spectatorJoinResponseSchema,
            async (ctx: RoomContext, validated: { requesterId: string; approved: boolean }) => {
                const requester: Player | null = await playerService.getPlayer(validated.requesterId);
                if (!requester || requester.roomCode !== ctx.roomCode) {
                    throw new PlayerError(ERROR_CODES.PLAYER_NOT_FOUND, 'Requester not found in room');
                }

                // Verify the requester is actually a spectator to prevent team players
                // from exploiting the spectator join flow
                if (requester.team && requester.role !== 'spectator') {
                    throw PlayerError.notAuthorized();
                }

                if (validated.approved) {
                    // Notify the requester they've been approved (io captured from outer closure)
                    const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                    if (requesterSockets.length > 0) {
                        // Safe to cast: we just verified length > 0
                        const requesterSocket = requesterSockets[0] as (typeof requesterSockets)[number];
                        requesterSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_APPROVED, {
                            message: 'Your request to join a team has been approved',
                            timestamp: Date.now(),
                        });
                    }

                    logger.info(
                        `Host approved spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`
                    );
                } else {
                    // Notify the requester they've been denied (io captured from outer closure)
                    const requesterSockets = await io.in(validated.requesterId).fetchSockets();
                    if (requesterSockets.length > 0) {
                        // Safe to cast: we just verified length > 0
                        const deniedSocket = requesterSockets[0] as (typeof requesterSockets)[number];
                        deniedSocket.emit(SOCKET_EVENTS.SPECTATOR_JOIN_DENIED, {
                            message: 'Your request to join a team was denied',
                            timestamp: Date.now(),
                        });
                    }

                    logger.info(
                        `Host denied spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`
                    );
                }
            }
        )
    );
}
