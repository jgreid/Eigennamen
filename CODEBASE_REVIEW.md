# Eigennamen Codebase Review Report

**Date:** 2026-03-07
**Codebase:** v5.1.0-beta.2 | ~84K LoC TypeScript | 291 source files | 130 test suites | 13 E2E specs

---

## Executive Summary

The Eigennamen codebase is well-architected with strong patterns: typed errors, Zod validation at boundaries, atomic Redis operations via Lua scripts, distributed locking, and a clean service layer. The project follows modern best practices including Express 5, comprehensive E2E testing, and structured logging.

This review identifies **6 improvement sprints** organized by priority and impact.

---

## Sprint 1: Security Hardening (Priority: Critical)

### 1.1 High-severity npm vulnerability
- **`express-rate-limit` 8.2.0-8.2.1** has a high-severity bypass via IPv4-mapped IPv6 addresses (GHSA-46wh-pxpv-q5gq)
- **Fix:** `npm audit fix` — straightforward patch upgrade

### 1.2 innerHTML usage in frontend (XSS surface)
- **15 uses of `innerHTML`** across 7 frontend files: `history.ts`, `board.ts`, `chat.ts`, `roles.ts`, `utils.ts`, `ui.ts`, `multiplayerUI.ts`
- Most are safe (clearing with `innerHTML = ''` or using `escapeHTML()`), but the pattern increases XSS risk surface
- `ui.ts:50` — toast HTML uses template literal with `innerHTML`, though inputs are sanitized via `escapeHTML()` and allowlisted icon types
- `history.ts:374` — uses HTML entities directly (safe but inconsistent with DOM-method approach used in `roles.ts:96`)
- **Recommendation:** Migrate remaining `innerHTML` usages to DOM construction methods for defense-in-depth, consistent with the pattern already used in `roles.ts`

### 1.3 Admin route authorization audit
- Admin routes in `routes/admin/roomRoutes.ts` use password-based auth — verify this is consistently applied to all admin endpoints
- Consider adding rate limiting specifically to the admin auth endpoint to prevent brute-force attacks

---

## Sprint 2: Code Quality & Maintainability (Priority: High)

### 2.1 Large file decomposition
The following non-test source files exceed 500 lines and should be considered for decomposition:

| File | Lines | Recommendation |
|------|-------|----------------|
| `services/gameHistoryService.ts` | 858 | Extract replay logic into separate module |
| `services/gameService.ts` | 621 | Already partially decomposed (game/boardGenerator, game/revealEngine); review remaining complexity |
| `frontend/history.ts` | 585 | Extract replay UI into dedicated module |
| `services/timerService.ts` | 581 | Consider separating timer state management from timer operations |
| `routes/admin/roomRoutes.ts` | 574 | Split into separate route files per resource |
| `config/redis.ts` | 534 | Extract embedded Redis management into separate module |
| `frontend/multiplayerUI.ts` | 520 | Extract into smaller UI component modules |
| `frontend/board.ts` | 506 | Extract board rendering from board logic |

### 2.2 TypeScript `any` usage
- **123 occurrences** of `as any` or `: any` across the codebase (mostly in test files)
- **Production code:** `frontend/board.ts` (1), `frontend/store/selectors.ts` (1) — these should be properly typed
- **Test code:** Heavy usage in test mocks (~100+ occurrences) — consider using `jest.Mocked<T>` or type-safe mock helpers
- ESLint has `@typescript-eslint/no-explicit-any` set to `warn` — consider escalating to `error` for non-test code

### 2.3 ESLint disable comments
- 7 `eslint-disable` comments across production code in: `utils/logger.ts`, `utils/retryAsync.ts`, `services/player/cleanup.ts`, `services/game/luaGameOps.ts`
- Review each to determine if the underlying issue can be resolved properly

---

## Sprint 3: Testing Improvements (Priority: High)

### 3.1 Test coverage gaps
While the project has 130 test suites, comparing source structure to test structure reveals potential gaps:
- **Missing or sparse test coverage for:**
  - `config/redis.ts` (534 lines, complex embedded Redis logic)
  - `middleware/rateLimit.ts` (443 lines)
  - `frontend/multiplayerSync.ts` (463 lines)
  - `frontend/roles.ts` (431 lines)
  - `utils/metrics.ts` (462 lines)
  - `socket/contextHandler.ts` (critical middleware — validation + rate limiting)
  - Several socket handlers (chat, timer handlers)

### 3.2 Test quality improvements
- Heavy `any` usage in test mocks reduces type safety — mock type mismatches won't be caught
- Consider adding a shared mock factory using `jest.Mocked<T>` patterns
- The `__tests__/helpers/mocks.ts` file is 721 lines — may benefit from splitting by domain

### 3.3 Coverage reporting
- Coverage is configured (`npm run test:coverage`) but should be integrated into CI with minimum thresholds
- Add coverage badges to README for visibility

---

## Sprint 4: Frontend Architecture (Priority: Medium)

### 4.1 Accessibility improvements
- Only **21 ARIA attribute usages** vs **95 DOM manipulation calls** in frontend code — ratio suggests gaps
- A dedicated `accessibility.css` (445 lines) and `accessibility.ts` exist, showing intent
- **Audit needed:** Systematic a11y review of dynamically created DOM elements for proper ARIA labels, roles, and keyboard navigation
- Consider adding `axe-core` to E2E tests for automated a11y regression testing

### 4.2 CSS architecture
- **5,248 lines** across 10 CSS files — well-organized with `variables.css` for design tokens
- `components.css` at 1,128 lines is the largest — consider splitting into component-specific files
- Verify CSS custom properties are consistently used (avoid hardcoded values)

### 4.3 Bundle optimization
- Frontend uses esbuild for bundling — verify tree-shaking effectiveness
- Consider implementing code splitting for the history/replay feature (585 lines) since it's not needed on initial load
- Service worker caching strategy should be reviewed for cache invalidation correctness

### 4.4 State management
- The reactive store (`frontend/store/`) with actions pattern is solid
- Verify no memory leaks from subscriptions not being cleaned up on disconnection

---

## Sprint 5: Performance & Scalability (Priority: Medium)

### 5.1 Redis optimization
- 26 Lua scripts provide atomic operations — good pattern
- Review scripts for:
  - Missing TTL assignments on temporary keys
  - Large key scans that could block Redis
  - Ensure all game state keys have appropriate TTLs to prevent memory leaks

### 5.2 Large service files
- `gameHistoryService.ts` (858 lines) handles game history, replays, and serialization — hot path for read operations
- Verify replay data retrieval uses efficient Redis patterns (avoid loading full history for summary views)

### 5.3 Timer service efficiency
- `timerService.ts` maintains local timer state (`LocalTimerData`) alongside Redis state
- In multi-instance deployments, verify timer reconciliation doesn't create race conditions
- The distributed lock (`utils/distributedLock.ts`) mitigates this, but edge cases may exist

### 5.4 Connection management
- `socket/connectionTracker.ts` and `socket/connectionHandler.ts` manage WebSocket lifecycle
- Verify proper cleanup on abnormal disconnections to prevent ghost connections consuming resources

---

## Sprint 6: DevOps & Infrastructure (Priority: Low)

### 6.1 Dependency maintenance
- All dependencies appear reasonably current (Express 5, Zod 4, Jest 30, Playwright 1.58)
- `ts-jest` at 29.4.0 with Jest 30.2.0 — verify compatibility (major version mismatch)
- npm itself suggests upgrade from 10.x to 11.x

### 6.2 CI/CD enhancements
- Add test coverage thresholds to CI pipeline
- Consider adding bundle size tracking to prevent regression
- Add automated dependency update review (Dependabot is configured)

### 6.3 Docker optimization
- Review `docker-compose.yml` for multi-stage build optimization
- Verify `.dockerignore` excludes test files, docs, and dev dependencies from production image

### 6.4 Monitoring
- `utils/metrics.ts` (462 lines) provides metrics infrastructure
- Verify metrics are being collected in production (Prometheus endpoint, health checks)
- Consider adding structured error tracking (Sentry or similar)

---

## Summary Matrix

| Sprint | Priority | Effort | Impact | Key Items |
|--------|----------|--------|--------|-----------|
| 1. Security Hardening | Critical | Low | High | npm audit fix, innerHTML migration, admin auth |
| 2. Code Quality | High | Medium | Medium | File decomposition, `any` cleanup, eslint fixes |
| 3. Testing | High | Medium | High | Coverage gaps, mock quality, CI integration |
| 4. Frontend Architecture | Medium | Medium | Medium | a11y audit, CSS split, bundle optimization |
| 5. Performance | Medium | Medium | High | Redis TTLs, timer races, connection cleanup |
| 6. DevOps | Low | Low | Low | Dep updates, CI coverage, Docker optimization |

---

## Strengths (What's Working Well)

- **Architecture:** Clean service layer with clear separation of concerns
- **Validation:** Comprehensive Zod schemas at all entry points
- **Error handling:** Typed `GameError` hierarchy with safe client-side exposure (detail allowlist)
- **Concurrency:** Atomic Lua scripts + distributed locks for multi-instance safety
- **Security awareness:** Production Zod scrubbing, error detail allowlisting, CORS, Helmet, rate limiting
- **Testing:** 130 test suites with dedicated security/adversarial tests
- **Frontend:** Reactive store pattern, dedicated accessibility module, i18n support (4 languages)
- **Documentation:** Excellent CLAUDE.md, architecture docs, ADRs, and contributor guides
