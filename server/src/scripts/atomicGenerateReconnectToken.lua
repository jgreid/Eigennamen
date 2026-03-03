-- atomicGenerateReconnectToken.lua
-- Description: Atomically generates a reconnection token, returning existing
-- token if one already exists for this session (prevents TOCTOU race).
--
-- KEYS[1]: Session key (reconnect:session:{sessionId})
-- KEYS[2]: Token key (reconnect:token:{token})
-- ARGV[1]: New token string
-- ARGV[2]: Token data JSON
-- ARGV[3]: TTL (seconds)
--
-- Returns: The token string (either existing or newly created)

local sessionKey = KEYS[1]
local tokenKey = KEYS[2]
local newToken = ARGV[1]
local tokenData = ARGV[2]
local ttl = tonumber(ARGV[3])

-- Try to get existing token for this session
local existing = redis.call('GET', sessionKey)
if existing then
    return existing
end

-- No existing token — set both mappings atomically
redis.call('SET', sessionKey, newToken, 'EX', ttl)
redis.call('SET', tokenKey, tokenData, 'EX', ttl)
return newToken
