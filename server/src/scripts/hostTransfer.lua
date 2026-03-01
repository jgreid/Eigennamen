-- hostTransfer.lua
-- Description: Atomically transfers host privileges from one player to another and updates the room record
--
-- KEYS[1]: Old host player key
-- KEYS[2]: New host player key
-- KEYS[3]: Room key
-- ARGV[1]: New host session ID
-- ARGV[2]: Player TTL (seconds)
-- ARGV[3]: Current timestamp (ms)
--
-- Returns: JSON `{success: true, oldHost, newHost}` or `{success: false, reason}`

local oldHostKey = KEYS[1]
local newHostKey = KEYS[2]
local roomKey = KEYS[3]
local newHostSessionId = ARGV[1]
local ttl = tonumber(ARGV[2])
local now = tonumber(ARGV[3])

-- Get old host data
local oldHostData = redis.call('GET', oldHostKey)
if not oldHostData then
    return cjson.encode({success = false, reason = 'OLD_HOST_NOT_FOUND'})
end

-- Get new host data
local newHostData = redis.call('GET', newHostKey)
if not newHostData then
    return cjson.encode({success = false, reason = 'NEW_HOST_NOT_FOUND'})
end

-- Get room data
local roomData = redis.call('GET', roomKey)
if not roomData then
    return cjson.encode({success = false, reason = 'ROOM_NOT_FOUND'})
end

-- Parse all data (pcall for corrupted data resilience)
local ok1, oldHost = pcall(cjson.decode, oldHostData)
if not ok1 then return cjson.encode({success = false, reason = 'CORRUPTED_DATA'}) end
local ok2, newHost = pcall(cjson.decode, newHostData)
if not ok2 then return cjson.encode({success = false, reason = 'CORRUPTED_DATA'}) end
local ok3, room = pcall(cjson.decode, roomData)
if not ok3 then return cjson.encode({success = false, reason = 'CORRUPTED_DATA'}) end

-- Atomically update all three records
oldHost.isHost = false
oldHost.lastSeen = now
newHost.isHost = true
newHost.lastSeen = now
room.hostSessionId = newHostSessionId

-- Write player updates with player TTL
redis.call('SET', oldHostKey, cjson.encode(oldHost), 'EX', ttl)
redis.call('SET', newHostKey, cjson.encode(newHost), 'EX', ttl)

-- Preserve room's existing TTL instead of overwriting with player TTL
local roomTTL = redis.call('TTL', roomKey)
if roomTTL > 0 then
    redis.call('SET', roomKey, cjson.encode(room), 'EX', roomTTL)
else
    redis.call('SET', roomKey, cjson.encode(room))
end

return cjson.encode({
    success = true,
    oldHost = oldHost,
    newHost = newHost
})
