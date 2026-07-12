import type { JoinRoomResult, LeaveRoomResult } from '../../types/room';
import type { Player, PlayerGameState, RedisClient } from '../../types';

import { getRedis } from '../../config/redis';
import logger from '../../utils/logger';
import * as playerService from '../playerService';
import * as gameService from '../gameService';
import { withTimeout, TIMEOUTS } from '../../utils/timeout';
import { normalizeRoomCode } from '../../utils/sanitize';
import { ROOM_MAX_PLAYERS, REDIS_TTL, LOCKS, SOCKET_EVENTS } from '../../config/constants';
import { RoomError, ServerError, GameStateError } from '../../errors/GameError';
import { ATOMIC_JOIN_SCRIPT, RELEASE_LOCK_SCRIPT } from '../../scripts';
import { getSocketFunctions, isRegistered as socketFunctionsRegistered } from '../../socket/socketFunctionProvider';
import { getRoom, refreshRoomTTL, cleanupRoom } from '../roomService';

/**
 * Join an existing room
 * Uses Lua script for atomic capacity check and add to prevent race conditions
 * @param roomId - Room ID (case-insensitive)
 * @param sessionId - Player's session ID
 * @param nickname - Player's nickname
 */
export async function joinRoom(roomId: string, sessionId: string, nickname: string): Promise<JoinRoomResult> {
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
        // Enforce allowSpectators (F2): a brand-new joiner arrives with no team,
        // so mid-game they can only ever be a spectator. If the host disabled
        // spectators, reject rather than silently seating a hidden watcher who
        // still receives every board broadcast. Pre-game lobby joins are
        // unaffected (they pick a team), and an existing member reconnecting with
        // a lost player hash is let through (checked against the players set).
        if (room.settings?.allowSpectators === false) {
            let activeGame = null;
            try {
                activeGame = await gameService.getGame(normalizedRoomId);
            } catch {
                activeGame = null; // corrupted game data → don't block the join on it
            }
            if (activeGame && !activeGame.gameOver) {
                const alreadyMember = await withTimeout(
                    redis.sIsMember(`room:${normalizedRoomId}:players`, sessionId),
                    TIMEOUTS.REDIS_OPERATION,
                    `joinRoom-spectatorCheck-${normalizedRoomId}`
                );
                if (!alreadyMember) {
                    throw RoomError.spectatorsNotAllowed(roomId);
                }
            }
        }

        // New join - use Lua script for atomic capacity check, set add, and player creation
        // Player data is now created atomically inside the Lua script,
        // eliminating the crash window between SADD and SET that could leave orphaned set members.
        const playerObj = playerService.buildPlayerData(sessionId, normalizedRoomId, nickname, false);
        const playerJSON = JSON.stringify(playerObj);

        const result = (await withTimeout(
            redis.eval(ATOMIC_JOIN_SCRIPT, {
                keys: [`room:${normalizedRoomId}:players`, `room:${normalizedRoomId}`],
                arguments: [
                    ROOM_MAX_PLAYERS.toString(),
                    sessionId,
                    playerJSON,
                    `player:${sessionId}`,
                    REDIS_TTL.PLAYER.toString(),
                ],
            }),
            TIMEOUTS.REDIS_OPERATION,
            `joinRoom-lua-${normalizedRoomId}`
        )) as number;

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
            error: (ttlError as Error).message,
        });
    }

    // Ensure player is not null at this point
    if (!player) {
        throw new ServerError('Failed to create or retrieve player');
    }

    // A human joining (or rejoining) a bot-hosted room must displace the
    // placeholder host (see ensureRoomHasHost) — otherwise a room whose humans
    // all dropped stays uncontrollable for every newcomer during the grace
    // window. Best-effort: never fail the join over the repair.
    if (!player.isBot) {
        try {
            await ensureRoomHasHost(normalizedRoomId);
        } catch (repairErr) {
            logger.warn(`Host repair during join failed: ${(repairErr as Error).message}`);
        }
    }

    // Re-read room data after join to avoid returning stale settings
    // (room config may have changed between initial getRoom and Lua script execution)
    const freshRoom = await getRoom(normalizedRoomId);

    return {
        room: freshRoom || room,
        players: await playerService.getPlayersInRoom(normalizedRoomId),
        game: gameState,
        player,
        isReconnecting,
    };
}

/**
 * Choose the best host successor from a candidate pool.
 *
 * A human ALWAYS beats a bot: a bot is a first-class player that never
 * disconnects but can run no host-only function (start game, settings, kick,
 * add/remove bot, pause), so a bot only ever gets host as the last resort that
 * keeps the room alive while no human is connected — `ensureRoomHasHost`
 * displaces a bot host as soon as a connected human is back (reconnect, resync
 * and join all run it). Preference order: connected human → any human → connected non-human
 * (last resort so an in-progress transfer still names someone). Returns null if
 * the pool is empty or holds only disconnected bots.
 *
 * Shared by the disconnect and explicit-leave host-transfer paths so their
 * selection can't drift (the leave path previously took `remainingPlayers[0]`
 * with no filter and could hand host to a bot — N3).
 */
export function selectHostSuccessor(candidates: Player[]): Player | null {
    return (
        candidates.find((p) => p.connected && !p.isBot) ??
        candidates.find((p) => !p.isBot) ??
        candidates.find((p) => p.connected) ??
        null
    );
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
    const remainingPlayers = allPlayers.filter((p) => p.sessionId !== sessionId);

    let newHostId: string | null = null;
    let roomDeleted = false;

    // Transfer host BEFORE removing the player so atomicHostTransfer can read old host data.
    // Previously removePlayer was called first, which deleted the old host's data and caused
    // atomicHostTransfer to always fail with OLD_HOST_NOT_FOUND, falling back to non-atomic path.
    // Uses distributed lock to prevent race with disconnectHandler's host transfer.
    // Prefer a connected human successor; never hand host to a bot (N3). If only
    // bots remain, firstPlayer is null and we skip the transfer — the room is torn
    // down below anyway (no humans remain).
    const firstPlayer = selectHostSuccessor(remainingPlayers);
    if (room.hostSessionId === sessionId && firstPlayer) {
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
                logger.info(
                    `Host transfer lock not acquired in leaveRoom for room ${code}, another handler is transferring`
                );
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
                    logger.error(
                        `Failed to release host transfer lock in leaveRoom for ${code}: ${(delErr as Error).message}`
                    );
                }
            }
        }
    }

    // Remove player after host transfer is complete
    await playerService.removePlayer(sessionId);

    // Re-check actual player count from Redis (not the stale snapshot) to handle
    // concurrent leaves that may have emptied the room since we fetched allPlayers.
    // Bots are first-class players that never disconnect, so a room left with only
    // bots would otherwise never be cleaned up here — treat "no humans remain" the
    // same as empty and tear the room (and its bots) down.
    const currentPlayers: Player[] = await playerService.getPlayersInRoom(code);
    const humansRemaining = currentPlayers.filter((p: Player) => !p.isBot).length;
    if (currentPlayers.length === 0 || humansRemaining === 0) {
        await cleanupRoom(code);
        roomDeleted = true;
    }

    return { newHostId, roomDeleted };
}

/**
 * Lazy host repair (A10): if a room's recorded `hostSessionId` no longer resolves
 * to an existing player — because the host was removed by grace-period cleanup or
 * key-TTL expiry with no connected candidate at that instant, so no deferred
 * transfer was left — the room is hostless forever and nobody can start a game,
 * change settings, kick, add bots, or pause it. Promote the first connected human
 * (bots can't run host functions). A no-op when the host record still exists.
 *
 * Returns the (possibly new) host session id, or null if the room is gone or has
 * no connected human to promote (a human-less room is torn down by cleanup; a
 * bots-only room can't be hosted anyway).
 */
export async function ensureRoomHasHost(code: string): Promise<string | null> {
    const redis: RedisClient = getRedis();
    const normalized = normalizeRoomCode(code);

    const room = await getRoom(normalized);
    if (!room) return null;

    // Host record still resolves to a HUMAN → nothing to repair. A bot host is
    // a PLACEHOLDER, not an owner: it can run no host-only function
    // (game:start, room:settings, bot:add/remove, kick), so a bot-hosted room
    // is exactly as locked for its human members as a hostless one. A bot
    // gets host by design when the last connected human disconnects (the
    // transfer's last-resort fallback keeps the room alive through the
    // reconnect grace window) — but the moment a human is connected again
    // they must displace it, or the room stays uncontrollable until TTL
    // teardown (live-play finding: the returning host could not start the
    // next game).
    let currentHost: Player | null = null;
    if (room.hostSessionId) {
        currentHost = await playerService.getPlayer(room.hostSessionId);
        if (currentHost && !currentHost.isBot) return room.hostSessionId;
    }

    const players = await playerService.getPlayersInRoom(normalized);
    const candidate = players.find((p) => p.connected && !p.isBot);
    // No connected human to promote: keep a live bot placeholder (the room is
    // being held for a reconnect; bots-only rooms are torn down by cleanup) —
    // but a DANGLING host record (player reaped) stays reported as null, as
    // before.
    if (!candidate) return currentHost ? (room.hostSessionId ?? null) : null;

    // Promote under the host-transfer lock so we don't race disconnectHandler /
    // leaveRoom doing their own transfer.
    const lockKey = `lock:host-transfer:${normalized}`;
    const lockValue = `repair:${candidate.sessionId}:${Date.now()}`;
    let lockAcquired = false;
    try {
        const lockResult = await withTimeout(
            redis.set(lockKey, lockValue, { NX: true, EX: LOCKS.HOST_TRANSFER }),
            TIMEOUTS.REDIS_OPERATION,
            `ensureRoomHasHost-lock-${normalized}`
        );
        lockAcquired = lockResult === 'OK' || !!lockResult;
        if (!lockAcquired) {
            // Another handler is transferring host right now — let it win.
            return room.hostSessionId ?? null;
        }

        // Re-read inside the lock to avoid acting on stale state.
        const fresh = await getRoom(normalized);
        if (!fresh) return null;
        if (fresh.hostSessionId) {
            const stillHost = await playerService.getPlayer(fresh.hostSessionId);
            // Same bot-placeholder rule as the unlocked pre-check above.
            if (stillHost && !stillHost.isBot) return fresh.hostSessionId; // repaired by someone else meanwhile
        }

        const displacedHostId = fresh.hostSessionId ?? null;
        fresh.hostSessionId = candidate.sessionId;
        await withTimeout(
            redis.set(`room:${normalized}`, JSON.stringify(fresh), { EX: REDIS_TTL.ROOM }),
            TIMEOUTS.REDIS_OPERATION,
            `ensureRoomHasHost-set-${normalized}`
        );
        await playerService.updatePlayer(candidate.sessionId, { isHost: true });
        // Clear the displaced (bot) host's stale flag so exactly one player
        // reads isHost — best-effort: the room record above is authoritative.
        if (displacedHostId && displacedHostId !== candidate.sessionId) {
            await playerService
                .updatePlayer(displacedHostId, { isHost: false })
                .catch((err: Error) => logger.warn(`Could not clear displaced host flag: ${err.message}`));
        }
        logger.info(`Lazy host repair: promoted ${candidate.sessionId} to host of room ${normalized}`);
        // Tell the room (best-effort; unregistered in unit tests/harness). The
        // repairing client itself gets fresh isHost in its own reconnect/resync/
        // join payload — this broadcast is for everyone else's host display.
        if (socketFunctionsRegistered()) {
            try {
                getSocketFunctions().emitToRoom(normalized, SOCKET_EVENTS.ROOM_HOST_CHANGED, {
                    newHostPlayerId: playerService.derivePlayerId(candidate.sessionId),
                    newHostNickname: candidate.nickname,
                    reason: 'hostRepaired',
                });
            } catch (emitErr) {
                logger.warn(`Host-repair broadcast failed: ${(emitErr as Error).message}`);
            }
        }
        return candidate.sessionId;
    } catch (err) {
        logger.error(`ensureRoomHasHost failed for room ${normalized}: ${(err as Error).message}`);
        return null;
    } finally {
        if (lockAcquired) {
            try {
                await withTimeout(
                    redis.eval(RELEASE_LOCK_SCRIPT, { keys: [lockKey], arguments: [lockValue] }),
                    TIMEOUTS.REDIS_OPERATION,
                    `ensureRoomHasHost-release-${normalized}`
                );
            } catch {
                /* best-effort */
            }
        }
    }
}
