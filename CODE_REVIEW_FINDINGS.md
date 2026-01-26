# Code Review Findings Report

**Date:** 2026-01-26
**Reviewer:** Claude (Automated Code Review)
**Tests:** 71 suites passed, 2331 tests passed

---

## Executive Summary

This comprehensive code review identified **38 issues** across the codebase:
- **4 Critical** - System-breaking bugs
- **13 High** - Significant functionality broken
- **15 Medium** - Edge cases, security concerns
- **6 Low** - Code quality, minor issues

**Most Affected Areas:**
1. Frontend-Backend Synchronization (modular frontend `src/js/socket.js`)
2. Timer Service (memory mode, race conditions)
3. Socket.io Event Handlers (rate limiter, disconnect handling)

---

## CRITICAL Issues (4)

### C1. Rate Limiter Handler Breaks Promise Chain
**File:** `server/src/socket/rateLimitHandler.js:43-77`

The `createRateLimitedHandler` function returns an async function that doesn't await the rate limiter callback, causing all 25 socket event handlers to have broken error propagation.

```javascript
// Problem: Returns immediately, doesn't wait for limiter callback
return async (data) => {
    limiter(socket, data, async (err) => {
        // This executes AFTER the outer function returns
        await handler(data);
    });
    // Function returns here immediately!
};
```

**Impact:** Error handling disconnected from Socket.io's event flow for ALL socket events.

---

### C2. Disconnect Handler Timeout Abandons State Updates
**File:** `server/src/socket/index.js:142-157`

If `handleDisconnect()` exceeds 10 seconds, the timeout fires and critical cleanup operations are abandoned:
- Player's connected status NOT updated
- Other players NOT notified
- Host transfer NOT performed

**Impact:** Players appear "connected" when disconnected; rooms can become locked.

---

### C3. Timer Service Memory Mode - Lua Scripts Fail Silently
**File:** `server/src/config/memoryStorage.js:529-598`

When using memory mode (`REDIS_URL=memory`), timer Lua scripts (`ATOMIC_TIMER_CLAIM_SCRIPT`, `ATOMIC_ADD_TIME_SCRIPT`) return `null` instead of executing.

```javascript
// memoryStorage.js line 595-598
logger.debug('Memory storage eval called with unsupported script pattern');
return null;  // All timer operations silently fail!
```

**Impact:** Turn timers completely non-functional in memory mode.

---

### C4. Frontend-Backend Event Mismatches (Modular Frontend)
**File:** `src/js/socket.js`

Multiple event name and payload mismatches make features non-functional:

| Feature | Client Sends | Server Expects | Status |
|---------|-------------|----------------|--------|
| Chat | `chat:send` | `chat:message` | BROKEN |
| Kick | `{ sessionId }` | `{ targetSessionId }` | BROKEN |
| Resync | `room:requestResync` | `room:resync` | BROKEN |
| Timer Control | `timer:start/stop/addTime` | No handlers | BROKEN |

**Impact:** Chat, player kick, resync, and timer controls all non-functional in modular frontend.

---

## HIGH Issues (13)

### H1. Room:reconnect Missing Socket Join on Timeout
**File:** `server/src/socket/handlers/roomHandlers.js:419-539`

If reconnect timeout fires, the socket is never joined to the room. Client thinks they reconnected but can't receive messages.

### H2. Game:reveal Timer Restart Race Condition
**File:** `server/src/socket/handlers/gameHandlers.js:210-219`

No synchronization between concurrent reveal handlers. Turn counter can increment multiple times.

### H3. Player:kick Target Socket May Disconnect Mid-Operation
**File:** `server/src/socket/handlers/playerHandlers.js:257-301`

Kicked player may not receive notification if their socket disconnects during the kick operation.

### H4. Non-Atomic Host Transfer in leaveRoom
**File:** `server/src/services/roomService.js:254-259`

Host transfer uses two separate Redis operations instead of atomic `atomicHostTransfer()`. Race condition window exists.

### H5. Race Condition on Concurrent startTimer Calls
**File:** `server/src/services/timerService.js:322-382`

Two instances can both create local timers for same room, causing duplicate or missing expirations.

### H6. AddTime Event Duplicates Expiration Logic
**File:** `server/src/services/timerService.js:268-284`

`handleTimerEvent` for 'addTime' creates new setTimeout with duplicated expiration code instead of using `createTimerExpirationCallback()`.

### H7. AddTime Pub/Sub Failure Returns Success
**File:** `server/src/services/timerService.js:688-709`

When pub/sub publish fails, function logs warning but returns success to caller.

### H8. Missing Token Format Validation in room:reconnect
**File:** `server/src/socket/handlers/roomHandlers.js:413-422`

`reconnectionToken` only has truthy check, unlike socketAuth which validates 64 hex characters.

### H9. Non-Timing-Safe Session ID Comparison
**File:** `server/src/services/playerService.js:893`

Uses `!==` instead of `crypto.timingSafeEqual()` for session ID comparison, unlike the similar function at line 670.

### H10. Missing Zod Schema for room:reconnect
**File:** `server/src/socket/handlers/roomHandlers.js:411-422`

Only handler that doesn't use Zod schema validation.

### H11. Reconnection Token Not Used by Frontend
**File:** `src/js/socket.js:391-412`

Server sends `room:reconnectionToken` but frontend never stores or uses it. Secure reconnection feature non-functional.

### H12. Session Token Rotation Lost
**File:** `src/js/socket.js:227-232`

Server rotates session token after reconnect (line 486 roomHandlers.js), includes new token in response, but frontend doesn't extract it.

### H13. Undefined Error Code Used
**File:** `server/src/socket/handlers/chatHandlers.js:27`

Uses `ERROR_CODES.VALIDATION_ERROR` which doesn't exist in constants. Should be `INVALID_INPUT`.

---

## MEDIUM Issues (15)

### M1. Missing Null Check After Room Fetch in game:start
**File:** `server/src/socket/handlers/gameHandlers.js:64,90-91`

Room fetched at line 64, used at line 90 without checking if deleted between operations.

### M2. Chat Message Broadcast Missing Error Aggregation
**File:** `server/src/socket/handlers/chatHandlers.js:50-81`

Emit errors logged individually but no tracking of which sends succeeded/failed.

### M3. Game History Returns Unchecked Null
**File:** `server/src/socket/handlers/gameHandlers.js:459`

`getGameHistory()` may return null, sent directly to client who may expect array.

### M4. Room Settings Not Re-validated Before Broadcast
**File:** `server/src/socket/handlers/roomHandlers.js:264-271`

Settings from service broadcast without schema validation.

### M5. Pause/Resume State Not Properly Synchronized
**File:** `server/src/services/timerService.js:238-248`

Paused flag may not propagate across instances in time.

### M6. Orphan Timer Recovery Loses Original Callback
**File:** `server/src/services/timerService.js:872-874`

Recovered timers always use generic callback from initialization.

### M7. Game End Doesn't Guarantee Timer Cleanup
**File:** `server/src/socket/handlers/gameHandlers.js:224-226`

Race condition between `stopTimer()` and orphan check on another instance.

### M8. AddTime Assumes Timer Exists in Redis
**File:** `server/src/services/timerService.js:586-645`

Between `exists` check and pub/sub publish, timer could expire.

### M9. Timer Status Doesn't Account for Paused State
**File:** `server/src/services/timerService.js:423-450`

`getTimerStatus()` calculates remaining time from endTime even when paused.

### M10. Role Assignment Lock Fragile
**File:** `server/src/services/playerService.js:382-410`

Lock implementation relies on Redis SET return value semantics.

### M11. Conflicting Reconnection Token Functions
**File:** `server/src/services/playerService.js:645 vs 867`

Two functions with different parameter orders and security levels.

### M12. Missing Error Code Status Mappings
**File:** `server/src/middleware/errorHandler.js:27-46`

Missing: SESSION_EXPIRED, SESSION_NOT_FOUND, RESERVED_NAME, CANNOT_SWITCH_TEAM_DURING_TURN.

### M13. Silent JSON Parse Errors
**Files:** `timerService.js:447`, `eventLogService.js:127,175`

JSON parse errors caught but not logged.

### M14. Empty Catch Blocks in JWT
**File:** `server/src/config/jwt.js:64,210`

Errors silently swallowed without logging.

### M15. Multiple Server Events Unhandled by Frontend
**File:** `src/js/socket.js`

Missing listeners for: `socket:error`, `session:inactivityTimeout`, `room:statsUpdated`, `chat:error`.

---

## LOW Issues (6)

### L1. Double Event Broadcast for Player Kick
**File:** `server/src/socket/handlers/playerHandlers.js:268-308`

Both `player:kicked` and `room:playerLeft` broadcast for same action.

### L2. Pending AddTime Operations Cleanup
**File:** `server/src/services/timerService.js:292-306`

Operations cleaned up by timestamp, not tracking completion.

### L3. Inconsistent Parameter Order
**File:** `server/src/middleware/socketAuth.js:257`

`validateReconnectToken(sessionId, token)` vs `validateReconnectionToken(token, sessionId)`.

### L4. Incomplete Host Update on Leave
**File:** `server/src/services/roomService.js:245-268`

If `updatePlayer` fails, new host lacks `isHost: true` flag.

### L5. Game History Events Not Mapped
**File:** `src/js/socket.js`

`game:historyResult` and `game:replayData` not registered.

### L6. Inactivity Timeout Not Communicated
**File:** `src/js/socket.js`

`session:inactivityTimeout` event not handled.

---

## Verified Working (No Issues Found)

- **Game Logic:** PRNG determinism, card distribution (9/8/7/1), turn order, win conditions
- **Clue Validation:** Multi-layer validation prevents XSS and card word matches
- **Guess Limits:** Correctly allows clueNumber + 1 guesses
- **Double Spymaster Prevention:** Lua script atomically prevents
- **Spectator Restrictions:** Role checks in all handlers
- **Player Limits:** Atomic check in `ATOMIC_JOIN_SCRIPT`
- **XSS Prevention:** `sanitizeHtml()` + Zod validation
- **Rate Limiting:** Comprehensive HTTP and Socket.io limits
- **Tests:** 2331 tests passing across 71 suites

---

## Recommendations by Priority

### Immediate (Production Blockers)
1. Fix `createRateLimitedHandler` to return Promise awaiting callback
2. Add Lua script support for timers in memory mode
3. Fix frontend event names: `chat:send`→`chat:message`, `room:requestResync`→`room:resync`
4. Fix frontend payload: `sessionId`→`targetSessionId` for kick

### High Priority
5. Increase disconnect timeout or add retry logic
6. Use `atomicHostTransfer()` in `leaveRoom`
7. Add format validation to room:reconnect handler
8. Fix timing-safe comparison in `validateReconnectionToken`
9. Store reconnection token in frontend

### Medium Priority
10. Add mutex/lock for concurrent game:reveal
11. Deduplicate timer expiration callback code
12. Add missing error code mappings
13. Add logging to silent catch blocks
14. Consolidate reconnection token validation functions

---

## Files Most Needing Attention

| File | Issues | Severity |
|------|--------|----------|
| `src/js/socket.js` | 8 | Critical/High |
| `server/src/services/timerService.js` | 7 | Critical/High/Medium |
| `server/src/socket/handlers/roomHandlers.js` | 5 | High/Medium |
| `server/src/socket/handlers/gameHandlers.js` | 4 | Critical/High/Medium |
| `server/src/services/playerService.js` | 4 | High/Medium |
| `server/src/socket/rateLimitHandler.js` | 1 | Critical |
| `server/src/config/memoryStorage.js` | 1 | Critical |
