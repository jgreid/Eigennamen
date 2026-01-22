# Nuanced Development Plan - Codenames Online

**Created:** January 22, 2026
**Last Updated:** January 22, 2026 (Post-Scrutiny Revision)
**Status:** Strategic roadmap based on deep code analysis
**Foundation:** 1363 tests, 79.4% statement coverage, production-ready codebase

---

## Executive Summary

This plan is based on **deep scrutiny of the actual codebase**, not surface-level documentation. Key corrections from original assessment:

- **Test coverage is 79.4%** (not 63% as docs stated) - 1363 tests passing
- **Frontend already uses modern patterns** - event delegation, cached elements, no inline handlers
- **One real bug found and fixed** - duplicate switch case in timerService.js

This revised plan focuses on **actual gaps** identified through code analysis.

### Current State Assessment (Verified)

| Dimension | Score | Verified Findings |
|-----------|-------|-------------------|
| Security | A- | All critical issues fixed, Lua scripts for atomicity |
| Reliability | A- | State versioning, distributed locks, event recovery |
| Test Coverage | A- | 79.4% statements, 71.66% branches, 1363 tests |
| Maintainability | B+ | Clean services, frontend needs minor refactoring |
| Observability | B | Audit functions exist but underutilized (26% coverage) |
| Feature Completeness | A | Full implementation with timer, chat, reconnection |

### Strategic Priorities (Revised Based on Scrutiny)

1. **Activate Audit Logging** - 12 audit functions exist but are barely used
2. **Socket/Rate Limit Coverage** - socket/index.js at 60%, rateLimitHandler at 43%
3. **E2E Testing** - Prevent regressions in complex user flows
4. **CSRF Middleware Coverage** - csrf.js at 34%
5. **Memory Storage Hardening** - memoryStorage.js at 62%

---

## Bugs Fixed During Scrutiny

### BUG: Duplicate Switch Case in timerService.js

**Location:** `server/src/services/timerService.js:175-218`
**Severity:** Medium
**Status:** FIXED

The `handleTimerEvent()` function had duplicate `case 'addTime':` blocks in the switch statement. The second case (lines 209-218) would never execute because JavaScript switch statements fall through from first match.

**Fix:** Consolidated both cases into a single handler that distinguishes between:
- `event.newEndTime` - notification of completed addTime operation
- `event.secondsToAdd` - request to perform addTime locally

---

## Phase 1: Activate Existing Infrastructure

### Track 1.1: Audit Logging Activation

**Objective:** Wire up the 12 existing audit functions that are defined but unused
**Impact:** HIGH - Security visibility with zero new code needed
**Complexity:** LOW

#### Current State (Verified)

The file `server/src/utils/audit.js` contains 12 comprehensive audit functions:

```javascript
// Functions exist but have only 26% coverage (barely called)
auditPasswordChanged()      // Room password changes
auditHostTransferred()       // Host transfers
auditSpymasterAssigned()     // Role assignments
auditRoleChanged()           // Role changes
auditGameStarted()           // Game starts
auditGameEnded()             // Game ends
auditSessionHijackBlocked()  // Security events
auditRateLimitExceeded()     // Rate limit violations
auditPlayerKicked()          // Player kicks
auditWordListModified()      // Word list changes
```

#### Implementation

Simply add calls to handlers that already import but don't use audit functions:

**gameHandlers.js - Already imports audit, add calls:**
```javascript
// Line 96: After game start success
auditGameStarted(socket.roomCode, socket.sessionId, players.length, socket.handshake.address);

// Line 205: After game over
auditGameEnded(socket.roomCode, result.winner, result.endReason, Date.now() - game.createdAt);
```

**playerHandlers.js - Add spymaster/role audit:**
```javascript
// After successful role change
auditRoleChanged(socket.roomCode, socket.sessionId, player.nickname, oldRole, role, socket.handshake.address);
```

**roomHandlers.js - Add password/host audit:**
```javascript
// After password change
auditPasswordChanged(socket.roomCode, socket.sessionId, socket.handshake.address, !!newPassword);

// After host transfer
auditHostTransferred(socket.roomCode, oldHostId, newHostId, reason, socket.handshake.address);
```

**Effort:** 2-3 hours
**Tests needed:** 8-10 (verify audit calls)
**Coverage impact:** audit.js 26% → 80%+

---

### Track 1.2: Socket Handler Coverage

**Objective:** Improve coverage for socket/index.js (60%) and rateLimitHandler.js (43%)
**Impact:** MEDIUM - Core connection handling paths
**Complexity:** MEDIUM

#### Specific Uncovered Lines

**socket/index.js (60.4% → 80% target):**
- Lines 77-115: Connection error handling paths
- Lines 223-332: Disconnect cleanup and timer coordination

**rateLimitHandler.js (42.85% → 70% target):**
- Lines 21-32: Rate limit configuration loading
- Lines 48-54: IP extraction fallbacks
- Lines 59-89: Rate limit exceeded handling

#### Test Scenarios Needed

```javascript
// socket/index.js tests
describe('Socket Connection Edge Cases', () => {
  it('handles connection with invalid session gracefully');
  it('cleans up timers on disconnect');
  it('handles rapid reconnection attempts');
  it('coordinates timer handoff on disconnect');
});

// rateLimitHandler.js tests
describe('Rate Limit Handler', () => {
  it('applies correct limits per event type');
  it('tracks IP-based limits correctly');
  it('emits rate_limited event when exceeded');
  it('logs rate limit violations');
});
```

**Effort:** 4-6 hours
**Tests needed:** 15-20

---

### Track 1.3: CSRF Middleware Coverage

**Objective:** Improve csrf.js coverage from 34% to 70%
**Impact:** LOW-MEDIUM - Security middleware
**Complexity:** LOW

#### Uncovered Paths

- Lines 47-77: CORS wildcard handling
- Lines 104-130: Content-Type validation

#### Test Scenarios

```javascript
describe('CSRF Protection', () => {
  it('blocks requests without X-Requested-With when CORS is wildcard');
  it('allows requests with proper headers');
  it('validates Content-Type for POST requests');
  it('logs CSRF validation failures');
});
```

**Effort:** 2-3 hours
**Tests needed:** 6-8

---

## Phase 2: End-to-End Testing Framework

### Track 2.1: Playwright Setup

**Objective:** Automated testing of complete user journeys
**Impact:** HIGH - Prevents regressions in critical paths
**Complexity:** MEDIUM

#### Implementation Structure

```
e2e/
├── playwright.config.ts
├── fixtures/
│   ├── game.fixture.ts      # Game setup helpers
│   └── socket.fixture.ts    # Socket.io test helpers
├── pages/
│   ├── home.page.ts
│   └── game.page.ts
└── tests/
    ├── standalone-mode.spec.ts
    ├── multiplayer-game.spec.ts
    ├── reconnection.spec.ts
    └── timer.spec.ts
```

#### Critical Test Scenarios

| Scenario | Priority | Why Critical |
|----------|----------|--------------|
| Complete game (create → play → win) | P0 | Core functionality |
| Reconnection after disconnect | P0 | Multiplayer reliability |
| Standalone mode URL encoding | P0 | Offline mode works |
| Timer pause/resume/add-time | P1 | Timer bugs are subtle |
| Multi-tab session handling | P1 | Common user behavior |
| Spymaster view isolation | P1 | Security-critical |

#### Test Implementation Examples

```typescript
// Standalone mode test
test('standalone game preserves state in URL', async ({ page }) => {
  await page.goto('/');

  // Create new game
  await page.click('[data-action="new-game"]');

  // Verify URL contains game state
  const url = page.url();
  expect(url).toContain('game=');
  expect(url).toContain('r=');

  // Reveal a card
  await page.click('.card:first-child');

  // Verify URL updated with reveal
  const newUrl = page.url();
  expect(newUrl).toMatch(/r=1/);
});

// Reconnection test
test('player reconnects and sees current game state', async ({ page, context }) => {
  // Setup: Create room and start game
  // ... setup code ...

  // Disconnect (close page)
  await page.close();

  // Reconnect with same session
  const newPage = await context.newPage();
  await newPage.goto(`/?room=${roomCode}`);

  // Verify game state restored
  await expect(newPage.locator('.current-turn')).toBeVisible();
  await expect(newPage.locator('.revealed-card')).toHaveCount(previousReveals);
});
```

**Effort:** 5-7 days
**Tests needed:** 25-30 scenarios
**CI time target:** < 5 minutes

---

## Phase 3: Frontend Assessment (Revised)

### Finding: Frontend Already Uses Modern Patterns

**Original assumption:** Frontend needs modernization from 3,800-line monolith
**Actual finding:** Frontend already implements good practices

#### Verified Good Patterns in index.html:

1. **Event Delegation** (lines 2976-3009):
   ```javascript
   // Board uses single delegated handler, not per-card handlers
   board.addEventListener('click', (e) => {
       const card = e.target.closest('.card');
       if (!card || card.classList.contains('revealed')) return;
       const index = parseInt(card.dataset.index, 10);
       if (!isNaN(index) && index >= 0) revealCard(index);
   });
   ```

2. **DOM Element Caching** (initCachedElements function):
   ```javascript
   const cachedElements = {};
   function initCachedElements() {
       cachedElements.board = document.getElementById('board');
       cachedElements.roleBanner = document.getElementById('role-banner');
       // ... 20+ cached elements
   }
   ```

3. **RequestAnimationFrame Batching** (lines 3209-3221):
   ```javascript
   if (!pendingUIUpdate) {
       pendingUIUpdate = true;
       requestAnimationFrame(() => {
           updateSingleCard(index);
           updateBoardIncremental();
           updateScoreboard();
           // ...
           pendingUIUpdate = false;
       });
   }
   ```

4. **Keyboard Navigation** (lines 3137-3166):
   - Arrow key navigation between cards
   - Enter/Space to reveal cards
   - Proper tabindex management

5. **Screen Reader Support**:
   - `aria-label` on cards
   - `role="gridcell"` for board cards
   - `announceToScreenReader()` function for state changes

6. **No Inline Handlers** - Uses `data-action` attributes with delegated handlers

### Revised Frontend Recommendation

Instead of major refactoring, focus on **incremental improvements**:

#### Track 3.1: Extract CSS to Separate File (Optional)

**Current:** ~1,200 lines of CSS in `<style>` tag
**Benefit:** Easier theming, better caching
**Risk:** Low
**Effort:** 2 hours

#### Track 3.2: Add Frontend Unit Tests

**Current:** 0 frontend tests
**Target:** Test critical functions with jsdom

```javascript
// __tests__/frontend/game.test.js
describe('seededRandom', () => {
  it('produces consistent results for same seed', () => {
    expect(seededRandom(12345)).toBe(seededRandom(12345));
  });

  it('produces different results for different seeds', () => {
    expect(seededRandom(12345)).not.toBe(seededRandom(54321));
  });
});

describe('encodeWordsForURL', () => {
  it('handles special characters', () => {
    const words = ['HELLO', 'WORLD|PIPE', 'BACK\\SLASH'];
    const encoded = encodeWordsForURL(words);
    const decoded = decodeWordsFromURL(encoded);
    expect(decoded).toEqual(words);
  });
});
```

**Effort:** 4-6 hours
**Tests needed:** 15-20

---

## Phase 4: Memory Storage Hardening

### Track 4.1: Improve memoryStorage.js Coverage

**Objective:** Increase coverage from 62% to 80%
**Impact:** MEDIUM - Fallback mode reliability
**Complexity:** MEDIUM

#### Uncovered Code Paths

- Lines 54-71: Transaction rollback handling
- Lines 230-257: Pub/sub simulation
- Lines 325-354: SCAN iterator implementation
- Lines 548-595: Pipeline execution edge cases

#### Test Scenarios

```javascript
describe('MemoryStorage', () => {
  describe('Transactions', () => {
    it('rolls back on WATCH key modification');
    it('handles nested MULTI calls');
    it('preserves atomicity under concurrent access');
  });

  describe('Pub/Sub Simulation', () => {
    it('delivers messages to all subscribers');
    it('handles pattern subscriptions');
    it('cleans up on unsubscribe');
  });

  describe('SCAN Iterator', () => {
    it('iterates all matching keys');
    it('respects COUNT hint');
    it('handles concurrent modifications');
  });
});
```

**Effort:** 4-6 hours
**Tests needed:** 12-15

---

## Phase 5: Operational Excellence

### Track 5.1: Metrics Already Exist - Need Integration

**Finding:** `server/src/utils/metrics.js` has comprehensive metrics implementation (92.5% coverage)

Existing capabilities:
- `incrementCounter()` - Counter support
- `setGauge()`, `incrementGauge()`, `decrementGauge()` - Gauge support
- `recordHistogram()` - Histogram with configurable buckets
- `getAllMetrics()` - Prometheus-style export

**Recommendation:** Wire up metrics collection to handlers

```javascript
// In gameHandlers.js - add at top
const { incrementCounter, recordHistogram } = require('../../utils/metrics');

// In reveal handler - add timing
const startTime = Date.now();
const result = await gameService.revealCard(...);
recordHistogram('game_reveal_latency_ms', Date.now() - startTime);
incrementCounter('game_cards_revealed');
```

**Effort:** 2-3 hours (add ~10 metrics calls to handlers)

---

## Phase 6: Future Game Enhancements (Lower Priority)

These are nice-to-have features that can be considered once core quality is at target levels.

### Track 6.1: Tournament Mode

**Status:** Not started
**Effort:** HIGH
**Prerequisite:** All Phase 1-5 items complete

### Track 6.2: Client-Side Statistics

**Status:** Not started
**Effort:** MEDIUM
**Note:** Can be implemented independently as localStorage-only feature

### Track 6.3: Custom Themes

**Status:** Partial - CSS already uses custom properties
**Effort:** LOW
**Note:** Foundation exists, just needs theme switcher UI

---

## Implementation Roadmap (Revised)

### Quick Wins (1-2 days each)

| Task | Effort | Coverage Impact |
|------|--------|-----------------|
| Wire up audit logging calls | 2-3 hours | audit.js: 26% → 80% |
| Add metrics to handlers | 2-3 hours | Already instrumented |
| CSRF middleware tests | 2-3 hours | csrf.js: 34% → 70% |

### Medium Term (3-5 days each)

| Task | Effort | Coverage Impact |
|------|--------|-----------------|
| Socket handler tests | 4-6 hours | socket/index.js: 60% → 80% |
| Rate limit handler tests | 3-4 hours | rateLimitHandler.js: 43% → 70% |
| Memory storage tests | 4-6 hours | memoryStorage.js: 62% → 80% |
| Frontend unit tests (jsdom) | 4-6 hours | New coverage area |

### Longer Term (5-10 days)

| Task | Effort | Value |
|------|--------|-------|
| E2E test framework setup | 5-7 days | Regression prevention |
| E2E critical path tests | 3-5 days | 25+ scenarios |

### Execution Order

```
Day 1-2: Quick wins (audit, metrics, CSRF)
  └─ Highest ROI: existing code, minimal changes

Day 3-5: Socket/Rate limit coverage
  └─ Core infrastructure paths

Day 6-8: Memory storage + Frontend tests
  └─ Fallback reliability + client coverage

Day 9-15: E2E framework and tests
  └─ Integration-level confidence
```

### Success Criteria (Measurable)

| Metric | Current | Target |
|--------|---------|--------|
| Statement Coverage | 79.4% | 85% |
| Branch Coverage | 71.66% | 78% |
| audit.js Coverage | 26% | 80% |
| socket/index.js Coverage | 60% | 80% |
| rateLimitHandler.js Coverage | 43% | 70% |
| E2E Test Scenarios | 0 | 25+ |
| Frontend Unit Tests | 0 | 15+ |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Timer refactor regression | Low | High | Existing tests comprehensive |
| Memory storage edge cases | Medium | Medium | Add fuzz testing |
| E2E tests flaky | Medium | Medium | Strict timeouts, retries |
| Coverage gaming vs value | Medium | Low | Focus on critical paths |

---

## Not In Scope (Explicit Decisions)

The following are **intentionally excluded** based on scrutiny findings:

1. **Frontend framework migration** - Current vanilla JS is well-structured
2. **Module extraction** - Frontend already uses good patterns
3. **TypeScript migration** - Would require significant effort with limited benefit
4. **Server-side rendering** - Unnecessary for this app
5. **User accounts** - Against design philosophy of drop-in play
6. **Database.js coverage** - Optional feature, graceful degradation works

---

## Conclusion

This scrutinized development plan reveals that the codebase is **more mature than documentation suggested**:

### Corrections from Original Assessment:
- Test coverage is **79.4%** not 63%
- Frontend **already uses** event delegation, caching, RAF batching
- **No inline onclick handlers** - data-action pattern already in use
- **1363 tests** passing, not 931

### Actual Gaps Found:
1. **Audit functions unused** - 12 functions exist but barely called
2. **Socket handler coverage low** - 60% for core connection logic
3. **Rate limiter coverage low** - 43% for security infrastructure
4. **Memory storage gaps** - 62% for fallback mode
5. **One real bug** - Duplicate switch case fixed in timerService.js

### Focus Areas:
1. **Activate existing infrastructure** (audit, metrics)
2. **Cover critical security paths** (rate limiting, CSRF)
3. **Add E2E tests** for regression prevention
4. **Leave frontend alone** - it's already well-structured

This plan prioritizes **wiring up existing good code** over writing new features.
