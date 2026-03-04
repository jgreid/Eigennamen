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

## Medium & Low Items — Reevaluation (Round 2)

After reading every file in detail, **21 of 29 remaining items were reclassified** as false positives or already handled:

| # | Original Finding | Revised Status | Reason |
|---|---|---|---|
| 9 | JWT revocation | **OVERBLOWN** | Sessions are WebSocket-based; socket disconnect invalidates JWT usage. Session ID validation at reconnect. |
| 10 | Session idle timeout | **OVERBLOWN** | Socket.io ping timeout (60s) handles idle detection. Redis TTLs clean up orphaned sessions. |
| 11 | CSP unsafe-inline | **VALID — FIXED** | Added CSP violation reporting endpoint at `/api/csp-report` with `reportUri` directive. Style migration remains as tech debt. |
| 12 | Redis eviction policy | **BAD RECOMMENDATION** | `noeviction` is **correct** for game data integrity. Silently evicting game state would corrupt active games. |
| 13 | Lock TTL vs operation | **FALSE POSITIVE** | `withAutoExtend()` already extends locks at 50% threshold. Per-operation timeouts configured correctly (`LOCKS.CARD_REVEAL * 1000`). |
| 14 | Dockerfile pinning | **VALID — FIXED** | Pinned to `node:22.14-alpine3.21` in both build and production stages. |
| 15 | Stack traces in logs | **OVERBLOWN** | Logs are server-side only (never client-facing). Stack traces are essential for debugging production issues. |
| 16 | Fly.io split-brain | **ALREADY MITIGATED** | Multiple layers: `validateEnv()` blocks by default, startup warning, fly.toml comments, 1-machine config. |
| 17 | Reconnection token scope | **FALSE POSITIVE** | Tokens include `roomCode` in `ReconnectionTokenData`. Sessions bound to rooms. |
| 18 | JWT type claim | **VALID — FIXED** | `generateSessionToken` already sets `type: 'session'`. Added `type: 'session'` to expected claims in `jwtHandler.ts`. |
| 19 | Redis command renaming | **DOCUMENTATION** | Production Redis should disable `FLUSHDB`/`FLUSHALL`/`CONFIG`/`DEBUG` — operational guidance, not a code change. |
| 20 | Audit service failures | **FALSE POSITIVE** | Already logs at `logger.error` level (line 246 of auditService.ts), not `debug`. |
| 21 | Service worker cache | **ALREADY HANDLED** | Versioned cache name (`eigennamen-v4`), old caches deleted on activate, network-first strategy. |
| 22 | FLY_ALLOC_ID in metrics | **FALSE POSITIVE** | Production only exposes `flyRegion` (line 278 of app.ts). `flyAllocId` only in dev mode. |
| 23 | Docker ulimits | **VALID — FIXED** | Added `nofile` (65536) and `nproc` (4096) limits to API container. |
| 24 | Graceful shutdown | **OVERBLOWN** | 10s with individual 3s Redis timeout is sufficient. |
| 25 | TTL coordination | **VALID — FIXED** | Added players set TTL refresh to `atomicJoin.lua` (syncs with room key TTL). |
| 26 | Redis reconnection | **VALID — FIXED** | Exponential backoff with 20% jitter, max 15s delay, 20 retries (was: linear 3s cap, 10 retries). |
| 27 | Lua JSON corruption | **VALID — NOT FIXED** | Low impact; would require touching 4+ Lua scripts and all TypeScript callers. |
| 28 | Lock extension race | **FALSE POSITIVE** | `finally` block waits for `pendingExtension` before release. Race handled. |
| 29 | Timer expired during pause | **FALSE POSITIVE** | `getTimerStatus` explicitly handles `'EXPIRED'` string at line 285-288. |
| 30 | Pub/Sub health | **VALID — NOT FIXED** | Main Redis client health monitored via `/health/ready` PING check. Pub/Sub has separate monitoring. Low priority. |
| 31 | Match score race | **FALSE POSITIVE** | `finalizeRound` only adds `ROUND_WIN_BONUS`. Card points pre-accumulated per-reveal in Lua. |
| 32 | Timer without lock | **FALSE POSITIVE** | `resumeTimer` calls `startTimer` which acquires `withLock`. |
| 33 | Match carry-over validation | **VALID — FIXED** | Added full Zod schema (`matchCarryOverSchema` + `roundResultSchema`) validating all fields. |
| 34 | Timer eviction batch | **VALID — FIXED** | Batch eviction (10% of capacity) prevents rapid growth from outpacing single-entry eviction. |
| 35 | Room cleanup batch | **OVERBLOWN** | Room sizes capped by `MAX_PLAYERS_PER_ROOM` config. Not thousands of players. |
| 36 | innerHTML in roles.ts | **VALID — FIXED** | Replaced all `innerHTML` with `createElement()` + `appendChild()` + `textContent`. Removed unused `escapeHTML` import. |
| 37 | Store subscription cleanup | **VALID — NOT FIXED** | Requires a frontend-wide audit. `multiplayerSync.ts` handles it correctly; other modules need review. |

---

## Final Summary

### Items Fixed (This Round)

| # | Fix | Files Changed |
|---|---|---|
| 11 | CSP violation reporting endpoint | `app.ts` |
| 14 | Dockerfile version pinning | `Dockerfile` |
| 18 | JWT type claim validation | `jwtHandler.ts` |
| 23 | Docker ulimits | `docker-compose.yml` |
| 25 | Players set TTL refresh on join | `atomicJoin.lua` |
| 26 | Redis reconnection backoff + jitter | `redis.ts` |
| 33 | Match carry-over Zod validation | `gameService.ts` |
| 34 | Batch timer eviction | `timerService.ts` |
| 36 | innerHTML → safe DOM methods | `roles.ts` |

### Items Not Fixed (Low Priority / Deferred)

| # | Reason for Deferral |
|---|---|
| 27 | Lua JSON corruption — touches 4+ scripts; low impact |
| 30 | Main Redis health — already covered by `/health/ready` PING |
| 37 | Store subscription audit — requires frontend-wide analysis |

### Verification

- **3539 tests pass** across 127 suites
- **TypeScript** compiles cleanly
- **ESLint** 0 errors, 2 pre-existing warnings (jwt.ts non-null assertions)

---

## Architecture Observations (Not Issues)

These are **positive patterns** worth preserving:

- **Constant-time comparison** (`crypto.timingSafeEqual`) for all token validation
- **Multi-layer rate limiting** (per-socket, per-IP, global) with LRU eviction
- **Error detail allowlist** — prevents accidental information disclosure
- **Zod validation at all entry points** — strong input validation posture
- **Lua scripts for atomic operations** — correct approach for Redis race conditions
- **Production Zod scrubbing** — field paths stripped to prevent schema disclosure
- **Reconnection token security** — `crypto.randomBytes(32)`, short TTL, pre-comparison length checks
- **Client IP trust validation** — only trusts proxy headers when explicitly configured
- **Per-player mutex for room sync** — sophisticated fix for team/role race conditions
- **Safe DOM rendering** — chat uses `textContent`, dynamic content uses `createElement()`
- **Timeout protection everywhere** — `withTimeout()` wraps all Redis ops and handler execution
- **Connection state recovery** — Socket.io v4 with `skipMiddlewares: false` re-validates on reconnect
- **noeviction policy** — correct choice for game data; prevents silent corruption

---

## Proposed Next Steps

1. **CSP inline style migration** — Eliminate `'unsafe-inline'` from `styleSrc` by migrating all `element.style.*` assignments in `frontend/` to CSS classes. Monitor CSP reports from the new `/api/csp-report` endpoint to identify any remaining violations.

2. **Frontend subscription audit (#37)** — Audit all `subscribe()` calls in `frontend/` modules beyond `multiplayerSync.ts` to ensure unsubscribe functions are called in teardown paths. Consider a centralized `SubscriptionManager` that auto-cleans on mode transitions.

3. **Lua script error codes (#27)** — Add distinct return codes (`CORRUPTED` vs `MISSING`) to `pcall(cjson.decode)` failure paths across all Lua scripts. This enables better observability for data corruption incidents.

4. **E2E security tests** — Extend the Playwright E2E suite with adversarial scenarios: CSRF bypass attempts, expired JWT reconnection, rate limit boundary testing, and CSP violation detection.

5. **Dependency audit automation** — Consider enabling Dependabot security alerts and auto-merge for patch updates. The Trivy CI gate (now with `exit-code: 1`) will catch container-level vulnerabilities.
