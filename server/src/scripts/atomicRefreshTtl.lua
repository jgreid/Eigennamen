-- atomicRefreshTtl.lua
-- Description: Atomically refreshes the TTL on all Redis keys associated with a
-- room (room, players set, game, team sets, AND each member's player hash).
--
-- KEYS[1]: Room key
-- KEYS[2]: Room players set key
-- KEYS[3]: Game key
-- KEYS[4]: Red team set key
-- KEYS[5]: Blue team set key
-- ARGV[1]: New TTL (seconds) — applied to all of the above. REDIS_TTL.PLAYER
--          equals REDIS_TTL.ROOM, so one TTL is correct for player hashes too.
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

-- Refresh the players set TTL, and each member's player hash TTL. The per-event
-- `updatePlayer(lastSeen)` write that used to refresh active players'
-- `player:<id>` TTL was removed (F5 — it existed only for a never-emitted idle
-- feature); this debounced room-TTL refresh (fired on every game mutation) now
-- carries that side effect so seated players/bots don't expire mid-game.
if redis.call('EXISTS', playersKey) == 1 then
    redis.call('EXPIRE', playersKey, ttl)
    local members = redis.call('SMEMBERS', playersKey)
    for _, sessionId in ipairs(members) do
        local playerKey = 'player:' .. sessionId
        if redis.call('EXISTS', playerKey) == 1 then
            redis.call('EXPIRE', playerKey, ttl)
        end
    end
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
