# Hardening Plan: Eigennamen Online

Comprehensive code review findings from a deep audit across security, concurrency, frontend robustness, configuration, and test coverage. Prioritized by severity.

The codebase is **already well above average** in security posture — Lua atomics, constant-time token comparison, CSP headers, Zod validation at all boundaries, error detail allowlisting, CSRF protection with `X-Requested-With`, and distributed locks with jitter are all excellent.

Below is what remains.

---

## Priority 0: Critical Severity

### C1. Game history index keys never expire — unbounded Redis growth
- **Files:** `server/src/services/gameHistoryService.ts:250-251`, `server/src/scripts/atomicSaveGameHistory.lua`
- **Issue:** Individual `gameHistory:{roomCode}:{gameId}` keys get a 30-day TTL, but the `gameHistoryIndex:{roomCode}` sorted set has **no TTL**. When rooms are cleaned up via `cleanupRoom()`, game history keys are not deleted either. The index sorted set grows forever, with phantom entries pointing to expired data keys.
- **Fix:** Set a 30-day TTL on `gameHistoryIndex:{roomCode}` in `atomicSaveGameHistory.lua`. Optionally also clean up `gameHistory:*` and `gameHistoryIndex:*` in `cleanupRoom()`.

### C2. Non-atomic `persistGameState` — game key and room status can diverge
- **File:** `server/src/services/gameService.ts:180-211`
- **Issue:** `persistGameState()` performs three separate operations: (1) write game state, (2) Lua script to set room status to `'playing'`, (3) refresh players TTL. If step 2 fails after step 1 succeeds, the game data exists but the room remains in `'waiting'` status. The catch block only logs; no rollback. Room becomes stuck with an active game but wrong status.
- **Fix:** Combine game state write and room status update into a single Lua script, or implement compensating rollback that deletes the game key on status update failure.

---

## Priority 1: High Severity

### H1. Reconnection token validation is non-atomic (read-then-delete race)
- **File:** `server/src/services/player/reconnection.ts:125-183`
- **Issue:** `validateRoomReconnectToken()` GETs the token data (line 133), validates it, then DELetes both keys (lines 167-178). Between GET and DEL, a concurrent reconnection with the same token can also GET successfully, leading to **two sockets claiming the same session**. Compare with `invalidateRoomReconnectToken()` which correctly uses a Lua script for atomicity.
- **Fix:** Use a Lua script that atomically GETs, validates sessionId, and DELetes in one operation (GETDEL pattern). Return token data only if deletion succeeded.

### H2. `endTurn` lacks distributed lock — double turn flip possible
- **File:** `server/src/services/gameService.ts:325-348`
- **Issue:** `revealCard` uses `withLock('reveal:{roomCode}')`, but `endTurn` does not. Timer expiration calls `endTurn` inside `withLock('timer-expire:{roomCode}')`, but player-triggered `endTurn` has no lock. If both fire simultaneously, the timer's `endTurn` passes empty `expectedTeam` (always succeeds), so the turn gets flipped twice, **skipping a team's entire turn**.
- **Fix:** Always validate `expectedTeam` in the `endTurn` Lua script (reject empty), or wrap all `endTurn` calls in the same distributed lock.

### H3. Timer start/stop race — no distributed lock on `startTimer`
- **File:** `server/src/services/timerService.ts:153-221`
- **Issue:** `startTimer()` calls `await stopTimer()` then creates a new timer — these are not atomic. Two concurrent `startTimer` calls can each clear the other's timer, leaving **two local `setTimeout` callbacks** for the same room. First fires prematurely and deletes the key the second expected.
- **Fix:** Add a distributed lock around `startTimer` keyed by room code, or make Redis SET + local timer setup atomic.

### H4. `executeGameTransaction` WATCH/MULTI vs Lua — incompatible concurrency models
- **Files:** `server/src/services/game/luaGameOps.ts:225-293`, `server/src/services/gameService.ts:279-320,353-390`
- **Issue:** `revealCard` holds a distributed lock + Lua script, but `forfeitGame` and `finalizeMatchRound` use WATCH/MULTI **without** acquiring the same lock. Under contention in match mode, `finalizeMatchRound` can exhaust its 3 retries and throw `concurrentModification`.
- **Fix:** Have `finalizeMatchRound` acquire the `reveal:{roomCode}` lock, or convert to a Lua script.

### H5. `generateSessionToken` allows claim override via `additionalClaims`
- **File:** `server/src/config/jwt.ts:268-275`
- **Issue:** `additionalClaims` is spread *after* `userId`/`sessionId`/`type`, so a caller can override them.
- **Fix:** Spread `additionalClaims` first: `{ ...additionalClaims, userId, sessionId, type: 'session' }`

### H6. Health/metrics endpoints exposed without auth in production
- **Files:** `server/src/routes/healthRoutes.ts:164-273`, `server/src/app.ts:220`
- **Issue:** `/health/metrics` and `/health/metrics/prometheus` leak memory usage, Redis mode, uptime, and alert thresholds without authentication. The `/metrics` root path correctly requires admin auth in production, but `/health/metrics` does not.
- **Fix:** Apply `strictLimiter` + `basicAuth` to `/health/metrics` and `/health/metrics/prometheus` in production. Keep `/health`, `/health/ready`, `/health/live` unauthenticated for load balancers.

### H7. Redis healthcheck exposes password in process list
- **File:** `docker-compose.yml:55`
- **Issue:** `redis-cli -a ${REDIS_PASSWORD}` is visible in `/proc/*/cmdline`.
- **Fix:** Use `REDISCLI_AUTH` env var:
  ```yaml
  test: ["CMD", "sh", "-c", "REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping"]
  ```

---

## Priority 2: Medium Severity

### M1. `forfeitGame` does not stop the turn timer
- **File:** `server/src/services/gameService.ts:353-390`
- **Issue:** Sets `gameOver = true` but never calls `timerService.stopTimer(roomCode)`. Timer fires, calls `endTurn`, gets `GAME_OVER` error — harmless but wastes resources and creates misleading logs.
- **Fix:** Call `timerService.stopTimer()` in the forfeit handler.

### M2. Room membership check in `joinRoom` is not atomic with room data read
- **File:** `server/src/services/room/membership.ts:22-127`
- **Issue:** `getRoom()` (line 29) returns a snapshot, then `ATOMIC_JOIN_SCRIPT` executes later. Room data returned to the caller is stale. If settings changed between calls, the newly joined player receives outdated room config until next sync.
- **Fix:** Re-read room data after successful join, or have Lua script return current room data.

### M3. `atomicCleanupDisconnectedPlayer.lua` doesn't clean socket mapping
- **File:** `server/src/scripts/atomicCleanupDisconnectedPlayer.lua`
- **Issue:** Removes player key + set membership, but leaves `session:{sessionId}:socket` orphaned until its TTL expires.
- **Fix:** Also delete `session:{sessionId}:socket` in the Lua script or cleanup code.

### M4. `scheduled:player:cleanup` sorted set has no TTL
- **File:** `server/src/services/player/cleanup.ts:64-79`
- **Issue:** Sorted set grows as players disconnect. If cleanup task stops or entries fail to parse, set grows without bound. No TTL on the key.
- **Fix:** Periodically trim entries older than 24 hours via `ZREMRANGEBYSCORE`.

### M5. JWT `signToken` allows unbounded `expiresIn` override
- **File:** `server/src/config/jwt.ts:115`
- **Issue:** Caller can pass `expiresIn: '999y'` to generate extremely long-lived tokens.
- **Fix:** Validate or cap `expiresIn` against a maximum (e.g., `7d`), or remove the override.

### M6. Wildcard subdomain matching inconsistency between socket and CSRF
- **Files:** `server/src/middleware/auth/originValidator.ts:73-80` vs `server/src/middleware/csrf.ts:157-166`
- **Issue:** Socket origin validator compares against the full origin string; CSRF middleware correctly parses URL and compares hostname only. The socket version is fragile (works now but breaks with ports).
- **Fix:** Standardize to URL parsing + hostname comparison, as done in `csrf.ts`.

### M7. Admin scrypt salt is hardcoded across all deployments
- **File:** `server/src/routes/adminRoutes.ts:21`
- **Issue:** `ADMIN_SCRYPT_SALT = 'eigennamen-admin-auth'` — identical passwords across deployments produce identical hashes.
- **Fix:** Derive salt from `JWT_SECRET` or add an `ADMIN_SALT` env var.

### M8. `.env.example` JWT_SECRET placeholder accepted silently
- **File:** `server/.env.example:20`
- **Issue:** Developers who copy `.env.example` to `.env` without changing the JWT secret get a predictable signing key with no error in dev mode.
- **Fix:** In `getJwtSecret()`, reject values starting with `CHANGE-ME` or emit a prominent warning.

### M9. `processScheduledCleanups` is not idempotent across instances
- **File:** `server/src/services/player/cleanup.ts:101-226`
- **Issue:** Multiple instances could process the same cleanup entries from the sorted set simultaneously.
- **Fix:** Use `ZPOPMIN` (Redis 5.0+) to atomically dequeue cleanup entries.

### M10. `fly.toml` defaults to in-memory mode
- **File:** `fly.toml:35-36`
- **Issue:** Default `REDIS_URL=memory` with `MEMORY_MODE_ALLOW_FLY=true` — scaling beyond 1 machine silently splits state.
- **Fix:** Add prominent warning and startup check for multi-machine memory-mode.

### M11. Swagger/API docs accessible in production
- **File:** `server/src/app.ts:223`
- **Issue:** `/api-docs` exposes full API schema for reconnaissance.
- **Fix:** Gate behind `isDevelopment()` or require admin auth in production.

### M12. Nickname regex mismatch between client and shared validation
- **File:** `server/src/frontend/multiplayerUI.ts:449` vs `server/src/shared/validation.ts:11`
- **Issue:** Client uses ASCII-only regex `/^[a-zA-Z0-9\s\-_]+$/`; shared validation uses Unicode `/^[\p{L}\p{N}\s\-_]+$/u`. Users with Unicode names get incorrect client-side errors.
- **Fix:** Use the Unicode regex from shared/validation.ts on the client side.

---

## Priority 3: Low Severity

### ~~L1. Missing `Permissions-Policy` header~~ ✅ FIXED
- **Status:** Already implemented at `app.ts:157-159` — `camera=(), microphone=(), geolocation=(), payment=()`.

### ~~L2. CSP allows `'unsafe-inline'` for styles~~ ✅ FIXED
- **Status:** `'unsafe-inline'` removed from `styleSrc`. All inline styles migrated to CSS classes and HTML `hidden` attribute. External `admin.css` extracted from `admin.html`.

### ~~L3. `allowEIO3: true` enables legacy Engine.IO protocol~~ ✅ FIXED
- **Status:** Already set to `allowEIO3: false` at `serverConfig.ts:50`.

### ~~L4. Socket Zod validation errors expose field paths in all environments~~ ✅ FIXED
- **Status:** Production path stripping implemented at `validation.ts:28-29`.

### L5. `revealCard.lua` doesn't validate `maxHistoryEntries` bounds
- **File:** `server/src/scripts/revealCard.lua:5`
- **Fix:** Add `if maxHistoryEntries == nil or maxHistoryEntries < 1 then maxHistoryEntries = 100 end`.

### L6. Distributed lock doesn't validate minimum `lockTimeout`
- **File:** `server/src/utils/distributedLock.ts:47-98`
- **Fix:** Enforce minimum (e.g., 1000ms) to prevent locks expiring before operations complete.

### ~~L7. ESLint `no-explicit-any` is `warn` not `error`~~ ✅ FIXED
- **Status:** Already set to `error` at `eslint.config.js:70,109`.

### L8. Frontend tsconfig missing advanced strictness flags
- **File:** `server/tsconfig.frontend.json`
- **Fix:** Add `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` to match backend.

### L9. Rate limiter timestamp arrays not pre-capped
- **File:** `server/src/middleware/rateLimit.ts:107-117`
- **Fix:** Early-return from `getLimiter` once array hits `limit.max`.

### L10. `safeTeamSwitch.lua` passes room code as KEYS instead of ARGV
- **File:** `server/src/scripts/safeTeamSwitch.lua`, `server/src/services/player/mutations.ts:42`
- **Issue:** `roomCode` passed as `KEYS[3]` but is a plain string, not a Redis key. Breaks Redis Cluster (different hash slot).
- **Fix:** Pass as ARGV and construct key names inside Lua.

### L11. `localTimers` evicts by insertion order, not by expiry time
- **File:** `server/src/services/timerService.ts:197-205`
- **Issue:** At 5000+ rooms, oldest-inserted timer evicted even if still active. A timer with a nearer `endTime` should be evicted first.
- **Fix:** Evict timer with earliest `endTime` rather than first-inserted.

### L12. Inline Lua script in `generateReconnectionToken` not preloaded
- **File:** `server/src/services/player/reconnection.ts:83-100`
- **Fix:** Move to `scripts/` directory for consistency and EVALSHA caching.

---

## Test Coverage Gaps

| Gap | Severity | Suggested Test File |
|-----|----------|---------------------|
| `originValidator.ts` (CSRF defense for WebSocket) | Medium | `__tests__/middleware/originValidator.test.ts` |
| `gameMutationNotifier.ts` (real-time state sync) | Medium | `__tests__/socket/gameMutationNotifier.test.ts` |
| Service sub-modules (`boardGenerator.ts`, `luaGameOps.ts`, `revealEngine.ts`, `membership.ts`) | Medium | Verify via coverage report or add dedicated tests |
| `GameError` hierarchy + `sanitizeErrorForClient` | Low | `__tests__/errors/GameError.test.ts` |
| Validator schemas (`roomSchemas`, `playerSchemas`, `chatSchemas`, `timerSchemas`) | Low | One test file per schema module |
| `parseJSON.ts` | Low | `__tests__/utils/parseJSON.test.ts` |
| Shared game rules module | Low | `__tests__/shared/gameRules.test.ts` |

---

## Architecture Improvements (Non-Urgent)

1. **Redis Streams for event sourcing** — Replace the capped history array in game state JSON with Redis Streams for ordered, durable event storage with consumer groups.

2. **Structured logging with correlation IDs** — Add a `traceId` flowing through handler → service → Lua for production debugging.

3. **Lua script preloading** — Use `SCRIPT LOAD` + `EVALSHA` instead of `EVAL` for the 26 Lua scripts to save bandwidth and parsing.

4. ~~**Automated dependency scanning**~~ ✅ DONE — `npm audit` in CI security job, Dependabot configured, Trivy container scanning, all GitHub Actions SHA-pinned.

---

## What's Already Excellent

- Zero `as any` in production source code; zero `@ts-ignore` / `@ts-nocheck` directives
- Maximally strict TypeScript config (`noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, etc.)
- Constant-time token comparison via `crypto.timingSafeEqual`
- 26 Lua scripts for atomic Redis operations with `CORRUPTED_DATA` error signaling
- Error detail allowlisting (only `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable`)
- Production Zod path stripping to prevent schema disclosure (both HTTP and WebSocket)
- Production CORS wildcard is fatal (`process.exit(1)`)
- JWT algorithm pinned to `HS256` with restricted `algorithms` in verify; no hardcoded fallback secret
- Multi-layer rate limiting (per-socket, per-IP, global-IP) with LRU eviction
- Non-root Docker user with multi-stage build; Redis not port-exposed outside Docker network
- Distributed locks with exponential backoff, auto-extension, and Lua-based safe release
- CSRF protection via `X-Requested-With` header requirement + origin validation
- Comprehensive XSS prevention: frontend uses `textContent` and `createElement()` throughout; no `innerHTML`
- Strict CSP: no `unsafe-inline` in script-src or style-src; all styles in external CSS files
- Permissions-Policy: camera, microphone, geolocation, payment all disabled
- SHA-pinned GitHub Actions across all CI/CD workflows with minimal permissions
- Batched state updates, concurrent render guards, and comprehensive state cleanup on room changes
- Bounded in-memory structures (`localTimers` at 5000, `lastTTLRefresh` at 500, `emissionMetrics` hourly reset)
