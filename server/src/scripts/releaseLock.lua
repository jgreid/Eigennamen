-- releaseLock.lua
-- Description: Releases a distributed lock only if the caller owns it by verifying the lock token
--
-- KEYS[1]: Lock key
-- ARGV[1]: Lock token (owner verification)
--
-- Returns: 1 if released, 0 if token mismatch

if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
else
    return 0
end
