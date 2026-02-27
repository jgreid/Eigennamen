local playerKey = KEYS[1]
local socketKey = KEYS[2]
local socketId = ARGV[1]
local socketTTL = tonumber(ARGV[2])
local playerTTL = tonumber(ARGV[3])
local lastIP = ARGV[4]
local now = ARGV[5]

-- Verify player exists
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

-- Set socket mapping
redis.call('SET', socketKey, socketId, 'EX', socketTTL)

-- Update player lastIP and lastSeen if IP provided
if lastIP ~= '' then
    local player = cjson.decode(playerData)
    player.lastIP = lastIP
    player.lastSeen = tonumber(now)
    redis.call('SET', playerKey, cjson.encode(player), 'EX', playerTTL)
end

return 1
