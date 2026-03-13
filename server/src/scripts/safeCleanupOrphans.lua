-- safeCleanupOrphans.lua
-- Description: Atomically cleans up orphaned session IDs from room sets.
-- For each session ID, re-verifies the player key is still nil before removing
-- from sets and deleting associated keys. This prevents a TOCTOU race where
-- a reconnecting player's data is destroyed by a concurrent cleanup.
--
-- KEYS[1]: Room players set key (room:{code}:players)
-- KEYS[2]: Red team set key (room:{code}:team:red)
-- KEYS[3]: Blue team set key (room:{code}:team:blue)
-- ARGV[1]: Number of orphaned sessions (N)
-- ARGV[2..N+1]: Session IDs
--
-- Returns: Number of sessions actually cleaned up

local playersKey = KEYS[1]
local redTeamKey = KEYS[2]
local blueTeamKey = KEYS[3]
local count = tonumber(ARGV[1])
local cleaned = 0

for i = 1, count do
    local sessionId = ARGV[i + 1]
    local playerKey = 'player:' .. sessionId
    local socketKey = 'session:' .. sessionId .. ':socket'

    -- Re-verify the player key is still nil (not recreated by a reconnection)
    local val = redis.call('GET', playerKey)
    if not val then
        redis.call('SREM', playersKey, sessionId)
        redis.call('SREM', redTeamKey, sessionId)
        redis.call('SREM', blueTeamKey, sessionId)
        redis.call('DEL', socketKey)
        cleaned = cleaned + 1
    end
end

return cleaned
