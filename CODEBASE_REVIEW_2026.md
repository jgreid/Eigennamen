# Codebase Review — Next Steps Proposal

**Date**: 2026-02-11
**Scope**: Full codebase deep-dive — backend, frontend, tests, infrastructure, security, DevOps
**Version Reviewed**: v2.3.0 (post Tier C — all critical/high/medium issues from prior reviews resolved)
**Previous Reviews**: CODEBASE_REVIEW.md (Tiers 1–C, 10 critical/high + 15 medium fixes), ROADMAP.md (Tier D backlog)

---

## Executive Summary

Die Eigennamen is a **production-ready** multiplayer Codenames implementation with strong fundamentals: 2,675+ tests at 94%+ coverage, zero TypeScript/ESLint errors, and comprehensive security hardening. All critical, high, and medium issues from previous reviews are resolved.

This review identifies **48 new improvement opportunities** across 6 categories, organized into actionable tiers. The focus shifts from critical bug-fixing to **hardening, i18n completion, test infrastructure, and polish**.

### Scorecard

| Category | Current | After Proposed Changes |
|----------|---------|----------------------|
| Backend Code | 9/10 | 9.5/10 |
| Frontend Code | 8/10 | 9/10 |
| i18n Completeness | 7/10 | 9/10 |
| Test Infrastructure | 8/10 | 9/10 |
| CI/CD & DevOps | 8/10 | 9.5/10 |
| Accessibility | 9/10 | 9.5/10 |
| Security | 10/10 | 10/10 |

---

## Table of Contents

1. [Tier E: High-Value Improvements (14 items)](#tier-e-high-value-improvements)
2. [Tier F: Medium-Value Improvements (17 items)](#tier-f-medium-value-improvements)
3. [Tier G: Low-Priority Polish (17 items)](#tier-g-low-priority-polish)
4. [Relationship to Existing Tier D](#relationship-to-existing-tier-d)
5. [Recommended Execution Order](#recommended-execution-order)

---

## Tier E: High-Value Improvements

Items that address real correctness, security, reliability, or significant user-facing gaps.

### E-1: CI Should Block on HIGH Vulnerabilities

**File**: `.github/workflows/ci.yml:111-118`
**Category**: Security / CI

The npm audit gate only fails on `CRITICAL > 0`. HIGH-severity vulnerabilities pass silently — `HIGH` is captured on line 112 but never enforced on line 118.

```bash
# Current (line 118):
if [ "$CRITICAL" -gt 0 ]; then
# Should be:
if [ "$CRITICAL" -gt 0 ] || [ "$HIGH" -gt 0 ]; then
```

**Effort**: Trivial (1-line change)

---

### E-2: Complete i18n in Multiplayer Module

**File**: `server/src/frontend/multiplayer.ts:108,153,226-236,269`
**Category**: i18n

At least 9 hardcoded English strings in the multiplayer module:
- `"Join Game"` / `"Create Game"` (line 108)
- `"Joining..."` / `"Creating..."` (line 153)
- `"Room X not found - check the Room ID"` (line 226)
- `"Room is full"`, `"Could not connect to server..."`, etc.

German/Spanish/French users see untranslated English in multiplayer dialogs — the most interactive part of the app.

**Effort**: Medium — extract strings to `locales/*.json`, use `t()` function

---

### E-3: Complete i18n in Game Status Messages

**File**: `server/src/frontend/game.ts:658,662,664,670,672,680,682`
**Category**: i18n

Game outcome messages are hardcoded English:
```typescript
turnText.textContent = 'YOU WIN! All agents found!';
turnText.textContent = 'GAME OVER - Assassin revealed!';
```

These are the most important messages in the game — displayed at game-ending moments.

**Effort**: Medium

---

### E-4: Complete i18n in Role Hints and Tooltips

**File**: `server/src/frontend/roles.ts:108-115,169,187,190`
**Category**: i18n / Accessibility

7 hardcoded strings — role selection hints and end-turn button tooltips:
```typescript
roleHint.textContent = 'Select a team above to choose a role';
endTurnBtn.title = 'End your team\'s turn';
endTurnBtn.title = 'Only the Clicker can end the turn';
```

Tooltips should also be `aria-label` for screen reader compatibility.

**Effort**: Low–Medium

---

### E-5: Timer Expiration Callback Lacks Distributed Lock

**File**: `server/src/services/timerService.ts:153-178`
**Category**: Concurrency

`createTimerExpirationCallback()` modifies game state without holding a distributed lock. If another instance simultaneously processes `game:reveal` (which does acquire locks), a race condition can corrupt game state.

**Fix**: Acquire a distributed lock within the timer callback before modifying game state.

**Effort**: Low

---

### E-6: Admin Dashboard XSS via Inline onclick Handlers

**File**: `server/public/admin.html:808,816,905`
**Category**: Security

Inline `onclick` handlers with template literals:
```javascript
onclick="toggleRoomDetails('${safeCode}')"
onclick="event.stopPropagation(); kickPlayer('${escapeHTML(code)}', '${safeId}')"
```

While `escapeHTML()` is applied, inline event handlers bypass entity escaping — the browser decodes entities before executing JavaScript. A room code containing `'); alert('xss` could execute.

**Fix**: Use `addEventListener()` with delegated event listeners, or use `data-*` attributes.

**Effort**: Medium

---

### E-7: Admin Broadcast Missing Zod Validation

**File**: `server/src/routes/adminRoutes.ts` (broadcast endpoint)
**Category**: Security

The `/admin/api/broadcast` POST endpoint extracts `message` and `type` from `req.body` using type assertion without Zod schema validation. This allows unexpected values in broadcast messages.

**Fix**: Add Zod schema:
```typescript
const broadcastSchema = z.object({
    message: z.string().min(1).max(500),
    type: z.enum(['info', 'warning', 'error'])
});
```

**Effort**: Low

---

### E-8: MemoryStorage _isExpired() Side-Effect Deletes Keys During Reads

**File**: `server/src/config/memoryStorage.ts:288-299`
**Category**: Correctness

`_isExpired()` deletes the key as a side effect. Callers that check expiry then operate on the key find it already deleted:
```typescript
if (this._isExpired(key)) return 0;  // Key deleted here!
const existed = this.data.has(key);    // Always false after expiry delete
```

**Fix**: Separate checking from deletion — `_isExpired()` should only return boolean, let callers delete explicitly.

**Effort**: Low

---

### E-9: RedisClient Interface Type Mismatches

**File**: `server/src/types/redis.ts`
**Category**: Type Safety

- `zAdd()` typed for singular member, but implementation uses variadic args
- `sAdd()` similarly typed for singular but used as variadic
- `scan()` return type says `cursor: number` but Redis returns `cursor: string`

These mismatches are masked at runtime by `as` casts but would cause errors if type checking were tightened.

**Effort**: Low

---

### E-10: WebSocket Load Test Coverage

**File**: `server/loadtest/room-flow.js`
**Category**: Testing

k6 load test only covers HTTP endpoints. Doesn't exercise WebSocket operations which are the app's core:
- Room join/leave events
- Game state updates (reveal, clue)
- Concurrent player connections
- Timer callbacks under load

Performance targets (1,000+ rooms, 5,000+ connections) are unvalidated for WebSocket traffic.

**Note**: Overlaps with D-10. Recommend extending scope.

**Effort**: Medium

---

### E-11: Docker Build Layer Optimization

**File**: `server/Dockerfile`
**Category**: Infrastructure

Source file changes invalidate the entire build layer. Optimized ordering:
1. Copy `package*.json` + `prisma/schema.prisma` → install deps + Prisma generate
2. Copy `tsconfig*.json` → config layer
3. Copy `src/` → build layer (only invalidated by source changes)

Additionally, the production stage runs `npm ci --omit=dev` again instead of pruning from the builder stage.

**Effort**: Low–Medium

---

### E-12: Incomplete Mock Redis for Test Reliability

**File**: `server/src/__tests__/helpers/socketTestHelper.ts:280-435`
**Category**: Test Infrastructure

MockRedis is missing Redis operations used in the codebase:
- `hDel`, `hLen`, `hKeys`, `hVals` (hash operations)
- `zCard`, `zCount`, `zScore` (sorted set operations)
- `lRem`, `lSet` (list operations)

Also, mock pub/sub delivers synchronously (line 225-239) while real Redis is async, masking timing bugs.

**Effort**: Medium

---

### E-13: Race Condition in Replay Fetch

**File**: `server/src/frontend/history.ts:135-165`
**Category**: Frontend / Correctness

No AbortController when loading replay data. Rapidly switching replays causes concurrent fetches — old responses overwrite newer ones.

**Fix**: Use AbortController to cancel in-flight requests (pattern already used elsewhere).

**Effort**: Low

---

### E-14: Add `aria-label` to Replay Control Buttons

**File**: `index.html:615-622`
**Category**: Accessibility

Replay buttons use HTML entities as content without `aria-label`. Screen readers announce empty content:
```html
<button class="replay-btn" id="replay-prev" title="Previous Move">&#9664;</button>
<!-- Should have: aria-label="Previous move" -->
```

**Effort**: Trivial (4 buttons)

---

## Tier F: Medium-Value Improvements

### F-1: Gate Frontend Debug Logging

**Files**: `server/src/frontend/roles.ts:202-439` (15+ console.log/warn calls) and other modules
**Category**: Performance / Info Disclosure

Debug statements in production don't respect `state.isDebugMode`. Clutters browser console and exposes internal logic.

**Note**: Overlaps with D-3. Specific locations identified.

**Effort**: Low

---

### F-2: Non-Atomic Room TTL Refresh

**File**: `server/src/services/roomService.ts:460-481`
**Category**: Reliability

`refreshRoomTTL()` refreshes 5 separate Redis keys individually. Between operations, keys can expire.

**Fix**: Use a Lua script to atomically refresh all room-related keys.

**Effort**: Medium

---

### F-3: Team Switching Race Condition

**File**: `server/src/services/playerService.ts:278-338`
**Category**: Concurrency

`setTeam()` fetches `oldTeam` before calling Lua script. Between read and Lua execution, another request can change the team, causing the script to remove from wrong team set.

**Fix**: Pass current team to Lua and verify atomically inside the script.

**Effort**: Low

---

### F-4: Lock Release Failure Leaves Permanent Lock

**File**: `server/src/services/gameService.ts` (finally blocks)
**Category**: Reliability

Lock release in `finally` blocks can fail silently. Subsequent operations fail with "Another card reveal in progress" until TTL expires.

**Fix**: Add exponential backoff retry on lock release, or ensure lock TTL is short enough to self-heal.

**Effort**: Low

---

### F-5: Duplicate Test Mock Infrastructure

**Files**: `server/src/__tests__/helpers/mocks.ts` and `socketTestHelper.ts`
**Category**: Test Quality

`createMockPlayer()`, `createMockRoom()`, `createMockGame()`, `sleep()`, `flushPromises()` are duplicated between helpers.

**Fix**: Consolidate into single module, re-export for backward compatibility.

**Effort**: Low

---

### F-6: Test Timeout Too Low for Integration Tests

**File**: `server/jest.config.ts.js:20`
**Category**: Test Reliability

Global `testTimeout: 10000` (10s) is tight for integration tests with Socket.io setup and full game flows. Can cause intermittent CI failures.

**Fix**: Increase to 15-20s globally, or per-file `jest.setTimeout()` for integration tests.

**Effort**: Trivial

---

### F-7: Missing `data-i18n-placeholder` on Input Fields

**File**: `index.html:74-76,540,554,559`
**Category**: i18n

Several input placeholders hardcoded in English:
```html
<input placeholder="New nickname">
<input placeholder="Enter your name">
```

**Effort**: Low

---

### F-8: CSS Colorblind Mode Fragility

**File**: `server/public/css/accessibility.css:209-320`
**Category**: Maintainability

Colorblind mode uses selector overrides (`body.colorblind-mode .class`). If base styles gain higher specificity, overrides silently break.

**Fix**: Use CSS custom properties (`--team-red-color`) with colorblind mode changing variable values.

**Effort**: Medium

---

### F-9: Missing Composite Database Index

**File**: `server/prisma/schema.prisma`
**Category**: Performance

`GameParticipant` has individual indexes but no composite `(gameId, team)` for common "get all team players" queries. Also missing `(gameId, sessionId)` for anonymous lookups.

**Effort**: Trivial

---

### F-10: Docker Health Check Warmup Period

**File**: `server/Dockerfile`
**Category**: Infrastructure

`start_period=30s` may be insufficient if PostgreSQL migration runs on cold start.

**Fix**: Increase to `start_period=60s`.

**Effort**: Trivial

---

### F-11: Fake Timers Not Properly Scoped in Tests

**File**: `server/src/__tests__/timerService.test.ts:39`
**Category**: Test Quality

`jest.useFakeTimers()` at module level without cleanup can leak into other test suites.

**Fix**: Move to `beforeEach()/afterEach()` with `jest.useRealTimers()`.

**Effort**: Trivial

---

### F-12: Integration Tests Use Promise.all Without Isolation

**Files**: Multiple integration test files
**Category**: Test Quality

`Promise.all([...])` in concurrent tests doesn't isolate which promise failed.

**Fix**: Use `Promise.allSettled()` and check individual results.

**Effort**: Low

---

### F-13: AudioContext Initialization Error Recovery

**File**: `server/src/frontend/notifications.ts:26-35`
**Category**: UX

If `AudioContext` unavailable, user can "enable" sounds but never hears anything. No feedback.

**Fix**: Feature-detect upfront, disable toggle with tooltip when unavailable.

**Effort**: Low

---

### F-14: localStorage Failure Feedback

**File**: `server/src/frontend/utils.ts:225-254`
**Category**: UX

Settings appear to save in private browsing but don't persist. No user feedback.

**Fix**: Toast notification on first failure.

**Effort**: Low

---

### F-15: Reconnection Timeout Not Cleaned on All Exit Paths

**File**: `server/src/frontend/multiplayerUI.ts:15,505,509,530`
**Category**: Memory

`reconnectionTimeoutId` not cleared if user navigates away while reconnection overlay shows.

**Fix**: Clear timeout in `leaveMultiplayerMode()`.

**Effort**: Trivial

---

### F-16: Docker BuildKit Not Used in CI

**File**: `.github/workflows/ci.yml:138-139`
**Category**: CI/CD

Plain `docker build` without BuildKit cache mounts. Slower builds.

**Fix**: Enable `DOCKER_BUILDKIT=1` and use `--cache-from`.

**Effort**: Low

---

### F-17: Missing SECURITY.md and Dependabot Config

**Category**: Documentation / CI

No vulnerability disclosure policy or automated dependency updates. Already identified as D-12 and D-13 but trivial to implement — promoting for visibility.

**Effort**: Trivial

---

## Tier G: Low-Priority Polish

| ID | Description | File(s) | Category |
|----|-------------|---------|----------|
| G-1 | Console debug statements across frontend modules | Multiple | Code Quality |
| G-2 | Canvas QR context not cleared on modal close | game.ts, settings.ts | Memory |
| G-3 | No debounce on settings textarea input | settings.ts | Performance |
| G-4 | Duplicate "Loading..." hardcoded strings | Multiple | i18n |
| G-5 | Test module isolation — use `jest.isolateModulesAsync()` | Multiple test files | Test Quality |
| G-6 | Load test thresholds need real infrastructure baseline | loadtest/room-flow.js | Testing |
| G-7 | Source maps may ship in production Docker image | Dockerfile | Security |
| G-8 | CodeQL query config has redundant `security-extended` | codeql.yml:35 | CI |
| G-9 | E2E selectors use classes/IDs instead of `data-testid` | e2e/ | Test Fragility |
| G-10 | SRI hashes for vendored JS (D-7) | index.html | Security |
| G-11 | Admin dashboard accessibility (D-8) | admin.html | Accessibility |
| G-12 | i18n plural support (D-9) | i18n.ts + locales/ | i18n |
| G-13 | Redundant `jest.clearAllMocks()` in tests (config already has `clearMocks: true`) | Multiple test files | Code Quality |
| G-14 | History/replay trimming off-by-one | gameHistoryService.ts | Correctness |
| G-15 | Inconsistent timeout config (distributedLock.ts hardcodes vs. centralized TIMEOUTS) | distributedLock.ts | Consistency |
| G-16 | Mixed module export patterns (CJS + ES6) | env.ts, logger.ts | Consistency |
| G-17 | Hardcoded accessibility strings in board.ts (buildCardAriaLabel) | board.ts:19-26 | i18n / a11y |

---

## Relationship to Existing Tier D

| Tier D Item | Status in This Review |
|-------------|----------------------|
| D-1: Chat UI frontend | Unchanged — highest-value feature work remaining |
| D-2: i18n markup audit | **Expanded** → E-2, E-3, E-4, F-7 with specific file/line locations |
| D-3: Gate debug logging | **Expanded** → F-1 with specific file references |
| D-4: Split multiplayer.js | Unchanged — still valuable architectural work |
| D-5: Migrate to Lua | Reinforced by F-2 (non-atomic TTL refresh) |
| D-6: Chaos testing | Unchanged |
| D-7: SRI hashes | Moved to G-10 |
| D-8: Admin a11y | Moved to G-11 |
| D-9: i18n plurals | Moved to G-12 |
| D-10: Perf regression tests | **Expanded** → E-10 (add WebSocket scenarios) |
| D-11: .dockerignore | **Already complete** — files exist at root and server/ |
| D-12: SECURITY.md | Promoted to F-17 |
| D-13: Dependabot | Promoted to F-17 |
| D-14: ReDoS tests | Unchanged |

---

## Recommended Execution Order

### Sprint 1: Quick Wins (1-2 days)

High impact, low effort:

| Item | Effort | Impact |
|------|--------|--------|
| E-1: CI blocks on HIGH vulns | Trivial | Security |
| E-14: aria-label on replay buttons | Trivial | Accessibility |
| F-6: Increase test timeout | Trivial | CI stability |
| F-10: Docker health check warmup | Trivial | Infrastructure |
| F-11: Scope fake timers in tests | Trivial | Test reliability |
| F-15: Reconnection timeout cleanup | Trivial | Memory |
| F-17: SECURITY.md + Dependabot | Trivial | Documentation / CI |
| F-9: Composite DB indexes | Trivial | Performance |

### Sprint 2: i18n Completion (2-3 days)

Complete the i18n audit — the largest user-facing gap:

| Item | Effort | Impact |
|------|--------|--------|
| E-2: Multiplayer i18n | Medium | User-facing |
| E-3: Game status i18n | Medium | User-facing |
| E-4: Role hints i18n | Low–Medium | User-facing |
| F-7: Input placeholder i18n | Low | User-facing |
| F-1: Gate debug logging (D-3) | Low | Performance |
| G-4: "Loading..." strings | Low | i18n |
| G-17: Board a11y strings | Low | i18n / a11y |

### Sprint 3: Security & Correctness Hardening (2-3 days)

| Item | Effort | Impact |
|------|--------|--------|
| E-5: Timer expiration lock | Low | Concurrency |
| E-6: Admin dashboard XSS | Medium | Security |
| E-7: Admin broadcast validation | Low | Security |
| E-8: MemoryStorage _isExpired() | Low | Correctness |
| E-9: RedisClient type fixes | Low | Type safety |
| E-13: Replay fetch AbortController | Low | Correctness |
| F-3: Team switching race | Low | Concurrency |
| F-4: Lock release retry | Low | Reliability |

### Sprint 4: Test & CI Infrastructure (2-3 days)

| Item | Effort | Impact |
|------|--------|--------|
| E-11: Docker layer optimization | Low–Medium | Build speed |
| E-12: Mock Redis completeness | Medium | Test reliability |
| F-5: Consolidate test helpers | Low | Maintainability |
| F-12: Promise.allSettled in tests | Low | Test reliability |
| F-16: BuildKit in CI | Low | CI speed |
| G-13: Remove redundant clearAllMocks | Low | Cleanliness |

### Sprint 5: Feature Work & Architecture (ongoing)

Resume Tier D feature items:
- **D-1**: Chat UI frontend (highest user-visible impact remaining)
- **D-4**: Split multiplayer.ts (architectural health)
- **D-5**: Migrate transactions to Lua (performance + atomicity, reinforced by F-2)
- **E-10**: WebSocket load tests (validate perf targets)

---

## Summary

The codebase is in excellent shape. All 25 prior critical/high/medium issues are resolved. This review found:

- **0 new critical bugs** requiring immediate hotfix
- **2 concurrency gaps** (E-5: timer lock, F-3: team switch race)
- **1 XSS concern** (E-6: admin inline onclick handlers)
- **1 CI security gap** (E-1: HIGH vulns not blocking)
- **~15 i18n gaps** across 4 frontend modules (the largest single area)
- **6 test infrastructure improvements**
- **4 DevOps optimizations**
- **17 low-priority polish items**

The recommended path: quick wins first (Sprint 1), then i18n completion (the largest gap), then security/correctness hardening, then test infrastructure, and finally resume feature development.

---

*Review conducted: 2026-02-11 | Next review recommended after Sprint 3 completion*
