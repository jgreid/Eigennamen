local timerKey = KEYS[1]
local secondsToAdd = tonumber(ARGV[1])
local instanceId = ARGV[2]

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local timer = cjson.decode(timerData)
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

-- Calculate new end time
local newEndTime = timer.endTime + (secondsToAdd * 1000)
local newDuration = math.ceil((newEndTime - now) / 1000)

-- Update timer
timer.endTime = newEndTime
timer.duration = newDuration
timer.instanceId = instanceId

-- Calculate new TTL (duration + buffer from constant)
local newTtl = newDuration + ttlBuffer

redis.call('SET', timerKey, cjson.encode(timer), 'EX', newTtl)
return cjson.encode({endTime = newEndTime, duration = newDuration, remainingSeconds = newDuration})
