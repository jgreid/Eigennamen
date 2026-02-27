local playersKey = KEYS[1]
local roomKey = KEYS[2]
local maxPlayers = tonumber(ARGV[1])
local sessionId = ARGV[2]
local playerData = ARGV[3]
local playerKey = ARGV[4]
local playerTTL = tonumber(ARGV[5])

-- Verify room still exists (prevents orphaned player sets if room was deleted between getRoom and this script)
if redis.call('EXISTS', roomKey) == 0 then
    return -2
end

-- Check if already a member
if redis.call('SISMEMBER', playersKey, sessionId) == 1 then
    return -1
end

-- Check capacity and add atomically
local currentCount = redis.call('SCARD', playersKey)
if currentCount >= maxPlayers then
    return 0
end

redis.call('SADD', playersKey, sessionId)

-- Atomically create player data (eliminates crash window)
if playerData and playerData ~= '' then
    redis.call('SET', playerKey, playerData, 'EX', playerTTL)
end

return 1
