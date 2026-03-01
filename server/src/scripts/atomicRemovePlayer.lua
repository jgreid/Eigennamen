-- atomicRemovePlayer.lua
-- Description: Atomically removes a player from their room and team sets, then deletes the player key
--
-- KEYS[1]: Player key (e.g., `player:<sessionId>`)
-- ARGV[1]: Session ID
--
-- Returns: Player JSON on success, nil if player not found

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
local roomCode = player.roomCode
local team = player.team

-- Remove from room's player set
if roomCode then
    redis.call('SREM', 'room:' .. roomCode .. ':players', sessionId)
    -- Remove from team set if player was on a team
    if team and team ~= cjson.null then
        redis.call('SREM', 'room:' .. roomCode .. ':team:' .. team, sessionId)
    end
end

-- Delete player data
redis.call('DEL', playerKey)

return playerData
