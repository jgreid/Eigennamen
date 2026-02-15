# Codebase Review & Hardening Development Plan

**Date**: 2026-02-15
**Scope**: Full codebase review of Codenames Online (Eigennamen)
**Version Reviewed**: 2.3.0

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Review Methodology](#2-review-methodology)
3. [Findings by Domain](#3-findings-by-domain)
   - [3.1 Project Structure & Configuration](#31-project-structure--configuration)
   - [3.2 Security](#32-security)
   - [3.3 Backend Services & Business Logic](#33-backend-services--business-logic)
   - [3.4 WebSocket Layer & Middleware](#34-websocket-layer--middleware)
   - [3.5 Frontend](#35-frontend)
   - [3.6 Test Suite](#36-test-suite)
   - [3.7 DevOps & Deployment](#37-devops--deployment)
4. [Consolidated Issue Registry](#4-consolidated-issue-registry)
5. [Development Plan: Hardening Sprints](#5-development-plan-hardening-sprints)
6. [Sprint Details](#6-sprint-details)
7. [Success Metrics](#7-success-metrics)

---

## 1. Executive Summary

### Overall Assessment: PRODUCTION-GRADE (8.5/10)

Codenames Online is a mature, well-engineered multiplayer game server demonstrating professional software engineering practices. The codebase is built on a solid foundation of TypeScript strict mode, comprehensive testing (2,536 tests, 94%+ coverage), defense-in-depth security, and thoughtful architecture with graceful degradation patterns.

### Strengths

| Area | Grade | Highlights |
|------|-------|------------|
| **Project Structure** | A+ | Clean modular design, path aliases, clear separation of concerns |
| **TypeScript Configuration** | A+ | All strict mode flags enabled, multi-config builds |
| **Security** | A | Multi-layer auth, comprehensive validation, CSRF/XSS/SQLi protection |
| **Backend Services** | A | Excellent Lua atomicity, distributed locks, proper error hierarchies |
| **WebSocket Implementation** | A- | Modular handlers, safe emission, connection tracking |
| **DevOps & CI/CD** | A+ | 7-job CI pipeline, Docker multi-stage, container scanning |
| **Testing** | A | 94%+ coverage, chaos/race condition tests, mutation testing |
| **Documentation** | A+ | 6 detailed docs, ADRs, comprehensive CLAUDE.md |
| **Frontend** | B+ | Good modularity, event delegation, WeakMap memory safety |
| **Accessibility** | B | ARIA labels, keyboard nav, but incomplete colorblind mode |

### Key Statistics

- **Backend**: 90 source files, ~12,000 lines of TypeScript
- **Frontend**: 26 TypeScript modules, 8 CSS files (94KB)
- **Tests**: 82 backend suites + 9 E2E specs = 2,536 tests
- **Dependencies**: 14 production, 27 dev (all current major versions)
- **CI Pipeline**: 7 jobs (test, typecheck, lint, security audit, Docker build, Trivy scan, E2E)
- **Zero Critical Vulnerabilities Found**

---

## 2. Review Methodology

Seven parallel deep-dive reviews were conducted across every layer of the codebase:

1. **Project Structure & Configuration** - package.json, tsconfig, ESLint, Jest, Docker, Prisma
2. **Security** - Authentication, authorization, input validation, CSRF, XSS, rate limiting, secrets
3. **Backend Services** - All 7 services + 3 game sub-modules (5,257 LOC)
4. **WebSocket Layer** - Socket setup, handlers, middleware, context/emission patterns
5. **Frontend** - 26 modules, CSS, accessibility, i18n, PWA, performance
6. **Test Suite** - 82 suites, integration/E2E tests, coverage analysis, flakiness
7. **DevOps & Deployment** - Docker, Fly.io, CI/CD, health checks, monitoring, graceful shutdown

Each review examined code quality, error handling, edge cases, race conditions, memory management, and adherence to best practices.

---

## 3. Findings by Domain

### 3.1 Project Structure & Configuration

**Grade: A+**

The project follows a clean, modular architecture with well-defined boundaries. TypeScript is configured with all strict mode flags, and the build system uses separate configs for backend, frontend, and production builds.

**Positive Findings:**
- Multi-config TypeScript setup (tsconfig.json, tsconfig.build.json, tsconfig.frontend.json)
- Path aliases (@config/*, @services/*, etc.) for clean imports
- ESLint 9 flat config with domain-specific rule overrides
- Jest multi-project config (backend node + frontend jsdom)
- esbuild for production frontend bundling with code splitting

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| CFG-1 | Low | `tsconfig.json` excludes only `*.test.ts`, not test helpers - `build:check` fails on helpers | `server/tsconfig.json` |
| CFG-2 | Low | Email field nullable with unique constraint - documented as intentional fix (Issue #66) | `server/prisma/schema.prisma:16` |

---

### 3.2 Security

**Grade: A (8.5/10)**

The security posture is strong with defense-in-depth across every layer. No critical or high vulnerabilities were found.

**Positive Findings:**
- Multi-step socket authentication (origin, IP, session, JWT, mapping)
- Timing-safe password comparison for admin auth (`crypto.timingSafeEqual`)
- Comprehensive Zod validation at all entry points with Unicode awareness
- Multi-layer CSRF protection (custom header + origin/referer validation)
- HTML escaping via `textContent` + `escapeHTML()` - no XSS vectors found
- Parameterized queries via Prisma (no raw SQL), parameterized Redis Lua scripts
- Rate limiting: per-socket + per-IP (3x multiplier) with LRU eviction
- Session hijacking prevention: age validation, IP consistency, connected-session blocking
- Sensitive data redaction in logs (`sanitizeForLog`)
- No hardcoded secrets anywhere in codebase

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| SEC-1 | Low | CSP allows `unsafe-inline` for scripts (required for game inline handlers) | `server/src/app.ts:124` |
| SEC-2 | Low | No token rotation on reconnection - stale tokens have longer exposure window | `middleware/auth/sessionValidator.ts` |
| SEC-3 | Low | Audit log retention policy not documented | `services/auditService.ts` |
| SEC-4 | Low | CORS origin validation documentation could be clearer for multi-domain setups | `server/src/app.ts` |
| SEC-5 | Low | Admin password only validated for length (12+ chars), no complexity enforcement | `server/src/config/env.ts:108` |

---

### 3.3 Backend Services & Business Logic

**Grade: A**

The services layer (5,257 LOC across 12 files) demonstrates excellent architectural patterns with strong atomicity guarantees via Redis Lua scripts, distributed locking, and comprehensive error handling.

**Positive Findings:**
- Lock release with exponential backoff retry (`gameService.ts:85-112`)
- Debounced TTL refresh prevents Redis hammering (`roomService.ts:451-484`)
- Atomic player updates: Lua first, WATCH/MULTI fallback with 3 retries (`playerService.ts:175-264`)
- Scheduled player cleanup via sorted sets with orphan detection (`playerService.ts:697-765`)
- Three-mode Redis support: external, embedded subprocess, in-memory (`redis.ts`)
- Game history lazy-cap at 75% threshold to minimize allocations

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| SVC-1 | Medium | WATCH/MULTI retry loop in `executeGameTransaction` lacks exponential backoff (unlike `updatePlayer`) | `services/game/luaGameOps.ts:158-199` |
| SVC-2 | Medium | Scheduled player cleanup has TOCTOU race between checking `connected` and removing player | `services/playerService.ts:697-765` |
| SVC-3 | Medium | Timer expiration callback created with `setTimeout` but async callback not awaited | `services/timerService.ts:213-216` |
| SVC-4 | Medium | Local timer state mutated before Redis confirmation succeeds | `services/timerService.ts:338-343` |
| SVC-5 | Low | Room status update to 'playing' silently catches failure after game creation | `services/gameService.ts:246-254` |
| SVC-6 | Low | Custom word list silently falls back to default if < 25 words (no user-visible error) | `services/gameService.ts:196-208` |
| SVC-7 | Low | `createGame()` spans 132 lines with multiple responsibilities - could extract word resolution | `services/gameService.ts:132-263` |
| SVC-8 | Low | Orphan cleanup logic duplicated in 3 functions across playerService | `services/playerService.ts` |
| SVC-9 | Low | Audit severity mapping has no default warning for unmapped event types | `services/auditService.ts:178-181` |

---

### 3.4 WebSocket Layer & Middleware

**Grade: A-**

The WebSocket implementation follows a modular architecture with comprehensive security, rate limiting, and error handling. The context handler pattern provides clean validation and player resolution.

**Positive Findings:**
- Connection limit middleware runs BEFORE authentication (proper order)
- Timeout-protected disconnect handler with AbortController (`connectionHandler.ts:124-152`)
- Atomic host transfer with distributed lock and owner-verified release (`disconnectHandler.ts:256-333`)
- Dual-layer rate limiting (per-socket + per-IP) with LRU eviction at 10K entries
- Periodic connection count reconciliation every 5 minutes
- Safe emission with error tracking, batch handling, null safety
- Per-player mutex for spectator room transitions prevents concurrent conflicts

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| WS-1 | Medium | Race condition between player state change in Redis and `syncSocketRooms()` call | `socket/contextHandler.ts:62-63` |
| WS-2 | Medium | Join operation: if `joinRoom()` succeeds but subsequent ops fail, player is in room with incomplete state | `socket/handlers/roomHandlers.ts:210-291` |
| WS-3 | Medium | `Promise.all()` for parallel join operations has no overall timeout wrapper | `socket/handlers/roomHandlers.ts:250-263` |
| WS-4 | Medium | Internal async operations inside disconnect handler lack individual `withTimeout()` wrappers | `socket/disconnectHandler.ts:192-340` |
| WS-5 | Medium | Socket function registration (`ensureSocketFunctionsRegistered`) not wrapped in try-catch | `socket/index.ts:176-177` |
| WS-6 | Low | No explicit `socket.leaveAll()` on disconnect (relies on Socket.io internal cleanup) | `socket/connectionHandler.ts:99` |
| WS-7 | Low | Socket rate limit cleanup could miss entries if `socketKeyIndex` wasn't populated | `socket/rateLimitHandler.ts:203-212` |
| WS-8 | Low | `clearSocketFunctions()` never called during shutdown | `socket/socketFunctionProvider.ts` |
| WS-9 | Low | Chat message length not validated in schema | `socket/handlers/chatHandlers.ts` |
| WS-10 | Low | Game history limit not validated for min value in schema | `socket/handlers/gameHandlers.ts:383-389` |
| WS-11 | Low | Per-player mutex lacks timeout on lock acquisition - could create long chains | `socket/handlers/playerHandlers.ts:74-112` |

---

### 3.5 Frontend

**Grade: B+**

The frontend demonstrates good modularity with 26 TypeScript modules, proper event delegation, and WeakMap usage for memory safety. However, there are memory leak risks, incomplete accessibility features, and limited PWA robustness.

**Positive Findings:**
- Central event delegation on `document.body` (app.ts:50-195)
- WeakMap for toast timers prevents GC blocking (ui.ts:9)
- HTML escaping via `textContent` + `escapeHTML()` throughout
- 4-language i18n support with browser language detection
- 37 `data-testid` attributes for stable E2E selectors
- Validated server data before state mutation with bounds checking

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| FE-1 | High | `window.addEventListener('resize')` never cleaned up - accumulates on room switches | `frontend/board.ts:32-44` |
| FE-2 | Medium | No `@media (prefers-reduced-motion: reduce)` support for animations/transitions | CSS files |
| FE-3 | Medium | Colorblind mode CSS variables defined but never applied to card components | `accessibility.ts`, `variables.css` |
| FE-4 | Medium | Service Worker `Promise.allSettled` doesn't handle critical asset cache failures | `public/sw.js:54-62` |
| FE-5 | Medium | Board initialization race condition - no synchronization on concurrent server messages | `multiplayerSync.ts:145-153` |
| FE-6 | Medium | Incomplete state reset on room leave (replay data not cleared) | `multiplayerSync.ts:78-89` |
| FE-7 | Low | Socket.io library (46KB) loaded synchronously - blocks HTML parsing | `index.html:21` |
| FE-8 | Low | Settings nav listeners not tracked for cleanup when modal closes | `settings.ts:84-88` |
| FE-9 | Low | No code splitting - all 26 modules loaded eagerly regardless of game mode | `frontend/app.ts` |
| FE-10 | Low | `localStorage.getItem()` in i18n.ts lacks try/catch (fails in private browsing) | `frontend/i18n.ts:36` |
| FE-11 | Low | Locale files not cached in Service Worker (offline language switch fails) | `public/sw.js` |
| FE-12 | Low | Card reveal state change not announced to screen readers | `frontend/board.ts` |
| FE-13 | Low | Timer countdown not announced at threshold values (30s, 10s, 1s) | `frontend/timer.ts` |
| FE-14 | Low | Missing `aria-label` on player count button | `index.html:60` |
| FE-15 | Low | Web Audio API not wrapped in try/catch for unsupported browsers | `frontend/notifications.ts:28-36` |

---

### 3.6 Test Suite

**Grade: A**

The test suite is mature and comprehensive with ~2,600 tests achieving 94%+ coverage. It includes unit, integration, chaos, race condition, and E2E tests with mutation testing via Stryker.

**Positive Findings:**
- Comprehensive Redis mock (561 lines) with all operations including Lua eval
- Socket.io test helper with real HTTP servers for integration tests
- Chaos tests validate graceful degradation (Redis failures, JSON corruption, partial writes)
- Race condition tests validate atomic operations (concurrent joins, reveals, team switches)
- Playwright E2E across 5 browser/device configurations
- Stryker mutation testing on 13 service files at 80% threshold
- Zero `.skip()` or `.only()` markers - clean test suite
- Proactive removal of flaky tests with documentation

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| TST-1 | Medium | Only 4 of 26 frontend modules have unit tests (multiplayer, timer, chat, i18n untested) | `__tests__/frontend/` |
| TST-2 | Medium | No E2E test for admin dashboard UI | `e2e/` |
| TST-3 | Low | Test files split into multiple extended/edge-case files - harder to find total coverage | `__tests__/handlers/` |
| TST-4 | Low | Route tests focus on happy path - limited 4xx/5xx error response coverage | `__tests__/routes/` |
| TST-5 | Low | Mutation testing only covers services/utils, not handlers/middleware | `stryker.config.json` |
| TST-6 | Low | No multi-instance Redis Pub/Sub integration test | N/A |
| TST-7 | Low | E2E timing dependencies (15s timeouts) could cause intermittent failures | `e2e/helpers.js` |

---

### 3.7 DevOps & Deployment

**Grade: A+**

The deployment infrastructure is production-grade with a sophisticated multi-mode architecture, comprehensive health checks, and thorough CI/CD.

**Positive Findings:**
- Multi-stage Docker build with non-root user, health checks, optimized layers
- Docker Compose with resource limits (512M/256M/128M), health checks, dependency ordering
- 7-job GitHub Actions CI: test (Node 20+22), typecheck, lint, security audit, Docker build, Trivy scan, E2E
- Dependabot configured with separate prod/dev dependency grouping
- CodeQL weekly security analysis
- Prometheus-compatible metrics export (`/health/metrics/prometheus`)
- Comprehensive health endpoints: basic, ready, live, metrics (Kubernetes-ready)
- Graceful shutdown: timers -> sockets -> HTTP -> Redis/DB with 10s force-exit
- Three Redis modes: external, embedded subprocess, in-memory fallback
- Winston structured logging with rotation (10MB, 5 files) and correlation IDs
- Pre-deploy validation script checks secrets, security, lint, tests, Docker build
- Environment validation at startup with production-specific safeguards

**Issues Found:**

| ID | Severity | Description | File |
|----|----------|-------------|------|
| OPS-1 | Medium | Memory mode on Fly.io causes split-brain if scaled beyond 1 machine (documented but risky) | `fly.toml` |
| OPS-2 | Low | No automated Fly.io deployment workflow (manual `fly deploy`) | `.github/workflows/` |
| OPS-3 | Low | No distributed tracing (OpenTelemetry) for request correlation across services | N/A |
| OPS-4 | Low | Global shutdown timeout (10s) not configurable via environment variable | `server/src/index.ts` |
| OPS-5 | Low | No load testing automation (loadtest directory exists but not in CI) | N/A |

---

## 4. Consolidated Issue Registry

### By Severity

| Severity | Count | Categories |
|----------|-------|------------|
| **High** | 1 | Frontend memory leak (FE-1) |
| **Medium** | 14 | Services (4), WebSocket (5), Frontend (3), Tests (2) |
| **Low** | 30 | Across all domains |
| **Total** | 45 | |

### Critical Path Issues (Must Fix)

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| FE-1 | Resize listener never cleaned up | Memory leak on room switches | 1h |
| SVC-1 | Missing backoff in game transaction retry | CPU spike under contention | 1h |
| SVC-2 | Player cleanup TOCTOU race | Potential double-cleanup | 3h |
| WS-1 | Player state/room sync race | Spectator room inconsistency | 4h |
| WS-2 | Incomplete join rollback | Orphaned player in room | 3h |

### High-Value Improvements

| ID | Issue | Impact | Effort |
|----|-------|--------|--------|
| FE-3 | Colorblind mode CSS not applied | Accessibility gap | 2h |
| FE-2 | No prefers-reduced-motion support | Accessibility gap | 1h |
| TST-1 | Frontend unit test gaps (22/26 modules untested) | Regression risk | 16h |
| SVC-3 | Timer callback not properly awaited | Race condition at expiration | 2h |
| WS-3 | No timeout on parallel join operations | Potential hang on slow Redis | 1h |

---

## 5. Development Plan: Hardening Sprints

### Sprint Overview

| Sprint | Theme | Duration | Focus |
|--------|-------|----------|-------|
| **Sprint 1** | Critical Fixes & Race Conditions | 1 week | Fix high/medium severity bugs, race conditions, memory leaks |
| **Sprint 2** | Accessibility & Frontend Hardening | 1 week | WCAG compliance, PWA robustness, frontend memory safety |
| **Sprint 3** | Test Coverage & Quality | 1 week | Frontend unit tests, E2E gaps, mutation testing expansion |
| **Sprint 4** | Operational Excellence | 1 week | Observability, deployment automation, performance testing |
| **Sprint 5** | Security Hardening & Polish | 1 week | CSP nonces, token rotation, audit improvements |

---

## 6. Sprint Details

### Sprint 1: Critical Fixes & Race Conditions (Week 1)

**Goal**: Eliminate all high-severity issues and the most impactful medium-severity race conditions.

#### Tasks

| Task | Issues Addressed | Effort | Priority |
|------|-----------------|--------|----------|
| Add exponential backoff to `executeGameTransaction` WATCH/MULTI retry loop | SVC-1 | 1h | P0 |
| Fix resize event listener leak in `board.ts` - add cleanup on room leave | FE-1 | 1h | P0 |
| Extract scheduled player cleanup to Lua script for atomicity | SVC-2 | 3h | P0 |
| Make player state changes atomic with socket room sync | WS-1 | 4h | P0 |
| Add rollback logic to room join if subsequent operations fail | WS-2 | 3h | P1 |
| Wrap parallel join operations in `withTimeout()` | WS-3 | 1h | P1 |
| Add `withTimeout()` to async operations inside disconnect handler | WS-4 | 2h | P1 |
| Fix timer expiration callback to properly await async operations | SVC-3 | 2h | P1 |
| Synchronize local timer state mutation with Redis confirmation | SVC-4 | 2h | P1 |
| Add try-catch around socket function registration | WS-5 | 0.5h | P2 |
| Add chat message length validation to schema | WS-9 | 0.5h | P2 |
| Add game history limit min-value validation | WS-10 | 0.5h | P2 |
| Add timeout to per-player mutex lock acquisition | WS-11 | 1h | P2 |

**Estimated Effort**: 21.5 hours
**Acceptance Criteria**: All existing tests pass, no new regressions, race condition integration tests added for each fix.

---

### Sprint 2: Accessibility & Frontend Hardening (Week 2)

**Goal**: Achieve WCAG 2.1 AA compliance and eliminate frontend memory/reliability issues.

#### Tasks

| Task | Issues Addressed | Effort | Priority |
|------|-----------------|--------|----------|
| Implement colorblind mode CSS overrides for card components | FE-3 | 2h | P0 |
| Add `@media (prefers-reduced-motion: reduce)` rules | FE-2 | 1h | P0 |
| Add screen reader announcements for card reveals | FE-12 | 2h | P1 |
| Add timer threshold announcements (30s, 10s, 1s) | FE-13 | 1h | P1 |
| Add missing `aria-label` attributes on interactive elements | FE-14 | 1h | P1 |
| Fix Service Worker critical asset cache failure handling | FE-4 | 2h | P1 |
| Cache locale files in Service Worker for offline language switching | FE-11 | 1h | P1 |
| Add board initialization synchronization lock | FE-5 | 2h | P1 |
| Clear replay state on room leave | FE-6 | 0.5h | P2 |
| Track and clean up settings nav listeners | FE-8 | 1h | P2 |
| Wrap Web Audio API in try/catch with graceful fallback | FE-15 | 0.5h | P2 |
| Add try/catch around localStorage in i18n.ts | FE-10 | 0.5h | P2 |
| Defer socket.io script loading | FE-7 | 1h | P2 |

**Estimated Effort**: 15.5 hours
**Acceptance Criteria**: Manual accessibility audit passes WCAG 2.1 AA, E2E accessibility tests updated, no console errors in private browsing mode.

---

### Sprint 3: Test Coverage & Quality (Week 3)

**Goal**: Expand frontend unit test coverage, fill E2E gaps, and broaden mutation testing scope.

#### Tasks

| Task | Issues Addressed | Effort | Priority |
|------|-----------------|--------|----------|
| Add unit tests for `multiplayer.ts` and `multiplayerSync.ts` | TST-1 | 4h | P0 |
| Add unit tests for `timer.ts` and `chat.ts` | TST-1 | 3h | P0 |
| Add unit tests for `i18n.ts` and `notifications.ts` | TST-1 | 3h | P1 |
| Add unit tests for `spectator.ts`, `history.ts`, `replay.ts` | TST-1 | 3h | P1 |
| Add unit tests for `settings.ts`, `debug.ts`, `constants.ts` | TST-1 | 3h | P2 |
| Add E2E spec for admin dashboard UI | TST-2 | 4h | P1 |
| Add route tests for 4xx/5xx error responses | TST-4 | 3h | P2 |
| Expand Stryker mutation testing to include handlers and middleware | TST-5 | 2h | P2 |
| Add multi-instance Redis Pub/Sub integration test | TST-6 | 4h | P2 |
| Consolidate handler test files (reduce extended/edge-case fragmentation) | TST-3 | 3h | P3 |

**Estimated Effort**: 32 hours
**Acceptance Criteria**: Frontend unit test coverage >= 80%, all new E2E specs pass across 3 browsers, mutation score >= 75% on expanded scope.

---

### Sprint 4: Operational Excellence (Week 4)

**Goal**: Improve observability, automate deployment, and validate performance under load.

#### Tasks

| Task | Issues Addressed | Effort | Priority |
|------|-----------------|--------|----------|
| Add automated Fly.io deployment workflow (GitHub Actions) | OPS-2 | 4h | P0 |
| Add OpenTelemetry integration for distributed tracing | OPS-3 | 6h | P1 |
| Make shutdown timeout configurable via environment variable | OPS-4 | 0.5h | P2 |
| Add load testing to CI pipeline (basic smoke test) | OPS-5 | 4h | P1 |
| Document audit log retention policy and rotation strategy | SEC-3 | 1h | P2 |
| Add Grafana dashboard template for Prometheus metrics | N/A | 3h | P2 |
| Add CORS origin validation documentation for multi-domain | SEC-4 | 0.5h | P3 |
| Production Redis provisioning runbook for Fly.io | OPS-1 | 1h | P2 |
| Add memory mode warning to admin dashboard | OPS-1 | 1h | P2 |

**Estimated Effort**: 21 hours
**Acceptance Criteria**: Automated deploys on merge to main, tracing visible in dashboard, load test baseline established, all runbooks documented.

---

### Sprint 5: Security Hardening & Polish (Week 5)

**Goal**: Implement defense-in-depth improvements and address remaining low-severity items.

#### Tasks

| Task | Issues Addressed | Effort | Priority |
|------|-----------------|--------|----------|
| Implement CSP nonce-based script loading (replace `unsafe-inline`) | SEC-1 | 6h | P1 |
| Add optional token rotation on reconnection | SEC-2 | 4h | P2 |
| Add audit event severity mapping validation with unmapped-type warnings | SVC-9 | 1h | P2 |
| Add user-visible error for word lists smaller than board size | SVC-6 | 1h | P2 |
| Explicit `socket.leaveAll()` on disconnect | WS-6 | 0.5h | P3 |
| Call `clearSocketFunctions()` during shutdown | WS-8 | 0.5h | P3 |
| Fix `tsconfig.json` test helper exclusion | CFG-1 | 0.5h | P3 |
| Extract word resolution logic from `createGame()` | SVC-7 | 2h | P3 |
| Deduplicate orphan cleanup logic in playerService | SVC-8 | 2h | P3 |
| Implement code splitting for multiplayer mode | FE-9 | 3h | P3 |

**Estimated Effort**: 20.5 hours
**Acceptance Criteria**: CSP nonce working without `unsafe-inline`, all low-severity issues resolved, clean codebase with no known issues remaining.

---

## 7. Success Metrics

### Before Hardening (Current State)

| Metric | Current Value |
|--------|---------------|
| Test Coverage (lines) | 94%+ |
| Frontend Unit Test Coverage | ~15% (4/26 modules) |
| Known Issues | 45 |
| Critical/High Issues | 1 |
| Medium Issues | 14 |
| WCAG 2.1 AA Compliance | Partial |
| Automated Deployment | No |
| Distributed Tracing | No |
| CSP `unsafe-inline` | Yes |

### After Hardening (Target State)

| Metric | Target Value |
|--------|--------------|
| Test Coverage (lines) | 95%+ |
| Frontend Unit Test Coverage | 80%+ (22/26 modules) |
| Known Issues | 0 |
| Critical/High Issues | 0 |
| Medium Issues | 0 |
| WCAG 2.1 AA Compliance | Full |
| Automated Deployment | Yes (GitHub Actions -> Fly.io) |
| Distributed Tracing | Yes (OpenTelemetry) |
| CSP `unsafe-inline` | No (nonce-based) |

### Total Estimated Effort

| Sprint | Hours | Focus |
|--------|-------|-------|
| Sprint 1 | 21.5h | Critical fixes & race conditions |
| Sprint 2 | 15.5h | Accessibility & frontend hardening |
| Sprint 3 | 32h | Test coverage & quality |
| Sprint 4 | 21h | Operational excellence |
| Sprint 5 | 20.5h | Security hardening & polish |
| **Total** | **110.5h** | **~3 developer-weeks** |

---

*This document was generated from a comprehensive parallel review of the entire Codenames Online codebase. Each finding includes specific file references and line numbers for traceability.*
