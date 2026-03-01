-- atomicSetSocketMapping.lua
-- Description: Atomically sets a socket-to-player mapping and updates the player's last IP and last seen timestamp
--
-- KEYS[1]: Player key
-- KEYS[2]: Socket mapping key
-- ARGV[1]: Socket ID
-- ARGV[2]: Socket mapping TTL (seconds)
-- ARGV[3]: Player TTL (seconds)
-- ARGV[4]: Last IP address (can be empty)
-- ARGV[5]: Current timestamp (ms)
--
-- Returns: 1 on success, nil if player not found

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
    local pOk, player = pcall(cjson.decode, playerData)
    if not pOk then return nil end
    player.lastIP = lastIP
    player.lastSeen = tonumber(now)
    redis.call('SET', playerKey, cjson.encode(player), 'EX', playerTTL)
end

return 1
