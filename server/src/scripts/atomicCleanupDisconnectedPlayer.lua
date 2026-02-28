local playerKey = KEYS[1]
local sessionId = ARGV[1]

-- Get player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local ok, player = pcall(cjson.decode, playerData)
if not ok then
    -- Data corrupted — delete key and return nil
    redis.call('DEL', playerKey)
    return nil
end

-- Guard: only remove if still disconnected
if player.connected then
    return 'RECONNECTED'
end

local roomCode = player.roomCode
local team = player.team

-- Remove from room's player set
if roomCode then
    redis.call('SREM', 'room:' .. roomCode .. ':players', sessionId)
    if team and team ~= cjson.null then
        redis.call('SREM', 'room:' .. roomCode .. ':team:' .. team, sessionId)
    end
end

-- Delete player data
redis.call('DEL', playerKey)

return playerData
