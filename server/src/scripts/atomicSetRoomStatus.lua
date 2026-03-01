-- atomicSetRoomStatus.lua
-- Description: Atomically updates a room's status field and refreshes its TTL
--
-- KEYS[1]: Room key
-- ARGV[1]: New status string (e.g., 'waiting', 'playing', 'finished')
-- ARGV[2]: Room TTL (seconds)
--
-- Returns: 'OK' on success, nil if room not found

local roomKey = KEYS[1]
local newStatus = ARGV[1]
local ttl = tonumber(ARGV[2])

local roomData = redis.call('GET', roomKey)
if not roomData then
    return nil
end

local ok, room = pcall(cjson.decode, roomData)
if not ok then return nil end
room.status = newStatus
redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)
return 'OK'
