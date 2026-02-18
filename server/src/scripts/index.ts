/**
 * Centralized Lua Scripts Barrel
 *
 * All Redis Lua scripts used across the application are exported from here.
 * Scripts are organized by domain:
 * - File-based scripts (.lua files loaded from disk)
 * - Inline scripts (defined in this module, previously scattered across services)
 *
 * Usage:
 *   import { ATOMIC_CREATE_ROOM_SCRIPT } from '../scripts';
 *   await redis.eval(ATOMIC_CREATE_ROOM_SCRIPT, { keys: [...], arguments: [...] });
 *
 *   // Or use the grouped export:
 *   import { LUA_SCRIPTS } from '../scripts';
 *   await redis.eval(LUA_SCRIPTS.ATOMIC_CREATE_ROOM, { keys: [...], arguments: [...] });
 */

import fs from 'fs';
import path from 'path';

// ─── File-based Lua scripts (loaded from .lua files) ───────────────

/** Atomic card reveal with game state updates */
export const REVEAL_CARD_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'revealCard.lua'), 'utf8');

/** Atomic turn end with score updates */
export const END_TURN_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'endTurn.lua'), 'utf8');

/** Atomic player field updates with TTL refresh */
export const UPDATE_PLAYER_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'updatePlayer.lua'), 'utf8');

/** Atomic team change with empty-team validation */
export const SAFE_TEAM_SWITCH_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'safeTeamSwitch.lua'), 'utf8');

/** Atomic role assignment with conflict checking */
export const SET_ROLE_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'setRole.lua'), 'utf8');

/** Atomic host transfer with fallback */
export const HOST_TRANSFER_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'hostTransfer.lua'), 'utf8');

// ─── Inline Lua scripts (previously in service files) ──────────────

/**
 * Atomic room creation using SETNX
 * Previously in: roomService.ts
 * Returns: 1 if created, 0 if exists
 */
export const ATOMIC_CREATE_ROOM_SCRIPT = `
local roomKey = KEYS[1]
local playersKey = KEYS[2]
local roomData = ARGV[1]
local ttl = tonumber(ARGV[2])

-- Atomically try to create the room (only if it doesn't exist)
local created = redis.call('SETNX', roomKey, roomData)
if created == 0 then
    return 0
end

-- Set TTL on the room
redis.call('EXPIRE', roomKey, ttl)

-- Clean up any stale players set from a previous room with the same code
redis.call('DEL', playersKey)

return 1
`;

/**
 * Atomic room join with capacity check and player creation
 * Previously in: roomService.ts
 * Returns: 1=success, 0=full, -1=already member, -2=room deleted
 */
export const ATOMIC_JOIN_SCRIPT = `
local playersKey = KEYS[1]
local roomKey = KEYS[2]
local maxPlayers = tonumber(ARGV[1])
local sessionId = ARGV[2]
local playerData = ARGV[3]
local playerKey = ARGV[4]
local playerTTL = tonumber(ARGV[5])

-- Verify room still exists (prevents orphaned player sets if room was deleted between getRoom and this script)
if redis.call('EXISTS', roomKey) == 0 then
    return -2
end

-- Check if already a member
if redis.call('SISMEMBER', playersKey, sessionId) == 1 then
    return -1
end

-- Check capacity and add atomically
local currentCount = redis.call('SCARD', playersKey)
if currentCount >= maxPlayers then
    return 0
end

redis.call('SADD', playersKey, sessionId)

-- Atomically create player data (eliminates crash window)
if playerData and playerData ~= '' then
    redis.call('SET', playerKey, playerData, 'EX', playerTTL)
end

return 1
`;

/**
 * Atomic TTL refresh of all room-related keys
 * Previously in: roomService.ts
 * Prevents TTL race condition by refreshing all keys atomically
 */
export const ATOMIC_REFRESH_TTL_SCRIPT = `
local roomKey = KEYS[1]
local playersKey = KEYS[2]
local gameKey = KEYS[3]
local redTeamKey = KEYS[4]
local blueTeamKey = KEYS[5]
local ttl = tonumber(ARGV[1])

-- Refresh room TTL (only if key exists)
if redis.call('EXISTS', roomKey) == 1 then
    redis.call('EXPIRE', roomKey, ttl)
end

-- Refresh players list TTL (only if key exists)
if redis.call('EXISTS', playersKey) == 1 then
    redis.call('EXPIRE', playersKey, ttl)
end

-- Refresh game TTL (only if key exists)
if redis.call('EXISTS', gameKey) == 1 then
    redis.call('EXPIRE', gameKey, ttl)
end

-- Refresh team sets TTL (only if key exists)
if redis.call('EXISTS', redTeamKey) == 1 then
    redis.call('EXPIRE', redTeamKey, ttl)
end
if redis.call('EXISTS', blueTeamKey) == 1 then
    redis.call('EXPIRE', blueTeamKey, ttl)
end

return 1
`;

/**
 * Atomic room status update (prevents TOCTOU race)
 * Previously in: gameService.ts
 */
export const ATOMIC_SET_ROOM_STATUS_SCRIPT = `
local roomKey = KEYS[1]
local newStatus = ARGV[1]
local ttl = tonumber(ARGV[2])

local roomData = redis.call('GET', roomKey)
if not roomData then
    return nil
end

local room = cjson.decode(roomData)
room.status = newStatus
redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)
return 'OK'
`;

/**
 * Atomic player removal from room and team sets
 * Previously in: playerService.ts
 * Returns: player data JSON on success, nil if not found
 */
export const ATOMIC_REMOVE_PLAYER_SCRIPT = `
local playerKey = KEYS[1]
local sessionId = ARGV[1]

-- Get player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)
local roomCode = player.roomCode
local team = player.team

-- Remove from room's player set
if roomCode then
    redis.call('SREM', 'room:' .. roomCode .. ':players', sessionId)
    -- Remove from team set if player was on a team
    if team and team ~= cjson.null then
        redis.call('SREM', 'room:' .. roomCode .. ':team:' .. team, sessionId)
    end
end

-- Delete player data
redis.call('DEL', playerKey)

return playerData
`;

/**
 * Atomic cleanup of a disconnected player.
 * Checks that the player is still disconnected before removing,
 * preventing a TOCTOU race where a player reconnects between the
 * cleanup scheduler's read and the removal.
 * Returns: player data JSON on success, 'RECONNECTED' if connected, nil if not found
 */
export const ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT = `
local playerKey = KEYS[1]
local sessionId = ARGV[1]

-- Get player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)

-- Guard: only remove if still disconnected
if player.connected then
    return 'RECONNECTED'
end

local roomCode = player.roomCode
local team = player.team

-- Remove from room's player set
if roomCode then
    redis.call('SREM', 'room:' .. roomCode .. ':players', sessionId)
    if team and team ~= cjson.null then
        redis.call('SREM', 'room:' .. roomCode .. ':team:' .. team, sessionId)
    end
end

-- Delete player data
redis.call('DEL', playerKey)

return playerData
`;

/**
 * Atomic socket mapping + IP update
 * Previously in: playerService.ts
 * Returns: 1 on success, nil if player not found
 */
export const ATOMIC_SET_SOCKET_MAPPING_SCRIPT = `
local playerKey = KEYS[1]
local socketKey = KEYS[2]
local socketId = ARGV[1]
local socketTTL = tonumber(ARGV[2])
local playerTTL = tonumber(ARGV[3])
local lastIP = ARGV[4]
local now = ARGV[5]

-- Verify player exists
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

-- Set socket mapping
redis.call('SET', socketKey, socketId, 'EX', socketTTL)

-- Update player lastIP and lastSeen if IP provided
if lastIP ~= '' then
    local player = cjson.decode(playerData)
    player.lastIP = lastIP
    player.lastSeen = tonumber(now)
    redis.call('SET', playerKey, cjson.encode(player), 'EX', playerTTL)
end

return 1
`;

// ─── Room settings script (previously in roomService.ts) ────────────

/**
 * Atomic room settings update
 * Previously in: roomService.ts
 * Validates host, merges allowed keys, enforces blitz constraints
 */
export const ATOMIC_UPDATE_SETTINGS_SCRIPT = `
local roomKey = KEYS[1]
local sessionId = ARGV[1]
local settingsJson = ARGV[2]
local blitzForcedTimer = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local roomData = redis.call('GET', roomKey)
if not roomData then
    return cjson.encode({error = 'ROOM_NOT_FOUND'})
end

local room = cjson.decode(roomData)

if room.hostSessionId ~= sessionId then
    return cjson.encode({error = 'NOT_HOST'})
end

local newSettings = cjson.decode(settingsJson)

-- Merge only allowed keys into existing settings
if not room.settings then
    room.settings = {}
end
if newSettings.teamNames ~= nil then room.settings.teamNames = newSettings.teamNames end
if newSettings.turnTimer ~= nil then room.settings.turnTimer = newSettings.turnTimer end
if newSettings.allowSpectators ~= nil then room.settings.allowSpectators = newSettings.allowSpectators end
if newSettings.gameMode ~= nil then room.settings.gameMode = newSettings.gameMode end

-- Enforce blitz constraints
if room.settings.gameMode == 'blitz' then
    room.settings.turnTimer = blitzForcedTimer
end

redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)

return cjson.encode({success = true, settings = room.settings})
`;

// ─── Timer scripts (previously in timerService.ts) ──────────────────

/**
 * Atomic addTime operation for turn timers
 * Previously in: timerService.ts
 * Reads current timer, calculates new duration, and updates atomically
 * Returns: new end time if successful, nil if timer doesn't exist or is expired
 */
export const ATOMIC_ADD_TIME_SCRIPT = `
local timerKey = KEYS[1]
local secondsToAdd = tonumber(ARGV[1])
local instanceId = ARGV[2]

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local timer = cjson.decode(timerData)
if timer.paused then
    return nil
end

local now = tonumber(ARGV[3])
local remainingMs = timer.endTime - now
if remainingMs <= 0 then
    return nil
end

-- Get TTL buffer from arguments instead of hardcoding
local ttlBuffer = tonumber(ARGV[4]) or 60

-- Calculate new end time
local newEndTime = timer.endTime + (secondsToAdd * 1000)
local newDuration = math.ceil((newEndTime - now) / 1000)

-- Update timer
timer.endTime = newEndTime
timer.duration = newDuration
timer.instanceId = instanceId

-- Calculate new TTL (duration + buffer from constant)
local newTtl = newDuration + ttlBuffer

redis.call('SET', timerKey, cjson.encode(timer), 'EX', newTtl)
return cjson.encode({endTime = newEndTime, duration = newDuration, remainingSeconds = newDuration})
`;

/**
 * Atomic timer status check with expiration detection
 * Prevents TOCTOU race in multi-instance deployments:
 * reads timer state and checks for expiration in a single atomic operation.
 * If the timer has expired while paused, it is deleted and 'EXPIRED' is returned.
 * Returns: JSON timer status, 'EXPIRED' if expired while paused, nil if no timer
 */
export const ATOMIC_TIMER_STATUS_SCRIPT = `
local timerKey = KEYS[1]
local now = tonumber(ARGV[1])

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local timer = cjson.decode(timerData)

-- Handle paused timer: check if it would have expired during pause
if timer.paused and timer.pausedAt and timer.remainingWhenPaused then
    local pausedDuration = now - timer.pausedAt
    local remainingMs = timer.remainingWhenPaused * 1000
    if pausedDuration >= remainingMs then
        -- Timer expired while paused — clean it up atomically
        redis.call('DEL', timerKey)
        return 'EXPIRED'
    end
    -- Still paused, return remaining time
    return cjson.encode({
        startTime = timer.startTime,
        endTime = timer.endTime,
        duration = timer.duration,
        remainingSeconds = timer.remainingWhenPaused,
        expired = false,
        isPaused = true
    })
end

-- Active timer: calculate remaining
local remainingMs = timer.endTime - now
local expired = remainingMs <= 0
local remainingSeconds = expired and 0 or math.ceil(remainingMs / 1000)

return cjson.encode({
    startTime = timer.startTime,
    endTime = timer.endTime,
    duration = timer.duration,
    remainingSeconds = remainingSeconds,
    expired = expired,
    isPaused = false
})
`;

// ─── Reconnection scripts (previously in player/reconnection.ts) ────

/**
 * Atomic reconnection token invalidation
 * Previously in: player/reconnection.ts
 * Reads the token from the session mapping, then deletes both the
 * token->session and session->token keys in a single atomic operation.
 * Returns 1 if a token was invalidated, 0 if no token existed.
 */
export const INVALIDATE_TOKEN_SCRIPT = `
local sessionKey = KEYS[1]
local existingToken = redis.call('GET', sessionKey)
if not existingToken then
    return 0
end
redis.call('DEL', 'reconnect:token:' .. existingToken)
redis.call('DEL', sessionKey)
return 1
`;

/**
 * Atomic cleanup of orphaned reconnection tokens
 * Previously in: player/reconnection.ts
 * Checks if a player exists and, if not, cleans up the orphaned token pair.
 * KEYS[1] = reconnect:session:<sessionId>
 * KEYS[2] = player:<sessionId>
 * Returns 1 if cleaned, 0 if player still exists.
 */
export const CLEANUP_ORPHANED_TOKEN_SCRIPT = `
local sessionKey = KEYS[1]
local playerKey = KEYS[2]
local playerData = redis.call('GET', playerKey)
if playerData then
    return 0
end
local tokenId = redis.call('GET', sessionKey)
if tokenId then
    redis.call('DEL', 'reconnect:token:' .. tokenId)
end
redis.call('DEL', sessionKey)
return 1
`;

// ─── Lock scripts (previously in utils/distributedLock.ts) ──────────

/**
 * Safe lock release (only release if we own the lock)
 * Previously in: utils/distributedLock.ts
 */
export const RELEASE_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
`;

/**
 * Lock extension (only extend if we own the lock)
 * Previously in: utils/distributedLock.ts
 */
export const EXTEND_LOCK_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ARGV[2])
else
    return 0
end
`;

