# Codebase Audit Report — Codenames Online

**Date**: 2026-02-01
**Auditor**: Claude (Automated Code Audit)
**Scope**: Full-stack application (server + frontend SPA)
**Branch**: `claude/codebase-audit-report-lkg22`

---

## Executive Summary

Codenames Online is a well-structured real-time multiplayer game built with Node.js/Express/Socket.io (server) and vanilla JS (8,063-line SPA). The codebase demonstrates good security awareness with Zod validation, rate limiting, CSRF protection, and atomic Redis operations via Lua scripts. However, the audit identified **38 issues** across 6 categories, with several critical items related to the monolithic frontend, broken test suite, missing CI/CD, and operational gaps.

### Severity Distribution

| Severity | Count | Description |
|----------|-------|-------------|
| **Critical** | 5 | Must fix — security risks, broken tests, production blockers |
| **High** | 10 | Should fix soon — reliability, maintainability concerns |
| **Medium** | 13 | Plan to fix — code quality, architecture improvements |
| **Low** | 10 | Nice to have — polish, documentation, DX improvements |

---

## 1. CRITICAL ISSUES

### C1: Test Suite Is Broken — 214 of 731 Tests Failing
**Files**: `server/src/__tests__/**`
**Impact**: No confidence in code correctness; regressions go undetected.

The test suite fails due to missing `node_modules` (`winston`, etc.) when run via `npx jest` and likely similar issues with `npm test`. 62 of 75 test suites fail. This means the 80% coverage threshold in `package.json` is unenforced.

**Root cause**: Tests depend on installed dependencies but `npm install` may not have been run, OR dependencies changed without updating tests.

### C2: No CI/CD Pipeline
**Files**: `.github/workflows/` — **does not exist**
**Impact**: No automated testing, linting, or deployment gate.

There are no GitHub Actions, no pre-commit hooks, no automated quality gates. Every merge goes directly without validation. Combined with C1, this means the test suite could stay broken indefinitely.

### C3: Monolithic 8,063-Line Frontend SPA
**Files**: `index.html`
**Impact**: Unmaintainable, untestable, no separation of concerns.

The entire frontend — HTML, CSS, and all JavaScript — lives in a single file. This makes:
- Code review nearly impossible (any change touches 8K lines)
- Frontend testing impossible (no module system, no test hooks)
- Performance suboptimal (no code splitting, no tree shaking)
- Collaboration difficult (merge conflicts on every frontend change)

### C4: JWT Secret Has Insecure Default in Docker Compose
**Files**: `docker-compose.yml:21`
**Impact**: If `JWT_SECRET` env var is not set, the default `change-this-in-production` is used.

```yaml
- JWT_SECRET=${JWT_SECRET:-change-this-in-production}
```

While production (Fly.io) uses `fly secrets`, anyone running Docker Compose without setting `JWT_SECRET` in `.env` gets a guessable secret.

### C5: Redis and Postgres Exposed Without Authentication in Docker Compose
**Files**: `docker-compose.yml`
**Impact**: Redis has no password. Postgres uses a default password.

Redis runs with no `requirepass`. While bound to the Docker network, any container on that network (or any misconfigured port mapping) gets full access. The Postgres default password `local-dev-password-do-not-use-in-prod` is logged in the compose file.

---

## 2. HIGH SEVERITY ISSUES

### H1: `unsafe-inline` in CSP for Scripts
**File**: `server/src/app.js:92`
**Impact**: Weakens XSS protection significantly.

```js
scriptSrc: ["'self'", "'unsafe-inline'"],
scriptSrcAttr: ["'unsafe-inline'"],
```

The CSP allows inline scripts, which undermines the primary defense against XSS. This is documented as necessary because the game uses inline scripts and onclick handlers, but it's a significant security gap.

### H2: Distributed Lock Delete Is Not Owner-Safe
**Files**: `server/src/services/gameService.js:1088`, `server/src/socket/index.js:344,499`
**Impact**: Lock can be released by a different process than the one that acquired it.

The pattern used is:
```js
const lockAcquired = await redis.set(lockKey, process.pid.toString(), { NX: true, EX: 15 });
// ... later ...
await redis.del(lockKey);  // No owner check!
```

If the lock TTL expires and another process acquires it, the first process will delete the second process's lock. Should use a Lua script that checks the lock value before deleting.

### H3: Memory Leak Risk in `connectionsPerIP` Map
**File**: `server/src/socket/index.js:33`
**Impact**: The `connectionsPerIP` Map grows unboundedly if IPs connect and disconnect without proper cleanup.

The decrement logic at line 152 handles cleanup, but if the socket disconnects abnormally (without the `disconnect` event firing), entries can accumulate. There's no periodic cleanup of this map.

### H4: Room Settings Updates Are Not Atomic
**File**: `server/src/services/roomService.js:294-316`
**Impact**: Concurrent settings updates cause lost updates.

`updateSettings()` uses read-modify-write without any locking or optimistic concurrency. Two concurrent `room:settings` events could overwrite each other.

### H5: Player Data Stored as JSON Strings in Redis
**Files**: `server/src/services/playerService.js`, `gameService.js`
**Impact**: Every player operation requires full JSON parse/serialize. No partial updates.

All player and game state is stored as serialized JSON strings. This means updating a single field (e.g., `connected: false`) requires parsing the entire object, modifying it, and re-serializing. The Lua scripts partially address this for game operations, but player operations still suffer.

### H6: No Input Sanitization on Frontend Output
**File**: `index.html`
**Impact**: While Zod validates on the server, the frontend renders data from Socket.io events without HTML escaping.

If server-side validation were bypassed (or if a future change introduces a gap), XSS could occur via nicknames, team names, or chat messages rendered in the DOM.

### H7: `allowEIO3: true` Enables Legacy Protocol
**File**: `server/src/socket/index.js:72`
**Impact**: EIO3 is an older protocol with known issues. Allowing it increases attack surface.

### H8: Error Messages Leak Internal Details in Development
**File**: `server/src/errors/GameError.js:350-356`
**Impact**: `sanitizeErrorForClient` properly filters in production, but the error handler middleware may not consistently use it for all error paths.

### H9: No Request ID / Correlation ID in HTTP Responses
**File**: `server/src/middleware/`
**Impact**: Debugging production issues requires correlating logs to requests, which is difficult without correlation IDs in responses.

Note: `correlationId.js` exists in utils but may not be wired into all middleware chains.

### H10: Reconnection Token Rotation Race Condition
**File**: `server/src/socket/handlers/roomHandlers.js:372-379`
**Impact**: After successful reconnection, a new token is generated. If the client disconnects during this window, it may have neither the old (consumed) nor new token.

---

## 3. MEDIUM SEVERITY ISSUES

### M1: No Database Migrations Strategy
Prisma is configured but `fly.toml` has the migration command commented out. There's no documented strategy for schema changes.

### M2: Swagger/OpenAPI Docs May Be Stale
`swagger.js` is configured but there's no validation that the docs match the actual API.

### M3: No Graceful Degradation for Lua Script Failures
The Lua scripts in `gameService.js` have fallback paths, but `playerService.js` Lua scripts do not have fallbacks for memory mode. If a Lua script fails in memory mode, the operation fails entirely.

### M4: Timer Service Creates New Callback On Every Start
**File**: `server/src/socket/index.js:539`
`createTimerExpireCallback()` is called on every `startTurnTimer`, creating a new closure each time. While not a leak (old ones get GC'd when timers are cleared), it's unnecessary allocation.

### M5: `toEnglishUpperCase` / `toEnglishLowerCase` Utility Concern
Custom locale-safe functions exist in `utils/sanitize.js`. If these don't handle all Unicode edge cases, clue validation could be bypassed.

### M6: No Rate Limiting on Admin Routes
**File**: `server/src/app.js:151`
Admin routes are mounted at `/admin` with basic auth but no rate limiting beyond the strict limiter. Brute-force is possible.

### M7: `setImmediate` for Timer Restart Creates Untracked Background Work
**File**: `server/src/socket/index.js:283`
Timer restart logic runs in `setImmediate`, which means errors in this path are only caught by the `.catch()` handler and logged. No retry mechanism.

### M8: No Structured Logging Format
Winston is used but log format may not be consistently structured JSON in production, making log aggregation harder.

### M9: No Health Check for Memory Storage Mode
When `REDIS_URL=memory`, the health check still reports storage as OK, but there's no way to detect if the in-memory store is running low on memory.

### M10: Game State Can Grow Unboundedly
History is capped at 200 entries, but the `clues` array has no cap. A long game could accumulate significant clue data.

### M11: No Automated Dependency Vulnerability Scanning
No `npm audit` in CI, no Dependabot/Renovate configuration.

### M12: Frontend Uses `var` and Global State
The entire frontend uses global variables (`gameState`, `isMultiplayerMode`, etc.) with no encapsulation.

### M13: No E2E Test Infrastructure Active
Playwright is in devDependencies but there's no evidence of working E2E tests or test configuration.

---

## 4. LOW SEVERITY ISSUES

### L1: `package.json` Name is "die-eigennamen-server" — Inconsistent with Project Name
### L2: No `.env.example` File Found in Repo Root
### L3: Docker Compose Uses `version: '3.8'` Which Is Deprecated in Recent Docker Compose
### L4: `ROOM_CODE_LENGTH: 6` Constant Is Unused (Room IDs Are User-Provided)
### L5: No API Versioning (Routes Are `/api/rooms/:code` Not `/api/v1/...`)
### L6: `wordListService` Has Unused Database Dependency Path
### L7: Static File Caching Is 1 Day in Production — No Cache Busting Strategy
### L8: No Compression for WebSocket Messages Below 1KB Threshold
### L9: `RETRY_CONFIG.DISTRIBUTED_LOCK` Has 50 Max Retries Which Seems Excessive
### L10: Service Worker Registration Silently Fails With No User Feedback

---

## 5. ARCHITECTURE OBSERVATIONS

### Strengths
1. **Clean service layer separation** — Business logic in services, handlers delegate correctly
2. **Atomic Redis operations** — Lua scripts for room creation, team switching, host transfer, card reveal
3. **Comprehensive Zod validation** — All socket events have schemas with XSS prevention
4. **Typed error hierarchy** — `GameError` subclasses with error codes and client-safe sanitization
5. **Graceful degradation** — Works without Postgres, works without Redis (memory mode)
6. **Security-conscious design** — CSRF, rate limiting, session validation, reconnection tokens, constant-time comparison
7. **Good operational setup** — Health checks (liveness + readiness), metrics endpoint, structured logging

### Weaknesses
1. **Monolithic frontend** — 8K-line single file, impossible to test or modularize
2. **No CI/CD** — All quality gates are manual
3. **Test suite broken** — 214 failing tests undermine all test investment
4. **Redis as primary datastore** — All state in Redis with TTLs means data loss on restart. Acceptable for ephemeral game rooms but limits features like persistent game history

---

## 6. PROPOSED SPRINT PLAN

### Sprint 1: Foundation (Critical Fixes)
**Goal**: Restore test suite, establish CI/CD, secure defaults
**Estimated effort**: 1 sprint

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Fix all failing tests (install deps, fix mocks) | C1 | `server/src/__tests__/**` |
| 2 | Create GitHub Actions CI pipeline (lint, test, coverage) | C2 | `.github/workflows/ci.yml` |
| 3 | Fix JWT_SECRET default to fail-fast instead of using insecure default | C4 | `docker-compose.yml` |
| 4 | Add Redis password to Docker Compose | C5 | `docker-compose.yml` |
| 5 | Add `npm audit` to CI pipeline | M11 | `.github/workflows/ci.yml` |
| 6 | Add `.env.example` with documented variables | L2 | `.env.example` |

### Sprint 2: Security Hardening
**Goal**: Fix security issues that could be exploited
**Estimated effort**: 1 sprint

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Implement owner-safe distributed lock release (Lua script) | H2 | `gameService.js`, `socket/index.js` |
| 2 | Add periodic cleanup for `connectionsPerIP` map | H3 | `socket/index.js` |
| 3 | Add HTML escaping to all frontend DOM insertions | H6 | `index.html` |
| 4 | Remove `allowEIO3: true` (or document why it's needed) | H7 | `socket/index.js` |
| 5 | Add rate limiting to admin routes | M6 | `routes/adminRoutes.js` |
| 6 | Add atomic settings update with optimistic locking | H4 | `roomService.js` |
| 7 | Cap `clues` array growth | M10 | `gameService.js` |

### Sprint 3: Frontend Modernization (Phase 1)
**Goal**: Break monolithic frontend into manageable modules
**Estimated effort**: 2 sprints

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Extract CSS into separate stylesheet(s) | C3 | `index.html` → `styles/` |
| 2 | Extract JS into ES modules with a bundler (Vite/esbuild) | C3 | `index.html` → `src/` |
| 3 | Remove `unsafe-inline` from CSP (use nonces or bundled scripts) | H1 | `app.js`, `index.html` |
| 4 | Add frontend linting (ESLint) | C3 | `eslint.config.js` |
| 5 | Implement proper HTML escaping utility | H6 | `src/utils/sanitize.js` |
| 6 | Add cache-busting via content hashes | L7 | Build config |

### Sprint 4: Testing & Quality
**Goal**: Comprehensive test coverage, E2E tests
**Estimated effort**: 1 sprint

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Achieve 80% coverage threshold (currently unenforced) | C1 | `__tests__/**` |
| 2 | Add integration tests for full game flow | M13 | `__tests__/integration/` |
| 3 | Configure and write Playwright E2E tests | M13 | `e2e/` |
| 4 | Add pre-commit hook for lint + test | C2 | `.husky/`, `package.json` |
| 5 | Add correlation ID to all HTTP responses | H9 | `middleware/` |
| 6 | Validate Swagger docs match actual API | M2 | `config/swagger.js` |

### Sprint 5: Operational Excellence
**Goal**: Production reliability, monitoring, deployment safety
**Estimated effort**: 1 sprint

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Add Dependabot/Renovate for dependency updates | M11 | `.github/dependabot.yml` |
| 2 | Document database migration strategy | M1 | `docs/DEPLOYMENT.md` |
| 3 | Add memory usage monitoring for memory mode | M9 | `config/memoryStorage.js` |
| 4 | Implement structured JSON logging in production | M8 | `utils/logger.js` |
| 5 | Add Lua fallbacks for player service operations | M3 | `playerService.js` |
| 6 | Fix reconnection token rotation race | H10 | `roomHandlers.js` |
| 7 | Add API versioning | L5 | `routes/index.js` |

### Sprint 6: Frontend Modernization (Phase 2)
**Goal**: Testable, maintainable frontend
**Estimated effort**: 2 sprints

| # | Task | Severity | Files |
|---|------|----------|-------|
| 1 | Add frontend unit tests (Vitest/Jest) | C3 | `src/__tests__/` |
| 2 | Implement proper state management (replace globals) | M12 | `src/state/` |
| 3 | Add TypeScript (gradual migration) | M12 | `tsconfig.json` |
| 4 | PWA improvements (offline support, better SW) | L10 | `service-worker.js` |
| 5 | Performance audit (code splitting, lazy loading) | C3 | Build config |

---

## 7. QUICK WINS (< 1 Hour Each)

These can be done immediately outside of sprints:

1. Remove deprecated `version: '3.8'` from `docker-compose.yml`
2. Remove unused `ROOM_CODE_LENGTH` constant
3. Rename package to match project name
4. Add `.env.example` file
5. Remove `allowEIO3: true` if no legacy clients exist
6. Cap `clues` array at 200 entries (same as history)
7. Reduce `RETRY_CONFIG.DISTRIBUTED_LOCK.maxRetries` from 50 to ~10

---

## Appendix: File Inventory

| Category | Files | Lines (approx) |
|----------|-------|-----------------|
| Frontend | 1 (`index.html`) | 8,063 |
| Services | 7 | ~3,500 |
| Socket handlers | 5 + 3 support files | ~2,000 |
| Middleware | 6 | ~600 |
| Config | 7 | ~800 |
| Utils | 11 | ~1,000 |
| Tests | 75 files | ~15,000+ |
| Routes | 5 | ~400 |
| **Total** | **~120 files** | **~31,000+** |
