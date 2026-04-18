-- atomicAddTime.lua
-- Description: Atomically adds time to a running (non-paused) timer and updates its TTL in Redis.
--
-- KEYS[1]: Timer key (e.g., `timer:room:ABC123`)
-- ARGV[1]: Seconds to add
-- ARGV[2]: Instance ID
-- ARGV[3]: Current timestamp (ms)
-- ARGV[4]: TTL buffer (seconds, default 60)
--
-- Returns: JSON `{endTime, duration, remainingSeconds}` on success
--          nil if timer not found, paused, or expired
--          'CORRUPTED_DATA' if stored JSON is malformed

local timerKey = KEYS[1]
local secondsToAdd = tonumber(ARGV[1])
local instanceId = ARGV[2]

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local ok, timer = pcall(cjson.decode, timerData)
if not ok then
    return 'CORRUPTED_DATA'
end
if timer.paused then
    return nil
end

local now = tonumber(ARGV[3])
local remainingMs = timer.endTime - now
if remainingMs <= 0 then
    return nil
end

-- Get TTL buffer from arguments instead of hardcoding
local ttlBuffer = tonumber(ARGV[4]) or 60

-- Calculate new end time and current remaining seconds.
-- `duration` is the originally-allotted turn length and must NOT be
-- overwritten on add-time — clients display it alongside the live remaining
-- time. Only `endTime` and the returned `remainingSeconds` reflect the add.
local newEndTime = timer.endTime + (secondsToAdd * 1000)
local remainingMsAfter = newEndTime - now
local remainingSeconds = 0
if remainingMsAfter > 0 then
    remainingSeconds = math.ceil(remainingMsAfter / 1000)
end

-- Update timer
timer.endTime = newEndTime
timer.instanceId = instanceId

-- TTL must cover remaining time plus buffer; preserves original duration for UI.
local newTtl = remainingSeconds + ttlBuffer

redis.call('SET', timerKey, cjson.encode(timer), 'EX', newTtl)
return cjson.encode({endTime = newEndTime, duration = timer.duration, remainingSeconds = remainingSeconds})
