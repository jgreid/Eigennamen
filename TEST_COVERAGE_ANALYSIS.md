# Test Coverage Analysis

## Current State

**Overall**: 2,527 tests across 81 suites (80 passing, 1 failing). Coverage thresholds are met at 94%+ lines/statements overall.

**Failing test**: `moduleImports.test.ts` — detects 5 import/export mismatches in compiled frontend JS (`chat.js` missing, aliased re-exports from `debug.js` not matching). This is a real build artifact issue, not a test bug.

### Coverage by Module (from `npm run test:coverage`)

| Module | Statements | Branches | Functions | Lines | Assessment |
|--------|-----------|----------|-----------|-------|------------|
| **services/** | 87.98% | 79.27% | 90% | 88.47% | Good |
| **services/game/** | 97.06% | 86.53% | 100% | 97% | Excellent |
| **socket/handlers/** | 86.95% | 77.43% | 88.23% | 88.37% | Good |
| **socket/** (core) | 75.43% | 73.89% | 74.64% | 76.42% | Needs work |
| **middleware/** | 81.18% | 73.61% | 85.1% | 80.97% | Adequate |
| **middleware/auth/** | 80.1% | 71.42% | 81.25% | 81% | Adequate |
| **routes/** | 82.83% | 63.47% | 67.34% | 83.58% | Branches weak |
| **config/** | N/A (varies) | — | — | — | Mixed |
| **utils/** | 97.98% | 87.43% | 97.22% | 98.84% | Excellent |
| **validators/** | 96.15% | 90% | 85.71% | 97.36% | Excellent |
| **frontend/** | 65.74% | 53.84% | 62.5% | 65.78% | Weak |

---

## Priority 1: Critical Gaps

### 1. `connectionHandler.ts` — 28% line coverage

This is the socket connection orchestrator that wires up every handler, manages disconnect with timeout/abort, and handles socket errors. Only ~28% of lines are covered.

**What's missing**:
- The `handleConnection` function (lines 82-173) is almost entirely untested
- Disconnect flow with `AbortController` timeout logic
- Socket error handler
- `updateSocketCount` integration with the Express app
- `ensureSocketFunctionsRegistered` idempotency
- Fly.io instance ID assignment

**Why it matters**: This is the central wiring point for all socket connections. Bugs here (e.g., a handler failing to register, disconnect timeout not firing) would affect every connected client.

**Recommended tests**:
- Verify all 5 handler modules are registered on connection
- Verify disconnect handler is called with timeout protection
- Test abort signal behavior when disconnect times out
- Test socket error emission
- Test `updateSocketCount` called on connect (+1) and disconnect (-1)

### 2. `disconnectHandler.ts` — 64% line coverage

The disconnect handler manages player disconnection, reconnection tokens, host transfer with distributed locking, and timer expiration callbacks. Lines 88-168 (timer restart after expiration) are uncovered.

**What's missing**:
- Timer restart logic after expiration (the `setImmediate` async IIFE, lines 87-166)
- Redis health check before timer restart
- Lock acquisition/release for timer restart
- Room/game state checks before restarting timer
- Host transfer when the host reconnects before transfer completes (line 277-279 re-check)
- Failed atomic host transfer path (line 311)

**Why it matters**: Timer restart after expiration is a common game flow. The distributed lock logic here prevents double-restarts across instances — if this breaks, timers can fire twice or not restart at all.

**Recommended tests**:
- Test `createTimerExpireCallback` full flow: game found, turn ended, timer restarted
- Test timer restart skipped when Redis unhealthy
- Test timer restart skipped when lock not acquired
- Test timer restart skipped when game is over
- Test host reconnection race condition (host reconnects before transfer)

### 3. `playerHandlers.ts` — 73% line coverage (58% branches)

The spectator join request/approval flow (lines 291-365) is not covered.

**What's missing**:
- `spectator:requestJoin` event handler
- `spectator:approveJoin` event handler (both approve and deny paths)
- Validation that requester is actually a spectator
- Host socket lookup via `io.in().fetchSockets()`

**Recommended tests**:
- Test spectator requesting to join a team
- Test non-spectator being rejected from join flow
- Test host approving/denying a spectator join request
- Test behavior when host or requester socket not found

### 4. `playerService.ts` — 77% line coverage (70% branches)

Several important code paths are uncovered (lines 258-306, 462-465, 551-552, 861-869, 1041-1133, 1191-1220).

**What's missing**:
- `updatePlayer` WATCH/MULTI retry fallback (lines 258-306) — the code path when Lua script fails
- `atomicHostTransfer` edge cases
- Reconnection token validation and cleanup paths
- Player cleanup/expiry logic

**Recommended tests**:
- Test `updatePlayer` fallback to WATCH/MULTI when Lua fails
- Test WATCH/MULTI retry with transaction conflict (simulating a concurrent write)
- Test reconnection token validation with expired/invalid tokens
- Test `atomicHostTransfer` when old host or new host not found

---

## Priority 2: Moderate Gaps

### 5. `rateLimit.ts` (socket) — 70% line coverage

Lines 220-252 (LRU eviction) and 304-347 (metrics cleanup with threshold) are untested.

**What's missing**:
- `performLRUEviction` when entry count exceeds `MAX_TRACKED_ENTRIES`
- Metrics cleanup when `uniqueSockets` or `uniqueIPs` exceed threshold
- `cleanupStale` integration with LRU eviction

**Recommended tests**:
- Populate rate limiter beyond `MAX_TRACKED_ENTRIES`, verify LRU eviction removes oldest entries
- Test metrics set cleanup when threshold exceeded

### 6. `sessionValidator.ts` — 72% line coverage (66% branches)

Lines 80-122 (Redis rate-limiting with Lua script, memory fallback) and 297-303 are uncovered.

**What's missing**:
- `checkValidationRateLimit` with Redis available (Lua-based atomic incr+expire)
- Fallback to `checkMemoryRateLimit` when Redis fails
- Memory rate limit eviction when map exceeds max entries
- Rate limit exceeded path

**Recommended tests**:
- Test Redis-based rate limiting (under limit, at limit, over limit)
- Test fallback to memory when Redis throws
- Test memory rate limit map eviction

### 7. `replayRoutes.ts` — 45% line coverage (0% branches)

Only the route registration is covered; none of the handler logic is tested.

**What's missing**:
- Successful replay fetch
- Validation error (invalid roomCode/gameId format)
- Replay not found (404)
- Error handling path

**Recommended tests**:
- GET `/api/replays/:roomCode/:gameId` — valid request returning replay data
- GET with invalid gameId format — 400 validation error
- GET for nonexistent replay — 404
- Service error — 500

### 8. `adminRoutes.ts` — 82% line coverage (54% branches)

Many branch conditions are uncovered (lines 138, 162-163, 278-279, 415-416, 659-665, 734-819).

**What's missing**:
- Error/edge-case branches in admin API endpoints
- SSE metrics stream (lines 734-819, likely the `stats/stream` endpoint)
- Edge cases in room detail fetching, broadcast, and player kick operations

**Recommended tests**:
- Test SSE `/admin/api/stats/stream` endpoint
- Test admin endpoints with missing/invalid parameters
- Test error handling when underlying services fail

---

## Priority 3: Frontend Testing

### 9. Frontend modules — 66% overall, only 4/24 files have tests

The frontend has 24 TypeScript modules but only `board.ts`, `state.ts`, `utils.ts`, and `rendering.ts` have dedicated tests. Major untested modules:

| Module | What it does | Risk |
|--------|-------------|------|
| `game.ts` | Core game logic (card clicks, turn management) | High — user-facing game mechanics |
| `multiplayer.ts` | Socket.io connection, room join/create | High — multiplayer is the primary mode |
| `multiplayerListeners.ts` | Socket event handlers (state sync) | High — data consistency |
| `multiplayerSync.ts` | State synchronization between client/server | High — desyncs cause broken games |
| `chat.ts` | Chat message sending/receiving | Medium |
| `i18n.ts` | Internationalization (4 languages) | Medium — string lookup |
| `accessibility.ts` | Colorblind mode, keyboard navigation, screen reader | Medium — accessibility compliance |
| `timer.ts` | Turn timer UI display | Medium |
| `ui.ts` | DOM manipulation, modal management | Medium |
| `settings.ts` | Game settings UI | Low |
| `notifications.ts` | Browser notifications | Low |
| `history.ts` | Game history display | Low |
| `roles.ts` | Role selection UI | Low |
| `debug.ts` | Debug panel, state inspection | Low |

**Recommended approach**: Start with `game.ts` and the multiplayer modules since they contain the most logic that could break silently. These modules can be tested with jsdom (the frontend test infrastructure already uses it).

---

## Priority 4: Test Quality Issues

### 10. Existing failing test needs fixing

`moduleImports.test.ts` fails because:
1. `multiplayerListeners.js` and `multiplayerUI.js` import from `./chat.js` which doesn't exist as a compiled output
2. `state.js` imports aliased names (`setState as _setStateImpl`) from `debug.js` that don't match available exports

This indicates either a build step is missing, or the frontend TypeScript compilation produces incorrect output. This test is doing useful work (catching real issues), so the underlying build problem should be fixed rather than the test being modified.

### 11. Integration test coverage is narrow

There are only 4 integration test files:
- `fullGameFlow.integration.test.ts` — full game lifecycle
- `handlers.integration.test.ts` — handler integration
- `raceConditions.test.ts` — concurrency
- `timerOperations.test.ts` — timer flows

**Missing integration scenarios**:
- **Reconnection flow**: Player disconnects, gets token, reconnects with token, state is restored
- **Multi-room isolation**: Actions in one room don't leak to another
- **Game mode transitions**: Starting a new game after one ends
- **Word list integration**: Creating custom word list, then starting a game with it

### 12. No negative/security-focused test patterns for some endpoints

While `security.test.ts` and `securityHardening.test.ts` exist, specific attack scenarios are not always tested at the handler level:
- **Replay enumeration**: What happens when someone brute-forces room codes on the replay endpoint?
- **Cross-room actions**: Player in room A tries to send events targeting room B
- **Session fixation**: Reusing old session tokens after reconnection

---

## Summary: Top 5 Recommendations

1. **`connectionHandler.ts`** (28% coverage) — Write a dedicated test file. This is the lowest-coverage file with the highest blast radius.

2. **`disconnectHandler.ts` timer restart path** (lines 87-166 untested) — Add tests for the `setImmediate` async IIFE that restarts timers after expiration. This is a common game flow path.

3. **`replayRoutes.ts`** (45% coverage, 0% branches) — Add HTTP-level tests with supertest. This is a public endpoint and currently has no meaningful test coverage.

4. **Frontend `game.ts` + multiplayer modules** — The frontend is the weakest area overall (66% coverage, 17% file coverage). Start with `game.ts` since it contains core user-facing logic.

5. **`playerHandlers.ts` spectator flow** (lines 291-365 untested) — The entire spectator join request/approval feature has no test coverage.
