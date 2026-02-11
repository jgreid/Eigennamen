# Codebase Review & Development Plan

**Date**: 2026-02-11
**Scope**: Full codebase review — architecture, code quality, security, testing, frontend, infrastructure, and UX
**Version Reviewed**: v2.2.0 (commit 07d06bd)
**Previous Review**: 2026-02-09 (Tiers 1-3 completed)

---

## Executive Summary

Codenames Online (Die Eigennamen) is a **mature, production-ready** multiplayer web application with strong engineering fundamentals. This review — conducted after multiple hardening rounds — confirms zero critical vulnerabilities, 2,308 passing backend tests, 303 frontend tests, 53 E2E tests, and well-structured TypeScript with strict compilation.

This fresh review identifies **19 actionable improvements** organized into 3 priority tiers, focused on: type safety hardening, frontend modularity, testing completeness, performance optimization, and documentation accuracy.

### Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Type Safety | 10/10 | Zero `any` types, strict TS compilation, comprehensive Zod schemas |
| Security | 9/10 | Defense-in-depth: CSRF, rate limiting, Zod validation, Helmet, audit logging |
| Backend Testing | 9/10 | 2,308 tests across 77 suites, 94%+ coverage |
| Architecture | 9/10 | Clean service layer, atomic Lua ops, handler pattern, graceful degradation |
| Frontend Testing | 7/10 | 303 tests covering utils, state, board, rendering |
| Code Organization | 9/10 | Domain-split config, extracted handlers, modular CSS |
| Infrastructure | 9/10 | Multi-env Docker, Fly.io, CI/CD with 6 quality gates |
| Accessibility | 9/10 | WCAG 2.1 AA: colorblind mode, keyboard nav, ARIA, focus traps |
| Documentation | 8/10 | 15+ docs, 5 ADRs; some directory name inconsistencies and stale counts |

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
- **Context handler pattern**: `contextHandler.ts` provides consistent validation, rate limiting, and player context resolution across all socket handlers
- **Graceful degradation**: PostgreSQL and Redis are both optional; the app falls back cleanly to in-memory storage
- **Typed error hierarchy**: `GameError` base class with specialized `RoomError`, `GameStateError`, `PlayerError`, `ValidationError`, `ServerError` — each with static factory methods
- **Atomic operations**: 6 Redis Lua scripts for critical paths (card reveal, clue giving, turn end, role setting, team switch, host transfer)
- **Safe emission**: `safeEmit.ts` wraps all Socket.io emissions with error handling and metrics
- **Domain-split configuration**: `constants.ts` reduced to a re-export hub; logic split across `gameConfig.ts`, `rateLimits.ts`, `socketConfig.ts`, `errorCodes.ts`, `securityConfig.ts`, `roomConfig.ts`
- **Extracted socket utilities**: `connectionTracker.ts`, `disconnectHandler.ts`, `playerContext.ts` extracted from monolithic socket/index.ts

### 1.2 Remaining Issues

**A1. `gameService.ts` Zod schemas use `.passthrough()` reducing type safety**
- File: `server/src/services/gameService.ts`
- The `gameStateSchema` validates presence of `id` but allows any other fields through
- Risk: Corrupted or incomplete game state from Redis could cause runtime errors during operations
- **Recommendation**: Replace `.passthrough()` with explicit field validation for critical game state properties

**A2. `multiplayer.js` is 1,922 lines handling too many concerns**
- File: `server/public/js/modules/multiplayer.js`
- Handles: room creation/joining, player list management, nickname editing, forfeit confirmation, spectator join requests
- **Recommendation**: Split into focused submodules (rooms.js, playerList.js, spectators.js)

**A3. Redis transaction pattern in gameService uses watch/unwatch instead of Lua**
- The optimistic locking pattern with watch/unwatch requires multiple Redis round trips
- Other critical operations (card reveal, clue) already use Lua scripts
- **Recommendation**: Migrate remaining watch/unwatch patterns to Lua scripts for consistency and performance

---

## 2. Code Quality Findings

### 2.1 Strengths

- Zero `any` types across the entire TypeScript codebase
- Consistent use of Zod schemas for input validation at all entry points
- Clean error code system with `SCREAMING_SNAKE_CASE` conventions
- ESLint 9 flat config with zero warnings enforced in CI
- TypeScript strict mode with `noUncheckedIndexedAccess`, `noImplicitReturns`, `useUnknownCatchVariables`
- Domain-separated constants with clean re-export pattern
- Reusable Zod schema builders (`createSanitizedString`, `createTeamNameSchema`)

### 2.2 Issues

**C1. No timeout wrappers on some Redis Lua script executions**
- Some service calls to Redis Lua scripts lack timeout protection
- A slow or unresponsive Redis could cause indefinite hangs
- **Recommendation**: Wrap all Redis Lua calls with `withTimeout()` utility

**C2. Session token not rotated on use**
- Reconnection tokens have a 5-minute TTL (good), but are not rotated when used
- Token remains valid for the full TTL window regardless of usage
- **Recommendation**: Rotate tokens on successful reconnection to minimize hijacking window

**C3. State debug logging in frontend impacts performance**
- `state.js` emits `console.log('%c[State]')` on every state mutation
- Could cause performance degradation with frequent state updates
- **Recommendation**: Gate debug logging behind a `DEBUG` flag or localStorage setting

---

## 3. Security Findings

### 3.1 Strengths (All Maintained)

- Input validation via Zod at all socket and REST entry points with Unicode-aware regex
- Rate limiting per-event with LRU eviction and in-memory fallback
- CSRF protection via `X-Requested-With` header + origin validation; violations audit-logged
- Session security: 8h age limits, IP consistency enforcement, atomic token rotation
- JWT hardening: production rejects dev secrets, enforces minimum secret length
- Helmet.js with enhanced CSP, HSTS, X-Frame-Options, Referrer-Policy
- Spymaster data protection: `getGameStateForPlayer()` strips card types
- NFKC Unicode normalization for clue validation
- Distributed locks for concurrent operations
- Audit logging with severity levels and in-memory fallback
- Non-root Docker user

### 3.2 Remaining Items

**S1. No Subresource Integrity (SRI) for vendored JS**
- Files: `server/public/js/socket.io.min.js`, `server/public/js/qrcode.min.js`
- Vendored copies without integrity hashes
- **Recommendation**: Add SRI hashes in script tags (low priority)

**S2. Admin dashboard has minimal frontend accessibility**
- `admin.html` lacks skip link and some color contrast in badge elements
- **Recommendation**: Add skip link and review contrast ratios

**S3. IP validation disabled by default**
- `ALLOW_IP_MISMATCH` defaults to true, weakening session security
- **Recommendation**: Document security implications; consider defaulting to false in production

---

## 4. Testing Findings

### 4.1 Backend Testing (Strong)

| Metric | Value |
|--------|-------|
| Test Suites | 77 passing |
| Total Tests | 2,308 passing |
| Frontend Suites | 4 passing |
| Frontend Tests | 303 passing |
| E2E Tests | 53 (7 spec files) |
| Execution Time | ~55 seconds (backend) |

**Strengths:**
- Comprehensive service and handler test coverage
- Integration tests for full game flow, race conditions, timer operations
- Good mocking patterns with reusable helpers (`mocks.ts`, `socketTestHelper.ts`)
- Edge cases covered: Unicode clues, concurrent modifications, Redis failures
- Extended test files for branch and edge-case coverage
- Frontend tests cover state management, board rendering, utilities, and rendering logic

### 4.2 Issues

**T1. No multiplayer E2E tests**
- E2E suite covers standalone game flow, accessibility, and timer
- Missing: room create → join → play → reconnect flow
- **Recommendation**: Add Playwright multiplayer E2E tests using dual browser contexts

**T2. No chaos/resilience testing**
- No tests for deliberate Redis/network failures during operations
- Graceful degradation is coded but not systematically tested
- **Recommendation**: Add resilience tests that simulate Redis disconnection mid-operation

**T3. Frontend tests use re-implementations instead of module imports**
- Frontend test files re-implement source functions rather than importing ES modules
- Increases maintenance burden if source changes
- **Recommendation**: Consider using module bundler for test imports or add sync verification

---

## 5. Frontend Findings

### 5.1 Strengths

- **Modular ES6 architecture**: 15 well-separated modules with clear responsibilities
- **Event delegation**: Centralized `data-action` pattern in `app.js` (no inline handlers)
- **Accessibility**: Skip link, ARIA live regions, keyboard shortcuts (n/e/s/m/h/?), colorblind SVG patterns, screen reader announcements
- **Semantic HTML**: Proper landmarks (`<main>`, `<aside>`, `<header>`), grid roles
- **PWA support**: Manifest, service worker, mobile web app meta tags
- **CSS architecture**: Design tokens in `variables.css`, 8 modular stylesheets, WCAG AA contrast
- **Glassmorphism design**: Backdrop-filter with proper webkit prefix and fallback
- **Responsive design**: Mobile-first with breakpoints at 1024px, 768px, 480px
- **i18n**: 4 complete languages (EN, DE, ES, FR) with localized word lists

### 5.2 Issues

**F1. Chat UI not implemented on frontend**
- Backend supports team chat and spectator chat via `chatHandlers.ts`
- `socket-client.js` has event listeners for `chat:message` and `chat:spectatorMessage`
- No visible chat UI in the frontend
- **Recommendation**: Implement chat panel with team/spectator tabs

**F2. Incomplete i18n markup in HTML**
- Some user-facing strings are hardcoded English without `data-i18n` attributes
- Examples: some modal titles, "Share Game" panel heading
- **Recommendation**: Audit all hardcoded English strings and mark with `data-i18n`

**F3. No plural form support in i18n system**
- Translation system supports `{{variable}}` interpolation
- Missing plural rules (e.g., "1 card" vs "2 cards")
- **Recommendation**: Add basic plural support to `i18n.js` (low priority)

**F4. Admin dashboard uses inline CSS/JS**
- `admin.html` has all styles and scripts inline
- Harder to maintain and test
- **Recommendation**: Extract to separate files if admin dashboard grows (low priority)

---

## 6. Infrastructure Findings

### 6.1 Strengths

- **CI/CD**: GitHub Actions with 6 quality gates: test (Node 20/22 matrix), typecheck, lint (zero warnings), security audit, Docker build verification, E2E tests
- **CodeQL**: Weekly security scanning with extended rule set
- **Docker**: Multi-stage build, non-root user, health checks, optimized layer caching
- **Docker Compose**: 3-service stack (API, PostgreSQL 15, Redis 7) with health checks and dependency ordering
- **Deployment**: Fly.io with WebSocket-aware config, force HTTPS, auto-scaling, graceful stop
- **Scripts**: `dev-setup.sh`, `health-check.sh`, `pre-deploy-check.sh`, `redis-inspect.sh`
- **Load testing**: k6 scripts for HTTP API and WebSocket load testing
- **Staging environment**: Documented in DEPLOYMENT.md
- **Database backups**: Documented strategy for PostgreSQL and Redis

### 6.2 Issues

**I1. No automated performance regression testing in CI**
- Performance targets exist (1,000 rooms, 5,000 connections, <40ms reveal)
- k6 scripts exist but not integrated into CI
- **Recommendation**: Add scheduled CI job running k6 tests against staging

**I2. No CHANGELOG.md**
- Project has 200+ commits but no structured changelog
- ROADMAP.md partially serves this purpose
- **Recommendation**: Add CHANGELOG.md following Keep a Changelog format

**I3. Documentation references stale directory name "Risley-Codenames"**
- Several docs reference `Risley-Codenames/` as the root directory name
- Actual repository is `Eigennamen`
- **Recommendation**: Update all directory references to match actual repo name

---

## 7. Development Plan

### Tier 1: Quick Wins (Previously Completed — Maintained)

All 8 items from the previous Tier 1 remain completed and verified:
- Magic numbers moved to constants ✅
- Safe JSON parsing utility (already existed) ✅
- Redis key centralization (already existed) ✅
- Reusable Zod schema builders ✅
- Token length validation (already existed) ✅
- Socket test interval leak fix ✅
- ts-jest deprecation fix ✅
- Skipped eviction test fix ✅

### Tier 2: Previously Completed — Maintained

All 6 items from the previous Tier 2 remain completed and verified:
- constants.ts domain split ✅
- authenticateSocket() refactored ✅
- Connection tracker + disconnect handler extracted ✅
- Frontend unit tests (303 tests) ✅
- Focus trap strengthened ✅
- Board render paths audited ✅

### Tier 3: Previously Completed — Maintained

All items from the previous Tier 3 remain completed and verified:
- setState() documented ✅
- Retry logic (already robust) ✅
- Loading states added ✅
- Staging environment documented ✅
- Database backup strategy documented ✅
- Docker image optimized ✅

### New Tier A: High Priority Improvements

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| A1 | Harden game state validation | Replace `.passthrough()` with explicit Zod fields in gameService | Low |
| C1 | Add timeout wrappers for Lua calls | Wrap all Redis Lua script executions with `withTimeout()` | Low |
| S3 | Document IP validation defaults | Document `ALLOW_IP_MISMATCH` security implications | Low |
| I3 | Fix documentation directory references | Update all "Risley-Codenames" → "Eigennamen" references | Low |

### New Tier B: Medium Priority Improvements

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| T1 | Add multiplayer E2E tests | Playwright tests for room create → join → play → reconnect | Medium |
| F1 | Implement chat UI | Frontend chat panel with team/spectator tabs | Medium |
| F2 | Complete i18n markup | Audit and mark all hardcoded English strings | Medium |
| C2 | Implement token rotation on use | Rotate reconnection tokens after successful reconnection | Low |
| C3 | Gate frontend debug logging | Make state.js debug logging conditional on config | Low |
| I2 | Add CHANGELOG.md | Structured changelog following Keep a Changelog format | Low |

### New Tier C: Lower Priority / Future Work

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| A2 | Split multiplayer.js | Decompose 1,922-line file into focused submodules | Medium |
| A3 | Migrate to Lua for all transactions | Replace watch/unwatch patterns with Lua scripts | Medium |
| T2 | Add chaos/resilience testing | Simulate Redis failures during operations | Medium |
| T3 | Improve frontend test imports | Use module bundler for ES module imports in tests | Low |
| S1 | Add SRI hashes for vendored JS | Subresource Integrity for socket.io and qrcode libs | Low |
| S2 | Improve admin dashboard a11y | Add skip link, review contrast ratios | Low |
| F3 | Add i18n plural support | Basic plural form handling in i18n.js | Low |
| F4 | Extract admin inline CSS/JS | Separate admin dashboard styles and scripts | Low |
| I1 | Automated perf regression tests | Schedule k6 load tests in CI | Medium |

---

## Appendix A: File Size Inventory

Files over 500 lines (current state after all refactoring):

| File | Lines | Status |
|------|-------|--------|
| `server/public/js/modules/multiplayer.js` | 1,922 | Consider splitting (Tier C) |
| `server/src/services/gameService.ts` | 1,573 | Acceptable — core domain logic |
| `server/src/services/playerService.ts` | 1,119 | Acceptable — consider future split |
| `server/public/js/socket-client.js` | 1,019 | Acceptable — WebSocket communication |
| `server/src/services/gameHistoryService.ts` | 739 | Acceptable — single responsibility |
| `server/public/js/modules/game.js` | 736 | Acceptable — game logic |
| `server/public/js/modules/app.js` | 644 | Acceptable — app orchestration |
| `index.html` | ~625 | Acceptable — SPA entry point |
| `server/src/middleware/socketAuth.ts` | 593 | Refactored — composable functions |
| `server/src/services/roomService.ts` | 534 | Acceptable — clean service |
| `server/public/js/modules/ui.js` | 534 | Acceptable — UI rendering |
| `server/src/services/timerService.ts` | 503 | Acceptable — clean service |
| `server/public/js/modules/history.js` | 503 | Acceptable — replay system |
| `server/public/js/modules/roles.js` | 499 | Acceptable — role management |

## Appendix B: Test Suite Health

```
Backend:  77 suites passing | 2,308 tests passing
Frontend: 4 suites passing  | 303 tests passing
E2E:      7 spec files | 53+ tests (Playwright + Chromium)

Total:    ~2,664 tests passing

Known issues:
- timing.test.ts: 3 flaky memory monitoring tests (pass in isolation)
```

## Appendix C: Dependency Audit

Key dependencies and their status:

| Package | Version | Notes |
|---------|---------|-------|
| express | 4.18.2 | Stable; Express 5.x available for future upgrade |
| socket.io | 4.7.2 | Current stable WebSocket transport |
| typescript | 5.3.3 | 5.7+ available; consider upgrading |
| @prisma/client | 5.6.0 | Stable ORM |
| zod | 3.22.4 | 3.24+ available; minor improvements |
| jest | 29.7.0 | Current stable |
| helmet | 7.1.0 | Current stable |
| playwright | 1.58+ | Current stable for E2E |
| eslint | 9.x | Flat config migration complete |

**Recommendation**: Run `npm outdated` periodically and upgrade minor/patch versions. Major upgrades (especially Express 5.x) should be done in a dedicated branch with full test validation.
