local timerKey = KEYS[1]
local nowMs = tonumber(ARGV[1])
local pausedTimerTTL = tonumber(ARGV[2])

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local ok, timer = pcall(cjson.decode, timerData)
if not ok then
    return cjson.encode({error = 'CORRUPTED_DATA'})
end

-- Already paused
if timer.paused then
    return cjson.encode({error = 'ALREADY_PAUSED'})
end

-- Calculate remaining time
local remainingMs = timer.endTime - nowMs
if remainingMs <= 0 then
    -- Timer already expired — clean it up
    redis.call('DEL', timerKey)
    return cjson.encode({error = 'EXPIRED'})
end

local remainingSeconds = math.ceil(remainingMs / 1000)

-- Atomically update timer to paused state
timer.paused = true
timer.remainingWhenPaused = remainingSeconds
timer.pausedAt = nowMs

redis.call('SET', timerKey, cjson.encode(timer), 'EX', pausedTimerTTL)

return cjson.encode({remainingSeconds = remainingSeconds})
