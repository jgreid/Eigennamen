-- cleanupOrphanedToken.lua
-- Description: Removes a reconnection token if its associated player no longer exists in Redis
--
-- KEYS[1]: Session key (e.g., `session:<sessionId>`)
-- KEYS[2]: Player key (e.g., `player:<sessionId>`)
--
-- Returns: 0 if player still exists, 1 if orphaned token cleaned up

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
