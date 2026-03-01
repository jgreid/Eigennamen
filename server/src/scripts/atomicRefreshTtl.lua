-- atomicRefreshTtl.lua
-- Description: Atomically refreshes the TTL on all Redis keys associated with a room (room, players, game, and team sets).
--
-- KEYS[1]: Room key
-- KEYS[2]: Room players set key
-- KEYS[3]: Game key
-- KEYS[4]: Red team set key
-- KEYS[5]: Blue team set key
-- ARGV[1]: New TTL (seconds)
--
-- Returns: Always 1

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
