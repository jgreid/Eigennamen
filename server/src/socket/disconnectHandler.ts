/**
 * Socket Disconnect Handler
 *
 * Handles player disconnection logic including:
 * - Reconnection token generation
 * - Player status updates
 * - Room notifications
 * - Host transfer with distributed locking
 *
 * Also contains the timer expiration callback factory, which is
 * closely related to cleanup/state transitions on disconnect.
 *
 * Extracted from socket/index.ts for separation of concerns.
 */

import type { Server as SocketIOServer } from 'socket.io';
import type { Player, GameState, TimerCallback, RedisClient } from '../types';
import type { GameSocket } from './rateLimitHandler';
import type { TimerInfo } from './socketFunctionProvider';

import logger from '../utils/logger';
import { SOCKET_EVENTS, LOCKS } from '../config/constants';
import { safeEmitToRoom } from './safeEmit';
import { withTimeout, TIMEOUTS } from '../utils/timeout';
import { withLock } from '../utils/distributedLock';

// RedisClient imported from '../types' (shared across all services)

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
        const gameService = require('../services/gameService');
        const roomService = require('../services/roomService');
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

                    return await gameService.endTurn(roomCode, 'Timer');
                }, { lockTimeout: 5000, maxRetries: 3 });
            } catch (lockError) {
                // If lock acquisition fails, another instance is handling this expiration
                logger.debug(`Timer expiration lock not acquired for room ${roomCode}, skipping: ${(lockError as Error).message}`);
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
            // Use distributed lock with improved error handling
            // when multiple timer expirations queue setImmediate callbacks.
            // Wrap in IIFE with .catch() to prevent unhandled promise rejections
            setImmediate(() => {
                (async () => {
                    const { getRedis, isRedisHealthy } = require('../config/redis');
                    const redis: RedisClient = getRedis();
                    const lockKey = `lock:timer-restart:${roomCode}`;
                    let lockAcquired = false;
                    let lockValue: string | undefined;

                    try {
                        // Check Redis availability before attempting lock
                        const redisHealthy = await isRedisHealthy();
                        if (!redisHealthy) {
                            logger.warn(`Timer restart skipped for room ${roomCode}: Redis not healthy`);
                            return;
                        }

                        // Use centralized lock TTL from config
                        lockValue = `${process.pid}:${Date.now()}`;
                        const lockResult = await redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.TIMER_RESTART });
                        // Redis SET with NX returns 'OK' (node-redis v4) or null on failure.
                        lockAcquired = lockResult === 'OK' || !!lockResult;

                        if (!lockAcquired) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: another instance handling it`, {
                                lockKey
                            });
                            return;
                        }

                        logger.debug(`Timer restart lock acquired for room ${roomCode}`, {
                            lockKey,
                            lockValue,
                            ttlSeconds: LOCKS.TIMER_RESTART
                        });

                        const room = await roomService.getRoom(roomCode);
                        const currentGame: GameState | null = await gameService.getGame(roomCode);

                        if (!room) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: room not found`);
                            return;
                        }
                        if (!room.settings || !room.settings.turnTimer) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: timer not configured`);
                            return;
                        }
                        if (!currentGame) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: game not found`);
                            return;
                        }
                        if (currentGame.gameOver) {
                            logger.debug(`Timer restart skipped for room ${roomCode}: game over (winner: ${currentGame.winner})`);
                            return;
                        }

                        await startTurnTimer(roomCode, room.settings.turnTimer);
                        logger.debug(`Timer restarted for room ${roomCode}, new turn: ${currentGame.currentTurn}`);
                    } catch (err) {
                        logger.error(`Timer restart failed for room ${roomCode}: ${(err as Error).message}`);
                    } finally {
                        // Always release lock if we acquired it (owner-verified)
                        if (lockAcquired && lockValue) {
                            try {
                                const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
                                await withTimeout(
                                    redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
                                    TIMEOUTS.TIMER_OPERATION,
                                    `release-timer-restart-lock-${roomCode}`
                                );
                            } catch (delErr) {
                                logger.error(`Failed to release timer restart lock for ${roomCode}: ${(delErr as Error).message}`);
                            }
                        }
                    }
                })().catch(err => {
                    // Catch any unhandled promise rejections from the async IIFE
                    logger.error(`Unhandled timer restart error for room ${roomCode}:`, err);
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
    const playerService = require('../services/playerService');
    const { getRedis } = require('../config/redis');

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
            logger.debug(`Disconnect handler aborted after critical work for socket ${socket.id}`);
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
            const { SESSION_SECURITY } = require('../config/constants');
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
                logger.debug(`Disconnect handler aborted before host transfer for socket ${socket.id}`);
                return;
            }

            // Check if disconnected player was host - use lock with longer TTL
            if (player.isHost) {
                const redis: RedisClient = getRedis();
                const lockKey = `lock:host-transfer:${roomCode}`;
                let hostTransferLockAcquired = false;
                let hostLockValue: string | undefined;

                try {
                    // Use centralized lock TTL from config with unique value for owner-verified release
                    hostLockValue = `${socket.sessionId}:${Date.now()}`;
                    const lockResult = await redis.set(lockKey, hostLockValue, { NX: true, EX: LOCKS.HOST_TRANSFER });
                    // Redis SET with NX returns 'OK' (node-redis v4) or null on failure.
                    hostTransferLockAcquired = lockResult === 'OK' || !!lockResult;

                    if (hostTransferLockAcquired) {
                        // Re-check if the disconnected host has reconnected
                        // This prevents transferring host to someone else when the original host
                        // successfully reconnected within the grace period
                        const currentHostPlayer: Player | null = await playerService.getPlayer(socket.sessionId);
                        if (currentHostPlayer && currentHostPlayer.connected) {
                            logger.info(`Host ${socket.sessionId} reconnected before transfer, skipping host transfer for room ${roomCode}`);
                            // Skip host transfer - host is back
                        } else {
                            const players: Player[] | null = await playerService.getPlayersInRoom(roomCode);
                            // Don't early return - just skip transfer if we can't get players
                            // Early return was causing the rest of disconnect handling to be skipped
                            if (!players || !Array.isArray(players)) {
                                logger.warn(`Unable to fetch players for host transfer in room ${roomCode}, room may be left without host`);
                                // Continue to finally block to release lock, but skip transfer
                            } else {
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
                            }
                        }
                    } else {
                        logger.debug(`Host transfer lock not acquired for room ${roomCode}, another instance handling it`);
                    }
                } catch (hostTransferError) {
                    logger.error(`Host transfer failed for room ${roomCode}: ${(hostTransferError as Error).message}`);
                } finally {
                    // Only release lock if we acquired it (owner-verified)
                    if (hostTransferLockAcquired && hostLockValue) {
                        try {
                            const { RELEASE_LOCK_SCRIPT } = require('../utils/distributedLock');
                            await withTimeout(
                                redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [hostLockValue] }),
                                TIMEOUTS.TIMER_OPERATION,
                                `release-host-transfer-lock-${roomCode}`
                            );
                        } catch (delErr) {
                            logger.error(`Failed to release host transfer lock for ${roomCode}: ${(delErr as Error).message}`);
                        }
                    }
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
