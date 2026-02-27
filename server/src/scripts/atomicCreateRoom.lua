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
