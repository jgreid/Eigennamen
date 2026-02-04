local playerKey = KEYS[1]
local teamSetKey = KEYS[2]
local roomCode = KEYS[3]
local newTeam = ARGV[1]
local sessionId = ARGV[2]
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local checkEmpty = ARGV[5] == 'true'

-- Defense-in-depth: Validate team is one of allowed values
-- JS already validates via Zod schema, but Lua should also check
-- __NULL__ is a special sentinel value for leaving a team
local allowedTeams = {red = true, blue = true, ['__NULL__'] = true}
if not allowedTeams[newTeam] then
    return cjson.encode({success = false, reason = 'INVALID_TEAM'})
end

-- Get current player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)
local oldTeam = player.team
local oldRole = player.role

-- Determine actual new team value
local actualNewTeam = nil
if newTeam ~= '__NULL__' then
    actualNewTeam = newTeam
end

-- If we need to check for empty team (during active game with team change)
if checkEmpty and oldTeam and oldTeam ~= cjson.null and oldTeam ~= actualNewTeam then
    -- Get all session IDs on the old team
    local teamMembers = redis.call('SMEMBERS', teamSetKey)
    local otherConnectedCount = 0

    for _, memberId in ipairs(teamMembers) do
        if memberId ~= sessionId then
            local memberData = redis.call('GET', 'player:' .. memberId)
            if memberData then
                local member = cjson.decode(memberData)
                if member.connected then
                    otherConnectedCount = otherConnectedCount + 1
                end
            end
        end
    end

    -- If no other connected members would remain, reject the switch
    if otherConnectedCount == 0 then
        return cjson.encode({success = false, reason = 'TEAM_WOULD_BE_EMPTY'})
    end
end

-- Proceed with team change
if actualNewTeam then
    player.team = actualNewTeam
else
    player.team = cjson.null
end
player.lastSeen = now

-- Clear team-specific roles when switching teams
if oldTeam ~= actualNewTeam and (oldRole == 'spymaster' or oldRole == 'clicker') then
    player.role = 'spectator'
end

redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)

-- ISSUE #1 FIX: Atomic team set maintenance
-- Remove from old team set if was on a team
if oldTeam and oldTeam ~= cjson.null then
    local oldTeamKey = 'room:' .. roomCode .. ':team:' .. oldTeam
    redis.call('SREM', oldTeamKey, sessionId)
    -- ISSUE #13 FIX: Clean up empty team sets
    if redis.call('SCARD', oldTeamKey) == 0 then
        redis.call('DEL', oldTeamKey)
    end
end

-- Add to new team set if joining a team
if actualNewTeam then
    local newTeamKey = 'room:' .. roomCode .. ':team:' .. actualNewTeam
    redis.call('SADD', newTeamKey, sessionId)
    redis.call('EXPIRE', newTeamKey, ttl)
end

return cjson.encode({success = true, player = player})
