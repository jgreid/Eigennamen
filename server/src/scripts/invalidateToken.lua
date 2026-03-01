-- invalidateToken.lua
-- Description: Deletes a session's reconnection token and its associated mapping from Redis
--
-- KEYS[1]: Session key
--
-- Returns: 0 if token doesn't exist, 1 if invalidated

local sessionKey = KEYS[1]
local existingToken = redis.call('GET', sessionKey)
if not existingToken then
    return 0
end
redis.call('DEL', 'reconnect:token:' .. existingToken)
redis.call('DEL', sessionKey)
return 1
