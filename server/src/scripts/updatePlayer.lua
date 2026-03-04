-- Atomic player update script
-- Replaces WATCH/MULTI read-modify-write with a single atomic Lua operation.
-- Prevents lost updates from concurrent modifications (e.g., simultaneous
-- disconnect + nickname change).
--
-- KEYS[1] = player key (e.g., "player:<sessionId>")
-- ARGV[1] = JSON object with fields to merge into the player
-- ARGV[2] = TTL in seconds for the player key
-- ARGV[3] = timestamp (milliseconds) to set as lastSeen
--
-- Returns: JSON string of the updated player on success
--          nil if the player key does not exist
--          'CORRUPTED_DATA' if stored JSON is malformed

local playerKey = KEYS[1]
local updatesJson = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Read current player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local ok1, player = pcall(cjson.decode, playerData)
if not ok1 then return 'CORRUPTED_DATA' end
local ok2, updates = pcall(cjson.decode, updatesJson)
if not ok2 then return 'CORRUPTED_DATA' end

-- Merge updates into the player object
for k, v in pairs(updates) do
    if v == cjson.null then
        player[k] = cjson.null
    else
        player[k] = v
    end
end

-- Always set lastSeen to the provided timestamp
player.lastSeen = now

-- Save the merged player with TTL
redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)

return cjson.encode(player)
