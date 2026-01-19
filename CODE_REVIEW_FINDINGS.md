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

## Additional Issues Found in Deep Review

### 16. Spymaster Role Assignment Race Condition

**Location:** `server/src/services/playerService.js:119-132`
**Severity:** Medium

```javascript
// If becoming spymaster, check if team already has one
if (role === 'spymaster' && player.team) {
    const roomPlayers = await getPlayersInRoom(player.roomCode);
    const existingSpymaster = roomPlayers.find(
        p => p.team === player.team && p.role === 'spymaster' && p.sessionId !== sessionId
    );
    if (existingSpymaster) {
        throw { code: ERROR_CODES.INVALID_INPUT, message: `${player.team} team already has a spymaster` };
    }
}
return updatePlayer(sessionId, { role });
```

Between checking for an existing spymaster and updating the player's role, another player could also become spymaster for the same team. This is a time-of-check to time-of-use (TOCTOU) race condition.

**Impact:** Two players could end up as spymasters for the same team, both seeing the card types.

**Recommendation:** Use a Redis transaction or lock to make the check-and-set atomic:
```javascript
const LOCK_KEY = `lock:spymaster:${roomCode}:${team}`;
await redis.set(LOCK_KEY, '1', { NX: true, EX: 5 });
// ... check and update ...
await redis.del(LOCK_KEY);
```

---

### 17. Session Hijacking Window During Disconnect Grace Period

**Location:** `server/src/middleware/socketAuth.js:27-37`
**Severity:** Low-Medium

```javascript
if (existingPlayer) {
    if (!existingPlayer.connected) {
        // Only allow session reuse if player is disconnected
        validatedSessionId = sessionId;
    } else {
        // Player is currently connected - potential hijacking attempt
        logger.warn(`Session hijacking attempt blocked...`);
    }
}
```

When a player disconnects, they're marked as `connected: false` but their session remains valid for reconnection. During this window (until TTL expires), an attacker who obtains the session ID could hijack the session by connecting with it.

**Recommendation:** Add additional verification like:
- Require a reconnection token generated at disconnect time
- Check IP address consistency
- Use shorter TTLs for disconnected sessions

---

### 18. getPlayersInRoom Orphan Cleanup Not Atomic

**Location:** `server/src/services/playerService.js:166-170`
**Severity:** Very Low

```javascript
if (orphanedSessionIds.length > 0) {
    for (const sessionId of orphanedSessionIds) {
        await redis.sRem(`room:${roomCode}:players`, sessionId);
    }
}
```

Orphan cleanup is done with individual `sRem` calls rather than a single atomic operation. Under high concurrency, this could cause issues.

**Recommendation:** Use Redis pipeline or SREM with multiple members:
```javascript
await redis.sRem(`room:${roomCode}:players`, ...orphanedSessionIds);
```

---

### 19. Team-Only Chat Messages Could Leak on Team Change

**Location:** `server/src/socket/handlers/chatHandlers.js:40-47`
**Severity:** Very Low

```javascript
if (validated.teamOnly && player.team) {
    const players = await playerService.getPlayersInRoom(socket.roomCode);
    const teammates = players.filter(p => p.team === player.team);
    for (const teammate of teammates) {
        io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
    }
}
```

If a player changes teams between the `getPlayer` call (line 24) and the `getPlayersInRoom` call (line 42), the team filtering might be inconsistent. This is extremely unlikely but theoretically possible.

---

### 20. No Validation That Spymaster Has a Team Before Giving Clue

**Location:** `server/src/socket/handlers/gameHandlers.js:149-152`
**Severity:** Low

```javascript
const player = await playerService.getPlayer(socket.sessionId);
if (!player || player.role !== 'spymaster') {
    throw { code: ERROR_CODES.NOT_SPYMASTER, message: 'Only spymasters can give clues' };
}
```

The handler checks if the player is a spymaster, but doesn't explicitly verify they have a team. The `giveClue` service does validate this (line 411), but the error message at the handler level would be clearer if it checked upfront.

---

### 21. Game Start Sends State to All Players Including Disconnected Ones

**Location:** `server/src/socket/handlers/gameHandlers.js:42-48`
**Severity:** Very Low

```javascript
const players = await playerService.getPlayersInRoom(socket.roomCode);
for (const p of players) {
    const gameState = gameService.getGameStateForPlayer(game, p);
    io.to(`player:${p.sessionId}`).emit('game:started', { game: gameState });
}
```

The game state is sent to all players in the room, including those marked as disconnected. This wastes resources, though Socket.IO will handle the missing socket gracefully.

**Recommendation:** Filter to connected players:
```javascript
const connectedPlayers = players.filter(p => p.connected);
```

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
1. Actually use the socket rate limiter in handlers (Issue #1) - **Security Critical**
2. Add rollback logic for failed player creation (Issue #6)
3. Fix spymaster role assignment race condition (Issue #16) - **Could allow cheating**

### Medium Priority
4. Configure CORS properly for production (Issue #3)
5. Validate JWT_SECRET is set at startup (Issue #4)
6. Parallelize player fetching (Issue #14)
7. Address session hijacking window during disconnect (Issue #17)

### Low Priority
8. Create custom GameError class (Issue #10)
9. Move timer constants to config file (Issue #11)
10. Add client-side team name validation (Issue #13)
11. Make orphan cleanup atomic (Issue #18)
12. Filter disconnected players when sending game state (Issue #21)

---

## Files Reviewed

### Server-Side (18 files)
- `server/src/services/gameService.js` - Core game logic, card reveal, clue validation
- `server/src/services/roomService.js` - Room CRUD, atomic joins via Lua script
- `server/src/services/playerService.js` - Player management, role assignment
- `server/src/services/timerService.js` - Distributed timer with Redis backing
- `server/src/socket/index.js` - Socket.IO initialization and configuration
- `server/src/socket/handlers/gameHandlers.js` - Game events (start, reveal, clue)
- `server/src/socket/handlers/roomHandlers.js` - Room events (create, join, leave)
- `server/src/socket/handlers/playerHandlers.js` - Player events (team, role, nickname)
- `server/src/socket/handlers/chatHandlers.js` - Chat functionality
- `server/src/middleware/socketAuth.js` - Socket authentication
- `server/src/middleware/rateLimit.js` - Rate limiting implementation
- `server/src/middleware/errorHandler.js` - Global error handling
- `server/src/validators/schemas.js` - Zod input validation schemas
- `server/src/config/redis.js` - Redis connection management
- `server/src/config/constants.js` - Game constants and configuration
- `server/src/app.js` - Express application setup

### Client-Side (1 file)
- `index.html` - Full standalone client (1,468 lines)

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Total Issues Found | 21 |
| Critical/High Priority | 3 |
| Medium Priority | 4 |
| Low Priority | 5 |
| Very Low Priority | 9 |
| Files Reviewed | 17 |

---

*End of Code Review - January 2026*
