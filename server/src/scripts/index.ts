/**
 * Centralized Lua Scripts Barrel
 *
 * All Redis Lua scripts used across the application are exported from here.
 * Scripts are organized by domain:
 * - File-based scripts (.lua files loaded from disk)
 * - Inline scripts (defined in this module, previously scattered across services)
 *
 * Note: Lock scripts (RELEASE_LOCK_SCRIPT, EXTEND_LOCK_SCRIPT) remain in
 * distributedLock.ts to avoid circular dependencies. gameService.ts imports
 * them directly from there.
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

/** Atomic clue giving with history */
export const GIVE_CLUE_SCRIPT: string = fs.readFileSync(path.join(__dirname, 'giveClue.lua'), 'utf8');

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

-- Atomically create player data (Sprint D1: eliminates crash window)
if playerData and playerData ~= '' then
    redis.call('SET', playerKey, playerData, 'EX', playerTTL)
end

return 1
`;

/**
 * Atomic TTL refresh of all room-related keys
 * Previously in: roomService.ts
 * ISSUE #8 FIX: Prevents TTL race condition by refreshing all keys atomically
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

// ─── Convenience grouped export ────────────────────────────────────

export const LUA_SCRIPTS = {
    // File-based (game operations)
    REVEAL_CARD: REVEAL_CARD_SCRIPT,
    GIVE_CLUE: GIVE_CLUE_SCRIPT,
    END_TURN: END_TURN_SCRIPT,
    UPDATE_PLAYER: UPDATE_PLAYER_SCRIPT,
    SAFE_TEAM_SWITCH: SAFE_TEAM_SWITCH_SCRIPT,
    SET_ROLE: SET_ROLE_SCRIPT,
    HOST_TRANSFER: HOST_TRANSFER_SCRIPT,

    // Room operations
    ATOMIC_CREATE_ROOM: ATOMIC_CREATE_ROOM_SCRIPT,
    ATOMIC_JOIN: ATOMIC_JOIN_SCRIPT,
    ATOMIC_REFRESH_TTL: ATOMIC_REFRESH_TTL_SCRIPT,
    ATOMIC_SET_ROOM_STATUS: ATOMIC_SET_ROOM_STATUS_SCRIPT,

    // Player operations
    ATOMIC_REMOVE_PLAYER: ATOMIC_REMOVE_PLAYER_SCRIPT,
    ATOMIC_SET_SOCKET_MAPPING: ATOMIC_SET_SOCKET_MAPPING_SCRIPT,
} as const;
