local sessionKey = KEYS[1]
local existingToken = redis.call('GET', sessionKey)
if not existingToken then
    return 0
end
redis.call('DEL', 'reconnect:token:' .. existingToken)
redis.call('DEL', sessionKey)
return 1
