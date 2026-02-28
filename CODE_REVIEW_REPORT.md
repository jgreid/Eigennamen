# Code Review Report — Eigennamen Online v4.0.0

**Date:** 2026-02-28
**Scope:** Full codebase review (backend services, frontend, security, tests, configuration)
**Branch:** `claude/code-review-report-lg6li`

---

## Executive Summary

| Area | Health | Notes |
|------|--------|-------|
| **Toolchain** | **PASS** | ESLint clean, TypeScript clean, 129 test suites / 3 595 tests all passing |
| **Dependencies** | **WARN** | 1 high-severity `minimatch` ReDoS (dev-only transitive) |
| **Backend Services** | **GOOD** | Solid architecture, minor race-condition edge cases |
| **Frontend** | **GOOD** | Well-structured reactive store; event-listener cleanup gaps |
| **Security & Validation** | **GOOD** | Strong Zod + rate-limit + Lua atomicity; a few hardening opportunities |
| **Tests & Config** | **GOOD** | Comprehensive suite; coverage thresholds could be tighter |

**Overall assessment:** The codebase is well-architected with strong patterns (typed errors, Zod validation at all entry points, Lua atomicity, reactive frontend store). Findings are primarily edge cases, cleanup hygiene, and hardening opportunities — not fundamental design flaws.

---

## 1. Toolchain & CI Health

| Check | Result |
|-------|--------|
| `npm run lint` | **PASS** — zero warnings |
| `npm run typecheck` (backend + frontend) | **PASS** — zero errors |
| `npm test` (129 suites, 3 595 tests) | **PASS** — all green in ~83 s |
| `npm audit` | **1 high** — `minimatch` ReDoS (dev transitive via eslint, rimraf, test-exclude) |

### Dependency Vulnerability

`minimatch` ≤3.1.3 has ReDoS via nested `*()` extglobs. Affects only dev tooling (ESLint, test-exclude, rimraf) — no production exposure. Fix: `npm audit fix`.

---

## 2. Backend Services

### 2.1 High Severity

| # | File | Line(s) | Issue |
|---|------|---------|-------|
| B-1 | `services/gameHistoryService.ts` | 386-393 | **Silent error swallowing in `saveGameResult()`** — catches all errors and returns `null`. Callers cannot distinguish validation failure from transient Redis I/O error. Game results may silently fail to persist. **Fix:** Return `{ success, reason? }` or throw on transient failures. |

### 2.2 Medium Severity

| # | File | Line(s) | Issue |
|---|------|---------|-------|
| B-2 | `services/roomService.ts` | 305-312 | **Unbounded debounce map** — `lastTTLRefresh` Map evicts entries by age but under sustained Redis failure, all entries stay young. Could grow unbounded. **Fix:** Hard-cap the map size or use LRU. |
| B-3 | `services/roomService.ts` | 107-124 | **Misleading post-Lua verification** — `redis.exists()` check after atomic SETNX is non-atomic and produces misleading error logs when Redis is flaky. **Fix:** Remove the check or clarify comment. |
| B-4 | `services/timerService.ts` | 371-376 | **Timer resume race condition** — between checking `pausedDuration >= remaining` and calling `redis.del()`, concurrent `addTime()` or `stopTimer()` could modify the timer. **Fix:** Use Lua script for atomic check-and-delete. |
| B-5 | `services/game/luaGameOps.ts` | 134 | **Unchecked empty string from Lua** — `resultStr` could be empty/whitespace, causing `JSON.parse("")` to throw. **Fix:** Guard with `if (!resultStr || resultStr.trim() === '')`. |
| B-6 | `services/playerService.ts` | 247 | **Missing error context on retry exhaustion** — concurrency error message lacks player/operation context. **Fix:** Enrich error message. |

### 2.3 Low Severity

| # | File | Issue |
|---|------|-------|
| B-7 | `services/game/revealEngine.ts:73,75,87` | Unsafe `as CardType` casts without runtime validation. |
| B-8 | `services/timerService.ts:197-204` | "Oldest entry" eviction comment is misleading (uses insertion order, not time). |
| B-9 | `services/auditService.ts:285-287` | No `Array.isArray()` guard on Redis `lRange` result. |

---

## 3. Frontend

### 3.1 High Severity

| # | File | Issue |
|---|------|-------|
| F-1 | Multiple (`chat.ts`, `accessibility.ts`, `board.ts`) | **Event listener leak** — 39 `addEventListener` calls vs. 7 `removeEventListener` calls. `initChat()`, keyboard shortcuts, and resize listeners never cleaned up on room exit. **Fix:** Centralize listener lifecycle; add `leaveMultiplayerMode()` cleanup wrapper. |
| F-2 | `frontend/multiplayerSync.ts:37-67` | **Incomplete DOM listener cleanup on disconnect** — `cleanupDOMListeners()` exists but is not called in all disconnect/error paths. |
| F-3 | `frontend/game/reveal.ts:65-72` | **Orphaned reveal timeouts** — `state.revealTimeouts` Map is cleared without first calling `clearTimeout()` on each entry. If game resets mid-reveal, stale timeouts fire on cleared state. |

### 3.2 Medium Severity

| # | File | Issue |
|---|------|-------|
| F-4 | `frontend/i18n.ts:126-129` | **Potential XSS in i18n interpolation** — `t()` interpolates `{{params}}` without HTML escaping. If result is used with `.innerHTML`, player nicknames containing `<script>` could execute. **Fix:** Escape interpolation values in `t()`. |
| F-5 | `frontend/handlers/gameEventHandlers.ts:106-111` | **Unvalidated server array lengths** — `data.types` assigned without checking length matches `BOARD_SIZE`. Malformed response could break rendering. |
| F-6 | `frontend/handlers/playerEventHandlers.ts:90-133` | **Fragile role-change state machine** — `rc.phase` can get stuck in `'team_then_role'` if first confirmation never arrives. 10s absolute timeout is the only safety net. |
| F-7 | `frontend/timer.ts:71-89` | **Stale closure in timer countdown** — `setInterval` callback captures state that may be replaced between creation and execution. Rapid timer restarts could cause overlap. |
| F-8 | `frontend/multiplayer.ts:337` | **Multiple reveal sweeps** — `startRevealSweep()` called without stopping previous. Joining rooms in succession starts duplicate sweeps. **Fix:** Call `stopRevealSweep()` first. |
| F-9 | `frontend/handlers/roomEventHandlers.ts:65` | **Resync flag timing** — socket events queued in the event loop may process before `resyncInProgress` flag takes effect. |

### 3.3 Low Severity

| # | File | Issue |
|---|------|-------|
| F-10 | `frontend/multiplayer.ts:226,308` | Error objects cast to `{ name?, code?, message? }` without type narrowing. |
| F-11 | `frontend/ui.ts:5-91` | Toast timers rely on GC via WeakMap; no max-age fallback. |
| F-12 | `frontend/store/reactiveProxy.ts:50-64` | Proxy traps fire even when no subscribers exist (minor perf). |
| F-13 | Multiple handlers | Inconsistent i18n usage — some toast messages use hardcoded strings instead of translation keys. |

---

## 4. Security & Validation

### 4.1 High Severity

| # | File | Issue |
|---|------|-------|
| S-1 | `socket/contextHandler.ts` | **Host ownership validation** — `createHostHandler()` sets `requireHost: true`. Verify that `getPlayerContext()` in `playerContext.ts` actually checks the `isHost` flag. If bypassed, any player could perform host-only actions. |

### 4.2 Medium Severity

| # | File | Issue |
|---|------|-------|
| S-2 | `config/jwt.ts:60-77` | **JWT_SECRET not enforced in production** — missing secret disables JWT auth with only a warning log. **Fix:** `throw` on startup if `NODE_ENV=production` and `JWT_SECRET` is unset. |
| S-3 | `middleware/csrf.ts:34-54` | **CSRF relies solely on `X-Requested-With` header** — no CSRF token. Custom headers block cross-origin form POSTs but are bypassable by HTTP clients. **Fix:** Implement double-submit cookie pattern for state-changing REST endpoints. |
| S-4 | `routes/adminRoutes.ts:58-60` | **Admin password hashed with SHA-256, not KDF** — vulnerable to rainbow table attacks if `ADMIN_PASSWORD` is weak. Timing-safe comparison is good. **Fix:** Use bcrypt/argon2 at startup; compare at request time. |
| S-5 | `config/rateLimits.ts:50` | **Room enumeration** — `/api/rooms/:code/exists` rate-limited at 30/min. At ~43K attempts/day, active rooms could be found. **Fix:** Reduce to 5-10/min. |
| S-6 | `scripts/safeTeamSwitch.lua:24` | **`cjson.decode()` without pcall** — corrupted Redis JSON crashes Lua script. **Fix:** Wrap in `pcall()` and return error object. |
| S-7 | `middleware/auth/sessionValidator.ts:62-111` | **In-memory rate-limit fallback cleanup interval** — 60s cleanup window allows stale entries to accumulate. **Fix:** Reduce to 10-20s when Redis is unavailable. |
| S-8 | `validators/gameSchemas.ts:46-52` | **Missing UUID format validation** on `gameId` in replay schema. Accepts any string up to 100 chars. |
| S-9 | `middleware/auth/clientIP.ts:37-64` | **X-Forwarded-For ignored without TRUST_PROXY** — if deployed behind proxy without explicit config, rate limiting uses proxy IP. **Fix:** Log warning when proxy headers detected but TRUST_PROXY not set. |

### 4.3 Low Severity

| # | File | Issue |
|---|------|-------|
| S-10 | `utils/sanitize.ts:13-17` | `removeControlChars()` strips ASCII control chars but not Unicode control chars (`\u202E` RTL override, `\u200B` zero-width space). |
| S-11 | `validators/playerSchemas.ts:19-20` | Session ID regex `/^[a-zA-Z0-9\-_]+$/` doesn't enforce UUID format. |
| S-12 | `config/jwt.ts:225-241` | JWT claims validation doesn't reject unexpected extra claims. |
| S-13 | `routes/replayRoutes.ts` | Game replay endpoints lack rate limiting. |

---

## 5. Tests & Configuration

### 5.1 High Severity

| # | File | Issue |
|---|------|-------|
| T-1 | `package.json` | **minimatch ReDoS vulnerability** — high severity, affects dev dependencies. **Fix:** `npm audit fix`. |

### 5.2 Medium Severity

| # | File | Issue |
|---|------|-------|
| T-2 | `jest.config.ts.js:76-83` | **Low coverage thresholds** — backend branches at 75%, frontend at 70%. Infrastructure modules (redis.ts, socket/index.ts) drag down globals. **Fix:** Raise thresholds; create dedicated integration suites for infrastructure. |
| T-3 | `playwright.config.js:70` | **60s server startup timeout** may be too short for constrained CI. **Fix:** Increase to 120s. |
| T-4 | `__tests__/` (general) | **No shared test factories** — test data is recreated inline across 129 suites. Duplication and inconsistency risk. **Fix:** Create `__tests__/helpers/fixtures.ts` with factory functions. |
| T-5 | `playwright.config.js` | **No Redis cleanup between E2E tests** — no `globalSetup`/`globalTeardown`. Tests may be order-dependent. |
| T-6 | `index.html:19-20` | **Manual SRI hash maintenance** — integrity hashes must match compiled JS. `esbuild.config.js` auto-updates but only if file paths resolve. Silent failure in CI could block script loading. |
| T-7 | `tsconfig.json:28` | **`noPropertyAccessFromIndexSignature: false`** weakens type safety for indexed object access. |

### 5.3 Low Severity

| # | File | Issue |
|---|------|-------|
| T-8 | `package.json:62,75` | Dual ESLint TypeScript packages (`@typescript-eslint/eslint-plugin` + `typescript-eslint`). Only one needed. |
| T-9 | `jest.config.ts.js:40-42` | Test patterns don't match `.spec.ts` files — only `*.test.ts`. |
| T-10 | `tsconfig.frontend.json:18` | `verbatimModuleSyntax: false` inconsistent with backend config. |

---

## 6. Prioritized Recommendations

### Tier 1 — Immediate (this week)

| Priority | Finding | Action |
|----------|---------|--------|
| 1 | T-1 | Run `npm audit fix` to patch minimatch |
| 2 | S-1 | Verify host ownership check in `playerContext.ts` |
| 3 | S-2 | Throw on startup if JWT_SECRET missing in production |
| 4 | F-1, F-2 | Centralize event listener cleanup on room exit |
| 5 | F-3 | Clear all reveal timeouts before clearing the Map |

### Tier 2 — Short term (this sprint)

| Priority | Finding | Action |
|----------|---------|--------|
| 6 | F-4 | Escape i18n interpolation parameters |
| 7 | B-1 | Return structured result from `saveGameResult()` |
| 8 | S-3 | Add CSRF token validation for REST state changes |
| 9 | S-4 | Replace SHA-256 admin auth with bcrypt |
| 10 | S-5 | Reduce room enumeration rate limit to 5-10/min |
| 11 | B-4 | Atomize timer resume check-and-delete with Lua |
| 12 | S-6 | Add `pcall()` error handling in Lua JSON decode |

### Tier 3 — Medium term (this quarter)

| Priority | Finding | Action |
|----------|---------|--------|
| 13 | T-2 | Raise coverage thresholds; add infrastructure integration tests |
| 14 | T-4 | Create shared test factory utilities |
| 15 | T-5 | Add Playwright global setup/teardown for Redis cleanup |
| 16 | B-2 | Hard-cap TTL refresh debounce map |
| 17 | F-5 | Validate server array lengths against BOARD_SIZE |
| 18 | S-10 | Extend sanitizer to strip Unicode control characters |
| 19 | F-6 | Simplify role-change state machine |
| 20 | T-7 | Enable `noPropertyAccessFromIndexSignature` |

### Tier 4 — Low priority / style

B-7, B-8, B-9, F-10, F-11, F-12, F-13, S-11, S-12, S-13, T-8, T-9, T-10

---

## Positive Observations

The codebase demonstrates strong engineering practices:

- **Typed error hierarchy** (`GameError` → `PlayerError`, `RoomError`, etc.) with safe client sanitization
- **Zod validation at all entry points** — socket events, REST params, Redis data parsing
- **Lua scripts for atomic Redis operations** — prevents race conditions in game state mutations
- **Context handler pattern** — centralized validation, rate limiting, and player resolution pipeline
- **Reactive frontend store** with batch updates and proxy-based change detection
- **Comprehensive test suite** — 129 suites, 3 595 tests, covering services, handlers, validators, frontend, and security (ReDoS regression tests)
- **Defense-in-depth** — Lua scripts re-validate bounds even though JS layer already checks
- **Safe emission** — all Socket.io broadcasts wrapped through `safeEmit`

---

*Report generated from full codebase review of Eigennamen Online v4.0.0 at commit `b70cdb2`.*
