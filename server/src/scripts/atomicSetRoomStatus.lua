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
