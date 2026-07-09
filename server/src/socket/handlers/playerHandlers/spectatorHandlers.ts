import type { Server } from 'socket.io';
import type { Player } from '../../../types';
import type { GameSocket, RoomContext } from '../types';

import * as playerService from '../../../services/playerService';
import { spectatorJoinRequestSchema, spectatorJoinResponseSchema } from '../../../validators/schemas';
import logger from '../../../utils/logger';
import { ERROR_CODES, SOCKET_EVENTS } from '../../../config/constants';
import { createRoomHandler, createHostHandler } from '../../contextHandler';
import { PlayerError, ValidationError } from '../../../errors/GameError';
import { sanitizeHtml } from '../../../utils/sanitize';
import { safeEmitToPlayer, safeEmitToRoom } from '../../safeEmit';

export default function spectatorHandlers(io: Server, socket: GameSocket): void {
    // Spectator: Request to join a team
    socket.on(
        SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
        createRoomHandler(
            socket,
            SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN,
            spectatorJoinRequestSchema,
            async (ctx: RoomContext, validated: { team: string }) => {
                // Only a genuine spectator (masked-board view) may use this flow.
                // Require the role to be EXACTLY 'spectator' — a teamless `observer`
                // has seen the fully unmasked board (incl. the assassin), so letting
                // it slip through here would seat it as a live clicker and reopen the
                // observer -> clicker laundering path that canChangeTeamOrRole closes.
                if (ctx.player.role !== 'spectator') {
                    throw PlayerError.notAuthorized();
                }

                // Find the host to notify
                const players: Player[] = await playerService.getPlayersInRoom(ctx.roomCode);
                const host = players.find((p: Player) => p.isHost);
                if (!host) {
                    throw new PlayerError(ERROR_CODES.NOT_HOST, 'No host found in room');
                }

                // Emit join request to the host. A player's socket is reachable only via
                // the `player:${sessionId}` room (joined at room-join/reconnect), so we
                // address it through safeEmitToPlayer rather than the bare sessionId.
                safeEmitToPlayer(io, host.sessionId, SOCKET_EVENTS.SPECTATOR_JOIN_REQUEST, {
                    requesterId: playerService.derivePlayerId(ctx.sessionId),
                    requesterNickname: ctx.player.nickname,
                    team: validated.team,
                    timestamp: Date.now(),
                });

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
            async (ctx: RoomContext, validated: { requesterId: string; approved: boolean; team?: 'red' | 'blue' }) => {
                // requesterId is the requester's opaque playerId (N1) — resolve it
                // back to their session within this room.
                const requester: Player | null = await playerService.findPlayerByPublicId(
                    ctx.roomCode,
                    validated.requesterId
                );
                if (!requester) {
                    throw new PlayerError(ERROR_CODES.PLAYER_NOT_FOUND, 'Requester not found in room');
                }
                const requesterSessionId = requester.sessionId;

                // Verify the requester is actually a spectator to prevent team players
                // — and teamless observers, who have seen the unmasked board — from
                // exploiting the spectator join flow. Role must be EXACTLY 'spectator'.
                if (requester.role !== 'spectator') {
                    throw PlayerError.notAuthorized();
                }

                if (validated.approved) {
                    const team = validated.team;
                    if (!team) {
                        throw new ValidationError('A team is required to approve a spectator join request');
                    }

                    // Seat the approved spectator onto the requested team as a CLICKER.
                    // Clicker (not spymaster) is the only safe seat: a spectator has only
                    // ever seen the masked board, so no key information leaks. If the team's
                    // clicker seat is already taken, setRole throws ROLE_TAKEN — revert the
                    // team move so the requester stays a clean spectator, and surface the
                    // error to the host.
                    await playerService.setTeam(requesterSessionId, team);
                    try {
                        await playerService.setRole(requesterSessionId, 'clicker');
                    } catch (roleErr) {
                        await playerService.setTeam(requesterSessionId, null).catch(() => {
                            /* best-effort revert */
                        });
                        throw roleErr;
                    }

                    // Tell the whole room the requester is now a team clicker.
                    safeEmitToRoom(io, ctx.roomCode, SOCKET_EVENTS.PLAYER_UPDATED, {
                        playerId: validated.requesterId,
                        changes: { team, role: 'clicker' },
                    });

                    // Notify the requester they've been approved (via their player: room).
                    // The client resyncs on this so its board, role banner, and socket
                    // room memberships (leaving the spectators room) update correctly.
                    safeEmitToPlayer(io, requesterSessionId, SOCKET_EVENTS.SPECTATOR_JOIN_APPROVED, {
                        team,
                        message: 'Your request to join a team has been approved',
                        timestamp: Date.now(),
                    });

                    logger.info(
                        `Host approved spectator ${sanitizeHtml(requester.nickname)} into ${team} team in room ${ctx.roomCode}`
                    );
                } else {
                    // Notify the requester they've been denied (via their player: room).
                    safeEmitToPlayer(io, requesterSessionId, SOCKET_EVENTS.SPECTATOR_JOIN_DENIED, {
                        message: 'Your request to join a team was denied',
                        timestamp: Date.now(),
                    });

                    logger.info(
                        `Host denied spectator ${sanitizeHtml(requester.nickname)} join request in room ${ctx.roomCode}`
                    );
                }
            }
        )
    );
}
