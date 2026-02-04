local playerKey = KEYS[1]
local roomPlayersKey = KEYS[2]
local newRole = ARGV[1]
local sessionId = ARGV[2]
local ttl = tonumber(ARGV[3])
local now = tonumber(ARGV[4])

-- Defense-in-depth: Validate role is one of allowed values
-- JS already validates via Zod schema, but Lua should also check
local allowedRoles = {spymaster = true, clicker = true, spectator = true}
if not allowedRoles[newRole] then
    return cjson.encode({success = false, reason = 'INVALID_ROLE'})
end

-- Get current player data
local playerData = redis.call('GET', playerKey)
if not playerData then
    return nil
end

local player = cjson.decode(playerData)

-- For spymaster/clicker roles, require team and check for existing role holder
if newRole == 'spymaster' or newRole == 'clicker' then
    if not player.team or player.team == cjson.null then
        return cjson.encode({success = false, reason = 'NO_TEAM'})
    end

    -- Get all players in room and check if role is taken
    local memberIds = redis.call('SMEMBERS', roomPlayersKey)
    for _, memberId in ipairs(memberIds) do
        if memberId ~= sessionId then
            local memberData = redis.call('GET', 'player:' .. memberId)
            if memberData then
                local member = cjson.decode(memberData)
                -- Bug #5 fix: Only block if same team, same role, AND player is connected
                -- Disconnected players should not block role assignment
                if member.team == player.team and member.role == newRole and member.connected then
                    return cjson.encode({
                        success = false,
                        reason = 'ROLE_TAKEN',
                        existingNickname = member.nickname
                    })
                end
            end
        end
    end
end

-- Update the role
local oldRole = player.role
player.role = newRole
player.lastSeen = now

redis.call('SET', playerKey, cjson.encode(player), 'EX', ttl)

return cjson.encode({success = true, player = player, oldRole = oldRole})
