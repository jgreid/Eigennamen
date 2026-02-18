# Next Steps — Eigennamen Online

**Date**: 2026-02-18
**Basis**: Full codebase re-review following fixes from PR #272, #273, #274

---

## Progress Since Last Review (2026-02-17)

The prior CODEBASE_REVIEW.md identified 15 recommendations. Here's the current status:

| # | Recommendation | Status |
|---|----------------|--------|
| 1 | Enforce ADMIN_PASSWORD in production | **Fixed** — startup now fails without it |
| 2 | Eliminate runtime require() calls | **Fixed** — all ES6 imports |
| 3 | Fix room sync mutex LRU eviction | **Fixed** — refactored to Redis-backed distributed locks |
| 4 | Add sessionId to JWT claims validation | **Fixed** — both sessionId and userId validated |
| 5 | Establish consistent error handling | Not started |
| 6 | Decompose complex functions | **Partially done** — sub-modules extracted, createGame() still 168 lines |
| 7 | Add timeout to disconnect handler timer | **Fixed** — withTimeout() added to all unprotected Redis calls |
| 8 | Increase frontend test coverage to 70%+ | **Fixed** — expanded from 8 to 19 test files |
| 9 | Add database integration tests | Not started |
| 10 | Strengthen RedisClient typing | Not started |
| 11 | Centralize room ID normalization | Not started |
| 12 | Add bounds validation to timerService.startTimer() | Not started |
| 13 | Fix listener cleanup gaps | Not started |
| 14 | Move duplicated room code validation schema | Not started |
| 15 | Add startup logging for disabled features | Not started |

**Summary**: 6 of 15 items fully resolved, 1 partially resolved, 8 remain.

---

## Proposed Next Steps (Prioritized)

### Tier 1 — Bug Fixes (High Impact, Low Risk)

#### 1. Clear offline queue on room leave
**File**: `server/src/frontend/socket-client.ts:556-561`

The `leaveRoom()` method doesn't clear `_offlineQueue`. Queued messages (e.g., chat) could replay into a different room on rejoin. The `disconnect()` method at line 776 already clears it properly — `leaveRoom()` should too.

**Fix**: Add `this._offlineQueue = [];` to `leaveRoom()`.

---

#### 2. Fix silent pipeline failure in game history
**File**: `server/src/services/gameHistoryService.ts:373-386`

When a Redis pipeline partially fails, the code logs a warning but doesn't throw. This can leave game history saved without its index being updated, breaking replay discovery.

**Fix**: Throw on partial pipeline failure instead of warning.

---

#### 3. Fix boardInitialized flag for room changes
**File**: `server/src/frontend/board.ts:168-171`

When switching multiplayer rooms, `boardInitialized` remains true and the old board has 25 cards, so the incremental update path runs instead of a full re-render. This shows stale game state.

**Fix**: Reset `boardInitialized = false` when leaving a room or when room code changes.

---

#### 4. Fix timer state not reset on room change
**File**: `server/src/frontend/multiplayerSync.ts:80-92`

`handleTimerStopped()` is called on cleanup, but `state.timerState` may retain a stale `intervalId`, causing ghost timer ticks if the room change happens mid-countdown.

**Fix**: Clear the interval and reset timer state to initial values on room leave.

---

### Tier 2 — Security & Correctness (Medium Impact)

#### 5. Establish consistent error handling convention
**Scope**: Cross-cutting, all services

Services currently mix three patterns: throw specific errors (`gameService`), return null for both "not found" and "corrupted" (`roomService`, `gameHistoryService`), and log-and-continue (`auditService`). This makes it difficult for callers to handle errors correctly.

**Proposed convention**:
- **Throw** `GameError` subclasses for business logic violations (not found, invalid state, permission denied)
- **Return null** only for "optional resource not found" cases
- **Never silently swallow** errors that affect data integrity (pipeline failures, lock failures)
- Document the convention in CONTRIBUTING.md

---

#### 6. Add bounds validation to timerService.startTimer()
**File**: `server/src/services/timerService.ts`

`addTime()` validates duration limits, but `startTimer()` accepts unbounded duration. A malicious host could start a timer with `duration: 999999999`.

**Fix**: Apply the same bounds validation from `addTime()` to `startTimer()`.

---

#### 7. Centralize room ID normalization
**Files**: `server/src/services/roomService.ts` (lines 70-71, 162, 200, 317+)

Room code normalization (uppercase, trim) is done inline in multiple places. A missed normalization could cause lookups to fail.

**Fix**: Create `normalizeRoomCode()` in `utils/` and use it everywhere.

---

#### 8. Deduplicate room code validation schema
**Files**: `server/src/routes/roomRoutes.ts:37-39`, `server/src/routes/replayRoutes.ts:39`

The same room code regex validation is written twice. Schema drift could cause inconsistent behavior.

**Fix**: Move to `validators/roomSchemas.ts` and import in both routes.

---

### Tier 3 — Robustness & Observability (Lower Impact)

#### 9. Add database integration tests
**Scope**: New test file(s) in `server/src/__tests__/integration/`

The Prisma schema has migrations and relationships, but no tests verify that migrations apply cleanly or that queries work against a real database. Schema changes could break silently.

**Fix**: Add a small integration test suite that:
- Applies migrations to an ephemeral PostgreSQL (via Docker or pg-mem)
- Verifies CRUD operations for Users, Rooms, Games, WordLists
- Runs in CI alongside existing tests

---

#### 10. Strengthen RedisClient typing
**File**: `server/src/config/redis.ts:385`

Uses `as unknown as RedisClient` cast. If the Redis client API changes on upgrade, this will mask type errors.

**Fix**: Define a proper `RedisClient` interface that matches the actual API surface used in the codebase.

---

#### 11. Fix listener cleanup gaps in frontend

**a.** Keyboard shortcut listener never removed on room leave (`server/src/frontend/accessibility.ts:45`).

**b.** `initChat()` not idempotent — accumulates duplicate listeners if called multiple times (`server/src/frontend/chat.ts:14-28`). Add a guard or clean up before re-adding.

---

#### 12. Add startup logging for disabled features
**File**: `server/src/config/database.ts:88-93`

When database connection fails, it's silently caught and features are disabled. Operators may not realize word lists, game history, and user accounts are unavailable.

**Fix**: Log a clear startup banner showing which optional features are active/inactive.

---

#### 13. Cap toast notification count
**File**: `server/src/frontend/ui.ts:25-65`

No maximum toast count — rapid actions create unbounded DOM elements. Cap to 5 concurrent toasts, removing the oldest when exceeded.

---

#### 14. Improve ARIA live region announcements
**File**: `server/src/frontend/board.ts:13-19`

The clear-then-set pattern with `requestAnimationFrame` isn't reliably detected by all screen readers. Use `aria-atomic="true"` and a timeout-based clearing strategy instead.

---

### Tier 4 — Architecture Improvements (Larger Scope)

#### 15. Further decompose createGame()
**File**: `server/src/services/gameService.ts:131-298`

Still 168 lines. Could be split into:
- `acquireGameCreationLock()` — lock acquisition + retry logic
- `resolveGameWords()` — word list resolution with 3-tier fallback
- `buildGameState()` — game state object construction
- `persistGameState()` — Redis write + TTL management

---

#### 16. Analyze and reduce frontend bundle size
**Directory**: `server/public/js/modules/` (1.1MB)

For a board game, this is large. Investigate:
- Are replay/history modules loaded eagerly when most users don't need them?
- Is there duplicate code in the esbuild output?
- Could socket.io client be loaded from CDN instead of bundled?

Use `esbuild --analyze` or `source-map-explorer` to identify opportunities.

---

#### 17. Add timer pause race condition protection (multi-instance)
**File**: `server/src/services/timerService.ts:363-387`

`getTimerStatus()` fetches pausedAt and remainingSeconds from Redis, then computes whether the timer would have expired while paused. Between the fetch and the check, another instance could update the timer (TOCTOU). This only matters in multi-instance deployments.

**Fix**: Atomic Lua script that fetches + checks + marks expired in a single Redis operation.

---

#### 18. Add Lua scripting health check at startup
**File**: `server/src/services/game/luaGameOps.ts`

If a Redis instance has scripting disabled, all game operations fail with unclear error messages. Add a startup validation step that runs a trivial `EVAL` command to verify Lua scripting is available.

---

## Effort Estimation (Rough)

| Tier | Items | Scope |
|------|-------|-------|
| Tier 1 (Bug Fixes) | #1–#4 | Small, targeted fixes — 4 files touched |
| Tier 2 (Security & Correctness) | #5–#8 | Medium scope — convention work + 4 fixes |
| Tier 3 (Robustness) | #9–#14 | Mixed — 1 new test suite + 5 small fixes |
| Tier 4 (Architecture) | #15–#18 | Larger refactors requiring careful testing |

**Recommended approach**: Complete Tier 1 first (highest impact-to-effort ratio), then Tier 2, and so on. Tier 4 items can be deferred to a later cycle without risk.
