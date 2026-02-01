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

-- Parse all data
local oldHost = cjson.decode(oldHostData)
local newHost = cjson.decode(newHostData)
local room = cjson.decode(roomData)

-- Atomically update all three records
oldHost.isHost = false
oldHost.lastSeen = now
newHost.isHost = true
newHost.lastSeen = now
room.hostSessionId = newHostSessionId

-- Write all updates
redis.call('SET', oldHostKey, cjson.encode(oldHost), 'EX', ttl)
redis.call('SET', newHostKey, cjson.encode(newHost), 'EX', ttl)
redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)

return cjson.encode({
    success = true,
    oldHost = oldHost,
    newHost = newHost
})
