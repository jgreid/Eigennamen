-- atomicValidateReconnectToken.lua
-- Description: Atomically validates and consumes a reconnection token.
-- GETs token data, validates sessionId, and DELetes both keys in one atomic op.
-- Prevents two concurrent reconnections from both succeeding with the same token.
--
-- KEYS[1]: Token key (reconnect:token:{token})
-- KEYS[2]: Session key (reconnect:session:{sessionId})
-- ARGV[1]: Expected session ID
--
-- Returns: Token data JSON on success, 'NOT_FOUND' if token missing,
--          'SESSION_MISMATCH' if sessionId doesn't match

local tokenKey = KEYS[1]
local sessionKey = KEYS[2]
local expectedSessionId = ARGV[1]

-- Atomically get and delete token data
local tokenData = redis.call('GET', tokenKey)
if not tokenData then
    return 'NOT_FOUND'
end

-- Validate session ownership before consuming
-- Parse just enough to check sessionId
local ok, parsed = pcall(cjson.decode, tokenData)
if not ok then
    return 'NOT_FOUND'
end

if parsed.sessionId ~= expectedSessionId then
    -- Don't delete — token belongs to a different session
    return 'SESSION_MISMATCH'
end

-- Token valid — consume it (one-time use) by deleting both keys
redis.call('DEL', tokenKey)
redis.call('DEL', sessionKey)

return tokenData
