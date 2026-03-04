# Codebase Review: Hardening Recommendations

**Date:** 2026-03-04
**Scope:** Security, reliability, operational hardening, code quality

---

## Executive Summary

The Eigennamen codebase demonstrates strong security foundations: multi-layer rate limiting, constant-time token comparison, Zod validation at all entry points, Lua-based atomic Redis operations, and a well-structured error allowlist. This review identifies **specific, actionable improvements** organized by severity.

---

## Reevaluation Notes (Post-Fix)

After detailed code review, several original findings were **reclassified**:

| # | Original | Revised Status | Reason |
|---|----------|----------------|--------|
| 1 | CORS wildcard not blocked | **FALSE POSITIVE** | Already enforced at `app.ts:109-114` with `process.exit(1)`. CI docker test was using `CORS_ORIGIN='*'` with `NODE_ENV=production` — **fixed**. |
| 2 | ADMIN_PASSWORD not required | **OVERBLOWN** | Admin routes return 401 when unset — proper behavior. Not a security gap. |
| 3 | Trivy exit-code: '0' | **VALID — FIXED** | Changed to `exit-code: '1'`. |
| 4 | Blocking scryptSync | **PARTIALLY MITIGATED — FIXED** | Admin hash was already cached at startup; only incoming password was blocking. Converted to async `scryptAsync`. |
| 5 | No socket connection rate limit | **FALSE POSITIVE** | `connectionTracker.ts` already enforces per-IP limits (`MAX_CONNECTIONS_PER_IP: 10`) and auth failure blocking (`AUTH_FAILURE_MAX_PER_IP: 10`, 5-min block). |
| 6 | Mixed-protocol bypass | **FALSE POSITIVE** | REST and WebSocket serve different operations; no shared auth path exploitable across protocols. |
| 7 | Docker container hardening | **VALID — FIXED** | Added `security_opt`, `cap_drop`, `cap_add` to both services. |
| 8 | No security test suite | **VALID — FIXED** | Created `adversarial.test.ts` with 25 tests. Existing `security/` directory already had `errorScenarios.test.ts`, `codeQuality.test.ts`, `redos.test.ts`. |

---

## Remaining Recommendations (Not Yet Fixed)

### 9. No JWT Token Revocation

**Files:** `server/src/config/jwt.ts`, `server/src/middleware/auth/jwtHandler.ts`
**Issue:** JWT tokens remain valid until expiry (24h) even after session ends. No mechanism to immediately invalidate a compromised token.
**Fix:** Implement a small Redis-backed blocklist of revoked JTIs, checked on each authenticated request. Only needs to hold entries until their natural expiry.

### 10. No Session Activity Timeout

**File:** `server/src/config/securityConfig.ts` (line 19)
**Issue:** Sessions have an 8-hour max age but no **idle timeout**. A session opened and immediately abandoned remains valid for the full 8 hours.
**Fix:** Track `lastActivityTime` per session. Add idle timeout (e.g., 30 minutes of no activity invalidates the session).

### 11. CSP `unsafe-inline` for Styles

**File:** `server/src/app.ts` (~line 123)
**Issue:** `styleSrc: ["'self'", "'unsafe-inline'"]` weakens Content Security Policy. Acknowledged as tech debt in code.
**Fix:** Migrate inline styles to CSS classes. In the interim, add a CSP violation reporting endpoint to monitor any exploitation attempts.

### 12. Redis Memory Eviction Policy

**File:** `server/src/config/redis.ts` (~line 102)
**Issue:** Embedded Redis uses `noeviction` policy. If memory limit is reached, Redis returns errors instead of evicting stale data, potentially crashing game operations.
**Fix:** Change to `allkeys-lru` for embedded mode. Consider reducing `maxmemory` from 256MB to 128MB with LRU eviction as a safety net.

### 13. Distributed Lock Timeout vs Operation Duration

**File:** `server/src/utils/distributedLock.ts` (~line 23)
**Issue:** Lock TTL is 5000ms, but some operations (card reveal: 15s) may exceed this. If an operation outlasts its lock, concurrent operations can corrupt state.
**Fix:** Ensure all long-running operations call `lock.extend()` before TTL expiry. Add a safety check that warns if an operation completes after its lock TTL.

### 14. Dockerfile Version Pinning

**File:** `server/Dockerfile` (lines 3, 30, 36)
**Issue:** Uses `node:22-alpine` without patch version pinning. `apk add` packages are unpinned.
**Fix:** Pin to specific versions (e.g., `node:22.x.x-alpine3.21`) for reproducible builds.

### 15. Stack Traces in Logs Leak File Paths

**File:** `server/src/middleware/errorHandler.ts` (~line 47)
**Issue:** Error stack traces in logs contain full filesystem paths, which could reveal deployment structure if logs are exfiltrated.
**Fix:** Sanitize paths in production logs:
```typescript
const sanitizedStack = error.stack?.replace(/\/home\/\w+\/[^:]+/g, '[APP]');
```

### 16. Fly.io Memory Mode Split-Brain Risk

**File:** `fly.toml` (lines 4-10, 35-36)
**Issue:** `MEMORY_MODE_ALLOW_FLY=true` permits in-memory Redis on Fly.io. With multiple machines, this causes split-brain where different instances have different game states.
**Fix:** Add a pre-deploy check script that fails if memory mode is enabled with `>1` machine.

### 17. Reconnection Token Scope

**File:** `server/src/config/securityConfig.ts` (line 23)
**Issue:** 5-minute reconnection token TTL is reasonable, but tokens aren't scoped to a specific room. A stolen reconnection token could potentially be used in a different context.
**Fix:** Bind reconnection tokens to `roomCode` and validate room match during reconnection.

---

## LOW — Nice to Have

### 18. JWT Claims Enhancement

**File:** `server/src/middleware/auth/jwtHandler.ts` (~line 44-56)
**Issue:** Missing `iat` (issued-at) validation and `type` claim to prevent token confusion.
**Fix:** Add `type: 'session'` claim and validate `iat` is within expected range.

### 19. Redis Command Renaming in Production

**File:** `server/src/config/redis.ts`
**Issue:** Dangerous Redis commands (`FLUSHDB`, `FLUSHALL`, `CONFIG`, `DEBUG`) are available.
**Fix:** Document that production Redis should rename/disable dangerous commands in `redis.conf`.

### 20. Audit Service Silent Failures

**Files:** Multiple locations calling `audit.suspicious()`
**Issue:** Audit failures are caught and logged at `debug` level. If the audit service breaks, security logging silently stops.
**Fix:** Log audit failures at `warn` level. Add a health check for the audit service.

### 21. Service Worker Cache Invalidation

**File:** `server/public/service-worker.js`
**Issue:** If the service worker caches a vulnerable version of frontend code, users may continue running it after a fix is deployed.
**Fix:** Implement a server-driven cache-bust mechanism (e.g., version check on activation that forces cache clear).

### 22. Metrics Endpoint Information Disclosure

**File:** `server/src/app.ts` (~line 276-279)
**Issue:** `FLY_ALLOC_ID` is exposed in `/metrics` in dev mode. This reveals infrastructure details.
**Fix:** Only expose `FLY_REGION`, never the full allocation ID.

### 23. Missing `ulimits` in Docker Compose

**File:** `docker-compose.yml`
**Issue:** No file descriptor or process limits on containers, allowing potential resource exhaustion.
**Fix:** Add `ulimits` for `nofile` and `nproc`.

### 24. Graceful Shutdown Timeout

**File:** `server/src/index.ts` (~line 116-120)
**Issue:** 10-second force-exit timeout may not allow Redis disconnect to complete cleanly.
**Fix:** Increase to 15 seconds with interval logging to diagnose slow shutdowns.

---

## Data Layer & Redis Hardening

### 25. Missing TTL Coordination Between Related Redis Keys

**Files:** `server/src/scripts/atomicJoin.lua`, `server/src/scripts/atomicRefreshTtl.lua`, `server/src/scripts/atomicCreateRoom.lua`
**Issue:** When a player joins (`atomicJoin.lua`), the players set doesn't get a TTL refresh. If `roomKey` expires but `playersKey` doesn't, subsequent joins see orphaned players. Related keys can expire at slightly different times due to clock skew.
**Fix:** Always set TTL on the players set in `atomicJoin.lua`. Add a periodic audit job that verifies all room-related keys expire within a tolerance window (±30 seconds).

### 26. Redis Reconnection Strategy Insufficient

**File:** `server/src/config/redis.ts` (~line 184-192)
**Issue:** Maximum reconnect delay caps at 3 seconds with no jitter. During a network partition, all instances retry in lockstep (thundering herd). Only 10 retries before giving up.
**Fix:** Use exponential backoff with jitter, increase max delay to 30s, increase max retries to 50:
```typescript
const baseDelay = Math.min(100 * Math.pow(2, retries), 30000);
const jitter = Math.random() * 0.1 * baseDelay;
return Math.floor(baseDelay + jitter);
```

### 27. Lua Script JSON Corruption Handling

**Files:** Multiple Lua scripts (`atomicRemovePlayer.lua`, `atomicCleanupDisconnectedPlayer.lua`, `atomicSetRoomStatus.lua`, `revealCard.lua`)
**Issue:** When `pcall(cjson.decode, ...)` fails, scripts silently return `nil` or delete the key. This makes it impossible to distinguish between "key doesn't exist" and "key contains corrupted data."
**Fix:** Return distinct error codes (`CORRUPTED`, `MISSING`, `INVALID_FORMAT`) so callers can log and investigate corruption incidents.

### 28. Lock Extension Race Condition in `withAutoExtend()`

**File:** `server/src/utils/distributedLock.ts` (~line 200-215)
**Issue:** If the main function completes between timer intervals, `pendingExtension` may be `null` when the `finally` block runs. The timer could then fire after the lock is released, causing an orphaned extension attempt.
**Fix:** Add a final safety extension before release to ensure the lock holds during the release operation.

### 29. Timer Expiration During Pause Returns Non-JSON

**File:** `server/src/scripts/atomicTimerStatus.lua` (~line 28)
**Issue:** When a paused timer expires, the Lua script returns the string `'EXPIRED'` instead of a JSON object. TypeScript callers expecting JSON will fail to parse this response.
**Fix:** Return `cjson.encode({expired = true, isPaused = true, remainingSeconds = 0})` for consistency.

### 30. Pub/Sub Health Monitoring Doesn't Cover Main Redis Client

**File:** `server/src/utils/pubSubHealth.ts` (~line 79-129)
**Issue:** Only monitors pub/sub clients (Socket.io adapter), not the main `redisClient` used for game operations. If the main client hangs, there's no health signal until operation timeouts occur.
**Fix:** Export main client health from `config/redis.ts` and integrate into the health monitoring module.

---

## Game Logic Hardening

### 31. Match Mode Score Race Condition in `finalizeRound()`

**File:** `server/src/services/gameService.ts` (~line 410-439)
**Issue:** `finalizeRound()` recalculates card points from `revealedBy[]` array, but match mode scores are already accumulated per-reveal in the Lua script. If a reveal occurs during finalization, the recalculated score won't include it, causing score loss.
**Fix:** Use the pre-accumulated `game.redMatchScore`/`game.blueMatchScore` directly instead of recalculating.

### 32. Timer State Mutation Without Lock in `resumeTimer()`

**File:** `server/src/services/timerService.ts` (~line 338-344)
**Issue:** `resumeTimer()` modifies `localTimer.paused` without acquiring the distributed lock that `startTimer()` uses. In multi-instance deployments, another instance's `startTimer()` could replace the timer entry between the Lua check and local update.
**Fix:** Move local timer mutation inside a `withLock()` acquisition.

### 33. Missing Validation on Match Carry-Over Data

**File:** `server/src/services/gameService.ts` (~line 153-171)
**Issue:** `buildGameState()` accepts `options.matchCarryOver` and directly assigns its fields to game state without Zod validation. A malicious client could inject corrupted carry-over data to manipulate match scores.
**Fix:** Add schema validation:
```typescript
const matchCarryOverSchema = z.object({
    matchRound: z.number().int().min(1).max(100),
    redMatchScore: z.number().int().min(0),
    blueMatchScore: z.number().int().min(0),
});
```

### 34. Unbounded Local Timer Map Under Load

**File:** `server/src/services/timerService.ts` (~line 200-218)
**Issue:** The eviction logic only removes one entry when reaching `LOCAL_TIMERS_MAX_SIZE`. Under rapid timer creation (DoS or load testing), the map can grow faster than eviction.
**Fix:** Evict a batch (e.g., 10%) when approaching capacity, or reject new timers when at 95% capacity.

### 35. Room Cleanup Not Batched for Large Rooms

**File:** `server/src/services/roomService.ts` (~line 304-334)
**Issue:** `cleanupRoom()` fetches all players with `sMembers()` and deletes them in a single `del()` call. For rooms with thousands of players, this blocks the event loop.
**Fix:** Batch cleanup in groups of 500 keys.

---

## Frontend & WebSocket Hardening

### 36. `innerHTML` Usage in `roles.ts`

**File:** `server/src/frontend/roles.ts` (~line 80, 103, 106, 109)
**Issue:** Uses `innerHTML` with `escapeHTML()` calls. While escaping is applied correctly, `innerHTML` is inherently riskier than DOM methods. If any escaping path is missed in future changes, XSS becomes possible.
**Fix:** Refactor to `createElement()` + `appendChild()` pattern for defense-in-depth.

### 37. Frontend Store Subscription Cleanup

**Files:** `server/src/frontend/store/eventBus.ts`, various frontend handlers
**Issue:** Store subscriptions return unsubscribe functions, but there's no systematic guarantee all subscriptions are cleaned up when leaving multiplayer mode or navigating pages. `multiplayerSync.ts` does this correctly, but other modules should be audited.
**Fix:** Audit all `subscribe()` calls to ensure corresponding cleanup exists in teardown paths.

---

## Architecture Observations (Not Issues)

These are **positive patterns** worth preserving:

- **Constant-time comparison** (`crypto.timingSafeEqual`) for all token validation — well done
- **Multi-layer rate limiting** (per-socket, per-IP, global) with LRU eviction — comprehensive
- **Error detail allowlist** — prevents accidental information disclosure when adding new error fields
- **Zod validation at all entry points** — strong input validation posture
- **Lua scripts for atomic operations** — correct approach for Redis race conditions
- **Production Zod scrubbing** — field paths stripped to prevent schema disclosure
- **Reconnection token security** — `crypto.randomBytes(32)`, short TTL, pre-comparison length checks
- **Client IP trust validation** — only trusts proxy headers when explicitly configured
- **Per-player mutex for room sync** — sophisticated fix for team/role race conditions (`playerRoomSync.ts`)
- **Safe DOM rendering** — chat uses `textContent`, dynamic content uses `createElement()`
- **Timeout protection everywhere** — `withTimeout()` wraps all Redis ops and handler execution
- **Unhandled rejection prevention** — proper `.catch()` on losing promises in `Promise.race()`
- **Connection state recovery** — Socket.io v4 with `skipMiddlewares: false` re-validates on reconnect

---

## Recommended Priority Order

| Priority | Items | Effort |
|----------|-------|--------|
| **Week 1** | #1 CORS enforcement, #2 Admin password enforcement, #3 Trivy exit code | Low |
| **Week 2** | #4 Async scrypt, #5 Socket connection rate limit, #7 Docker hardening | Medium |
| **Week 3** | #6 Unified rate limiting, #8 Security test suite, #25 TTL coordination | Medium |
| **Month 2** | #9 JWT revocation, #10 Activity timeout, #11 CSP migration, #31 Match score race | High |
| **Ongoing** | #12-37 remaining items as capacity allows | Varies |
