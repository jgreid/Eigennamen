-- atomicSaveGameHistory.lua
-- Description: Atomically saves a game history entry with TTL, adds it to a sorted index, and trims old entries
--
-- KEYS[1]: Game history entry key
-- KEYS[2]: Game history index key
-- ARGV[1]: Game data JSON
-- ARGV[2]: History ID (UUID)
-- ARGV[3]: Timestamp (seconds)
-- ARGV[4]: History entry TTL (seconds)
-- ARGV[5]: Max history entries to retain
--
-- Returns: Always 1

local gameKey = KEYS[1]
local indexKey = KEYS[2]
local gameJson = ARGV[1]
local historyId = ARGV[2]
local timestamp = tonumber(ARGV[3]) or 0
local ttl = tonumber(ARGV[4]) or 86400
local maxHistory = tonumber(ARGV[5]) or 50

-- Store the game history entry with TTL
redis.call('SET', gameKey, gameJson, 'EX', ttl)

-- Add to sorted set index (NX prevents duplicate entries)
redis.call('ZADD', indexKey, 'NX', timestamp, historyId)

-- Trim index to keep only the most recent games
redis.call('ZREMRANGEBYRANK', indexKey, 0, -(maxHistory + 1))

-- Set TTL on index
redis.call('EXPIRE', indexKey, ttl)

return 1
