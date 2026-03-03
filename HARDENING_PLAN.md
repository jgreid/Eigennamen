# Hardening Plan: Eigennamen Online

Comprehensive code review findings, prioritized by severity. The codebase is **already well above average** in security posture — Lua atomics, constant-time token comparison, CSP headers, Zod validation at all boundaries, error detail allowlisting, CSRF protection with `X-Requested-With`, and distributed locks with jitter are all excellent.

Below is what remains.

---

## Priority 1: High Severity

### H1. `generateSessionToken` allows claim override via `additionalClaims`
- **File:** `server/src/config/jwt.ts:268-275`
- **Issue:** `additionalClaims` is spread *after* the fixed fields (`userId`, `sessionId`, `type`), so a caller could override them with arbitrary values.
- **Fix:** Spread `additionalClaims` first:
  ```ts
  return signToken({ ...additionalClaims, userId, sessionId, type: 'session' });
  ```

### H2. Health/metrics endpoints exposed without auth in production
- **Files:** `server/src/routes/healthRoutes.ts:164-273`, `server/src/app.ts:220`
- **Issue:** `/health/metrics` and `/health/metrics/prometheus` leak memory usage, Redis mode, uptime, and alert thresholds to unauthenticated users. The `/metrics` root path correctly requires admin auth in production, but the `/health/metrics` path does not.
- **Fix:** Apply `strictLimiter` + `basicAuth` to `/health/metrics` and `/health/metrics/prometheus` in production. Keep `/health`, `/health/ready`, `/health/live` unauthenticated for load balancers.

### H3. Redis healthcheck exposes password in process list
- **File:** `docker-compose.yml:55`
- **Issue:** `redis-cli -a ${REDIS_PASSWORD}` is visible in `/proc/*/cmdline`.
- **Fix:** Use `REDISCLI_AUTH` env var:
  ```yaml
  test: ["CMD", "sh", "-c", "REDISCLI_AUTH=$REDIS_PASSWORD redis-cli ping"]
  ```

---

## Priority 2: Medium Severity

### M1. JWT `signToken` allows unbounded `expiresIn` override
- **File:** `server/src/config/jwt.ts:115`
- **Issue:** Caller can pass `expiresIn: '999y'` to generate extremely long-lived tokens.
- **Fix:** Validate or cap `expiresIn` against a maximum (e.g., `7d`), or remove the override.

### M2. Wildcard subdomain matching inconsistency between socket and CSRF
- **Files:** `server/src/middleware/auth/originValidator.ts:73-80` vs `server/src/middleware/csrf.ts:157-166`
- **Issue:** Socket origin validator compares against the full origin string; CSRF middleware correctly parses URL and compares hostname. The socket version is fragile (works correctly now but breaks if ports are added).
- **Fix:** Standardize to URL parsing + hostname comparison, as done in `csrf.ts`.

### M3. Admin scrypt salt is hardcoded across all deployments
- **File:** `server/src/routes/adminRoutes.ts:21`
- **Issue:** `const ADMIN_SCRYPT_SALT = 'eigennamen-admin-auth'` — identical passwords across deployments produce identical hashes.
- **Fix:** Derive salt from `JWT_SECRET` or add an `ADMIN_SALT` env var.

### M4. `.env.example` JWT_SECRET placeholder accepted silently
- **File:** `server/.env.example:20`
- **Issue:** Developers who copy `.env.example` to `.env` without changing the JWT secret get a predictable signing key with no error in dev mode.
- **Fix:** In `getJwtSecret()`, reject values starting with `CHANGE-ME` or emit a prominent warning.

### M5. `processScheduledCleanups` is not idempotent across instances
- **File:** `server/src/services/player/cleanup.ts:101-226`
- **Issue:** Multiple instances could process the same cleanup entries from the sorted set simultaneously. `zRem` after processing prevents double-processing, but two instances could both execute cleanup for the same player before either removes the entry.
- **Fix:** Use `ZPOPMIN` (Redis 5.0+) to atomically dequeue cleanup entries.

### M6. `fly.toml` defaults to in-memory mode
- **File:** `fly.toml:35-36`
- **Issue:** Default `REDIS_URL=memory` with `MEMORY_MODE_ALLOW_FLY=true` means scaling beyond 1 machine splits game state silently.
- **Fix:** Add a prominent warning comment and consider a startup check that warns when running memory mode with >1 Fly.io machine.

### M7. Swagger/API docs accessible in production
- **File:** `server/src/app.ts:223`
- **Issue:** `/api-docs` exposes full API schema for reconnaissance.
- **Fix:** Gate behind `isDevelopment()` or require admin auth in production.

---

## Priority 3: Low Severity

### L1. Missing `Permissions-Policy` header
- **File:** `server/src/app.ts:117-154`
- **Fix:** Add `Permissions-Policy: camera=(), microphone=(), geolocation=()`.

### L2. CSP allows `'unsafe-inline'` for styles
- **File:** `server/src/app.ts:123`
- **Fix:** Migrate inline styles to external CSS and remove `'unsafe-inline'`.

### L3. `allowEIO3: true` enables legacy Engine.IO protocol
- **File:** `server/src/socket/serverConfig.ts:50`
- **Fix:** Remove unless legacy client support is needed.

### L4. Socket Zod validation errors expose field paths in all environments
- **File:** `server/src/middleware/validation.ts:26`
- **Fix:** Apply the same production path-stripping logic as `errorHandler.ts:108-111`.

### L5. `revealCard.lua` doesn't validate `maxHistoryEntries` bounds
- **File:** `server/src/scripts/revealCard.lua:5`
- **Fix:** Add `if maxHistoryEntries == nil or maxHistoryEntries < 1 then maxHistoryEntries = 100 end`.

### L6. Distributed lock doesn't validate minimum `lockTimeout`
- **File:** `server/src/utils/distributedLock.ts:47-98`
- **Fix:** Enforce minimum (e.g., 1000ms) to prevent locks expiring before operations complete.

### L7. ESLint `no-explicit-any` is `warn` not `error`
- **File:** `server/eslint.config.js:70`
- **Fix:** Promote to `error` (current codebase has zero violations in source).

### L8. Frontend tsconfig missing advanced strictness flags
- **File:** `server/tsconfig.frontend.json`
- **Fix:** Add `noUncheckedIndexedAccess`, `noImplicitReturns`, `noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters` to match backend.

### L9. Rate limiter timestamp arrays not pre-capped
- **File:** `server/src/middleware/rateLimit.ts:107-117`
- **Fix:** Early-return from `getLimiter` once array hits `limit.max`.

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

3. **Lua script preloading** — Use `SCRIPT LOAD` + `EVALSHA` instead of `EVAL` for the 23 Lua scripts to save bandwidth and parsing.

4. **Automated dependency scanning** — Add `npm audit` to CI and consider `.github/dependabot.yml`.

---

## What's Already Excellent

- Zero `as any` in production source code
- Maximally strict TypeScript config (`noUncheckedIndexedAccess`, `useUnknownInCatchVariables`, etc.)
- Constant-time token comparison via `crypto.timingSafeEqual`
- 23 Lua scripts for atomic Redis operations
- Error detail allowlisting (only `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable`)
- Production Zod path stripping to prevent schema disclosure
- Production CORS wildcard is fatal (`process.exit(1)`)
- JWT algorithm pinned to `HS256` with restricted `algorithms` in verify
- Multi-layer rate limiting (per-socket, per-IP, global-IP) with LRU eviction
- Non-root Docker user with multi-stage build
- Distributed locks with exponential backoff and jitter
- CSRF protection via `X-Requested-With` header requirement
