# Code Review & Hardening Plan

**Date**: 2026-02-06
**Scope**: Full codebase review of Risley-Codenames (server + frontend)
**Test Status**: 91/92 suites passing, 2978/3020 tests passing (42 skipped, 1 suite skipped)

---

## Summary

The codebase demonstrates solid security fundamentals: Zod input validation at all entry points, rate limiting, Helmet.js headers, CSRF protection, distributed locks for critical operations, and role-based authorization via context handlers. This plan identifies the remaining gaps organized by severity.

---

## HIGH Priority

### H1. Frontend innerHTML XSS Vectors

**Files**: `server/public/js/modules/multiplayer.js:523-540`, `server/public/js/modules/history.js:54-72`, `server/public/js/modules/accessibility.js:114-132`

The frontend uses `innerHTML` with template literals to render player lists, game history, and keyboard shortcut panels. While `escapeHTML()` is applied to some dynamic values (e.g., `p.nickname`), other interpolated variables like `hostBadge` and `kickBtn` in `multiplayer.js` are injected as raw HTML strings. If a compromised or malicious server sends crafted data, these become XSS vectors.

**Recommendation**: Refactor rendering to use DOM APIs (`createElement`, `textContent`) instead of `innerHTML` with template strings, or apply `escapeHTML()` to all dynamic content without exception.

### H2. Rate Limit Fail-Open Default

**File**: `server/src/config/constants.ts:55`

```typescript
RATE_LIMIT_FAIL_CLOSED: false  // Default: fail-open for availability
```

When Redis is unavailable, session validation rate limiting is bypassed entirely (`server/src/middleware/socketAuth.ts:170-177`). An attacker who can trigger or coincide with Redis instability can brute-force session validation without throttling.

**Recommendation**: Set `RATE_LIMIT_FAIL_CLOSED: true` in production deployments, or implement an in-memory fallback rate limiter that activates when Redis is unreachable.

### H3. Non-Atomic Fallback in Player Updates

**File**: `server/src/services/playerService.ts:231-239`

After 3 failed optimistic locking retries, `updatePlayer()` falls back to a non-atomic read-modify-write:

```typescript
const player = await getPlayer(sessionId);
const updatedPlayer = { ...player, ...updates, lastSeen: Date.now() };
await redis.set(playerKey, JSON.stringify(updatedPlayer), { EX: REDIS_TTL.PLAYER });
```

This can silently overwrite concurrent updates from other operations (e.g., two simultaneous role changes for the same player).

**Recommendation**: Either throw an error after exhausting retries (letting the caller retry at a higher level), or use a Lua script for the critical update path to guarantee atomicity.

### H4. No Frontend Test Coverage

The 4,800+ lines of frontend JavaScript across 15 modules (`game.js`, `multiplayer.js`, `board.js`, `state.js`, etc.) have zero automated tests. The XSS issues in H1 and state manipulation risks are undetectable without frontend testing.

**Recommendation**: Add a frontend test suite (Vitest + jsdom or Playwright component tests) covering at minimum:
- HTML escaping in all rendering functions
- URL parameter parsing and sanitization
- State management invariants
- Socket event handler error paths

---

## MEDIUM Priority

### M1. IP Mismatch Allowed by Default

**File**: `server/src/config/constants.ts:50`

```typescript
IP_MISMATCH_ALLOWED: true  // Allow reconnection from different IP
```

Combined with `RECONNECTION_TOKEN_TTL_SECONDS: 300` (5 minutes), a stolen session ID + reconnection token can be used from any IP within the grace period. The system logs the mismatch but doesn't block it.

**Recommendation**: Consider `IP_MISMATCH_ALLOWED: false` for production, or add progressive security (e.g., require token re-validation if IP changes).

### M2. Hardcoded Development JWT Secret

**File**: `server/src/config/jwt.ts:56`

```typescript
const DEV_SECRET = 'development-secret-do-not-use-in-production';
```

If a developer runs the server without setting `JWT_SECRET`, all JWTs are signed with this publicly known constant. In production, the code either warns (missing secret) or throws (too short), but doesn't guarantee rejection of the dev secret itself.

**Recommendation**: In production, explicitly reject the known dev secret string in addition to the length check.

### M3. Duet Game Mode Detection via String Matching

**File**: `server/src/services/gameService.ts:1010`

```typescript
const isDuetGame = preCheckData && preCheckData.includes('"gameMode":"duet"');
```

This checks for Duet mode by searching for a literal JSON substring in the serialized game state. If Redis or serialization ever produces different spacing (e.g., `"gameMode": "duet"` with a space), the check silently fails and the wrong Lua script path executes.

**Recommendation**: Parse the JSON and check the field properly, or use a dedicated Redis key/field for game mode.

### M4. Race Condition in Player Kick Operation

**File**: `server/src/socket/handlers/playerHandlers.ts:245-295`

The kick operation removes the player from Redis (line 269) before disconnecting their socket (lines 272-281). In the gap between these operations, the kicked player's socket can still emit events that reference their now-deleted player data, causing handler errors.

**Recommendation**: Disconnect the socket first (or mark the player as "kicking" in Redis) before removing their data, or wrap both operations in a distributed lock.

### M5. Reconnection Token TOCTOU Race

**File**: `server/src/services/playerService.ts:832-857`

The token generation uses `SET NX` to prevent duplicate tokens, but if the existing token expires between the NX failure and the subsequent GET, the code falls through and creates a new token without cleaning up properly. With two concurrent calls hitting this window, both callers store separate `token->session` mappings while only the last `session->token` write wins, leaving an orphaned token that could still validate.

**Recommendation**: Use a Lua script that atomically checks, creates, and returns the token in a single operation.

### M6. CSRF Violations Not Audit-Logged

**File**: `server/src/middleware/csrf.ts:38-93`

CSRF violations are logged via `logger.warn()` but never recorded in the audit service (`auditService.ts`). Security-sensitive events like blocked CSRF requests should appear in audit logs alongside socket auth failures and rate limit violations.

**Recommendation**: Add `audit.suspicious()` calls for CSRF rejections.

### M7. Disconnect Handler Timeout Orphans Background Work

**File**: `server/src/socket/index.ts:238-263`

When the disconnect handler times out after 30 seconds, the original async promise continues running in the background. Under heavy churn (many simultaneous disconnects), these orphaned promises accumulate memory and CPU.

**Recommendation**: Use an `AbortController`/cancellation token pattern so timed-out disconnect operations actually stop their work.

### M8. Room Enumeration via Connection Pooling

**File**: `server/src/config/constants.ts:75`

With `MAX_CONNECTIONS_PER_IP: 10` and `room:join` rate limited to 10/min per socket, an attacker can open 10 concurrent sockets and attempt 100 room joins per minute per IP. Room codes are 6 characters, but if the character set is limited, enumeration becomes feasible.

**Recommendation**: Add a global per-IP rate limit for `room:join` that applies across all sockets from the same IP, not per-socket.

---

## LOW Priority

### L1. Session ID in localStorage

**File**: `server/public/js/socket-client.js:42-43`

Session IDs and nicknames are stored in `sessionStorage`/`localStorage`, accessible to any script on the domain. If any XSS vulnerability exists (see H1), session hijacking becomes trivial.

**Recommendation**: After fixing H1, consider moving session tokens to `httpOnly` cookies for defense-in-depth.

### L2. Debug State Dump in Console

**File**: `server/public/js/modules/state.js:320-328`

A `dumpState()` function logs complete game state (including spymaster assignments, current turn, room IDs) to the browser console. Any player can call this from DevTools.

**Recommendation**: Gate debug output behind a build-time flag, or remove it. Sensitive fields (card types for non-spymasters) should never be present in client state regardless.

### L3. Clue Validation Single-Character Word Exemption

**File**: `server/src/services/gameService.ts:1146-1151`

Single-character board words (e.g., "A", "I") are exempted from the "clue contains board word" validation. This means a clue like "ANT" passes even though the board contains "A".

**Recommendation**: This is a known trade-off (documented in the comment), but could be tightened by requiring the board word match to be a whole-word boundary, not a substring.

### L4. Audit Logs Lost in Memory Mode

**File**: `server/src/services/auditService.ts:189-204`

When running without external Redis (memory mode), all audit log writes are silently discarded. Security events are completely lost.

**Recommendation**: Write audit logs to the in-memory storage (same as game data), or fall back to file-based logging when Redis is unavailable.

### L5. Timer Handlers Missing Active Game Check

**File**: `server/src/socket/handlers/timerHandlers.ts:67-147`

Timer pause/resume/stop handlers use `createHostHandler` (correct for authorization), but don't verify that an active game exists. A host can manipulate timers on a room with no game in progress.

**Recommendation**: Add a game-active check at the start of timer handlers, or use `createGameHandler` which enforces game context.

### L6. Error Messages Expose Implementation Details in Non-Production

**File**: `server/src/middleware/errorHandler.ts:108-110`

Full error messages (including internal details) are returned in non-production environments. If staging/development environments are accessible externally, this leaks implementation information.

**Recommendation**: Use a whitelist of safe error messages even in development, or ensure non-production environments are never publicly accessible.

### L7. Dead Code in Timer Service

**File**: `server/src/services/timerService.ts:88, 503-507`

`_globalExpireCallback` is declared (with `@ts-expect-error` suppressing the unused warning) and `initializeTimerService()` sets it, but it's never called. This is dead code that adds confusion.

**Recommendation**: Remove the unused global callback and `initializeTimerService()` function.

### L8. MemoryStorage Test Timeout

**Test Suite**: `memoryStorageEviction.test.ts` produces `setInterval` timeout leaks in tests, causing the 1 skipped suite. The `MemoryStorage` constructor creates intervals that aren't cleaned up in test contexts.

**Recommendation**: Add proper teardown (`afterEach`/`afterAll`) that calls `clearInterval` on the cleanup timer, or use fake timers in tests.

---

## Positive Findings

The following security measures are well-implemented and should be maintained:

- **Input validation**: Comprehensive Zod schemas at all socket and REST entry points, including Unicode-aware regex, reserved name blocking, and control character removal
- **Rate limiting**: Per-event rate limits on all socket handlers, per-IP connection limits, LRU-evicting rate limit storage
- **Authorization**: Context handler pattern (`createRoomHandler`, `createHostHandler`, `createGameHandler`) consistently enforces role and state requirements
- **Spymaster data protection**: `getGameStateForPlayer()` correctly strips card types for non-spymaster players
- **Distributed locks**: Card reveal and game creation use Redis locks with Lua scripts for atomicity
- **Security headers**: Helmet.js with CSP, HSTS, X-Frame-Options properly configured
- **CSRF protection**: Custom header requirement (`X-Requested-With`) plus origin validation when CORS is restricted; production rejects wildcard CORS origin
- **Session security**: Session age limits, IP consistency logging, reconnection token rotation, timing-safe admin password comparison
- **Graceful degradation**: System works without PostgreSQL or Redis (falls back to in-memory storage) without compromising core security
