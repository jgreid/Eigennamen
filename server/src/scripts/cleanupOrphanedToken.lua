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
