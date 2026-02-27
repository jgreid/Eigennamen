local roomKey = KEYS[1]
local sessionId = ARGV[1]
local settingsJson = ARGV[2]
local blitzForcedTimer = tonumber(ARGV[3])
local ttl = tonumber(ARGV[4])

local roomData = redis.call('GET', roomKey)
if not roomData then
    return cjson.encode({error = 'ROOM_NOT_FOUND'})
end

local room = cjson.decode(roomData)

if room.hostSessionId ~= sessionId then
    return cjson.encode({error = 'NOT_HOST'})
end

local newSettings = cjson.decode(settingsJson)

-- Merge only allowed keys into existing settings
if not room.settings then
    room.settings = {}
end
if newSettings.teamNames ~= nil then room.settings.teamNames = newSettings.teamNames end
if newSettings.turnTimer ~= nil then room.settings.turnTimer = newSettings.turnTimer end
if newSettings.allowSpectators ~= nil then room.settings.allowSpectators = newSettings.allowSpectators end
if newSettings.gameMode ~= nil then room.settings.gameMode = newSettings.gameMode end

-- Enforce blitz constraints
if room.settings.gameMode == 'blitz' then
    room.settings.turnTimer = blitzForcedTimer
end

redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)

return cjson.encode({success = true, settings = room.settings})
