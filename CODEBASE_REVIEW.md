# Codebase Review & Development Plan

**Date**: 2026-02-09
**Scope**: Full codebase review - architecture, code quality, security, testing, infrastructure, and UX
**Version Reviewed**: v2.4.0 (commit 9a6d456)

---

## Executive Summary

Codenames Online is a **mature, production-ready** multiplayer web application with strong engineering fundamentals. The review found zero critical vulnerabilities, 2,980 passing backend tests (94%+ coverage), and well-structured TypeScript with zero `any` types. The codebase has already undergone multiple hardening rounds (documented in `HARDENING_PLAN.md` and `FUTURE_PLAN.md`).

This review identifies **27 actionable improvements** across 6 categories, organized into 4 priority tiers. The improvements focus on code maintainability, frontend test coverage, developer experience, and architectural refinements that will support the feature roadmap outlined in `ROADMAP.md`.

### Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Type Safety | 10/10 | Zero `any` types, comprehensive interfaces |
| Security | 9/10 | Defense-in-depth, all OWASP top 10 addressed |
| Backend Testing | 9/10 | 2,980 tests, 94%+ coverage, integration tests |
| Architecture | 8/10 | Clean service layer, minor file-size concerns |
| Frontend Testing | 4/10 | Only 36 tests; modules like state/board/game untested |
| Code Organization | 7/10 | Good patterns, but large files need splitting |
| Infrastructure | 8/10 | Solid CI/CD, Docker, Fly.io deployment |
| Accessibility | 8/10 | Colorblind mode, ARIA, keyboard nav; focus trapping gaps |
| Documentation | 8/10 | Excellent project docs; inline code comments sparse |

---

## Table of Contents

1. [Architecture Findings](#1-architecture-findings)
2. [Code Quality Findings](#2-code-quality-findings)
3. [Security Findings](#3-security-findings)
4. [Testing Findings](#4-testing-findings)
5. [Frontend Findings](#5-frontend-findings)
6. [Infrastructure Findings](#6-infrastructure-findings)
7. [Development Plan](#7-development-plan)

---

## 1. Architecture Findings

### 1.1 Strengths

- **Service layer isolation**: All business logic in `/server/src/services/`, handlers only delegate
- **Context handler pattern**: `contextHandler.ts` provides consistent validation, rate limiting, and player context resolution across all socket handlers - eliminates boilerplate
- **Graceful degradation**: PostgreSQL and Redis are both optional; the app falls back cleanly to in-memory storage
- **Typed error hierarchy**: `GameError` base class with specialized `RoomError`, `GameStateError`, `PlayerError`, `ValidationError`, `ServerError` - each with static factory methods
- **Atomic operations**: Redis Lua scripts for critical paths (team switching, reconnection tokens, card reveals)
- **Safe emission**: `safeEmit.ts` wraps all Socket.io emissions with error handling and metrics

### 1.2 Issues

**A1. `constants.ts` has grown to 19KB and mixes unrelated domains**
- File: `server/src/config/constants.ts`
- Contains board config, rate limits, socket timeouts, game modes, duet rules, error codes, and room settings all in one file
- Navigating and maintaining this file is increasingly difficult
- **Recommendation**: Split into domain-specific files: `gameConfig.ts`, `rateLimits.ts`, `socketConfig.ts`, `errorCodes.ts`

**A2. `socketAuth.ts` authenticateSocket() is 169 lines with 5+ nesting levels**
- File: `server/src/middleware/socketAuth.ts:416-585`
- Performs session validation, reconnection token verification, JWT validation, IP checking, and origin validation in one function
- **Recommendation**: Extract into composable middleware: `validateSession()`, `validateReconnectionToken()`, `validateOrigin()`, `validateJwt()`

**A3. `socket/index.ts` is 743 lines mixing setup, lifecycle, and cleanup**
- File: `server/src/socket/index.ts`
- Handles initialization, connection tracking, IP limiting, disconnect grace periods, host transfer, and shutdown - all in one file
- **Recommendation**: Extract `connectionTracker.ts` and `disconnectHandler.ts`

**A4. Magic numbers scattered outside constants**
- `30000` ms timeout in `socket/index.ts` disconnect handler
- `60000` ms cleanup interval in `socketAuth.ts`
- `5000` ms socket count cache in `app.ts`
- **Recommendation**: Move all to `constants.ts` (or the new split files)

---

## 2. Code Quality Findings

### 2.1 Strengths

- Zero `any` types across the entire TypeScript codebase
- Consistent use of Zod schemas for input validation at all entry points
- Clean error code system with `SCREAMING_SNAKE_CASE` conventions
- Good use of TypeScript interfaces exported from `/types/`
- ESLint configured with strict rules, CI enforces zero warnings

### 2.2 Issues

**C1. JSON.stringify/parse used 9+ times in gameService.ts without error handling**
- File: `server/src/services/gameService.ts`
- Corrupted Redis data would cause unhandled JSON parse errors
- **Recommendation**: Create `safeJsonParse()` utility that returns `null` on failure (pattern already used in some places)

**C2. Redis key prefix strings duplicated across services**
- Pattern `room:${roomCode}:game`, `player:${sessionId}`, etc. scattered through multiple service files
- **Recommendation**: Centralize in a `redisKeys.ts` utility module:
  ```typescript
  export const redisKeys = {
    game: (roomCode: string) => `room:${roomCode}:game`,
    player: (sessionId: string) => `player:${sessionId}`,
    // ...
  };
  ```

**C3. Team name validation logic duplicated in Zod schemas**
- File: `server/src/validators/schemas.ts`
- The `removeControlChars()` + `.refine()` + Unicode regex pattern is repeated for nickname, room code, and clue schemas
- **Recommendation**: Extract a reusable `sanitizedString(maxLength)` Zod schema builder

**C4. eventLogService.ts is a 61-line stub kept only for test compatibility**
- File: `server/src/services/eventLogService.ts`
- Service was superseded but kept as dead code
- **Recommendation**: Remove and update any tests that reference it

**C5. Mixed module systems in migration**
- Some files use `require()` alongside ES6 `import`; `module.exports` alongside `export`
- **Recommendation**: Complete the ES module migration in a dedicated pass

---

## 3. Security Findings

### 3.1 Strengths (Maintain These)

- Input validation via Zod at all socket and REST entry points with Unicode-aware regex
- Rate limiting per-event with LRU eviction and in-memory fallback when Redis unavailable
- CSRF protection via `X-Requested-With` header + origin validation; violations audit-logged
- Session security: age limits (8h), IP consistency enforcement (default deny), atomic token rotation
- JWT hardening: production rejects dev secrets, enforces minimum secret length, validates claims
- Helmet.js with enhanced CSP, HSTS, X-Frame-Options
- Spymaster data protection: `getGameStateForPlayer()` strips card types for non-spymaster players
- DOM-based rendering (no innerHTML) after H1 hardening

### 3.2 Remaining Items

**S1. Reconnection token format validation order**
- File: `server/src/middleware/socketAuth.ts`
- Regex `/^[0-9a-f]+$/i` validates format but doesn't check length first
- A very long string passes the regex but wastes processing time
- **Recommendation**: Check `token.length === 64` before regex validation

**S2. No Subresource Integrity (SRI) for vendored JS**
- Files: `server/public/js/socket.io.min.js`, `server/public/js/qrcode.min.js`
- These are vendored copies without integrity hashes
- **Recommendation**: Add SRI hashes in `index.html` script tags (low priority, already noted in ROADMAP)

---

## 4. Testing Findings

### 4.1 Backend Testing (Strong)

| Metric | Value |
|--------|-------|
| Test Suites | 91 passing, 1 skipped |
| Total Tests | 2,980 passing, 14 skipped |
| Coverage | 94%+ |
| Execution Time | ~85 seconds |

**Strengths:**
- Comprehensive service and handler test coverage
- Integration tests for full game flow, race conditions, timer operations
- Good mocking patterns with `jest.mock()`
- Edge cases covered: Unicode clues, concurrent modifications, Redis failures

**Issues:**

**T1. 3 test timeouts in socketIndexComprehensive.test.ts**
- File: `server/src/__tests__/socketIndexComprehensive.test.ts:561, 584, 600`
- Root cause: `setInterval` at `socket/index.ts:287` (connections cleanup) not cleared in test teardown
- Tests pass individually but timeout in full suite due to leaked intervals
- **Recommendation**: Export a `cleanup()` function from socket/index.ts and call it in test `afterAll`

**T2. ts-jest deprecation warning**
- Jest config uses `isolatedModules: true` in ts-jest transform options
- Warning suggests moving to `tsconfig.json`
- **Recommendation**: Move `isolatedModules` config to tsconfig.json per ts-jest migration guide

**T3. memoryStorageEviction.test.ts permanently skipped**
- Timer cleanup issue in eviction tests; doesn't affect production
- **Recommendation**: Fix or remove to keep test suite clean

### 4.2 Frontend Testing (Critical Gap)

| Metric | Value |
|--------|-------|
| Test Suites | 1 (rendering.test.ts) |
| Total Tests | 36 |
| Coverage | Minimal - only escapeHTML, rendering XSS, URL encoding |

**T4. 15 frontend modules with ~4,800 lines have near-zero test coverage:**

| Module | Lines | Test Coverage | Risk |
|--------|-------|---------------|------|
| `state.js` | ~397 | None | High - central state management |
| `game.js` | ~300+ | None | High - game flow logic |
| `board.js` | ~200+ | None | High - rendering, keyboard nav |
| `multiplayer.js` | ~200+ | None | High - socket integration |
| `ui.js` | ~150+ | Partial (escapeHTML only) | Medium |
| `utils.js` | ~150+ | Partial (URL encoding only) | **Critical** - seeded PRNG must match server |
| `timer.js` | ~100+ | None | Medium |
| `accessibility.js` | ~100+ | None | Medium |
| `settings.js` | ~100+ | None | Low |
| `roles.js` | ~100+ | None | Medium |
| `chat.js` | ~100+ | None | Low |
| `notifications.js` | ~100+ | None | Low |
| `history.js` | ~100+ | None | Medium |
| `i18n.js` | ~100+ | None | Low |
| `constants.js` | ~50 | None | Low |

**Highest risk untested code:**
1. **Seeded PRNG** (`utils.js`) - Must produce identical output to server's Mulberry32; any divergence breaks standalone mode
2. **State management** (`state.js`) - All modules depend on state correctness
3. **Game flow** (`game.js`) - Core card reveal logic, turn management
4. **Board rendering** (`board.js`) - DOM construction, keyboard navigation

### 4.3 E2E Testing

- 53 Playwright E2E tests passing
- CI runs E2E on every PR with Chromium
- **Gap**: No E2E tests for multiplayer flows (room create -> join -> play -> reconnect)

---

## 5. Frontend Findings

### 5.1 Strengths

- **Modular ES6 architecture**: 15 well-separated modules with clear responsibilities
- **Event delegation**: Centralized `data-action` pattern in `app.js` (no inline handlers)
- **Accessibility**: Skip link, ARIA live regions, keyboard shortcuts, colorblind patterns with SVG, screen reader announcements
- **Semantic HTML**: Proper `<main>`, `<aside>`, `<header>`, `role="grid"`, `role="gridcell"`
- **PWA support**: Manifest, apple-touch-icon, mobile web app meta tags
- **CSS architecture**: Design tokens in `variables.css`, modular stylesheets, WCAG AA contrast targets

### 5.2 Issues

**F1. State object is a large mutable singleton without change tracking**
- File: `server/public/js/modules/state.js`
- Direct mutation throughout codebase: `state.gameState.currentTurn = value`
- `setState()` helper exists but isn't consistently used
- **Recommendation**: Enforce `setState()` usage for all mutations to enable debugging and future reactivity

**F2. Error recovery is limited to showing error messages**
- Most errors show a toast or modal and require manual refresh
- Network reconnection exists but game state errors have no retry mechanism
- **Recommendation**: Add retry logic for transient errors (socket reconnection already handles network; extend to game state re-sync)

**F3. Focus management gaps in modal stack**
- File: `server/public/js/modules/ui.js`
- Modal stack exists (Phase 2 hardening), but focus trapping within modals is basic
- Tab can escape the modal to background elements
- **Recommendation**: Implement proper focus trap (first/last focusable element cycling)

**F4. Board re-renders full DOM on each card reveal**
- File: `server/public/js/modules/board.js`
- Incremental update system exists but the full render path is still used in some flows
- **Recommendation**: Audit all render paths to ensure incremental updates are used consistently

**F5. No loading/skeleton states**
- Room join, game start, and reconnection have no visual feedback beyond the reconnection overlay
- **Recommendation**: Add loading indicators for async operations (room join, word list loading)

---

## 6. Infrastructure Findings

### 6.1 Strengths

- **CI/CD**: GitHub Actions with Node 20/22 matrix, lint (zero warnings), security audit, Docker build verification, E2E tests
- **Docker**: 3-service compose (API, PostgreSQL, Redis) with health checks and dependency ordering
- **Deployment**: Fly.io with WebSocket-aware config, force HTTPS, health checks, auto-scaling
- **Database**: Clean Prisma schema with 5 models, proper indexes, cascade deletes, direct URL for migrations
- **Scripts**: dev-setup.sh, health-check.sh, pre-deploy-check.sh, redis-inspect.sh

### 6.2 Issues

**I1. No staging environment documented**
- Deployment goes directly from local Docker to production Fly.io
- Database migrations not tested in staging first
- **Recommendation**: Document staging deployment process (or add Fly.io staging app)

**I2. No automated performance regression testing**
- Performance targets exist in ROADMAP.md (1,000 rooms, 5,000 connections, <40ms reveal)
- No automated tests validate these targets
- **Recommendation**: Add k6 or Artillery load tests to CI (can run on schedule, not every PR)

**I3. No database backup strategy documented**
- PostgreSQL is used for word lists and optional user data
- No backup/restore procedures documented
- **Recommendation**: Document backup strategy (even if simple: `pg_dump` cron or Fly.io managed backups)

**I4. Docker image could be optimized**
- No evidence of multi-stage build to reduce image size
- **Recommendation**: Use multi-stage Dockerfile (build stage with dev deps, production stage with only runtime)

---

## 7. Development Plan

### Tier 1: Quick Wins (1-2 days each)

These items improve code health with minimal risk.

| ID | Task | Files Affected | Effort |
|----|------|----------------|--------|
| A4 | Move magic numbers to constants | `socket/index.ts`, `socketAuth.ts`, `app.ts` | 1h |
| C1 | Create `safeJsonParse()` utility | `gameService.ts`, new `utils/json.ts` | 2h |
| C2 | Centralize Redis key patterns in `redisKeys.ts` | All services | 3h |
| C3 | Extract reusable Zod schema builders | `validators/schemas.ts` | 2h |
| C4 | Remove dead `eventLogService.ts` stub | `eventLogService.ts`, affected tests | 1h |
| S1 | Add length check before reconnection token regex | `socketAuth.ts` | 30m |
| T1 | Fix socket test interval leak | `socketIndexComprehensive.test.ts`, `socket/index.ts` | 2h |
| T2 | Fix ts-jest deprecation warning | `jest.config.ts.js`, `tsconfig.json` | 30m |
| T3 | Fix or remove skipped eviction test | `memoryStorageEviction.test.ts` | 1h |

### Tier 2: Important Improvements (1-2 weeks)

These items address the most significant gaps found in this review.

| ID | Task | Files Affected | Effort |
|----|------|----------------|--------|
| **T4** | **Add frontend unit tests for critical modules** | New test files | **5 days** |
| | - `utils.test.js`: Seeded PRNG determinism (match server output) | | |
| | - `state.test.js`: setState, getStateSnapshot, initialization | | |
| | - `game.test.js`: Card reveal logic, turn management, win conditions | | |
| | - `board.test.js`: DOM construction, keyboard navigation, incremental updates | | |
| | - `multiplayer.test.js`: Socket event handling, abort/reconnection | | |
| A1 | Split `constants.ts` into domain files | `config/` directory | 3h |
| A2 | Refactor `authenticateSocket()` into composable functions | `socketAuth.ts` | 4h |
| A3 | Extract connection tracker and disconnect handler | `socket/index.ts` | 4h |
| F3 | Implement proper focus trap in modals | `ui.js` | 3h |
| F4 | Audit and fix inconsistent board render paths | `board.js`, `game.js` | 3h |

### Tier 3: Architectural Improvements (2-4 weeks)

These items improve long-term maintainability and developer experience.

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| C5 | Complete ES module migration | Remove all `require()`/`module.exports` | 2 days |
| F1 | Enforce `setState()` for all state mutations | Add ESLint rule or code review convention | 1 day |
| F2 | Add retry logic for transient game state errors | `multiplayer.js`, `game.js` | 2 days |
| F5 | Add loading/skeleton states for async operations | `ui.js`, `multiplayer.js`, CSS | 2 days |
| I1 | Document and create staging environment | `docs/DEPLOYMENT.md`, Fly.io config | 1 day |
| I3 | Document database backup strategy | `docs/DEPLOYMENT.md` | 2h |
| I4 | Optimize Docker image with multi-stage build | `Dockerfile` | 3h |
| E2E | Add multiplayer E2E tests | `tests/e2e/multiplayer.spec.ts` | 3 days |

### Tier 4: Future Enhancements (Aligns with ROADMAP.md)

These are the larger feature initiatives already tracked in `ROADMAP.md` and `FUTURE_PLAN.md`, with additional context from this review.

| Feature | Review Notes | Pre-requisites |
|---------|-------------|----------------|
| **Internationalization** (ROADMAP Phase 1) | i18n.js module exists with EN/DE/ES/FR setup; needs localized word lists and full UI string extraction | Tier 2 frontend tests for regression safety |
| **WCAG 2.1 AA Compliance** (ROADMAP Phase 3) | Good foundation (colorblind mode, ARIA, keyboard nav); gaps in focus trapping (F3) and contrast audit | Fix F3 first |
| **Game Modes** (ROADMAP Phase 4) | Duet mode config exists in constants.ts; blitz and 3-team modes need new game flow logic | Tier 2 frontend tests, A1 constants split |
| **Performance testing** (ROADMAP) | No automated load tests; targets defined but unvalidated | I2 load test framework |
| **Observability** (FUTURE Phase 5) | Winston logging in place; no distributed tracing | OpenTelemetry integration |
| **Horizontal scaling** (FUTURE Phase 5) | Redis Pub/Sub adapter configured; untested multi-instance | I2 load tests, staging environment |

---

## Appendix A: File Size Inventory (Potential Refactoring Targets)

Files over 500 lines that may benefit from splitting:

| File | Lines | Suggestion |
|------|-------|------------|
| `server/src/services/gameService.ts` | 1,573 | Acceptable - core domain logic, well-organized |
| `server/src/services/playerService.ts` | 1,119 | Consider extracting authentication logic |
| `server/src/socket/index.ts` | 743 | Extract connection tracking and disconnect handling |
| `server/src/services/gameHistoryService.ts` | 739 | Acceptable - single responsibility |
| `index.html` | 625 | Acceptable - SPA entry point |
| `server/src/middleware/socketAuth.ts` | 593 | Refactor authenticateSocket() into composable functions |
| `server/src/services/roomService.ts` | 534 | Acceptable - clean service |
| `server/src/services/timerService.ts` | 503 | Acceptable - clean service |

## Appendix B: Test Suite Health

```
Backend:  91/92 suites passing | 2,980/2,994 tests passing | 14 skipped
Frontend: 1/1 suite passing    | 36/36 tests passing
E2E:      53 passing (Playwright + Chromium)

Known issues:
- socketIndexComprehensive.test.ts: 3 tests timeout from leaked setInterval
- memoryStorageEviction.test.ts: 1 suite skipped (timer cleanup issue)
- timing.test.ts: Flaky in full suite, passes in isolation
```

## Appendix C: Dependency Audit

Key dependencies and their status:

| Package | Version | Latest | Notes |
|---------|---------|--------|-------|
| express | 4.18.2 | Check for 5.x | Major version may have breaking changes |
| socket.io | 4.7.2 | Check for updates | WebSocket transport core |
| typescript | 5.3.3 | 5.7+ available | Consider upgrading for performance |
| @prisma/client | 5.6.0 | Check for updates | ORM |
| zod | 3.22.4 | 3.24+ available | Schema validation |
| jest | 29.7.0 | Current | Test framework |
| helmet | 7.1.0 | Current | Security headers |

**Recommendation**: Run `npm outdated` periodically and upgrade minor/patch versions. Major upgrades (especially Express 5.x) should be done in a dedicated branch with full test validation.
