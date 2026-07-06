-- atomicExpireTimer.lua
-- Description: Compare-and-delete for a fired local timeout. A setTimeout armed
--   for a specific endTime may fire AFTER the timer it was armed for was extended
--   (addTime), paused, restarted, or stopped. This script deletes-and-signals-
--   expiry ONLY when the stored timer still matches the endTime the timeout was
--   armed for and is not paused — so a stale timeout can no longer delete a
--   freshly-extended timer or end a turn that was just granted more time (A11).
--
-- KEYS[1]: Timer key (e.g., `timer:room:ABC123`)
-- ARGV[1]: Expected endTime (ms) the fired timeout was armed for
--
-- Returns:
--   'EXPIRED'        — stored timer matched the armed endTime and was not paused;
--                      key deleted. Caller SHOULD run the onExpire callback.
--   'SUPERSEDED'     — stored timer's endTime no longer matches (extended/restarted);
--                      left intact. Caller MUST NOT expire.
--   'PAUSED'         — stored timer is paused; left intact. Caller MUST NOT expire.
--   'GONE'           — no timer key (already stopped/cleaned up). Caller MUST NOT expire.
--   'CORRUPTED_DATA' — malformed JSON; key deleted. Caller MUST NOT expire.

local timerKey = KEYS[1]
local expectedEndTime = tonumber(ARGV[1])

local timerData = redis.call('GET', timerKey)
if not timerData then
    return 'GONE'
end

local ok, timer = pcall(cjson.decode, timerData)
if not ok then
    redis.call('DEL', timerKey)
    return 'CORRUPTED_DATA'
end

-- A paused timer must never be expired by a stale local timeout — resume owns it.
if timer.paused then
    return 'PAUSED'
end

-- endTime mismatch means the timer was extended (addTime) or restarted after this
-- timeout was armed. Deleting it here would discard the newer timer and end the
-- turn that was just granted more time. Leave it for its own (later) timeout.
if expectedEndTime == nil or timer.endTime ~= expectedEndTime then
    return 'SUPERSEDED'
end

redis.call('DEL', timerKey)
return 'EXPIRED'
