-- atomicUpdateSettings.lua
-- Description: Atomically validates host identity and merges allowed settings updates into a room's configuration
--
-- KEYS[1]: Room key
-- ARGV[1]: Session ID (to verify host)
-- ARGV[2]: Settings updates JSON (allowed: teamNames, turnTimer, allowSpectators, gameMode)
-- ARGV[3]: Room TTL (seconds)
--
-- Returns: JSON `{success: true, settings}` or `{error: 'CODE'}`

local roomKey = KEYS[1]
local sessionId = ARGV[1]
local settingsJson = ARGV[2]
local ttl = tonumber(ARGV[3])

local roomData = redis.call('GET', roomKey)
if not roomData then
    return cjson.encode({error = 'ROOM_NOT_FOUND'})
end

local ok1, room = pcall(cjson.decode, roomData)
if not ok1 then return cjson.encode({error = 'CORRUPTED_DATA'}) end

if room.hostSessionId ~= sessionId then
    return cjson.encode({error = 'NOT_HOST'})
end

local ok2, newSettings = pcall(cjson.decode, settingsJson)
if not ok2 then return cjson.encode({error = 'CORRUPTED_DATA'}) end

-- Merge only allowed keys into existing settings
if not room.settings then
    room.settings = {}
end
if newSettings.teamNames ~= nil then room.settings.teamNames = newSettings.teamNames end
if newSettings.turnTimer ~= nil then room.settings.turnTimer = newSettings.turnTimer end
if newSettings.allowSpectators ~= nil then room.settings.allowSpectators = newSettings.allowSpectators end
if newSettings.gameMode ~= nil then room.settings.gameMode = newSettings.gameMode end

redis.call('SET', roomKey, cjson.encode(room), 'EX', ttl)

return cjson.encode({success = true, settings = room.settings})
