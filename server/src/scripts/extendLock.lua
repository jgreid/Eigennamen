-- extendLock.lua
-- Description: Extends a held lock's TTL, but only if the caller still owns it.
-- KEYS[1]: lock key
-- ARGV[1]: owner id (lock value)
-- ARGV[2]: additional TTL in milliseconds
-- Returns: 1 if extended, 0 if not owned or the TTL argument is invalid
local ttl = tonumber(ARGV[2])
if not ttl or ttl <= 0 then
    return 0
end
if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("pexpire", KEYS[1], ttl)
else
    return 0
end
