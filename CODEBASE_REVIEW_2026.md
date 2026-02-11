# Comprehensive Codebase Review - Codenames Online

**Date**: 2026-02-11
**Scope**: Full codebase review — backend services, socket layer, frontend, middleware/security, configuration/types/utilities, tests
**Reviewer**: Claude (automated deep analysis)

---

## Executive Summary

This is a well-architected, production-ready multiplayer Codenames implementation with strong foundations: strict TypeScript, 2,675+ tests at 94%+ coverage, comprehensive security middleware, and clean separation of concerns. The codebase has clearly benefited from prior review cycles (95 findings addressed per commit history).

This review identifies **67 remaining findings** across 6 categories:

| Category | Critical | High | Medium | Low | Total |
|----------|----------|------|--------|-----|-------|
| Backend Services | 2 | 5 | 6 | 3 | 16 |
| Socket Layer | 1 | 2 | 5 | 5 | 13 |
| Security & Middleware | 0 | 2 | 2 | 2 | 6 |
| Frontend | 3 | 5 | 5 | 2 | 15 |
| Config/Types/Utilities | 2 | 3 | 5 | 3 | 13 |
| Tests & Infrastructure | 0 | 0 | 2 | 2 | 4 |
| **Totals** | **8** | **17** | **25** | **17** | **67** |

**Key themes**: Race conditions in service-layer Redis operations, XSS vectors in admin dashboard template literals, type safety gaps in MemoryStorage, and incomplete Unicode handling in Lua scripts.

---

## 1. Backend Services

### 1.1 Token Consumption Race Condition (playerService.ts)
**Severity: CRITICAL**

`validateSocketAuthToken()` (lines 674-684) does NOT consume the token, while `validateRoomReconnectToken()` (lines 931-932) DOES consume it. If both are called in quick succession for the same token, the second call fails with `TOKEN_EXPIRED`.

```
validateSocketAuthToken()  → reads token, does not delete
validateRoomReconnectToken() → reads and deletes token
                              ↑ Race: if both execute concurrently, one succeeds and one fails
```

**Fix**: Use a single atomic validate-and-consume operation for both paths, or ensure the token type determines which validator is called (never both).

### 1.2 Orphaned Reconnection Tokens on Player Removal (playerService.ts)
**Severity: CRITICAL**

`removePlayer()` (lines 578-595) does not delete the player's reconnection token. Cleanup relies entirely on `cleanupOrphanedReconnectionTokens()` background task. If that task is disabled or delayed, tokens persist indefinitely and could be reused.

**Fix**: Add explicit token deletion in `removePlayer()`:
```typescript
await redis.del(`reconnect:${roomCode}:${player.sessionId}`);
```

### 1.3 Race Condition in Team Switching (playerService.ts)
**Severity: HIGH**

`setTeam()` (lines 278-338) fetches `oldTeam` via `getPlayer()` before calling the Lua script. Between the read and Lua execution, another request can change the team, causing the Lua script to remove the player from the wrong team set.

**Fix**: Pass current team as a Lua argument and let Lua verify atomically inside the script.

### 1.4 Incorrect TTL Management in Transaction Rollback (gameService.ts)
**Severity: HIGH**

In `revealCardFallback()` (line 386) and `giveClueTransactional()` (line 544), the code reads TTL with `redis.ttl()`. If TTL returns -1 (no expiration), it falls back to `REDIS_TTL.ROOM`. This could extend the TTL indefinitely on repeated operations.

**Fix**: Only refresh TTL if the current value is positive:
```typescript
if (currentTTL > 0) {
    await redis.expire(gameKey, currentTTL);
} // else: leave TTL unchanged
```

### 1.5 Non-Atomic TTL Refresh Across Room Keys (roomService.ts)
**Severity: HIGH**

`refreshRoomTTL()` (lines 460-481) reads and refreshes 5 separate Redis keys individually with timeout wrappers. Between operations, keys can expire. No atomic operation covers all 5 keys.

**Fix**: Use a Lua script to atomically refresh all room-related keys.

### 1.6 Lock Release Failure Leaves Permanent Lock (gameService.ts)
**Severity: HIGH**

Lock release in the `finally` block (lines 249-257) can fail silently. If lock release times out, subsequent operations fail with "Another card reveal in progress" permanently until TTL expires.

**Fix**: Add exponential backoff retry on lock release failure, or ensure lock TTL is short enough to self-heal.

### 1.7 updatePlayer Retry Exhaustion Without Backoff (playerService.ts)
**Severity: HIGH**

After max retries (lines 213-251), throws `concurrentModification`. No backoff between retries. Callers may loop forever if wrapping this in their own retry logic.

**Fix**: Add exponential backoff between retries and document the max-retry behavior in the function JSDoc.

### 1.8 Incomplete Rollback in Room Creation (roomService.ts)
**Severity: MEDIUM**

Player creation failure rolls back the room (lines 213-221), but doesn't validate the room was actually deleted. If room deletion fails (Redis timeout), the room persists as an orphan.

**Fix**: Log warning on rollback failure and add orphan detection to cleanup task.

### 1.9 Unsafe Team Key Construction (roomService.ts)
**Severity: MEDIUM**

Team keys (line 472) are constructed as `room:${code}:team:${team}` without validation that `team` is a valid value. Undefined team creates orphaned keys.

**Fix**: Validate team against allowed values before key construction.

### 1.10 Timer Paused Expiration Not Enforced (timerService.ts)
**Severity: MEDIUM**

When a timer is paused and expires, calling `addTime()` returns nil from the Lua script (lines 413-426). No validation that the paused timer is actually expired before allowing operations.

**Fix**: Check timer state before allowing addTime operations.

### 1.11 Off-by-One in History Index Trimming (gameHistoryService.ts)
**Severity: MEDIUM**

`zRemRangeByRank(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1))` at line 366 removes more entries than intended. Should be `-(MAX_HISTORY_PER_ROOM)` to keep exactly `MAX_HISTORY_PER_ROOM` entries.

### 1.12 Unvalidated Game ID in getReplayEvents (gameHistoryService.ts)
**Severity: MEDIUM**

Accepts `gameId` from user (line 516) without format validation. Crafted gameId values could trigger Redis key pattern issues.

**Fix**: Validate gameId matches UUID format before constructing Redis keys.

### 1.13 Silent Failure Patterns in Services
**Severity: MEDIUM**

Multiple services return `null` for both "not found" and "database disabled" (e.g., `wordListService.getWordList()` lines 104-106, `gameHistoryService` lines 298-306). Callers cannot distinguish between states.

**Fix**: Use discriminated union return types: `{ status: 'not_found' } | { status: 'disabled' } | { status: 'ok', data: T }`.

### 1.14 Memory Mode Unbound Growth in AuditService
**Severity: LOW**

In-memory fallback (lines 129-139) uses `list.unshift()` with trimming, but under high load the list can temporarily exceed bounds between push and trim operations.

### 1.15 Race Condition in Audit lPush + lTrim
**Severity: LOW**

Redis mode pushes log then trims separately (lines 223-231). Between operations, a reader could fetch data exceeding max bounds.

### 1.16 Fire-and-Forget Usage Count in WordListService
**Severity: LOW**

`getWordsForGame()` returns words then calls `incrementUsageCount()` as fire-and-forget (lines 432-435). If game creation fails after words are retrieved, the count is wrong.

---

## 2. Socket Layer

### 2.1 Socket Function Registration Order (socket/index.ts + socketFunctionProvider.ts)
**Severity: HIGH**

In `socket/index.ts`, handlers are registered at lines 200-205 BEFORE `registerSocketFunctions()` is called at lines 285-293. If a client connects and sends an event before line 285 executes, the handler crashes with "Socket functions not yet registered."

**Fix**: Move `registerSocketFunctions()` call before handler registration.

### 2.2 Non-Async Chat Handler Throws Synchronously (chatHandlers.ts)
**Severity: HIGH**

The `CHAT_SPECTATOR` handler (line 107) is NOT declared as `async`, but throws `PlayerError.notAuthorized()` synchronously. The wrapper in `contextHandler.ts` is async, so synchronous throws in the callback may not be caught by the try-catch.

**Fix**: Add `async` to the handler:
```typescript
async (ctx: RoomContext, validated: SpectatorChatInput) => {
```

### 2.3 Memory Leak in roomSyncLocks Map (playerHandlers.ts)
**Severity: MEDIUM**

The `roomSyncLocks` Map (line 77) grows unbounded. Lock keys use format `${sessionId}:${roomCode}`. When a player disconnects, pending locks for their session are never cleaned up.

**Fix**: Add TTL-based cleanup or clear locks in disconnect handler.

### 2.4 Stale Context After Service Updates (playerContext.ts)
**Severity: MEDIUM**

Player context is built once per handler invocation (lines 107-173). If a handler modifies player state (e.g., `setTeam()`), the context becomes stale. Handlers must use return values rather than context for post-mutation reads.

**Recommendation**: Document this pattern explicitly. Consider adding a `refreshContext()` method.

### 2.5 No Retry Logic for Failed Emissions (safeEmit.ts)
**Severity: MEDIUM**

Failed emissions are logged but never retried (lines 88, 140). For critical game-state events (card reveals, game over), this could leave clients permanently out of sync.

**Fix**: Add optional retry queue for critical events, or implement client-side resync detection.

### 2.6 Race Condition in Room Join Stats Fetch (roomHandlers.ts)
**Severity: MEDIUM**

If `playerService.getRoomStats()` fails during room join (lines 233-244), clients receive a `STATS_STALE` warning but the room/player/game data is not re-validated for consistency.

### 2.7 Game History Saved After Reveal (gameHandlers.ts)
**Severity: MEDIUM**

History is saved AFTER revealing the result to all players (lines 247-258). If the server crashes between reveal and save, game history is lost while game state is already revealed.

**Recommendation**: Save history before broadcasting, or use a two-phase commit.

### 2.8 Timer Add Time: Negative Seconds Not Validated
**Severity: LOW**

The `timerAddTimeSchema` should validate that seconds is positive. Negative values could incorrectly modify the timer.

### 2.9 Spectator Chat: Error on Failed Emit Not Reported
**Severity: LOW**

If emit fails in spectator chat (lines 124-128), the error is logged but not reported back to the client.

### 2.10 Connection Tracker: Synchronous Socket Enumeration
**Severity: LOW**

Cleanup (every 5 minutes) enumerates ALL sockets synchronously (line 144 in connectionTracker.ts). With many sockets, this briefly blocks the event loop.

### 2.11 Team Chat: Silently Drops Messages on Teammate Fetch Failure
**Severity: LOW**

If teammate fetch fails (lines 86-92 in chatHandlers.ts), the message is sent only to the requester, silently dropping it for the team.

### 2.12 GameContext Type Not Enforced Consistently
**Severity: LOW**

`createGameHandler` should guarantee `GameContext` return type (handlers/types.ts lines 37-42), but TypeScript may not enforce this if handlers use generic `RoomContext`.

---

## 3. Security & Middleware

### 3.1 Admin Broadcast Missing Zod Validation (adminRoutes.ts)
**Severity: HIGH**

The `/admin/api/broadcast` POST endpoint (line 359) extracts `message` and `type` from `req.body` using type assertion (`req.body as { message?: string; type?: string }`) without Zod schema validation. This could allow type confusion or unexpected values in broadcast messages.

**Fix**: Add Zod schema:
```typescript
const broadcastSchema = z.object({
    message: z.string().min(1).max(500),
    type: z.enum(['info', 'warning', 'error'])
});
```

### 3.2 JWT Auth Silent Failure in Word List Routes (wordListRoutes.ts)
**Severity: HIGH**

Invalid JWT tokens silently continue without setting `req.user` (lines 70-82). The `requireAuth` middleware catches this later, but if a route accidentally omits `requireAuth`, unauthenticated requests pass through.

**Fix**: Fail closed on JWT verification errors. Log warning and reject requests with malformed tokens.

### 3.3 Empty Body Handling in Validation Middleware
**Severity: MEDIUM**

`req.body || {}` (line 49 in validation.ts) masks null/undefined body. While Zod catches most violations, this could hide upstream body-parsing failures.

### 3.4 Error Details in Development Mode
**Severity: MEDIUM**

In development mode, full error messages are exposed (errorHandler.ts line 107). If `NODE_ENV` is misconfigured in production, stack traces could leak.

### 3.5 Admin Dashboard Missing Operator Guidance
**Severity: LOW**

When `ADMIN_PASSWORD` is not configured (line 96 in adminRoutes.ts), access is denied without guidance for operators on how to set it.

### 3.6 CORS Origin Validation Bypass in Development
**Severity: LOW**

When `CORS_ORIGIN=*` in dev, origin validation is skipped (csrf.ts line 141). This is expected but should be documented as a security consideration.

---

## 4. Frontend

### 4.1 Admin Dashboard: XSS via Inline onclick Handlers (admin.html)
**Severity: CRITICAL**

Lines 808, 816, 905 use inline `onclick` handlers with template literals:
```javascript
onclick="toggleRoomDetails('${safeCode}')"
onclick="event.stopPropagation(); closeRoom('${safeCode}')"
onclick="event.stopPropagation(); kickPlayer('${escapeHTML(code)}', '${safeId}')"
```

While `escapeHTML()` is applied, inline event handlers bypass HTML entity escaping because the browser decodes entities before executing JavaScript. A room code containing `'); alert('xss` would execute.

**Fix**: Use `addEventListener()` instead of inline handlers, or use `data-*` attributes with delegated event listeners.

### 4.2 Admin Dashboard: Template Literal in Attribute Context (admin.html)
**Severity: CRITICAL**

Line 676: `title="Memory: ${mem}MB"` — if `mem` contains special characters, it could break out of the attribute context.

**Fix**: Use `escapeHTML()` for all template literal values in HTML attributes.

### 4.3 Global `io` Variable Check (socket-client.js)
**Severity: CRITICAL**

Line 38-40 uses `typeof io === 'undefined'` to check for Socket.io. A malicious script defining `window.io` before this script loads could intercept all WebSocket communication.

**Fix**: Use module imports or check against a specific property: `typeof io === 'function' && io.version`.

### 4.4 Missing Nickname Length Validation (multiplayer.ts)
**Severity: HIGH**

Lines 186-189, 259-262: Unicode regex validation exists but no maximum length check. A 100,000-character nickname could pass client-side validation.

**Fix**: Add `&& nickname.length <= 30` matching the server-side `NICKNAME_MAX_LENGTH`.

### 4.5 Unescaped Room Code in Toast (multiplayer.ts)
**Severity: HIGH**

Line 368: `showToast(\`Game created! Share Room ID: ${state.currentRoomId}\`, 'success', 8000)` — room code is not escaped in the toast message. If room code contains HTML special characters, this is an XSS vector.

**Fix**: Use `escapeHTML(state.currentRoomId)`.

### 4.6 CSS Selector Injection (settings.ts)
**Severity: HIGH**

Line 28: `input[name="wordlist-mode"][value="${savedMode}"]` — if `savedMode` (from localStorage) contains quotes, the CSS selector breaks and could cause unexpected behavior.

**Fix**: Validate `savedMode` against allowed values before selector construction.

### 4.7 Toast Type Parameter Not Validated (ui.ts)
**Severity: HIGH**

Lines 39-43: `icons[type]` lookups use the `type` parameter without validation. If `type` is an unexpected string, it accesses arbitrary object keys.

**Fix**: Validate `type` against `['error', 'success', 'warning', 'info']` before use.

### 4.8 Debug Mode Accessible to All Users (state.ts)
**Severity: HIGH**

Line 445: `localStorage.getItem('debug') === 'codenames'` enables debug mode exposing `window.__codenamesDebug` with state inspection. Any user can enable this.

**Fix**: Remove from production builds or require a more secure activation mechanism.

### 4.9 Non-null Assertions on DOM Data Attributes (board.ts)
**Severity: MEDIUM**

Lines 80, 90: `parseInt(...dataset.index!, 10)` uses non-null assertions without validation. Malformed `data-index` attributes cause `parseInt` to return `NaN`.

**Fix**: Add explicit null check before `parseInt`.

### 4.10 Windows Line Endings Not Handled (settings.ts)
**Severity: MEDIUM**

Line 146-148: Word list split by `\n` doesn't handle `\r\n`, creating empty entries on Windows.

**Fix**: Use `text.split(/\r?\n/)`.

### 4.11 Accessibility: Missing ARIA Attributes (index.html)
**Severity: MEDIUM**

- Line 62: Expand icon `▾` lacks `aria-expanded` attribute
- Line 65: Spectator emoji `👁` lacks `aria-hidden="true"`
- Line 209: Character counter lacks `aria-live` region
- Line 304: Copy button emoji `📋` lacks `aria-hidden="true"`

### 4.12 Hardcoded Accessibility Strings (board.ts)
**Severity: MEDIUM**

Lines 19-26: `buildCardAriaLabel()` uses hardcoded English strings ("assassin card", "team card") instead of i18n keys. These won't be translated.

### 4.13 URL-Safe Base64 Padding Loss (utils.ts)
**Severity: MEDIUM**

Line 95: `encodeWordsForURL()` strips base64 padding with `.replace(/=+$/, '')`. If the decode side doesn't account for this, data corruption occurs.

### 4.14 No Script Loading Error Handling (index.html)
**Severity: LOW**

Lines 19-21: Three script tags load synchronously without `defer` or error handling. Failed script loads produce no user feedback.

### 4.15 Admin Auto-Refresh Memory Accumulation (admin.html)
**Severity: LOW**

Line 1017-1020: `setInterval()` for auto-refresh has no cleanup. Long-running sessions accumulate memory if fetch responses grow.

---

## 5. Configuration, Types & Utilities

### 5.1 Unsafe JSON Parsing in MemoryStorage Lua Eval
**Severity: CRITICAL**

Multiple locations (lines 855, 879, 919, 1046, 1115, 1135, 1207, 1227, 1285 in memoryStorage.ts) use `JSON.parse()` with type assertions but no schema validation. Corrupted data passes type checks at compile time but causes runtime failures.

**Fix**: Use `parseJSON()` utility with Zod schemas for all `JSON.parse()` calls in MemoryStorage.

### 5.2 RedisClient Interface Type Mismatches (types/redis.ts)
**Severity: CRITICAL**

- `zAdd()` (line 57) accepts singular `member` but implementation uses variadic args
- `sAdd()` similarly typed for singular but used as variadic
- `scan()` return type says `cursor: number` but Redis and MemoryStorage return `cursor: string`

**Fix**: Update `types/redis.ts` to match actual Redis API signatures:
```typescript
zAdd(key: string, ...items: Array<{ score: number; value: string }>): Promise<number>;
sAdd(key: string, ...members: string[]): Promise<number>;
scan?(cursor: string, options?: { MATCH?: string; COUNT?: number }): Promise<{ cursor: string; keys: string[] }>;
```

### 5.3 TTL Race Condition in MemoryStorage (memoryStorage.ts)
**Severity: HIGH**

`_isExpired()` (lines 288-299) deletes the key as a side effect. Callers that check expiry then operate on the key find it already deleted:
```typescript
// del() line 356:
if (this._isExpired(key)) return 0;  // Key deleted here!
const existed = this.data.has(key);    // Always false after expiry delete
```

**Fix**: `_isExpired()` should only check, not delete. Let callers decide:
```typescript
private _isExpired(key: string): boolean {
    const expiry = this.expiries.get(key);
    return !!(expiry && expiry <= Date.now());
}
```

### 5.4 Unsafe `as` Type Casts Throughout MemoryStorage
**Severity: HIGH**

Lines 1369, 1372, 1378, 1462, 1467, and many others use `as` casts after existence checks. If logic changes, these casts silently produce wrong types at runtime.

**Fix**: Replace `as` casts with proper type guards or `Map.get()` with explicit undefined checks.

### 5.5 EvalOptions Type Mismatch (memoryStorage.ts)
**Severity: HIGH**

`eval()` (line 950) requires `options.keys` but `EvalOptions` interface (line 84-87) marks `keys` as optional. Callers without keys cause runtime crash.

**Fix**: Make `keys` required in `EvalOptions` or add defensive check in `eval()`.

### 5.6 Missing NFKC Normalization in Lua Scripts
**Severity: MEDIUM**

`giveClue.lua` (lines 38-53) uses `string.upper()` for clue-word comparison. Lua's `string.upper()` handles ASCII only, not Unicode characters (accented letters, Turkish 'ı', etc.). CLAUDE.md mentions NFKC normalization but Lua scripts don't implement it.

**Fix**: Document that Unicode normalization must happen server-side before calling Lua scripts. Add validation in the TypeScript caller.

### 5.7 Event Handler Memory Leak in MemoryStorage
**Severity: MEDIUM**

`_eventHandlers` Map (line 164) stores callbacks indefinitely. `removeListener()` (line 1831) requires exact callback reference, which fails for anonymous functions.

**Fix**: Implement handler limit or WeakRef-based cleanup.

### 5.8 Inconsistent Timeout Configuration
**Severity: MEDIUM**

`distributedLock.ts` (line 14) hardcodes `LOCK_OPERATION_TIMEOUT = 5000` instead of using the centralized `TIMEOUTS` from `timeout.ts`.

**Fix**: Import from centralized config or add `LOCK_OPERATION` to `TIMEOUTS`.

### 5.9 Logger Correlation ID Lazy Load Failure
**Severity: MEDIUM**

`loadCorrelationId()` (logger.ts lines 61-73) silently returns empty object `{}` if the correlation module fails to load. Logging calls expecting correlation fields get none.

### 5.10 Mixed Module Export Patterns
**Severity: MEDIUM**

Files like `env.ts`, `logger.ts`, and `correlationId.ts` mix CommonJS `module.exports` with ES6 `export`. While functional, this creates inconsistency and potential bundler issues.

### 5.11-5.13 Low-Priority Type Issues
**Severity: LOW**

- Magic numbers in MemoryStorage config (lines 118-120) — `10000` should be a named constant
- `tryParseJSON()` silently discards error context — should log warning
- Inconsistent `as const` usage in security config exports

---

## 6. Tests & Infrastructure

### 6.1 Lua Scripts Mocked Rather Than Tested
**Severity: MEDIUM**

Integration tests mock Lua script behavior in JavaScript rather than testing actual Redis+Lua execution. This means Lua-specific bugs (like the Unicode issue in 5.6) aren't caught by tests.

**Recommendation**: Add a small set of integration tests that run against a real Redis instance with actual Lua scripts.

### 6.2 Race Condition Tests Lack True Concurrency
**Severity: MEDIUM**

Race condition tests simulate concurrent operations sequentially with mocked Redis. True concurrency bugs (like 1.1, 1.3) require parallel async execution.

**Recommendation**: Add stress tests with `Promise.all()` for concurrent operations.

### 6.3 Coverage Thresholds Below Actual Coverage
**Severity: LOW**

Jest config thresholds (75% branches, 80% lines) are well below actual coverage (94%+). Raising thresholds would catch coverage regressions earlier.

### 6.4 Duplicate Playwright Configs
**Severity: LOW**

Both root `playwright.config.ts` and `server/playwright.config.js` exist with different `testDir` settings. Should consolidate to one.

---

## 7. Architectural Observations

### Strengths

1. **Defense in Depth**: Multi-layer validation (Zod schemas → service validation → Lua scripts), rate limiting (per-socket + per-IP + per-event), and error handling (GameError hierarchy with safe codes).

2. **Graceful Degradation**: Database, Redis, and multiplayer are all optional. The app functions in standalone mode with zero external dependencies.

3. **Security Posture**: Helmet CSP, CSRF with X-Requested-With + origin validation, timing-safe password comparison in admin auth, session age limits, IP consistency checks, audit logging.

4. **Test Infrastructure**: Comprehensive mock system with factory functions, socket test helpers, 2,675+ tests. The `socketTestHelper.ts` with dynamic port assignment and event waiting is production-quality.

5. **Distributed Systems Awareness**: Distributed locks with owner-verified release (Lua scripts), Redis Pub/Sub for multi-instance, reconnection token system with TTL.

### Areas for Improvement

1. **Atomicity Gaps**: Several operations that should be atomic span multiple Redis calls. The Lua scripts cover critical paths (card reveal, clue giving, team switching) but room TTL refresh, player removal + token cleanup, and history save + game reveal are not atomic.

2. **Error Distinguishability**: Too many operations return `null` for different failure modes. Discriminated unions would make error handling more reliable.

3. **Frontend Build Pipeline**: The frontend TypeScript compilation is separate from the backend with manual cache-busting (`?v=5`). A proper asset pipeline with content-hash-based filenames would improve cache reliability.

4. **Monitoring Gaps**: While metrics and health checks exist, there's no distributed tracing, no circuit breaker for Redis operations, and no alerting infrastructure.

---

## 8. Prioritized Fix Plan

### Phase 1: Critical (Immediate)
1. Fix admin dashboard XSS via inline onclick handlers (4.1, 4.2)
2. Fix token consumption race condition (1.1)
3. Add reconnection token cleanup to `removePlayer()` (1.2)
4. Fix unsafe JSON parsing in MemoryStorage (5.1)
5. Fix RedisClient interface type mismatches (5.2)
6. Fix socket function registration order (2.1)

### Phase 2: High Priority
7. Fix non-async chat handler (2.2)
8. Fix team switching race condition (1.3)
9. Add Zod validation to admin broadcast (3.1)
10. Fail closed on JWT errors in word list routes (3.2)
11. Add nickname length validation on frontend (4.4)
12. Fix MemoryStorage `_isExpired()` side effects (5.3)
13. Fix TTL management in transaction rollback (1.4)
14. Add atomic room TTL refresh (1.5)
15. Add lock release retry with backoff (1.6)
16. Fix EvalOptions type (5.5)
17. Escape room code in toasts (4.5)
18. Fix CSS selector injection in settings (4.6)
19. Validate toast type parameter (4.7)

### Phase 3: Medium Priority
20. Add roomSyncLocks cleanup mechanism (2.3)
21. Add retry logic for critical emissions (2.5)
22. Fix history trimming off-by-one (1.11)
23. Validate gameId format in replay (1.12)
24. Add NFKC normalization documentation for Lua (5.6)
25. Fix non-null assertions in board.ts (4.9)
26. Handle Windows line endings in settings (4.10)
27. Fix accessibility ARIA attributes (4.11)
28. Internationalize accessibility strings (4.12)
29. Add Lua script integration tests (6.1)
30. Add true concurrency tests (6.2)

### Phase 4: Low Priority / Cleanup
31. Remove debug mode access from production (4.8)
32. Consolidate Playwright configs (6.4)
33. Raise coverage thresholds (6.3)
34. Standardize module export patterns (5.10)
35. Replace magic numbers with named constants (5.11)

---

## Appendix: Files Reviewed

### Backend Services (7 files)
- `server/src/services/gameService.ts`
- `server/src/services/roomService.ts`
- `server/src/services/playerService.ts`
- `server/src/services/timerService.ts`
- `server/src/services/wordListService.ts`
- `server/src/services/gameHistoryService.ts`
- `server/src/services/auditService.ts`

### Socket Layer (14 files)
- `server/src/socket/index.ts`
- `server/src/socket/contextHandler.ts`
- `server/src/socket/safeEmit.ts`
- `server/src/socket/rateLimitHandler.ts`
- `server/src/socket/playerContext.ts`
- `server/src/socket/disconnectHandler.ts`
- `server/src/socket/connectionTracker.ts`
- `server/src/socket/socketFunctionProvider.ts`
- `server/src/socket/handlers/roomHandlers.ts`
- `server/src/socket/handlers/gameHandlers.ts`
- `server/src/socket/handlers/playerHandlers.ts`
- `server/src/socket/handlers/timerHandlers.ts`
- `server/src/socket/handlers/chatHandlers.ts`
- `server/src/socket/handlers/types.ts`

### Middleware & Security (7 files)
- `server/src/middleware/errorHandler.ts`
- `server/src/middleware/rateLimit.ts`
- `server/src/middleware/csrf.ts`
- `server/src/middleware/validation.ts`
- `server/src/middleware/timing.ts`
- `server/src/middleware/socketAuth.ts`
- `server/src/app.ts`

### Routes (5 files)
- `server/src/routes/index.ts`
- `server/src/routes/roomRoutes.ts`
- `server/src/routes/wordListRoutes.ts`
- `server/src/routes/adminRoutes.ts`
- `server/src/routes/replayRoutes.ts`

### Configuration & Types (22 files)
- `server/src/config/` (13 files including gameConfig, socketConfig, securityConfig, memoryStorage, redis, env, etc.)
- `server/src/types/` (9 files including redis.ts, socket-events.ts, etc.)

### Utilities (8 files)
- `server/src/utils/timeout.ts`
- `server/src/utils/logger.ts`
- `server/src/utils/parseJSON.ts`
- `server/src/utils/distributedLock.ts`
- `server/src/utils/correlationId.ts`
- `server/src/utils/audit.ts`
- `server/src/utils/metrics.ts`
- `server/src/utils/rateLimiter.ts`

### Frontend (15+ files)
- `index.html`
- `server/src/frontend/` (state.ts, board.ts, ui.ts, multiplayer.ts, game.ts, settings.ts, accessibility.ts, i18n.ts, history.ts, utils.ts, etc.)
- `server/public/js/socket-client.js`
- `server/public/admin.html`
- `server/public/css/` (8 stylesheet files)

### Lua Scripts (6 files)
- `server/src/scripts/revealCard.lua`
- `server/src/scripts/giveClue.lua`
- `server/src/scripts/switchTeam.lua`
- `server/src/scripts/setRole.lua`
- `server/src/scripts/timerStart.lua`
- `server/src/scripts/timerPause.lua`

### Test Infrastructure
- `server/src/__tests__/helpers/mocks.ts`
- `server/src/__tests__/helpers/socketTestHelper.ts`
- `server/jest.config.ts.js`
- Sample test files across backend, frontend, and integration directories
