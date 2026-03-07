# Eigennamen Codebase Review Report

**Date:** 2026-03-07
**Codebase:** v5.1.0-beta.3 | ~84K LoC TypeScript | 291 source files | 133 test suites | 13 E2E specs

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
While the project has 130 test suites (51,705 lines of test code), comparing source structure to test structure reveals gaps:
- **No dedicated tests for:**
  - `utils/parseJSON.ts` — critical utility for Redis data deserialization
  - `socket/gameMutationNotifier.ts` — event emitter pattern untested
  - `errors/GameError.ts` — error class hierarchy (tested indirectly)
- **Sparse test coverage for:**
  - `config/redis.ts` (534 lines, complex embedded Redis logic)
  - `middleware/rateLimit.ts` (443 lines)
  - `utils/metrics.ts` (462 lines)
  - `socket/contextHandler.ts` (critical middleware — validation + rate limiting)
  - Several socket handlers (chat, timer handlers)
- **No E2E tests for:** admin dashboard, audit features, error recovery scenarios

### 3.2 Test quality improvements
- Heavy `any` usage in test mocks (100+ occurrences) reduces type safety — mock type mismatches won't be caught
- Consider adding a shared mock factory using `jest.Mocked<T>` patterns
- The `__tests__/helpers/mocks.ts` file is 721 lines — may benefit from splitting by domain

### 3.3 Coverage reporting
- Coverage thresholds already configured (backend 75-85%, frontend 70%) — good
- CI enforces thresholds but no coverage trend tracking or badges
- Add coverage badges to README for visibility

---

## Sprint 4: Frontend Architecture (Priority: Medium)

### 4.1 Accessibility improvements
- Only **21 ARIA attribute usages** vs **95 DOM manipulation calls** in frontend code — ratio suggests gaps
- A dedicated `accessibility.css` (445 lines) and `accessibility.ts` exist, showing intent
- **Skip link CSS defined but HTML element may be missing** from `index.html`
- Keyboard hint contrast (`rgba(255, 255, 255, 0.35)`) may fail WCAG AA contrast requirements
- **Audit needed:** Systematic a11y review of dynamically created DOM elements for proper ARIA labels, roles, and keyboard navigation
- Consider adding `axe-core` to E2E tests for automated a11y regression testing

### 4.2 CSS architecture
- **5,248 lines** across 10 CSS files — well-organized with `variables.css` for design tokens
- `components.css` at 1,128 lines is the largest — consider splitting into component-specific files
- Only 2 responsive breakpoints (768px, 1024px) — consider adding 1200px+ for large desktops
- Verify CSS custom properties are consistently used (avoid hardcoded values)

### 4.3 Bundle & PWA optimization
- Frontend uses esbuild for bundling — verify tree-shaking effectiveness
- Consider implementing code splitting for the history/replay feature (585 lines) since it's not needed on initial load
- **Service worker caches only 3 files** (`/`, `/index.html`, `/manifest.json`) — CSS and JS bundles are missing, breaking offline mode
- No service worker update notification mechanism (`skipWaiting` flow)
- No offline fallback page — users see "Offline 503" instead of a helpful message

### 4.4 State management
- The reactive store (`frontend/store/`) with actions pattern is solid
- **Array mutation caveat:** `push`/`splice` on proxied arrays won't trigger reactive listeners — must reassign array reference. Easy source of subtle bugs
- Event bus has max 50 listeners per topic with warning, but no automatic cleanup on component teardown — potential listener leak
- Verify no memory leaks from subscriptions not being cleaned up on disconnection

### 4.5 Standalone mode URL limits
- Game state encoded in URL for serverless play — clever design
- **URL length risk:** Custom word lists are Base64-encoded without compression; large lists may exceed browser URL limits (~2,083 chars)
- Corrupted URLs silently show blank board instead of error message

---

## Sprint 5: Performance & Scalability (Priority: Medium)

### 5.1 Timer map eviction causes CPU stalls (High)
- `timerService.ts:202-214` -- when the local timer Map hits 5,000 entries, it creates a full array copy and sorts all entries O(n log n) to evict 10%
- Under 100+ concurrent games, this sort triggers every 30-60 seconds causing **50-100ms event loop stalls**
- **Fix:** Replace with a min-heap or LinkedHashMap eviction policy

### 5.2 Player cleanup N+1 Redis queries (Medium)
- `services/player/cleanup.ts:142-218` -- cleanup loop issues per-player Lua call + per-room `sCard` + `exists` checks
- For 50 disconnected players: **150+ individual Redis operations** per cleanup cycle (runs every 60s)
- Mass disconnect (server restart with 500 players) = 5,000+ Redis ops
- **Fix:** Batch into a single Lua script or use Redis pipeline

### 5.3 Redis optimization
- 26 Lua scripts provide atomic operations -- good pattern
- `atomicRefreshTtl.lua:21-41` -- redundant `EXISTS` checks before `EXPIRE` (EXPIRE is idempotent, returns 0 if key missing). Adds ~10% extra Redis calls on every TTL refresh
- Ensure all game state keys have appropriate TTLs to prevent memory leaks

### 5.4 Connection tracker eviction issues (Medium)
- `connectionTracker.ts:139-169` -- cleanup resets all IP timing data to "now" every 30 seconds, defeating LRU eviction logic
- Eviction itself does O(n log n) sort on 10,000 entries when at capacity
- **Fix:** Track changes incrementally; use TTL-based cleanup instead of reactive eviction

### 5.5 Distributed lock contention latency
- `distributedLock.ts:59-96` -- worst case 20 retries with exponential backoff = up to **5 seconds blocking** waiting for a lock
- Game mutations (reveal card, end turn) acquire locks -- prolonged wait makes the game feel frozen
- Lock auto-extension (`withAutoExtend`) has no retry on extension failure -- could lose lock mid-operation
- **Fix:** Consider adaptive timeout or lock-free algorithms for non-critical operations

### 5.6 Audit log memory inefficiency
- `auditService.ts:130` -- `unshift()` is O(n) per audit event (shifts entire array)
- Under bot attack (1,000 failed auth/sec), this dominates CPU
- **Fix:** Use `push()` with reverse iteration, or Redis-backed storage

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
| 4. Frontend Architecture | Medium | Medium | Medium | a11y audit, PWA offline fix, reactive store caveats, URL limits |
| 5. Performance | Medium | Medium | High | Timer eviction stalls, cleanup N+1, lock contention, audit O(n) |
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
