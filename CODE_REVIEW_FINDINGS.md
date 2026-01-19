# Code Review Findings - Risley-Codenames

**Review Date:** January 2026
**Reviewer:** Claude Code Review
**Branch:** `claude/code-review-orVir`

---

## Executive Summary

This is a well-architected multiplayer Codenames game with both standalone (URL-based) and server-based modes. The codebase demonstrates good security awareness with rate limiting, input validation, and session management. However, there are several issues that should be addressed, ranging from potential security vulnerabilities to code quality improvements.

**Overall Assessment:** Good quality codebase with room for improvements in specific areas.

---

## Critical Issues

### 1. Socket Rate Limiter Not Actually Used in Handlers

**Location:** `server/src/socket/index.js:87` and all handler files
**Severity:** Medium-High

The socket rate limiter is created and attached to `socket.rateLimiter`, but **it is never actually invoked** in any of the event handlers. The handlers don't call the rate limiter before processing events.

```javascript
// socket/index.js:87 - Rate limiter is attached but never used
socket.rateLimiter = socketRateLimiter;

// In handlers like gameHandlers.js - no rate limit check
socket.on('game:reveal', async (data) => {
    // Should call: socket.rateLimiter.getLimiter('game:reveal')(socket, data, () => {...})
    // But doesn't - events are processed without rate limiting
});
```

**Impact:** Malicious users could flood the server with socket events, bypassing the intended rate limits.

**Recommendation:** Wrap each socket event handler with the rate limiter:
```javascript
const rateLimitedHandler = (eventName, handler) => {
    return async (data) => {
        const limiter = socket.rateLimiter.getLimiter(eventName);
        limiter(socket, data, async (err) => {
            if (err) return socket.emit('error', { message: err.message });
            await handler(data);
        });
    };
};
```

---

### 2. Potential ReDoS in Clue Validation Regex

**Location:** `server/src/validators/schemas.js:74`
**Severity:** Low-Medium

```javascript
.regex(/^[A-Za-z\s-]+$/, 'Clue must contain only letters, spaces, and hyphens')
```

While this specific regex is safe, the pattern should be more restrictive. The current regex allows unlimited spaces and hyphens, which could lead to edge cases.

**Recommendation:** Add length constraints (already have max 50) and consider using a stricter pattern:
```javascript
.regex(/^[A-Za-z]+(?:[\s-][A-Za-z]+)*$/, 'Clue must be letters with optional spaces/hyphens')
```

---

## Security Issues

### 3. CORS Configuration Allows Wildcard in Production

**Location:** `server/src/app.js:25-31` and `server/src/socket/index.js:37-41`
**Severity:** Medium

```javascript
const corsOrigin = process.env.CORS_ORIGIN || '*';  // Defaults to wildcard
```

If `CORS_ORIGIN` is not set, the server accepts requests from any origin, which is risky in production.

**Recommendation:** Remove the wildcard default or fail if not set in production:
```javascript
const corsOrigin = process.env.CORS_ORIGIN;
if (!corsOrigin && process.env.NODE_ENV === 'production') {
    throw new Error('CORS_ORIGIN must be set in production');
}
```

---

### 4. JWT Secret Could Be Undefined

**Location:** `server/src/middleware/socketAuth.js:55`
**Severity:** Medium

```javascript
const decoded = jwt.verify(token, process.env.JWT_SECRET);
```

If `JWT_SECRET` is undefined, jwt.verify will fail silently or throw. There's no validation that the secret is configured.

**Recommendation:** Add startup validation for required environment variables.

---

### 5. Error Messages Leak Internal Details

**Location:** `server/src/middleware/errorHandler.js:67-69`
**Severity:** Low

```javascript
message: process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : err.message
```

Good that production hides details, but ensure all error paths follow this pattern. Some socket handlers directly emit error messages that might contain sensitive information.

---

## Bugs and Logic Issues

### 6. Room Join Script Returns Unexpected Values Not Fully Handled

**Location:** `server/src/services/roomService.js:154-161`
**Severity:** Low-Medium

The Lua script handling is good but the fallback case could be more robust:

```javascript
} else if (result === 1) {
    // Successfully added to set, now create player data
    player = await playerService.createPlayerData(sessionId, code, nickname, false);
} else {
    // Unexpected result (null, undefined, or other) - log and throw error
```

If `createPlayerData` fails after the Lua script has already added the session to the set, the player will be in an inconsistent state (in the players set but without player data).

**Recommendation:** Make the operation atomic or add rollback logic:
```javascript
try {
    player = await playerService.createPlayerData(sessionId, code, nickname, false);
} catch (error) {
    // Rollback: remove from players set
    await redis.sRem(`room:${code}:players`, sessionId);
    throw error;
}
```

---

### 7. Game State Race Condition Window

**Location:** `server/src/services/gameService.js:236-349`
**Severity:** Low

While the code uses Redis WATCH/MULTI for optimistic locking, there's a small window where multiple instances could read the same state before any transaction completes. With 3 retries, this is usually fine, but under high load it could fail.

The implementation is reasonable for the use case, but worth monitoring.

---

### 8. Timer Orphan Check Could Miss Timers

**Location:** `server/src/services/timerService.js:428`
**Severity:** Low

```javascript
} else if (remainingMs > 0 && remainingMs < ORPHAN_CHECK_INTERVAL * 2) {
```

Timers with `remainingMs >= ORPHAN_CHECK_INTERVAL * 2` (60+ seconds) won't be claimed by another instance if the original instance crashes. They'll expire in Redis but the callback won't fire.

**Recommendation:** Consider using Redis keyspace notifications for timer expiration instead of polling, or reduce the threshold.

---

### 9. Client XSS Prevention Incomplete

**Location:** `index.html:1077, 1080`
**Severity:** Low

The `escapeHTML` function is used correctly in most places, but there are a few spots where user input (team names from URL) is rendered:

```javascript
banner.innerHTML = `You are the <strong>${escapeHTML(teamNames.red)}</strong> SPYMASTER...`;
```

This is correctly escaped. However, the `textContent` assignments in `updateScoreboard()` are also safe:
```javascript
document.getElementById('red-team-name').textContent = teamNames.red;
```

The code handles XSS well overall. Just ensure all user input continues to be escaped when used in innerHTML contexts.

---

## Code Quality Issues

### 10. Inconsistent Error Handling Pattern

**Location:** Various handler files
**Severity:** Low

Error objects are created inline with different structures:
```javascript
throw { code: ERROR_CODES.ROOM_NOT_FOUND, message: 'Room not found' };  // Object literal
throw { code: ERROR_CODES.SERVER_ERROR, message: 'Failed...' };  // Object literal
```

**Recommendation:** Create a custom error class for consistency:
```javascript
class GameError extends Error {
    constructor(code, message, details = null) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
```

---

### 11. Magic Numbers in Timer Service

**Location:** `server/src/services/timerService.js:18-22`
**Severity:** Very Low

```javascript
const ORPHAN_CHECK_INTERVAL = 30000;
const ORPHAN_CHECK_TIMEOUT = 5000;
const MAX_ORPHAN_KEYS = 100;
```

These should be in the constants file for consistency with other configuration.

---

### 12. Duplicate Default Word List

**Location:** `index.html:744-796` and `server/src/config/constants.js:72-124`
**Severity:** Very Low

The default word list is duplicated between client and server. This creates a maintenance burden and risk of drift.

**Recommendation:** For the standalone client this is acceptable, but consider serving the word list from the server for the multiplayer mode.

---

### 13. Missing Input Validation for Team Names in Client

**Location:** `index.html:981-988`
**Severity:** Low

```javascript
if (redName) {
    const decoded = decodeURIComponent(redName);
    teamNames.red = decoded.slice(0, 20);  // Only length check
}
```

The client validates length but not content. While server validates this, the client should also validate to prevent issues in standalone mode.

**Recommendation:** Add character validation:
```javascript
teamNames.red = decoded.slice(0, 20).replace(/[<>"'&]/g, '');
```

---

## Performance Considerations

### 14. getPlayersInRoom Fetches All Players Sequentially

**Location:** `server/src/services/playerService.js:148-175`
**Severity:** Low-Medium

```javascript
for (const sessionId of sessionIds) {
    const player = await getPlayer(sessionId);  // Sequential await
    // ...
}
```

For rooms with many players, this creates sequential Redis calls.

**Recommendation:** Use Promise.all for parallel fetching:
```javascript
const playerPromises = sessionIds.map(sessionId => getPlayer(sessionId));
const players = await Promise.all(playerPromises);
```

---

### 15. Health Check Endpoint Could Be Slow

**Location:** `server/src/app.js:63-137`
**Severity:** Very Low

The `/health/ready` endpoint performs multiple async operations. Under heavy load, this could timeout.

**Recommendation:** Add timeout protection or cache results briefly.

---

## Positive Observations

The codebase demonstrates several good practices:

1. **Good Input Validation:** Zod schemas with proper constraints for all inputs
2. **Security Headers:** Helmet middleware properly configured
3. **Session Hijacking Prevention:** Socket auth checks for connected status
4. **Atomic Operations:** Lua scripts for race condition prevention in room joins
5. **Optimistic Locking:** Redis WATCH/MULTI for game state updates
6. **XSS Prevention:** Client properly escapes user input in HTML contexts
7. **Comprehensive Error Codes:** Well-defined error taxonomy
8. **Graceful Degradation:** Memory mode fallback when Redis unavailable
9. **Health Checks:** Multiple health endpoints for different purposes
10. **Clean Separation of Concerns:** Services, handlers, and middleware properly separated

---

## Recommended Priority Actions

### High Priority
1. Actually use the socket rate limiter in handlers (Issue #1)
2. Add rollback logic for failed player creation (Issue #6)

### Medium Priority
3. Configure CORS properly for production (Issue #3)
4. Validate JWT_SECRET is set at startup (Issue #4)
5. Parallelize player fetching (Issue #14)

### Low Priority
6. Create custom GameError class (Issue #10)
7. Move timer constants to config file (Issue #11)
8. Add client-side team name validation (Issue #13)

---

## Files Reviewed

- `server/src/services/gameService.js`
- `server/src/services/roomService.js`
- `server/src/services/playerService.js`
- `server/src/services/timerService.js`
- `server/src/socket/index.js`
- `server/src/socket/handlers/gameHandlers.js`
- `server/src/socket/handlers/roomHandlers.js`
- `server/src/socket/handlers/playerHandlers.js`
- `server/src/middleware/socketAuth.js`
- `server/src/middleware/rateLimit.js`
- `server/src/middleware/errorHandler.js`
- `server/src/validators/schemas.js`
- `server/src/config/redis.js`
- `server/src/config/constants.js`
- `server/src/app.js`
- `index.html`

---

*End of Code Review*
