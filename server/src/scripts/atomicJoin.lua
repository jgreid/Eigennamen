-- atomicJoin.lua
-- Description: Atomically adds a player to a room after verifying the room exists, the player is not already a member, and capacity is not exceeded.
--
-- KEYS[1]: Room players set key
-- KEYS[2]: Room key
-- ARGV[1]: Max players limit
-- ARGV[2]: Session ID
-- ARGV[3]: Player data JSON
-- ARGV[4]: Player key
-- ARGV[5]: Player TTL (seconds)
--
-- Returns: 1 on success, -2 if room deleted, -1 if already member, 0 if full

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
