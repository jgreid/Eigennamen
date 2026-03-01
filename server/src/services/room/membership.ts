import type {
    JoinRoomResult,
    LeaveRoomResult,
} from '../../types/room';
import type { Player, PlayerGameState, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import * as playerService from '../playerService';
import * as gameService from '../gameService';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { normalizeRoomCode } from '../../utils/sanitize';
import {
    ROOM_MAX_PLAYERS,
    REDIS_TTL,
    LOCKS,
} from '../../config/constants';
import { RoomError, ServerError, GameStateError } from '../../errors/GameError';
import { ATOMIC_JOIN_SCRIPT, RELEASE_LOCK_SCRIPT } from '../../scripts';
import { getRoom, refreshRoomTTL, cleanupRoom } from '../roomService';

/**
 * Join an existing room
 * Uses Lua script for atomic capacity check and add to prevent race conditions
 * @param roomId - Room ID (case-insensitive)
 * @param sessionId - Player's session ID
 * @param nickname - Player's nickname
 */
export async function joinRoom(
    roomId: string,
    sessionId: string,
    nickname: string
): Promise<JoinRoomResult> {
    const redis: RedisClient = getRedis();

    // Normalize room ID (case-insensitive)
    const normalizedRoomId = normalizeRoomCode(roomId);

    // Get room (throws GameStateError on corrupted data)
    const room = await getRoom(normalizedRoomId);
    if (!room) {
        throw RoomError.notFound(roomId);
    }

    // Check if player is already in room (reconnecting)
    // Corrupted player data is cleaned up by getPlayer and treated as fresh join
    let player: Player | null;
    try {
        player = await playerService.getPlayer(sessionId);
    } catch {
        player = null;
    }
    let isReconnecting = false;

    if (player && player.roomCode === normalizedRoomId) {
        // Reconnection - update player status
        player = await playerService.updatePlayer(sessionId, { connected: true, lastSeen: Date.now() });
        isReconnecting = true;
        logger.info(`Player ${sessionId} reconnected to room "${roomId}"`);
    } else {
        // New join - use Lua script for atomic capacity check, set add, and player creation
        // Player data is now created atomically inside the Lua script,
        // eliminating the crash window between SADD and SET that could leave orphaned set members.
        const playerObj = playerService.buildPlayerData(sessionId, normalizedRoomId, nickname, false);
        const playerJSON = JSON.stringify(playerObj);

        const result = await withTimeout(
            redis.eval(
                ATOMIC_JOIN_SCRIPT,
                {
                    keys: [`room:${normalizedRoomId}:players`, `room:${normalizedRoomId}`],
                    arguments: [
                        ROOM_MAX_PLAYERS.toString(),
                        sessionId,
                        playerJSON,
                        `player:${sessionId}`,
                        REDIS_TTL.PLAYER.toString()
                    ]
                }
            ),
            TIMEOUTS.REDIS_OPERATION,
            `joinRoom-lua-${normalizedRoomId}`
        ) as number;

        if (result === -2) {
            // Room was deleted between getRoom() and the atomic script
            throw RoomError.notFound(roomId);
        }

        if (result === 0) {
            throw RoomError.full(roomId);
        }

        if (result === -1) {
            // Already a member but player data might be missing - treat as reconnection
            player = await playerService.createPlayer(sessionId, normalizedRoomId, nickname, false);
            isReconnecting = true;
        } else if (result === 1) {
            // Player was created atomically by the Lua script
            player = playerObj;
        } else {
            // Unexpected result - log and throw error
            logger.error('Unexpected result from room join script', { result, roomId });
            throw new ServerError('Failed to join room due to unexpected error');
        }

        logger.info(`Player ${nickname} (${sessionId}) joined room "${roomId}"`);
    }

    // Get current game if any (non-critical — don't fail join on corrupted game data)
    let gameState: PlayerGameState | null = null;
    try {
        const game = await gameService.getGame(normalizedRoomId);
        gameState = game ? gameService.getGameStateForPlayer(game, player) : null;
    } catch {
        logger.warn('Failed to load game state during join, proceeding without it', { roomId: normalizedRoomId });
    }

    // Refresh all room-related TTLs (non-critical — don't fail join if TTL refresh fails)
    try {
        await refreshRoomTTL(normalizedRoomId);
    } catch (ttlError) {
        logger.warn('Failed to refresh room TTL during join', {
            roomId: normalizedRoomId,
            error: (ttlError as Error).message
        });
    }

    // Ensure player is not null at this point
    if (!player) {
        throw new ServerError('Failed to create or retrieve player');
    }

    return {
        room,
        players: await playerService.getPlayersInRoom(normalizedRoomId),
        game: gameState,
        player,
        isReconnecting
    };
}

/**
 * Leave a room
 */
export async function leaveRoom(code: string, sessionId: string): Promise<LeaveRoomResult> {
    if (!code || typeof code !== 'string') {
        return { newHostId: null, roomDeleted: false };
    }
    const redis: RedisClient = getRedis();
    code = normalizeRoomCode(code);

    // Corrupted room data treated as "room gone" for leave purposes.
    // Redis/network errors are re-thrown so callers can handle them.
    let room;
    try {
        room = await getRoom(code);
    } catch (err) {
        if (err instanceof GameStateError) {
            // Room data exists but is corrupted — treat as "room gone"
            logger.warn(`Corrupted room data for ${code} during leave, treating as deleted`);
            room = null;
        } else {
            throw err;
        }
    }
    if (!room) {
        // Still remove the player even if room data is missing/corrupted
        await playerService.removePlayer(sessionId);
        return { newHostId: null, roomDeleted: false };
    }

    // Get remaining players (excluding the leaving player) for host transfer decision
    const allPlayers: Player[] = await playerService.getPlayersInRoom(code);
    const remainingPlayers = allPlayers.filter(p => p.sessionId !== sessionId);

    let newHostId: string | null = null;
    let roomDeleted = false;

    // Transfer host BEFORE removing the player so atomicHostTransfer can read old host data.
    // Previously removePlayer was called first, which deleted the old host's data and caused
    // atomicHostTransfer to always fail with OLD_HOST_NOT_FOUND, falling back to non-atomic path.
    // Uses distributed lock to prevent race with disconnectHandler's host transfer.
    const firstPlayer = remainingPlayers[0];
    if (room.hostSessionId === sessionId && remainingPlayers.length > 0 && firstPlayer) {
        const lockKey = `lock:host-transfer:${code}`;
        let lockAcquired = false;
        let lockValue: string | undefined;

        try {
            lockValue = `leave:${sessionId}:${Date.now()}`;
            const lockResult = await withTimeout(
                redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.HOST_TRANSFER }),
                TIMEOUTS.REDIS_OPERATION,
                `leaveRoom-hostTransferLock-${code}`
            );
            lockAcquired = lockResult === 'OK' || !!lockResult;

            if (lockAcquired) {
                newHostId = firstPlayer.sessionId;
                const transferResult = await playerService.atomicHostTransfer(sessionId, newHostId, code);
                if (!transferResult.success) {
                    logger.warn(`Non-atomic host transfer fallback for room ${code}: ${transferResult.reason}`);
                    // Fallback to non-atomic if Lua script fails (e.g., memory mode)
                    room.hostSessionId = newHostId;
                    await withTimeout(
                        redis.set(`room:${code}`, JSON.stringify(room), { EX: REDIS_TTL.ROOM }),
                        TIMEOUTS.REDIS_OPERATION,
                        `leaveRoom-set-hostTransfer-${code}`
                    );
                    await playerService.updatePlayer(newHostId, { isHost: true });
                }
            } else {
                logger.info(`Host transfer lock not acquired in leaveRoom for room ${code}, another handler is transferring`);
            }
        } catch (lockError) {
            logger.error(`Host transfer lock error in leaveRoom for room ${code}: ${(lockError as Error).message}`);
        } finally {
            if (lockAcquired && lockValue) {
                try {
                    await withTimeout(
                        redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
                        TIMEOUTS.REDIS_OPERATION,
                        `release-host-transfer-lock-leave-${code}`
                    );
                } catch (delErr) {
                    logger.error(`Failed to release host transfer lock in leaveRoom for ${code}: ${(delErr as Error).message}`);
                }
            }
        }
    }

    // Remove player after host transfer is complete
    await playerService.removePlayer(sessionId);

    // Re-check actual player count from Redis (not the stale snapshot) to handle
    // concurrent leaves that may have emptied the room since we fetched allPlayers
    const currentPlayers: Player[] = await playerService.getPlayersInRoom(code);
    if (currentPlayers.length === 0) {
        await cleanupRoom(code);
        roomDeleted = true;
    }

    return { newHostId, roomDeleted };
}
