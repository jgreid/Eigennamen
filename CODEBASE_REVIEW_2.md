# Codebase Review 2 — Eigennamen Online v4.0.0

**Date:** 2026-02-27
**Scope:** Holistic deep-dive — frontend game flows, backend services, docs cohesion, performance
**Builds on:** CODEBASE_REVIEW.md (Sprint 1–6 proposals)

---

## Executive Summary

Eigennamen Online is a mature, well-structured project. The v4.0.0 release addressed many prior findings (reactive store, module decomposition, 126 test suites, clean lint/typecheck). This review goes deeper — particularly into **frontend game flow correctness**, **backend cache/cleanup gaps**, and **cross-cutting doc consistency** — and proposes concrete next steps.

**Overall assessment:** Production-ready with minor hardening opportunities. No critical vulnerabilities or architectural flaws found.

---

## 1. Frontend Game Flows

### 1.1 What Works Well

- **Card reveal pipeline** is solid: bounds-checked, double-click guarded, per-card timeouts, rAF-batched DOM updates (`frontend/game/reveal.ts:13-145`).
- **Incremental board updates** (`board.ts:256-335`) avoid full re-renders for most state changes. The `renderingInProgress` guard prevents concurrent rebuilds.
- **Event delegation** (`board.ts:131-165`) uses a single click/keydown handler for all 25 cards — efficient and leak-free.
- **State batching** (`store/batch.ts`, `multiplayerSync.ts:166`) ensures subscribers see one coherent transition, not 20 intermediate states.
- **Multiplayer cleanup** (`multiplayerSync.ts:99-149`) is thorough: clears timeouts, reveal sets, replay intervals, resize listeners, keyboard shortcuts, and URL params.
- **Accessibility** is above average: ARIA grid roles, keyboard navigation with wrapping, screen reader announcements, color-blind patterns, reduced-motion support.

### 1.2 Issues Found

#### P2 — Orphaned `requestAnimationFrame` on room switch

**Files:** `frontend/game/reveal.ts:235`, `multiplayerSync.ts:99-149`

`revealCardFromServer()` schedules a `requestAnimationFrame` callback (line 235) but the rAF ID is not stored anywhere. If `leaveMultiplayerMode()` is called while a rAF is pending, the callback fires against a cleared/rebuilt DOM.

**Impact:** Subtle visual glitch (stale card classes applied to wrong board). Non-crashable because DOM operations are guarded.

**Fix:** Store rAF ID in state; cancel in `resetMultiplayerState()`:
```typescript
// In revealCardFromServer:
state.pendingRevealRAF = requestAnimationFrame(() => { ... });

// In resetMultiplayerState:
if (state.pendingRevealRAF) {
    cancelAnimationFrame(state.pendingRevealRAF);
    state.pendingRevealRAF = null;
}
```

#### P3 — Dual role-change timeout mechanisms

**Files:** `frontend/roles.ts:18-30`, `frontend/handlers/playerEventHandlers.ts:128-138`

Two independent timeout mechanisms govern role changes:
1. A 5-second per-operation timeout in `roles.ts` (`ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS`)
2. A separate per-phase timeout in `playerEventHandlers.ts` for the `team_then_role` path

If the role portion of a two-phase change times out (5s), the absolute failsafe (10s) doesn't fire until much later, leaving the button in a loading state for up to 10 seconds.

**Fix:** Consolidate into a single timeout mechanism. Use the absolute timeout as the sole safety net and remove the per-phase timeout.

#### P3 — `revealingCards` safety cap is reactive, not proactive

**File:** `frontend/game/reveal.ts:54-58`

The safety cap (`if (revealingCards.size >= BOARD_SIZE)`) only triggers when the set reaches 25 entries. Individual per-card timeouts (line 65-72) handle the normal case well, but if timeouts don't fire (e.g., tab backgrounded, timer throttled), the set could stay full until the cap triggers.

**Impact:** Unlikely in practice. Tab backgrounding throttles timers but doesn't prevent them from firing eventually.

**Recommendation:** Add a periodic sweep (e.g., every 10 seconds) that clears entries older than `CARD_REVEAL_TIMEOUT_MS`, rather than relying solely on per-card timeouts.

#### P4 — Font resize recalculates all cards unnecessarily

**File:** `board.ts:59-71`

`handleResize()` resets all inline `font-size` styles and calls `fitCardText()` for all cards on every resize event (debounced at 150ms). For a 5x5 board this is negligible, but the pattern reads/writes all 25 card layouts.

**Impact:** Minimal. The 150ms debounce is sufficient for current board sizes.

### 1.3 Frontend Strengths Not in Previous Review

- **Resync guard** (`gameEventHandlers.ts:40`) correctly drops events during resync since resync replaces all state.
- **Clue state clearing** on reveal-caused turn end (`reveal.ts:230-232`) handles the edge case where no separate `turnEnded` event is emitted.
- **Fallback clicker logic** (`board.ts:117-128`) lets any team member click if the assigned clicker disconnects — good UX for small groups.

---

## 2. Backend Services

### 2.1 What Works Well

- **Service layer separation** is clean: handlers validate and delegate, services own business logic, Lua scripts handle atomicity.
- **Context handler pattern** (`socket/contextHandler.ts`) provides a uniform validation → rate-limit → player-context → handler pipeline.
- **Distributed locks** properly use SET NX + TTL with ownership verification. Lock release in `finally` blocks prevents deadlocks.
- **Disconnect handler** (`connectionHandler.ts:125-149`) uses `AbortController` + `Promise.race` with proper `finally` cleanup — robust against hangs.
- **Spymaster card filtering** prevents information leakage: non-spymasters receive `null` types for unrevealed cards.
- **Game state cache** (`playerContext.ts:14-46`) with 500ms TTL and LRU eviction reduces Redis round-trips for bursts of events.

### 2.2 Issues Found

#### P2 — Game state cache not invalidated on all mutations

**Files:** `socket/handlers/gameHandlers.ts`, `socket/playerContext.ts`

`invalidateGameStateCache()` is called after: `createGame` (line 95), `revealCard` (line 184), `endTurn` (line 284), `forfeitGame` (line 317), and timer-expire `endTurn` (`disconnectHandler.ts:51`).

It is **not** called after:
- `setRole` / `setTeam` in `playerHandlers.ts` — game state cached here may have stale `currentTurn` or `gameOver` if a concurrent reveal/endTurn happened.
- `updateSettings` in `roomHandlers.ts` — game mode changes aren't reflected.

**Impact:** Mild. The 500ms TTL limits staleness, and team/role changes don't directly modify game state. But a stale `currentTurn` in the cache could allow a brief window where a player's turn validation passes incorrectly.

**Fix:** Add `invalidateGameStateCache(ctx.roomCode)` after any handler that could change game-relevant state, or reduce TTL to 200ms.

#### P2 — Auth failure map never pruned

**File:** `socket/connectionTracker.ts:19`

The `authFailuresPerIP` Map accumulates entries indefinitely. Individual entries expire on check via `isAuthBlocked()` (line 213), but entries from IPs that fail auth and never reconnect are never cleaned up.

The periodic cleanup at lines 136-157 reconciles `connectionsPerIP` and `ipLastSeen` but does **not** touch `authFailuresPerIP`.

**Impact:** Slow memory leak under sustained auth failure attempts from many distinct IPs.

**Fix:** Add auth failure cleanup to the periodic sweep:
```typescript
// In startConnectionsCleanup interval callback:
const now = Date.now();
for (const [ip, entry] of authFailuresPerIP) {
    if (now - entry.windowStart > AUTH_FAILURE_WINDOW_MS && entry.blockedUntil < now) {
        authFailuresPerIP.delete(ip);
    }
}
```

#### P3 — Timer sweep interval not cleared on shutdown

**File:** `socket/index.ts:179-182`

The `timerSweepInterval` is created with `.unref()` but never stored for cleanup. `cleanupSocketModule()` (line 202) doesn't clear it.

**Impact:** Very minor — `.unref()` prevents it from blocking process exit. But it's a cleanup correctness issue.

**Fix:** Store the interval reference and clear it in `cleanupSocketModule()`.

#### P4 — Metrics window reset race condition

**File:** `socket/safeEmit.ts:58-75`

Multiple concurrent calls to `safeEmitToRoom()`/`safeEmitToPlayer()` can all see the reset condition as true and reset metrics simultaneously, losing counts.

**Impact:** Metrics inaccuracy. Non-functional issue since metrics are for observability only.

**Fix:** Use a compare-and-swap pattern (atomic `metricsWindowStart` update) or accept the benign race.

### 2.3 Backend Strengths Not in Previous Review

- **Abort signal propagation** in disconnect handler (`disconnectHandler.ts:173-176, 218-221`) gracefully skips non-critical work (room notification, host transfer) after timeout.
- **Reconnection token security** is well-designed: tokens stored server-side only, deadline broadcast without token value, IP consistency checks.
- **Rate limiter cleanup** on disconnect (`connectionHandler.ts:116-120`) prevents memory leaks from disconnected sockets.

---

## 3. Documentation & Cohesion

### 3.1 What's Consistent

- **CLAUDE.md** accurately reflects the actual codebase structure, conventions, and key files.
- **CHANGELOG.md** is thorough and well-organized from v1.0.0 through v4.0.0.
- **ADRs** (4 records) have clear rationale and consequences sections.
- **CONTRIBUTING.md** aligns with actual code patterns (Zod validation, service layer, contextHandler).

### 3.2 Inconsistencies Found

#### Service worker cache version mismatch

**File:** `server/public/service-worker.js:9`

```javascript
const CACHE = 'eigennamen-v3';
```

The app is at v4.0.0 but the service worker cache is named `eigennamen-v3`. This won't cause functional issues (the activate handler prunes old caches), but it's confusing and means the cache won't be refreshed on upgrade from v3 → v4.

**Fix:** Update to `'eigennamen-v4'`.

#### CLAUDE.md says 8 CSS modules; there are 9

**File:** `CLAUDE.md:10`

> `├── css/                 # Stylesheets (8 modules)`

Actual count: 9 CSS files (variables, layout, components, modals, responsive, accessibility, multiplayer, replay, admin-theme).

#### E2E spec count

**File:** `CLAUDE.md`

> `cd server && npm run test:e2e       # Playwright E2E tests`

CHANGELOG says "9 Playwright E2E spec files" — confirmed: 9 `.spec.js` files plus a `helpers.js`. But the CLAUDE.md directory tree says `e2e/ # Playwright E2E tests (9 specs)` while the actual `e2e/` directory contains `.spec.js` not `.spec.ts` files. Minor — the count is correct.

#### Game mechanics spec added after CHANGELOG v4.0.0

The E2E directory has `game-mechanics.spec.js` which isn't listed in the CHANGELOG v1.8.0 entries (which list 8 specs). It was likely added in v4.0.0 to reach 9.

---

## 4. Cross-Cutting Observations

### 4.1 Testing

**Strengths:**
- 126 test suites, 3,528 tests, 0 failures is excellent for a project of this size.
- Coverage at 81.62% statements / 69.77% branches is solid.
- Frontend and backend have separate coverage thresholds (appropriate given different test densities).

**Gaps (aligned with Sprint 4 in CODEBASE_REVIEW.md):**
- No direct Lua script unit tests (tested indirectly through integration tests).
- No concurrency tests exercising distributed lock contention.
- Frontend `fitCardText` error path untested.

### 4.2 Bundle & Performance

- **52 frontend modules** compiled via esbuild — modern, fast bundler.
- No code splitting or lazy loading, but the app is small enough that this isn't needed.
- `contain: layout style` on `.card` (components.css) is a good CSS containment practice.
- `will-change` is used sparingly, avoiding the common over-use pitfall.

### 4.3 Security

The security posture is strong:
- Input validation at all entry points (Zod).
- JWT with enforced minimum secret length in production.
- Per-socket + per-event rate limiting.
- Helmet headers (CSP, HSTS, X-Frame-Options).
- Spymaster card type filtering prevents information leakage.
- Reconnection tokens server-side only (fixed in v2.2.0).
- Audit logging for security events.

No new security vulnerabilities found beyond the items already tracked in CODEBASE_REVIEW.md Sprint 2.

---

## 5. Proposed Next Steps

Organized by priority, building on CODEBASE_REVIEW.md sprints where applicable.

### Tier 1 — Quick Wins (1-2 hours each)

| # | Task | Files | Sprint Ref |
|---|------|-------|------------|
| 1 | Update service worker cache version to `v4` | `server/public/service-worker.js:9` | New |
| 2 | Fix CLAUDE.md CSS module count (8 → 9) | `CLAUDE.md` | New |
| 3 | Add `invalidateGameStateCache` after role/team changes | `socket/handlers/playerHandlers.ts` | New |
| 4 | Clear timer sweep interval on shutdown | `socket/index.ts` (store ref, clear in cleanup) | Sprint 1 |
| 5 | Add auth failure map cleanup to periodic sweep | `socket/connectionTracker.ts` | Sprint 1 |

### Tier 2 — Short Tasks (2-4 hours each)

| # | Task | Files | Sprint Ref |
|---|------|-------|------------|
| 6 | Store and cancel rAF IDs on room switch | `frontend/game/reveal.ts`, `frontend/multiplayerSync.ts`, `frontend/state.ts` | Sprint 3 |
| 7 | Consolidate role-change timeouts into single mechanism | `frontend/roles.ts`, `frontend/handlers/playerEventHandlers.ts` | Sprint 3 |
| 8 | Add periodic sweep for stale `revealingCards` entries | `frontend/game/reveal.ts` or `frontend/state.ts` | Sprint 3 |
| 9 | Extract remaining inline Lua scripts to `.lua` files | `server/src/scripts/index.ts` | Sprint 1 |

### Tier 3 — Larger Efforts (half-day to full-day each)

| # | Task | Files | Sprint Ref |
|---|------|-------|------------|
| 10 | Add Lua script unit tests | `server/src/__tests__/` | Sprint 4 |
| 11 | Add concurrency/contention tests | `server/src/__tests__/integration/` | Sprint 4 |
| 12 | Implement server-wide IP rate limiting | `socket/`, `middleware/` | Sprint 2 |
| 13 | Create `MetricsRegistry` for unified metrics | `socket/safeEmit.ts`, `socket/rateLimitHandler.ts`, `services/timerService.ts` | Sprint 5 |

### Tier 4 — Future Considerations

| # | Task | Notes |
|---|------|-------|
| 14 | Type-safe socket event names | Generate union type from `socketConfig.ts` |
| 15 | Bundle analysis & code splitting | Not urgent at current bundle size |
| 16 | Memoized selectors in reactive store | Not needed at current scale |

---

## 6. Summary

| Area | Rating | Notes |
|------|--------|-------|
| Architecture | Strong | Clean service layer, good separation of concerns |
| Frontend game flow | Good | Solid card reveal pipeline, minor cleanup gaps |
| Backend services | Good | Robust locking, minor cache invalidation gap |
| Security | Strong | Multi-layer defense, no new vulnerabilities |
| Testing | Good | 3,528 tests; Lua and concurrency testing are gaps |
| Documentation | Good | Mostly consistent; a few minor mismatches |
| Performance | Good | Efficient DOM updates, appropriate optimizations |
| Operational readiness | Good | Health checks, audit logging; metrics unification needed |

The codebase is in a healthy state. Tier 1 items (5 quick wins) can be addressed immediately. Tier 2 items (4 short tasks) would further strengthen the frontend game flow. Tier 3 items align with the existing CODEBASE_REVIEW.md sprint plan.
