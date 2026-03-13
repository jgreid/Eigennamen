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

-- Check capacity
local currentCount = redis.call('SCARD', playersKey)
if currentCount >= maxPlayers then
    return 0
end

-- Write player data BEFORE adding to the players set.
-- If Redis crashes after SET but before SADD, we get harmless orphan data
-- (expires via TTL). The reverse order (SADD first) would leave a phantom
-- set member with no backing data, causing null-player bugs.
if playerData and playerData ~= '' then
    redis.call('SET', playerKey, playerData, 'EX', playerTTL)
end

redis.call('SADD', playersKey, sessionId)

-- Refresh players set TTL to match room TTL, preventing orphaned player sets
-- when the room key is refreshed but the players set expires independently
local roomTTL = redis.call('TTL', roomKey)
if roomTTL > 0 then
    redis.call('EXPIRE', playersKey, roomTTL)
end

return 1
