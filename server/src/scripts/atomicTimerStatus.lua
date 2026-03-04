-- atomicTimerStatus.lua
-- Description: Retrieves the current status of a timer, calculating remaining time and detecting expiration during pause
--
-- KEYS[1]: Timer key
-- ARGV[1]: Current timestamp (ms)
--
-- Returns: JSON timer object on success
--          'EXPIRED' if paused timer expired (key is deleted)
--          'CORRUPTED_DATA' if stored JSON is malformed
--          nil if timer not found

local timerKey = KEYS[1]
local now = tonumber(ARGV[1])

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local ok, timer = pcall(cjson.decode, timerData)
if not ok then
    return 'CORRUPTED_DATA'
end

-- Handle paused timer: check if it would have expired during pause
if timer.paused and timer.pausedAt and timer.remainingWhenPaused then
    local pausedDuration = now - timer.pausedAt
    local remainingMs = timer.remainingWhenPaused * 1000
    if pausedDuration >= remainingMs then
        -- Timer expired while paused — clean it up atomically
        redis.call('DEL', timerKey)
        return 'EXPIRED'
    end
    -- Still paused, return remaining time
    return cjson.encode({
        startTime = timer.startTime,
        endTime = timer.endTime,
        duration = timer.duration,
        remainingSeconds = timer.remainingWhenPaused,
        expired = false,
        isPaused = true
    })
end

-- Active timer: calculate remaining
local remainingMs = timer.endTime - now
local expired = remainingMs <= 0
local remainingSeconds = expired and 0 or math.ceil(remainingMs / 1000)

return cjson.encode({
    startTime = timer.startTime,
    endTime = timer.endTime,
    duration = timer.duration,
    remainingSeconds = remainingSeconds,
    expired = expired,
    isPaused = false
})
