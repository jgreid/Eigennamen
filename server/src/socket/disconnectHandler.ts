import type { Server as SocketIOServer } from 'socket.io';
import type { Player, GameState, TimerCallback } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { TimerInfo } from './socketFunctionProvider';

import logger from '../utils/logger';
import { SOCKET_EVENTS, LOCKS, SESSION_SECURITY } from '../config/constants';
import { safeEmitToRoom } from './safeEmit';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { withLock } from '../utils/distributedLock';
import * as gameService from '../services/gameService';
import * as roomService from '../services/roomService';
import * as playerService from '../services/playerService';
import { invalidateGameStateCache } from './playerContext';
import { isRedisHealthy } from '../config/redis';

/**
 * Create the callback for timer expiration.
 *
 * The returned callback is invoked by the timer service when a turn timer
 * expires. It ends the current turn, broadcasts the result, and attempts
 * to restart the timer for the next turn using a distributed lock.
 *
 * @param emitToRoom - Function to emit events to a room
 * @param startTurnTimer - Function to start a turn timer
 */
function createTimerExpireCallback(
    emitToRoom: (roomCode: string, event: string, data: unknown) => void,
    startTurnTimer: (roomCode: string, durationSeconds: number) => Promise<TimerInfo>
): TimerCallback {
    return async (roomCode: string): Promise<void> => {
        try {
            // Use distributed lock to prevent race conditions when
            // multiple instances fire timer expiration for the same room.
            // Without this lock, concurrent endTurn calls could double-flip the turn.
            let result: { currentTurn: string; previousTurn: string } | null = null;
            try {
                result = await withLock(`timer-expire:${roomCode}`, async () => {
                    // Check if game is still active before ending turn (prevents race condition)
                    const game: GameState | null = await gameService.getGame(roomCode);
                    if (!game) {
                        logger.debug(`Timer expired for room ${roomCode} but no game found`);
                        return null;
                    }
                    if (game.gameOver) {
                        logger.debug(`Timer expired for room ${roomCode} but game already over`);
                        return null;
                    }

                    const turnResult = await gameService.endTurn(roomCode, 'Timer');
                    invalidateGameStateCache(roomCode);
                    return turnResult;
                }, { lockTimeout: 5000, maxRetries: 3 });
            } catch (lockError) {
                // If lock acquisition fails, another instance is handling this expiration
                logger.info(`Timer expiration lock not acquired for room ${roomCode}, skipping: ${(lockError as Error).message}`);
                return;
            }

            if (!result) {
                return;
            }

            emitToRoom(roomCode, SOCKET_EVENTS.GAME_TURN_ENDED, {
                currentTurn: result.currentTurn,
                previousTurn: result.previousTurn,
                reason: 'timerExpired'
            });
            emitToRoom(roomCode, SOCKET_EVENTS.TIMER_EXPIRED, { roomCode });

            // Restart timer for the new turn (if timer is configured and game not over)
            // Use distributed lock to prevent duplicate restarts when multiple
            // timer expirations queue setImmediate callbacks.
            // Wrapped in withTimeout to prevent indefinite hangs if Redis/lock ops stall.
            setImmediate(() => {
                withTimeout(
                    (async () => {
                        // Check Redis availability before attempting lock
                        const redisHealthy = await isRedisHealthy();
                        if (!redisHealthy) {
                            logger.warn(`Timer restart skipped for room ${roomCode}: Redis not healthy`);
                            return;
                        }

                        await withLock(`timer-restart:${roomCode}`, async () => {
                            const room = await roomService.getRoom(roomCode);
                            const currentGame: GameState | null = await gameService.getGame(roomCode);

                            if (!room) {
                                logger.warn(`Timer restart skipped for room ${roomCode}: room not found`);
                                return;
                            }
                            if (!room.settings || !room.settings.turnTimer) {
                                logger.debug(`Timer restart skipped for room ${roomCode}: timer not configured`);
                                return;
                            }
                            if (!currentGame) {
                                logger.warn(`Timer restart skipped for room ${roomCode}: game not found`);
                                return;
                            }
                            if (currentGame.gameOver) {
                                logger.debug(`Timer restart skipped for room ${roomCode}: game over (winner: ${currentGame.winner})`);
                                return;
                            }

                            await startTurnTimer(roomCode, room.settings.turnTimer);
                            logger.debug(`Timer restarted for room ${roomCode}, new turn: ${currentGame.currentTurn}`);
                        }, { lockTimeout: LOCKS.TIMER_RESTART * 1000, maxRetries: 3 });
                    })(),
                    TIMEOUTS.SOCKET_HANDLER,
                    `timer-restart-${roomCode}`
                ).catch(err => {
                    // Lock contention, timeout, or Redis failure — non-critical
                    logger.warn(`Timer restart skipped for room ${roomCode}: ${(err as Error).message}`);
                });
            });
        } catch (error) {
            logger.error(`Timer expiry error for room ${roomCode}:`, error);
        }
    };
}

/**
 * Handle player disconnection with room notification.
 * Uses distributed locks to prevent race conditions during host transfer.
 *
 * Generates reconnection token for secure reconnection.
 *
 * @param ioInstance - Socket.io server instance
 * @param socket - The disconnecting socket
 * @param reason - Disconnect reason string
 * @param abortSignal - Optional AbortSignal to cancel non-critical work after timeout
 */
async function handleDisconnect(
    ioInstance: SocketIOServer,
    socket: GameSocket,
    reason: string,
    abortSignal?: AbortSignal
): Promise<void> {
    try {
        const player: Player | null = await withTimeout(
            playerService.getPlayer(socket.sessionId),
            TIMEOUTS.REDIS_OPERATION,
            `disconnect-getPlayer-${socket.sessionId}`
        );

        if (!player) {
            return;
        }

        const roomCode = player.roomCode;

        // Generate reconnection token before marking as disconnected
        let reconnectionToken: string | null = null;
        try {
            reconnectionToken = await withTimeout(
                playerService.generateReconnectionToken(socket.sessionId),
                TIMEOUTS.REDIS_OPERATION,
                `disconnect-genToken-${socket.sessionId}`
            );
        } catch (tokenError) {
            logger.warn(`Failed to generate reconnection token for ${socket.sessionId}:`, (tokenError as Error).message);
        }

        // Update player's connected status
        await withTimeout(
            playerService.handleDisconnect(socket.sessionId),
            TIMEOUTS.REDIS_OPERATION,
            `disconnect-handleDisconnect-${socket.sessionId}`
        );

        // Check if we've been aborted (timed out) — skip remaining non-critical work
        if (abortSignal?.aborted) {
            logger.warn(`Disconnect handler aborted after critical work for socket ${socket.id}`);
            return;
        }

        // Notify other players in the room
        if (roomCode) {
            // Get updated player list to ensure clients have consistent state
            const updatedPlayers: Player[] = await withTimeout(
                playerService.getPlayersInRoom(roomCode),
                TIMEOUTS.REDIS_OPERATION,
                `disconnect-getPlayers-${roomCode}`
            );

            // Calculate reconnection deadline for frontend display
            const reconnectionDeadline = Date.now() + (SESSION_SECURITY.RECONNECTION_TOKEN_TTL_SECONDS * 1000);

            // Do NOT broadcast reconnection token to the room!
            // The token was previously broadcast to all players, allowing potential session hijacking.
            // Now the token is stored server-side only and validated during reconnection handshake.
            // The disconnecting player should proactively request their reconnection token via
            // 'room:getReconnectionToken' event BEFORE they disconnect (e.g., on 'beforeunload').
            safeEmitToRoom(ioInstance, roomCode, SOCKET_EVENTS.PLAYER_DISCONNECTED, {
                sessionId: socket.sessionId,
                nickname: player.nickname,
                team: player.team,
                reason: reason,
                timestamp: Date.now(),
                // Include updated player list for state consistency
                players: updatedPlayers,
                // Indicate player may reconnect and when the window closes
                // Token is NOT broadcast - stored server-side only for security
                reconnecting: !!reconnectionToken,
                reconnectionDeadline: reconnectionToken ? reconnectionDeadline : null
            });

            // Broadcast updated stats so clients reflect the disconnection
            const roomStats = await withTimeout(
                playerService.getRoomStats(roomCode, updatedPlayers),
                TIMEOUTS.REDIS_OPERATION,
                `disconnect-getRoomStats-${roomCode}`
            );
            safeEmitToRoom(ioInstance, roomCode, SOCKET_EVENTS.ROOM_STATS_UPDATED, { stats: roomStats });

            // Check abort before expensive host transfer
            if (abortSignal?.aborted) {
                logger.warn(`Disconnect handler aborted before host transfer for socket ${socket.id}`);
                return;
            }

            // Check if disconnected player was host - use distributed lock
            if (player.isHost) {
                try {
                    await withLock(`host-transfer:${roomCode}`, async () => {
                        // Re-check if the disconnected host has reconnected
                        // This prevents transferring host to someone else when the original host
                        // successfully reconnected within the grace period
                        const currentHostPlayer: Player | null = await playerService.getPlayer(socket.sessionId);
                        if (currentHostPlayer && currentHostPlayer.connected) {
                            logger.info(`Host ${socket.sessionId} reconnected before transfer, skipping host transfer for room ${roomCode}`);
                            return;
                        }

                        const players: Player[] | null = await playerService.getPlayersInRoom(roomCode);
                        if (!players || !Array.isArray(players)) {
                            logger.warn(`Unable to fetch players for host transfer in room ${roomCode}, room may be left without host`);
                            return;
                        }

                        const connectedPlayers = players.filter((p: Player) => p.connected && p.sessionId !== socket.sessionId);

                        if (connectedPlayers.length > 0) {
                            // Transfer host to first connected player
                            // Safe to cast: we just verified length > 0
                            const newHost = connectedPlayers[0] as Player;

                            // Use atomic host transfer to prevent race conditions
                            // This atomically updates old host, new host, and room in a single Lua script
                            const transferResult = await playerService.atomicHostTransfer(
                                socket.sessionId,
                                newHost.sessionId,
                                roomCode
                            );

                            if (transferResult.success) {
                                safeEmitToRoom(ioInstance, roomCode, SOCKET_EVENTS.ROOM_HOST_CHANGED, {
                                    newHostSessionId: newHost.sessionId,
                                    newHostNickname: newHost.nickname,
                                    reason: 'previousHostDisconnected'
                                });
                            } else {
                                logger.error(`Atomic host transfer failed: ${transferResult.reason}`, { roomCode });
                            }
                        }
                    }, { lockTimeout: LOCKS.HOST_TRANSFER * 1000, maxRetries: 5 });
                } catch (hostTransferError) {
                    // If lock acquisition fails, another instance is handling this transfer
                    logger.info(`Host transfer lock not acquired for room ${roomCode}: ${(hostTransferError as Error).message}`);
                }
            }
        }

    } catch (error) {
        logger.error('Error handling disconnect:', error);
    }
}

export {
    handleDisconnect,
    createTimerExpireCallback
};
