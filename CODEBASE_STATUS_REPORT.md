# Codebase Status Report — Codenames Online

**Date**: 2026-02-11
**Scope**: Full codebase review (post-fix) across backend services, socket handlers, frontend, config/infrastructure, and test suite
**Branch**: `claude/code-review-feedback-NFCy9`

---

## Executive Summary

The codebase is a substantial multiplayer game implementation (~2,675 tests, 94%+ line coverage reported, 19 files across backend/frontend/Lua recently fixed). The recent fix pass addressed 12 critical and high issues, notably: atomic Lua team switching, Duet mode in revealCard.lua, JWT secret hardcoding, CORS defaults, connection tracker eviction, optimistic UI races, and session rate limiting atomicity.

**However**, significant issues remain. This report catalogs them honestly.

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 7 | Open |
| High | 16 | Open |
| Medium | 22 | Open |
| Low | 14 | Open |
| **Total** | **59** | |

The most consequential systemic issue is that the **test suite provides an illusion of coverage** — 2,538 tests pass, but Redis is fully mocked in "integration" tests, Lua scripts are never executed, and rate limiting is bypassed in all handler tests. Effective real coverage is estimated at 40-50%.

---

## 1. Critical Issues (Must Fix)

### C1. Integration Tests Are Fake
**Files**: `server/src/__tests__/integration/*.test.ts`
**Impact**: False confidence in system reliability

All "integration" tests mock Redis completely:
```javascript
jest.mock('../../config/redis', () => { const mockRedis = { get: jest.fn(...) } });
```
This means: Lua script atomicity, Pub/Sub delivery, transaction rollbacks, and connection failures are **never tested**. The `fullGameFlow.integration.test.ts` and `raceConditions.test.ts` are unit tests with real sockets, not integration tests.

**Recommendation**: Use Docker Compose with real Redis for integration tests; test actual Lua script execution.

---

### C2. Rate Limiting Bypassed in All Handler Tests
**Files**: `server/src/__tests__/gameHandlers.test.ts`, `*Handlers*.test.ts`
**Impact**: Rate limiting bugs invisible to test suite

Every handler test mocks out rate limiting:
```javascript
jest.mock('../socket/rateLimitHandler', () => ({
    createRateLimitedHandler: jest.fn((socket, eventName, handler) => handler)
}));
```
No test verifies that rate limiting actually blocks requests.

**Recommendation**: Add dedicated rate limiting tests with real timing; test handler behavior when rate-limited.

---

### C3. Memory Leak in roomSyncLocks Map
**File**: `server/src/socket/handlers/playerHandlers.ts:77-121`
**Impact**: Unbounded memory growth under player churn

The `roomSyncLocks` Map stores per-player mutex promises keyed by `sessionId:roomCode`. Entries are only deleted when the current promise reference matches. If a player disconnects mid-lock, the entry persists forever. No max size, no eviction, no periodic cleanup.

**Recommendation**: Add max size with LRU eviction, or use WeakRef pattern, or add cleanup on disconnect.

---

### C4. Reconnection Token Cleanup Race Condition
**File**: `server/src/services/playerService.ts:971-1005`
**Impact**: Valid reconnection tokens deleted while in use

`cleanupOrphanedReconnectionTokens` fetches a token ID, then deletes it. A player could reconnect between the fetch and deletion, causing their valid token to be destroyed.

**Recommendation**: Use atomic Lua script for cleanup (check-and-delete in one operation) or add a grace period.

---

### C5. Safety Timeout Clears Optimistic UI Without Revert
**File**: `server/src/frontend/roles.ts:251-257, 348-354, 436-443`
**Impact**: UI permanently desynced from server state

When the ack callback doesn't arrive within 5 seconds, the safety timeout calls `clearRoleChange()` (not `revertAndClearRoleChange()`). This leaves the optimistic UI in place without reverting to the pre-change state. The player sees one team/role but the server has another.

**Recommendation**: Change safety timeout to call `revertAndClearRoleChange()` instead of `clearRoleChange()`, or add periodic server state validation.

---

### C6. Duet Mode timerTokens Can Go Negative
**Files**: `server/src/scripts/revealCard.lua:103`, `server/src/services/game/revealEngine.ts:188`
**Impact**: Invalid game state

Both the Lua and TypeScript paths decrement `timerTokens` without checking it's > 0 first. If a neutral card is revealed when timerTokens is already 0, it goes to -1. The `<= 0` check catches this for game-over, but the negative value is written to state.

**Recommendation**: Guard with `if (game.timerTokens or 0) > 0 then game.timerTokens = game.timerTokens - 1 end`.

---

### C7. CORS_ORIGIN=null Bypasses Origin Validation
**File**: `server/src/middleware/csrf.ts:133-145`
**Impact**: CSRF protection weakened in default configuration

With the recent change to default CORS_ORIGIN to `null`, the CSRF middleware's `getAllowedOrigins()` returns `null`, which bypasses origin/referer validation entirely. Protection then relies solely on the `X-Requested-With` header check — which is bypassable with Flash/Java plugins in older browsers.

**Recommendation**: In production, require explicit CORS_ORIGIN or fail closed. Add startup check that warns and sets strict mode if CORS_ORIGIN is unset in production.

---

## 2. High Issues

### H1. Lock Release Failures Silently Ignored
**File**: `server/src/services/gameService.ts:250-256` and similar patterns
Lock release failures are caught and logged but don't prevent cascading lock timeouts. If a lock release fails, the next operation waits for TTL expiry.

### H2. Unsafe JSON.parse in roomService
**File**: `server/src/services/roomService.ts:237` and similar
Direct `JSON.parse` calls exist without try-catch. Should consistently use `tryParseJSON` wrapper. Corrupted Redis data causes uncaught exceptions.

### H3. Timer Resume with Corrupted pausedAt
**File**: `server/src/services/timerService.ts:366-392`
If `pausedAt` is missing or non-numeric (corrupted data), arithmetic produces `NaN`. Should validate `pausedAt` is a valid number before computing remaining time.

### H4. Session Hijacking via IP Mismatch Bypass
**File**: `server/src/middleware/socketAuth.ts:288-290`
When `IP_MISMATCH_ALLOWED=true`, sessions can be reused from different IPs without additional verification. Should add challenge-response or notify original IP.

### H5. TOCTOU in Team Member Validation for Card Reveal
**File**: `server/src/socket/handlers/gameHandlers.ts:173-196`
Team members are fetched to check if clicker is disconnected, but the clicker could reconnect between check and reveal. The Lua script provides the real validation, making this handler check potentially stale.

### H6. Stale Spymaster View After Room Join
**File**: `server/src/socket/handlers/roomHandlers.ts:119-128`
Game types sent to spymasters on join may be stale if a card was revealed between the data fetch and emission.

### H7. Connection Limit Bypass via X-Forwarded-For Spoofing
**File**: `server/src/socket/connectionTracker.ts` + `socketAuth.ts:134-147`
When `FLY_APP_NAME` is set, X-Forwarded-For is trusted automatically. An attacker can spoof arbitrary IPs to bypass connection limits. Should validate that requests come from actual Fly.io load balancers.

### H8. setupMultiplayerListeners Not Fully Idempotent
**File**: `server/src/frontend/multiplayerListeners.ts:607-616`
Game mode radio button listeners are added every time `setupMultiplayerListeners()` runs. The `state.multiplayerListenersSetup` guard prevents re-running the whole function, but if it's called after a `cleanupMultiplayerListeners()` + re-setup cycle, radio listeners accumulate.

### H9. Board Size Assumptions Without Cross-Validation
**Files**: `server/src/frontend/game.ts`, `board.ts`, `multiplayerSync.ts`
Multiple functions assume `words.length === types.length === 25`. If the server sends mismatched arrays (e.g., 24 words, 25 types), accessing `types[index]` may return undefined. No validation after sync.

### H10. CodenamesClient Null Safety Inconsistent
**Files**: `server/src/frontend/roles.ts:201`, `history.ts:19`, others
Some paths guard with `CodenamesClient &&` before access, others don't. If the socket client fails to load, `TypeError: Cannot read property 'isInRoom' of undefined` crashes the app.

### H11. Score Overflow in Duet Mode
**File**: `server/src/services/game/revealEngine.ts:76-83`
`greenFound` is incremented without upper bound check. While the win condition catches `>= greenTotal`, the value could theoretically exceed it in edge cases (e.g., board config change mid-game).

### H12. Audit Log Silent Truncation
**File**: `server/src/services/auditService.ts:220-232`
`lTrim` silently discards logs beyond 10,000. No archival, no warning when approaching limit. Compliance/forensics data lost.

### H13. Mock Redis Never Fails in Tests
**File**: `server/src/__tests__/helpers/mocks.ts`
All Redis mock operations succeed. Connection timeouts, key expiry, out-of-memory, and cluster failures are never simulated. Error recovery paths are untested.

### H14. Test File Proliferation Indicates Design Gaps
**Files**: 3 roomService test files, 3 playerHandlers test files, 2 gameHandlers test files
Multiple test files per module suggest gaps were discovered post-implementation and patched reactively. No systematic test design.

### H15. Pub/Sub is Synchronous in Test Mocks
**File**: `server/src/__tests__/helpers/mocks.ts`
Mock Redis `publish()` immediately executes handlers synchronously. Real Redis Pub/Sub is asynchronous. Message ordering issues and delivery race conditions are hidden.

### H16. CommonJS/ES6 Dual Export Pattern
**Files**: `server/src/config/jwt.ts`, `server/src/config/constants.ts`, `server/src/middleware/socketAuth.ts`
Functions exported via both `module.exports` and ES6 `export`. Consumers importing via different mechanisms may get different objects. Should standardize on one pattern.

---

## 3. Medium Issues

| # | Issue | File(s) |
|---|-------|---------|
| M1 | Off-by-one in history lazy trim (multiplier allows overgrowth) | `gameService.ts:109-112` |
| M2 | Reconnection token reuse (returns stale token without validity check) | `playerService.ts:849-870` |
| M3 | Missing version check in reveal fallback (concurrent reveals can increment to same version) | `gameService.ts:383` |
| M4 | Word list size TOCTOU (validated before and after cleaning) | `wordListService.ts:233-239` |
| M5 | Disconnect timeout doesn't clean partial state (host transfer lock held) | `socket/index.ts:240-260` |
| M6 | Memory rate limiter has no metrics (can't monitor stale entry accumulation) | `socketAuth.ts:158-172` |
| M7 | Reconnection token TTL may be too short for mobile (5 min vs old 15 min) | `securityConfig.ts:22` |
| M8 | player:setTeam rate limit too permissive (5 per 2 seconds) | `rateLimits.ts:37` |
| M9 | Missing error codes for Lua clue validation responses | `errorCodes.ts` |
| M10 | CSRF warning logs include full origin/referer (information disclosure) | `csrf.ts:76-77` |
| M11 | MemoryStorageClient interface incomplete (missing Redis methods) | `redis.ts:84-95` |
| M12 | Timer interval not cleared on all disconnect paths | `timer.ts` |
| M13 | Role change state machine doesn't prevent cross-button rapid clicks | `roles.ts:207/293/382` |
| M14 | Duplicate socket `connect()` calls possible | `multiplayer.ts:209-210` |
| M15 | Spectator count not initialized on join (shows 0 until first stats event) | `multiplayerUI.ts` |
| M16 | Dynamic import of history module has no timeout | `multiplayerListeners.ts:554-569` |
| M17 | Inconsistent nickname validation regex (Unicode vs ASCII) | `multiplayer.ts:186` vs `multiplayerUI.ts:468` |
| M18 | Duet score increments without greenTotal bounds | `revealEngine.ts:76-83` |
| M19 | Database email unique constraint on nullable field | `prisma/schema.prisma:25` |
| M20 | Lua scripts have inconsistent error response format | Various `.lua` |
| M21 | Duet board config values not runtime-validated to sum to 25 | `gameConfig.ts:51-61` |
| M22 | AdminRoutes defines local RoomData type duplicating canonical Room type | `adminRoutes.ts:41-56` |

---

## 4. Low Issues

| # | Issue | File(s) |
|---|-------|---------|
| L1 | Inconsistent error message capitalization across services | Multiple |
| L2 | TTL refresh failure silently caught (rooms could expire with players) | `roomService.ts:328-336` |
| L3 | Hardcoded BOARD_SIZE duplicated (25 in gameHistoryService vs constant) | `gameHistoryService.ts:207` |
| L4 | Dangling reconnection tokens not consumed after auth | `playerService.ts:637-650` |
| L5 | Unused `isRevealingCard` state variable (replaced by `revealingCards.size > 0`) | `state.ts:365` |
| L6 | New game debounce not reset on multiplayer error | `game.ts:82-85` |
| L7 | QR code generation error not communicated to user | `game.ts:276-346` |
| L8 | Missing focus restoration on modal close (accessibility) | `ui.ts`, `multiplayer.ts` |
| L9 | Toast messages not localized (hardcoded English) | Various |
| L10 | Spectator chat message length not validated | `multiplayerUI.ts:292-322` |
| L11 | Reconnecting boolean flag leaks session state to other players | `disconnectHandler.ts:225` |
| L12 | Memory mode URL matching too strict (`memory` vs `memory://`) | `roomConfig.ts:18` |
| L13 | Zod clue word regex limits to 10 word parts (arbitrary) | `schemas.ts:206` |
| L14 | GameError factory methods inconsistent (some classes have them, others don't) | `GameError.ts` |

---

## 5. What the Recent Fixes Got Right

The recent fix pass (commit `0d90db3`) addressed real issues effectively:

| Fix | Assessment |
|-----|-----------|
| **safeTeamSwitch.lua atomic key derivation** | Correct — eliminates the stale KEYS[2] race |
| **revealCard.lua Duet mode** | Correct — matches TypeScript revealEngine logic. `>=` comparison is consistent with TS |
| **JWT dev secret removal** | Correct — eliminates credential leakage. Tests updated appropriately |
| **CORS default to null** | Partially correct — prevents accidental wildcard but creates new C7 issue (see above) |
| **Connection tracker LRU eviction** | Good improvement — prevents IP map exhaustion DoS |
| **Spectator join authorization** | Correct — closes the spectator role bypass |
| **Game creation exponential backoff** | Good — reduces lock contention |
| **Session rate limit atomic Lua** | Correct — eliminates INCR/EXPIRE race |
| **Socket room sync mutex** | Good intent, but creates C3 (memory leak in locks map) |
| **Frontend null checks** | Correct — eliminates crashes from non-null assertions |
| **Optimistic UI race condition** | Good — prevents unrelated updates from overwriting optimistic state |
| **Frontend init guards** | Correct — prevents duplicate listener registration |

**Verdict**: 10 of 12 fixes are clean improvements. 2 introduced new issues (C3 memory leak, C7 CORS bypass).

---

## 6. Test Suite Reality Check

### Reported vs Effective Coverage

| Metric | Reported | Effective (Estimated) |
|--------|----------|----------------------|
| Statements | 75.72% | ~45% |
| Branches | 66.51% | ~35% |
| Functions | 80%+ | ~50% |
| Lines | 76.51% | ~45% |

**Why the gap?**
- Lua scripts never executed (atomic operations untested)
- Rate limiting bypassed in all handler tests
- Mock Redis always succeeds (error paths untested)
- Integration tests mock Redis (not real integration)
- Service mocks return hardcoded values (business logic not exercised)

### What's Actually Well-Tested
- PRNG determinism and hash functions
- Zod validation schemas
- Error class hierarchy
- Basic CRUD operations (when Redis mock behaves like real Redis)
- Frontend DOM rendering and ARIA labels
- Connection tracker counting logic

### What's Not Tested At All
- Concurrent operations with real Redis
- Rate limiting enforcement
- Redis failure recovery
- Multi-instance Socket.io synchronization
- Complete game flow (start to finish)
- Timer expiry during pause
- Admin endpoint authentication completeness
- XSS prevention end-to-end
- JWT token tampering resistance

---

## 7. Architecture Strengths

Despite the issues, the codebase has notable strengths:

1. **Clean separation of concerns**: Services, handlers, validators, and types are well-organized
2. **Typed error hierarchy**: `GameError` subclasses with factory methods enable structured error handling
3. **Lua scripts for atomicity**: The pattern of using Redis Lua for critical sections is sound
4. **Graceful degradation**: Works without Redis (memory fallback) and without PostgreSQL
5. **Discriminated union types**: Role change state machine in frontend uses TypeScript's type system well
6. **Comprehensive event system**: Socket events are centralized in `socketConfig.ts`
7. **i18n support**: Translation infrastructure exists for 4 languages
8. **Security middleware stack**: CSRF, rate limiting, Helmet, input validation with Zod

---

## 8. Recommended Action Plan

### Phase 1: Immediate (This Week)
1. **Fix C3**: Add cleanup/eviction to `roomSyncLocks` map
2. **Fix C5**: Change safety timeout to `revertAndClearRoleChange()`
3. **Fix C6**: Add timerTokens >= 0 guard in both Lua and TypeScript
4. **Fix C7**: Add production startup check for CORS_ORIGIN; fail closed or warn loudly

### Phase 2: Near-Term (Next 2 Weeks)
5. **Fix C1**: Create real integration tests with Docker Compose + Redis
6. **Fix C2**: Add rate limiting test suite (without mocking rate limiter)
7. **Fix C4**: Atomic token cleanup via Lua
8. **Fix H1**: Add lock release retry logic
9. **Fix H3**: Validate `pausedAt` before arithmetic

### Phase 3: Short-Term (This Month)
10. Consolidate fragmented test files (H14)
11. Fix JSON.parse safety (H2)
12. Standardize exports to ES6 only (H16)
13. Add frontend CodenamesClient null guards (H10)
14. Fix nickname regex inconsistency (M17)

### Phase 4: Medium-Term (This Quarter)
15. Add E2E tests with Playwright for complete game flows
16. Add error recovery tests (Redis failures, network partitions)
17. Add concurrent operation tests with real Redis
18. Complete i18n for toast messages (L9)
19. Accessibility audit: focus management, screen reader testing

---

## 9. Files Modified in Recent Fix Pass

| File | Changes |
|------|---------|
| `server/src/scripts/safeTeamSwitch.lua` | Atomic team key derivation |
| `server/src/scripts/revealCard.lua` | Full Duet mode support |
| `server/src/services/gameService.ts` | Lua Duet enablement, retry backoff, unused import cleanup |
| `server/src/config/jwt.ts` | Dev secret removal |
| `server/src/config/env.ts` | CORS default to null |
| `server/src/middleware/csrf.ts` | Handle null CORS_ORIGIN |
| `server/src/middleware/socketAuth.ts` | Atomic Lua rate limiting |
| `server/src/socket/connectionTracker.ts` | LRU eviction |
| `server/src/socket/handlers/playerHandlers.ts` | Spectator auth, sync mutex |
| `server/src/frontend/multiplayerSync.ts` | RevealTimeouts cleanup |
| `server/src/frontend/game.ts` | Bounds check, type fallback |
| `server/src/frontend/settings.ts` | Init guard |
| `server/src/frontend/multiplayer.ts` | Init guard, null checks |
| `server/src/frontend/multiplayerUI.ts` | Null checks |
| `server/src/frontend/board.ts` | Null check on clearTimeout |
| `server/src/frontend/multiplayerListeners.ts` | Optimistic UI race fix |
| `server/src/__tests__/socketAuth.test.ts` | Updated mocks for eval |
| `server/src/__tests__/jwt.test.ts` | Updated for null return |
| `server/src/__tests__/env.test.ts` | Updated for null CORS |

---

*Report generated from parallel analysis of 5 review areas covering all source files in the repository.*
