-- atomicResumeTimer.lua
-- Description: Resumes a paused timer, checking whether it expired during the pause period
--
-- KEYS[1]: Timer key
-- ARGV[1]: Current timestamp (ms)
--
-- Returns: JSON `{expired, remainingSeconds, ...}` on success

local timerKey = KEYS[1]
local nowMs = tonumber(ARGV[1])

local timerData = redis.call('GET', timerKey)
if not timerData then
    return nil
end

local ok, timer = pcall(cjson.decode, timerData)
if not ok then
    return cjson.encode({error = 'CORRUPTED_DATA'})
end

-- Must be paused to resume
if not timer.paused then
    return cjson.encode({error = 'NOT_PAUSED'})
end

local remainingSeconds = timer.remainingWhenPaused
if not remainingSeconds or remainingSeconds <= 0 then
    return cjson.encode({error = 'INVALID_REMAINING'})
end

-- Check if timer would have expired during the pause
if timer.pausedAt then
    local pausedDurationMs = nowMs - timer.pausedAt
    local remainingMs = remainingSeconds * 1000

    if pausedDurationMs >= remainingMs then
        -- Timer expired while paused — delete atomically
        redis.call('DEL', timerKey)
        return cjson.encode({expired = true, pausedFor = pausedDurationMs, hadRemaining = remainingMs})
    end
end

-- Timer is still valid — return remaining time for the caller to start a new timer
return cjson.encode({expired = false, remainingSeconds = remainingSeconds})
