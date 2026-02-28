# Codebase Review 2 — Eigennamen Online v4.0.0

**Date:** 2026-02-28
**Scope:** Holistic deep-dive — frontend game flows, backend services, docs cohesion, performance
**Builds on:** CODEBASE_REVIEW.md (Sprint 1–6 proposals)
**Status:** All actionable items implemented (see Section 5)

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

### 1.2 Issues Found and Fixed

#### FIXED — Orphaned `requestAnimationFrame` on room switch

**Files changed:** `frontend/game/reveal.ts`, `frontend/multiplayerSync.ts`, `frontend/stateTypes.ts`, `frontend/state.ts`

`revealCardFromServer()` scheduled a `requestAnimationFrame` callback but the rAF ID was not stored, so it couldn't be cancelled on room switch. Now `state.pendingRevealRAF` stores the ID and `resetMultiplayerState()` cancels it.

#### FIXED — Dual role-change timeout mechanisms

**Files changed:** `frontend/roles.ts`, `frontend/handlers/playerEventHandlers.ts`

Removed the per-operation 5s timeouts from `setTeam()` and `setRoleForTeam()`, and the per-phase timeout in the `playerUpdated` handler. The 10-second absolute failsafe (`ROLE_CHANGE_ABSOLUTE_TIMEOUT_MS`) is now the sole safety net for all role-change phases.

#### FIXED — `revealingCards` safety cap is reactive, not proactive

**Files changed:** `frontend/game/reveal.ts`, `frontend/multiplayer.ts`, `frontend/multiplayerSync.ts`

Added a periodic sweep (`sweepStaleRevealingCards()`) that runs every `CARD_REVEAL_TIMEOUT_MS` during multiplayer mode. Entries in `revealingCards` that no longer have a pending timeout are cleaned up. Sweep starts on multiplayer join, stops on leave.

#### P4 — Font resize recalculates all cards unnecessarily

**File:** `board.ts:59-71`

`handleResize()` resets all inline `font-size` styles and calls `fitCardText()` for all cards on every resize event (debounced at 150ms). For a 5x5 board this is negligible, but the pattern reads/writes all 25 card layouts.

**Impact:** Minimal. The 150ms debounce is sufficient for current board sizes. Not fixed — low priority.

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

### 2.2 Issues Found and Fixed

#### FIXED — Game state cache not invalidated on all mutations

**File changed:** `socket/handlers/playerHandlers.ts`

Added `invalidateGameStateCache(ctx.roomCode)` calls after `setTeam` and `setRole` handlers. This prevents stale cached game state from being used when concurrent mutations happen.

#### FIXED — Auth failure map never pruned

**File changed:** `socket/connectionTracker.ts`

Added auth failure cleanup to the periodic `startConnectionsCleanup` sweep. Entries where the window has elapsed and the block has expired are deleted, preventing unbounded memory growth from IPs that fail auth and never reconnect.

#### FIXED — Timer sweep interval not cleared on shutdown

**File changed:** `socket/index.ts`

Stored the `timerSweepInterval` in a module-level variable (`timerSweepIntervalRef`) and clear it in `cleanupSocketModule()`.

#### FIXED — Emission metrics not bridged to central system

**File changed:** `socket/safeEmit.ts`

The hourly metrics window now flushes totals into central gauges (`emission_window_total`, `emission_window_failed`) via `setGauge()` before resetting. This makes emission health visible in `/metrics` and Prometheus export.

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

#### FIXED — Service worker cache version mismatch

**File changed:** `server/public/service-worker.js`

Updated cache name from `'eigennamen-v3'` to `'eigennamen-v4'`.

#### Corrected — CSS module count

Initial review stated 9 CSS files. Actual count is **8** (variables, layout, components, modals, responsive, accessibility, multiplayer, replay). CLAUDE.md was already correct.

---

## 4. Cross-Cutting Observations

### 4.1 Testing

**Strengths:**
- 126 test suites, 3,528 tests, 0 failures is excellent for a project of this size.
- Coverage at 81.62% statements / 69.77% branches is solid.
- Frontend and backend have separate coverage thresholds (appropriate given different test densities).

**Addressed gaps:**
- **NEW:** Lua script behavioral logic tests (`__tests__/scripts/luaScriptLogic.test.ts`) — verifies game logic patterns in revealCard, endTurn, setRole, hostTransfer, and safeTeamSwitch scripts.
- **NEW:** Distributed lock contention tests (`__tests__/integration/lockContention.test.ts`) — verifies mutual exclusion, release-on-error, ownership validation, auto-extension, and max-retry failure.

### 4.2 Bundle & Performance

- **52 frontend modules** compiled via esbuild — modern, fast bundler.
- **Code splitting already enabled**: `splitting: true` in esbuild config with ESM format. Chunks output to `chunks/[name]-[hash]`.
- **Bundle analysis already available**: `--analyze` flag triggers `esbuild.analyzeMetafile()`.
- `contain: layout style` on `.card` (components.css) is a good CSS containment practice.
- `will-change` is used sparingly, avoiding the common over-use pitfall.

### 4.3 Security

The security posture is strong:
- Input validation at all entry points (Zod).
- JWT with enforced minimum secret length in production.
- Per-socket + per-event + global per-IP rate limiting (3-layer defense).
- Helmet headers (CSP, HSTS, X-Frame-Options).
- Spymaster card type filtering prevents information leakage.
- Reconnection tokens server-side only (fixed in v2.2.0).
- Audit logging for security events.

No new security vulnerabilities found.

---

## 5. Implementation Status

All actionable items have been implemented. Items that were already present in the codebase before review are noted.

### Tier 1 — Quick Wins

| # | Task | Status |
|---|------|--------|
| 1 | Update service worker cache version to `v4` | **Done** |
| 2 | Fix CLAUDE.md CSS module count | **N/A** — CLAUDE.md was already correct (8 modules) |
| 3 | Add `invalidateGameStateCache` after role/team changes | **Done** |
| 4 | Clear timer sweep interval on shutdown | **Done** |
| 5 | Add auth failure map cleanup to periodic sweep | **Done** |

### Tier 2 — Short Tasks

| # | Task | Status |
|---|------|--------|
| 6 | Store and cancel rAF IDs on room switch | **Done** |
| 7 | Consolidate role-change timeouts into single mechanism | **Done** |
| 8 | Add periodic sweep for stale `revealingCards` entries | **Done** |
| 9 | Extract remaining inline Lua scripts to `.lua` files | **Already done** — all 21 scripts already in `.lua` files |

### Tier 3 — Larger Efforts

| # | Task | Status |
|---|------|--------|
| 10 | Add Lua script behavioral logic tests | **Done** |
| 11 | Add distributed lock contention tests | **Done** |
| 12 | Implement server-wide IP rate limiting | **Already done** — `GLOBAL_IP_RATE_LIMIT_MAX` in `rateLimit.ts` |
| 13 | Bridge safeEmit metrics into central metrics system | **Done** |

### Tier 4 — Future Considerations

| # | Task | Status |
|---|------|--------|
| 14 | Type-safe socket event names | **Already done** — `SocketEventName` union type in `socketConfig.ts:102` |
| 15 | Bundle analysis & code splitting | **Already done** — esbuild has `splitting: true` and `--analyze` flag |
| 16 | Memoized selectors in reactive store | **Not needed** — selectors are trivial property reads; `.find()` on ~12-item array |

---

## 6. Summary

| Area | Rating | Notes |
|------|--------|-------|
| Architecture | Strong | Clean service layer, good separation of concerns |
| Frontend game flow | Strong | Card reveal pipeline hardened with rAF tracking, sweep, timeout consolidation |
| Backend services | Strong | Cache invalidation fixed, auth cleanup added, metrics bridged |
| Security | Strong | Multi-layer defense (3-tier rate limiting), no vulnerabilities |
| Testing | Strong | Lua logic tests and lock contention tests added |
| Documentation | Strong | All inconsistencies resolved |
| Performance | Good | Efficient DOM updates; code splitting and bundle analysis already available |
| Operational readiness | Strong | Health checks, audit logging, metrics unified |

All items from this review have been addressed. The codebase is in excellent shape for production.
