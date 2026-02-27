local gameKey = KEYS[1]
local indexKey = KEYS[2]
local gameJson = ARGV[1]
local historyId = ARGV[2]
local timestamp = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])
local maxHistory = tonumber(ARGV[5])

-- Store the game history entry with TTL
redis.call('SET', gameKey, gameJson, 'EX', ttl)

-- Add to sorted set index (NX prevents duplicate entries)
redis.call('ZADD', indexKey, 'NX', timestamp, historyId)

-- Trim index to keep only the most recent games
redis.call('ZREMRANGEBYRANK', indexKey, 0, -(maxHistory + 1))

-- Set TTL on index
redis.call('EXPIRE', indexKey, ttl)

return 1
