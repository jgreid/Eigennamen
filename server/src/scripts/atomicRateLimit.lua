-- KEYS[1] = rate limit key (e.g., session:validation:<ip>)
-- ARGV[1] = TTL in seconds
-- Returns: current count after increment

local key = KEYS[1]
local ttl = tonumber(ARGV[1])
local count = redis.call('INCR', key)
if count == 1 then
    redis.call('EXPIRE', key, ttl)
end
return count
