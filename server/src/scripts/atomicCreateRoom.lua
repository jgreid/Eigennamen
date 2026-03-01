local roomKey = KEYS[1]
local playersKey = KEYS[2]
local roomData = ARGV[1]
local ttl = tonumber(ARGV[2])
-- Optional: host player key for atomic host creation
local playerKey = KEYS[3]
local playerData = ARGV[3]
local playerTtl = ARGV[4] and tonumber(ARGV[4])
local sessionId = ARGV[5]

-- Atomically try to create the room (only if it doesn't exist)
local created = redis.call('SETNX', roomKey, roomData)
if created == 0 then
    return 0
end

-- Set TTL on the room
redis.call('EXPIRE', roomKey, ttl)

-- Clean up any stale players set from a previous room with the same code
redis.call('DEL', playersKey)

-- If host player data is provided, create player atomically with the room
if playerKey and playerData and playerTtl and sessionId then
    redis.call('SET', playerKey, playerData, 'EX', playerTtl)
    redis.call('SADD', playersKey, sessionId)
    redis.call('EXPIRE', playersKey, ttl)
end

return 1
