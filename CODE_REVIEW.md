# Code Review: Risley-Codenames

**Reviewer:** Claude Code Review
**Date:** 2026-01-17
**Branch:** `claude/code-review-KEV3p`

---

## Executive Summary

This is a well-architected Codenames implementation with both a standalone client and a full multiplayer server. The codebase demonstrates good separation of concerns, comprehensive input validation, and thoughtful security measures. However, there are several areas that could benefit from improvement.

**Overall Assessment:** Good quality codebase with minor issues to address.

---

## Findings by Severity

### 🔴 Critical Issues (0)

No critical security vulnerabilities or blocking issues found.

---

### 🟠 Medium Issues (4)

#### 1. Race Condition in Room Join (roomService.js:107-123)

**File:** `server/src/services/roomService.js`
**Lines:** 107-123

**Issue:** The double-check pattern for room capacity has a potential race condition. Between `SCARD` check and `createPlayer`, another player could join. While the rollback mechanism exists, it's not atomic.

**Current Code:**
```javascript
const currentCount = await redis.sCard(`room:${code}:players`);
if (currentCount >= ROOM_MAX_PLAYERS) {
    throw { code: ERROR_CODES.ROOM_FULL, message: 'Room is full' };
}
// Race window here...
player = await playerService.createPlayer(sessionId, code, nickname, false);
```

**Recommendation:** Use Redis transactions with `WATCH` or Lua scripts for atomic check-and-add operations, similar to how `revealCard` handles concurrency.

---

#### 2. Seeded Random Number Generator Quality (gameService.js:23-26)

**File:** `server/src/services/gameService.js` (also in `index.html`)
**Lines:** 23-26

**Issue:** The `seededRandom` function uses `Math.sin()` which is not cryptographically secure and may have poor distribution properties for certain seed values. While acceptable for game randomness, the quality could be improved.

**Current Code:**
```javascript
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}
```

**Recommendation:** Consider using a more robust PRNG like xorshift or Mulberry32 for better distribution:
```javascript
function seededRandom(seed) {
    seed = seed | 0;
    seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
}
```

---

#### 3. In-Memory Timer Service Not Horizontally Scalable (timerService.js:9)

**File:** `server/src/services/timerService.js`
**Lines:** 8-9

**Issue:** The `activeTimers` Map is in-memory, which means timers don't survive server restarts and won't work correctly with multiple server instances (despite Redis pub/sub for Socket.io).

**Current Code:**
```javascript
// In-memory timers (for single instance, use Redis pub/sub for multi-instance)
const activeTimers = new Map();
```

**Recommendation:** Store timer state in Redis with TTL, and use a distributed scheduling mechanism (e.g., Bull/BullMQ, or Redis-based timer with polling) for multi-instance support.

---

#### 4. Potential Memory Leak in Socket Rate Limiter (rateLimit.js:48-79)

**File:** `server/src/middleware/rateLimit.js`
**Lines:** 48-79

**Issue:** While `cleanupSocket` and `cleanupStale` functions exist, they must be explicitly called. If a socket disconnects without calling `cleanupSocket`, entries persist until the periodic cleanup runs.

**Observation:** The cleanup functions are defined but I don't see them being called on socket disconnect in the socket handlers.

**Recommendation:** Ensure `cleanupSocket` is called in the disconnect handler in `socket/index.js`:
```javascript
socket.on('disconnect', (reason) => {
    socketRateLimiter.cleanupSocket(socket.id);
    // ... existing disconnect logic
});
```

---

### 🟡 Low Issues (6)

#### 5. Missing Input Sanitization for Team Names in URL (index.html:977-981)

**File:** `index.html`
**Lines:** 977-981

**Issue:** While `escapeHTML` is used when rendering team names, the decoding from URL doesn't validate the content beyond `decodeURIComponent`.

**Current Code:**
```javascript
if (redName) {
    teamNames.red = decodeURIComponent(redName);
}
```

**Recommendation:** Add length limits and character validation:
```javascript
if (redName) {
    const decoded = decodeURIComponent(redName);
    teamNames.red = decoded.slice(0, 20); // Match server limit
}
```

---

#### 6. Console Logging in Production (multiple files)

**Issue:** The logger is configured but there's no clear distinction between development and production log levels in the codebase.

**Recommendation:** Ensure `utils/logger.js` respects `NODE_ENV` for log levels (e.g., `debug` only in development).

---

#### 7. Deprecated `document.execCommand` Usage (index.html:1295)

**File:** `index.html`
**Line:** 1295

**Issue:** `document.execCommand('copy')` is deprecated. While the primary `navigator.clipboard.writeText` is modern, the fallback uses deprecated API.

**Current Code:**
```javascript
} catch (err) {
    input.select();
    document.execCommand('copy');
```

**Recommendation:** The fallback is acceptable for older browser support but consider removing it if targeting modern browsers only, or document this as intentional legacy support.

---

#### 8. Missing Error Handling for wordlist.txt Fetch (index.html:1429-1441)

**File:** `index.html`
**Lines:** 1429-1441

**Issue:** The `tryLoadWordlistFile` function silently catches all errors without distinguishing between "file not found" (expected) and other errors (unexpected).

**Current Code:**
```javascript
} catch (e) {
    // File doesn't exist or can't be loaded
}
```

**Recommendation:** Log unexpected errors in development:
```javascript
} catch (e) {
    if (e.name !== 'TypeError') { // Network errors are TypeError
        console.warn('Unexpected error loading wordlist.txt:', e);
    }
}
```

---

#### 9. Hardcoded Port in Test Scripts

**File:** `server/package.json` (assumed)

**Issue:** If tests run against a live server, the port should be configurable via environment variables.

**Recommendation:** Ensure test configuration uses `process.env.PORT` or a dedicated test port.

---

#### 10. Missing CSRF Protection for REST Endpoints

**File:** `server/src/app.js`

**Issue:** While WebSocket connections are authenticated, REST API endpoints lack CSRF protection. This is lower risk since most operations are via WebSocket, but the word list endpoints accept POST/PUT/DELETE.

**Recommendation:** Add CSRF middleware (e.g., `csurf`) for state-changing REST endpoints, or use same-site cookies if implementing authentication.

---

### 🔵 Informational (5)

#### 11. Code Duplication: Seeded Random Functions

**Files:** `index.html` and `server/src/services/gameService.js`

**Observation:** The `seededRandom`, `hashString`, and `shuffleWithSeed` functions are duplicated between client and server. This is intentional for the standalone client mode but could lead to drift.

**Suggestion:** Add a comment in both files noting they must stay in sync.

---

#### 12. Large DEFAULT_WORDS Array Duplicated

**Files:** `index.html` (~270 lines) and `server/src/config/constants.js` (~52 lines)

**Observation:** The 270+ word default word list is duplicated. Any additions or removals must be made in both places.

**Suggestion:** For the server, consider loading from a JSON file or database to ease maintenance.

---

#### 13. Comprehensive Test Coverage Could Be Expanded

**File:** `server/src/__tests__/`

**Observation:** Tests cover pure utility functions well but integration tests for Socket.io events and service interactions appear limited.

**Suggestion:** Add integration tests for critical flows:
- Room creation and joining
- Game start and card reveal
- Host transfer on disconnect
- Timer expiration

---

#### 14. Good Security Practices Observed

**Positive Observations:**
- XSS prevention with `escapeHTML()` function
- Input validation with Zod schemas
- Rate limiting on API and socket events
- Helmet.js for security headers
- CORS configuration
- Optimistic locking for concurrent operations
- Role-based access control (host/spymaster)

---

#### 15. Well-Structured Error Handling

**Positive Observations:**
- Consistent error codes in `constants.js`
- Proper error propagation with context
- Global error handler catches unhandled errors
- Socket errors properly emitted to clients

---

## Specific File Reviews

### index.html (Client)

| Aspect | Rating | Notes |
|--------|--------|-------|
| Code Organization | ⭐⭐⭐⭐ | Single file but well-structured with clear function separation |
| Security | ⭐⭐⭐⭐ | XSS prevention, URL sanitization |
| Accessibility | ⭐⭐⭐⭐ | ARIA labels, keyboard navigation, colorblind mode |
| Maintainability | ⭐⭐⭐ | Would benefit from modularization for larger changes |

### Server Architecture

| Aspect | Rating | Notes |
|--------|--------|-------|
| Separation of Concerns | ⭐⭐⭐⭐⭐ | Clear layers: routes → services → data |
| Error Handling | ⭐⭐⭐⭐ | Consistent patterns throughout |
| Scalability | ⭐⭐⭐ | Redis for sessions, but timer service is single-instance |
| Testing | ⭐⭐⭐ | Good unit tests, could use more integration tests |
| Documentation | ⭐⭐⭐⭐ | Good inline comments and JSDoc |

---

## Recommendations Summary

### Priority 1 (Should Fix)
1. Add atomic room capacity check to prevent race condition
2. Implement socket rate limiter cleanup on disconnect

### Priority 2 (Should Consider)
3. Improve PRNG quality for game seed generation
4. Make timer service Redis-backed for horizontal scaling

### Priority 3 (Nice to Have)
5. Add input length validation for URL-decoded team names
6. Add integration test coverage
7. Consider CSRF protection for REST endpoints

---

## Conclusion

This is a solid codebase with thoughtful architecture and good security practices. The dual-mode design (standalone + server) is well-executed. The main areas for improvement are around edge cases in concurrent operations and horizontal scalability of the timer service. The test suite could be expanded to cover more integration scenarios.

The code is production-ready for single-instance deployments. For multi-instance deployments, the timer service would need to be refactored to use Redis-backed scheduling.
