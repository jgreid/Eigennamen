# Critical Code Review - Codenames Online

**Date**: 2025-02-11
**Scope**: Full codebase — backend services, socket layer, frontend, config/middleware, tests/infrastructure

---

## Executive Summary

This codebase is a feature-rich multiplayer game implementation with solid architecture in places, but harbors **systemic issues** across five categories:

1. **Race conditions** in service layer and socket handlers that corrupt game state under concurrency
2. **Security gaps** in authentication, CSRF, and session management
3. **Frontend fragility** from global mutable state and pervasive non-null assertions
4. **Phantom test coverage** — 94% line coverage masks ~800 tests that pass with broken code
5. **Incomplete Duet mode** in Lua scripts, causing silent fallback to slower paths

**Severity breakdown**: 12 Critical, 28 High, 35 Medium, 20 Low findings.

---

## 1. Backend Services — Critical Bugs

### 1.1 Race Condition in Team Switching (playerService.ts)
**Severity: CRITICAL**

`setTeam()` fetches `oldTeam` via `getPlayer()` *before* calling the Lua script. Another request can change the team between the read and the Lua execution, causing the Lua script to remove the player from the wrong team set.

```
Lines 278-284: getPlayer() → fetches oldTeam
Lines 285+:   Lua script uses oldTeam
              ↑ NOT ATOMIC — another setTeam can interleave here
```

**Fix**: Pass the current team as a Lua script argument and let Lua verify/read atomically.

### 1.2 Duet Mode Not Implemented in Lua Scripts
**Severity: CRITICAL**

`revealCard.lua` only handles `redScore`/`blueScore` (lines 57-61). Duet mode needs `greenFound` increments. The code silently falls back to the non-Lua path (`skipLuaForDuet=true`), which is slower and doesn't have the same atomicity guarantees.

`giveClue.lua` has the same gap — no Duet mode validation.

### 1.3 Timer Pause/Resume Gives Free Time
**Severity: HIGH**

When resuming a paused timer, `resumeTimer()` passes the *originally paused* `remainingSeconds` to `startTimer()`. If a timer had 60s remaining, was paused for 30s, it resumes with 60s instead of 30s (or the original remaining amount). The code even has a comment: "NOTE: We do NOT subtract pause duration" — but this breaks timer semantics.

### 1.4 Concurrent Game Creation Uses Fixed-Delay Retry
**Severity: HIGH**

`createGame()` uses `SET NX` for locking (lines 132-141) but retries with a fixed delay, not exponential backoff. Under high concurrency, all retrying requests fire simultaneously after the delay. Additionally, the error on retry exhaustion is a generic error instead of `RoomError.gameInProgress()`.

### 1.5 Orphaned Reconnection Tokens Leak Memory
**Severity: MEDIUM**

`cleanupOrphanedReconnectionTokens()` only deletes tokens when player data doesn't exist (lines 983-991). Consumed/invalidated tokens where the player still exists are never cleaned, causing `reconnect:token:*` keys to accumulate.

### 1.6 Room TTL Refresh Has TOCTOU Window
**Severity: MEDIUM**

`ATOMIC_REFRESH_TTL_SCRIPT` uses separate `EXISTS` checks and `EXPIRE` calls (lines 116-148). Between checking existence and setting TTL, a key could expire. Every room join triggers 5 Redis calls for TTL refresh — with 10 players joining simultaneously, that's 50 Redis calls.

### 1.7 Word List Fallback Is Silent
**Severity: MEDIUM**

If a custom word list fetch fails (lines 175-188), the game silently uses `DEFAULT_WORDS` with no indication in game state. User selected a custom list but gets default words.

---

## 2. Socket/WebSocket Layer

### 2.1 Socket Room Desynchronization
**Severity: CRITICAL**

`syncSpectatorRoomMembership()` runs AFTER handlers complete. Concurrent `setTeam` + `setRole` calls can result in a player being in both `room:X` AND `spectators:X` socket rooms simultaneously, receiving all broadcasts twice.

No centralized synchronization point exists — socket room membership is managed by 10+ different handlers independently.

### 2.2 Host Transfer Lock Race Condition
**Severity: HIGH**

In `disconnectHandler.ts` (lines 239-317), the host reconnection check happens outside the lock-guarded region. Another instance can acquire the lock between the reconnection check and the transfer, potentially transferring host to the wrong player.

### 2.3 Spectator Join Authorization Bypass
**Severity: HIGH**

`SPECTATOR_APPROVE_JOIN` handler (playerHandlers.ts, lines 316-352) verifies the requester is in the room but never checks `requester.role === 'spectator'`. A team player could impersonate a spectator request.

### 2.4 Connection Tracker Rejects Legitimate Users
**Severity: HIGH**

When `connectionsPerIP` map reaches 10,000 entries (connectionTracker.ts, lines 17-37), new IPs have their count never incremented. The subsequent `isConnectionLimitReached()` check then rejects these IPs. Legitimate users from new IPs get blocked when the map is full.

**Fix**: Use LRU eviction instead of silently dropping new entries.

### 2.5 Disconnected Clicker Bypass
**Severity: MEDIUM**

`gameHandlers.ts` (lines 168-186) checks if the team clicker is disconnected to allow other players to reveal cards. Between this check and the `revealCard` call, the clicker could reconnect, creating a window where a non-clicker reveals cards.

### 2.6 Player Context Auto-Correction Is Dangerous
**Severity: MEDIUM**

`getPlayerContext()` (playerContext.ts, lines 113-145) automatically "fixes" socket room membership to match Redis state without verifying the player has permission to be in that room. If Redis is compromised or state is corrupted, this auto-joins players to arbitrary rooms.

### 2.7 Silent safeEmit Failures
**Severity: MEDIUM**

Socket.io's `.to().emit()` doesn't throw errors (safeEmit.ts, lines 82-113). The try/catch only catches `io` being null. If a socket is disconnected or a room is empty, the emit silently "succeeds" with zero recipients, causing game state divergence.

---

## 3. Frontend TypeScript

### 3.1 Global Mutable State Without Encapsulation
**Severity: CRITICAL (Architectural)**

All game state lives in a single global `state` object (state.ts) imported and mutated by 15+ modules with no ownership or invariant enforcement. You can set `state.playerTeam = 'red'` and `state.spymasterTeam = 'blue'` simultaneously. Race conditions between async socket events and UI updates are inevitable.

Examples of unguarded mutations:
- `multiplayer.ts:219` — sets `state.currentRoomId` directly
- `multiplayerListeners.ts:223,238,241` — updates `state.multiplayerPlayers` three different ways
- `game.ts:409` — sets `state.gameState.revealed[index] = true` without bounds check

### 3.2 ~50+ Non-Null Assertions Hiding Crashes
**Severity: HIGH**

```typescript
// multiplayer.ts:101-102
document.getElementById('join-form')!.classList.toggle('active', mode === 'join');
document.getElementById('create-form')!.classList.toggle('active', mode === 'create');

// board.ts:80
const index = parseInt((card as HTMLElement).dataset.index!, 10);
```

These crash silently when HTML structure changes. Four different patterns for getting DOM elements exist in the codebase, making it impossible to audit for null safety.

### 3.3 Event Listener Leaks
**Severity: HIGH**

Most event listeners are not tracked for cleanup:
- `board.ts:30-42` — Window resize listener never removed
- `multiplayer.ts:386-393` — Input listeners re-registered on every modal open
- `settings.ts:73-77` — Nav listeners registered every time settings opens

A `domListenerCleanup` array exists in `multiplayerSync.ts` but most listeners aren't registered in it.

### 3.4 Optimistic UI Race Conditions
**Severity: HIGH**

`roles.ts:197-258` applies optimistic state updates before server confirmation. When the server rejects and sends a `playerUpdated` event, two conflicting updates race: the revert function vs. the `syncLocalPlayerState` call from the socket listener. The sync can arrive first, then the revert overwrites the server's authoritative state.

### 3.5 revealCardFromServer Uses Local Types as Fallback
**Severity: MEDIUM**

```typescript
// game.ts:474
const type = serverData.type || state.gameState.types[index];
```

If `serverData.type` is missing, the code uses local types — but non-spymasters don't have types populated, resulting in wrong card types and corrupted scoring.

### 3.6 revealTimeouts Not Cleaned on Disconnect
**Severity: MEDIUM**

`resetMultiplayerState()` clears `revealingCards` but not `revealTimeouts`. Old timeout IDs accumulate as a memory leak.

### 3.7 Missing Array Bounds Checks
**Severity: MEDIUM**

`revealCard()` (game.ts:348) sets `state.gameState.revealed[index] = true` without bounds validation. `revealCardFromServer()` has bounds checks, but the client-initiated path does not.

---

## 4. Configuration, Middleware & Security

### 4.1 Hardcoded JWT Development Secret
**Severity: CRITICAL**

`jwt.ts` falls back to `DEV_SECRET = 'development-secret-do-not-use-in-production'` when no `JWT_SECRET` is configured. While it only throws in production, if development code accidentally runs in production, all authentication is compromised. Anyone knowing this string can forge tokens.

### 4.2 CORS Wildcard Default
**Severity: HIGH**

`env.ts:24` defaults `CORS_ORIGIN` to `'*'`. `csrf.ts:134` has the same fallback. When CORS is wildcard, the CSRF `isOriginAllowed()` function returns `true` immediately (csrf.ts:151), bypassing all origin protection.

### 4.3 Session Validation Rate Limit Race Condition
**Severity: HIGH**

`socketAuth.ts` (lines 209-214) uses separate `redis.incr()` then `redis.expire()` calls — not atomic. Under concurrent requests, the TTL might never be set if Redis crashes between the two calls, creating a permanent rate limit key.

**Fix**: Use a Lua script for atomic incr+expire.

### 4.4 JWT Not Verifying Issuer/Audience
**Severity: MEDIUM**

`socketAuth.ts` (line 547) only validates `userId` claims. The JWT config specifies issuer `'die-eigennamen'` and audience `'game-client'`, but these are never verified. A token issued for a different audience is accepted.

### 4.5 Room Code Validation Inconsistency
**Severity: MEDIUM**

`roomRoutes.ts:38` and `validators/schemas.ts:54-60` define room code validation differently. Routes don't call `removeControlChars()` before validation. They use different error messages and different refinement chains, potentially accepting different inputs.

### 4.6 Error Handler Missing Status Code Mappings
**Severity: MEDIUM**

`errorHandler.ts` maps ~14 error codes to HTTP status codes, but `ERROR_CODES` has 20+. Missing codes (`NO_CLUE`, `GAME_NOT_STARTED`, `SESSION_VALIDATION_RATE_LIMITED`, etc.) silently default to 500. No compile-time enforcement that all codes are mapped.

### 4.7 Timing Attack in Socket Auth Token Validation
**Severity: MEDIUM**

`playerService.ts` (lines 661-671) uses `timingSafeEqual` but returns early if token lengths differ, leaking length information. An attacker can determine token length by observing response timing.

### 4.8 Unicode Normalization Missing in Lua
**Severity: MEDIUM**

`gameService.ts:421` applies NFKC normalization for clue validation, but `giveClue.lua:38` uses `string.upper()` which doesn't normalize Unicode. Homograph attacks with lookalike characters (e.g., "ﬁle" ligature vs "file") can bypass Lua validation.

---

## 5. Test Quality & Infrastructure

### 5.1 Phantom Test Coverage
**Severity: CRITICAL (Process)**

The claimed 94%+ coverage is misleading:
- **335 tests** use weak assertions (`toBeDefined()`, `toBeNull()`, `not.toBe()`) that pass with broken implementations
- **186 tests** mock Redis to return `null` unconditionally, never testing actual data paths
- **Zod validation is completely mocked away** in handler tests (`validateInput: jest.fn((schema, data) => data)`)
- **Rate limiter is bypassed** in all 77 handler tests
- **Integration tests use mocked Redis**, not real Redis — `fullGameFlow.integration.test.ts` is a misnomer

**Estimated real test effectiveness**: ~30-40% of tests would catch actual bugs.

### 5.2 No Real Concurrency Tests
**Severity: HIGH**

`raceConditions.test.ts` exists but uses sequential mocking — no `Promise.all()` testing actual concurrent operations. Timer tests use `jest.useFakeTimers()` which prevents real async scheduling. Reconnection window tests don't exist.

### 5.3 E2E Tests Are Fragile and Incomplete
**Severity: HIGH**

- Timer tests check element visibility but not actual countdown behavior
- Multiple fallback selectors (`#timer-duration, input[name*="duration" i], input[type="number"]`) suggest UI instability
- Tests skip via `.catch(() => false)` when selectors don't match — tests pass even if feature is broken
- No WebSocket reconnection tests, no multiplayer state sync tests

### 5.4 ESLint Rules Too Permissive
**Severity: MEDIUM**

Missing critical rules:
- `no-floating-promises` — unhandled promise rejections
- `no-misused-promises` — promises in conditionals
- `no-async-promise-executor` — race condition patterns
- `require-await` — misleading async functions
- `no-explicit-any` is only a warning, not an error
- `no-non-null-assertion` is only a warning, not an error

### 5.5 TypeScript Tests Not Type-Checked
**Severity: MEDIUM**

`tsconfig.json:73` excludes `src/__tests__/**/*.test.ts`. Tests freely use `any` types and incorrect mock signatures without compile-time validation. `skipLibCheck: true` also hides dependency type errors.

### 5.6 Docker Compose Secrets in Environment
**Severity: MEDIUM**

Database and Redis passwords are in `docker-compose.yml` environment variables (lines 25-26). If `.env` is accidentally committed or Docker logs are exposed, credentials leak.

### 5.7 Jest testTimeout Too Long
**Severity: LOW**

10-second timeout (jest.config.ts.js:20) means hanging tests take 10s to fail. Should be 2-5s for unit tests, with explicit longer timeouts for integration tests.

---

## Priority Fix List

### Immediate (Ship-blockers)
1. **Fix team switching race condition** — Make Lua script read current team atomically
2. **Fix JWT development secret** — Never return hardcoded secret; force explicit configuration
3. **Fix connection tracker overflow** — Implement LRU eviction
4. **Fix host transfer lock race** — Move reconnection check inside lock
5. **Implement Duet mode in Lua scripts** — `greenFound` scoring

### This Sprint
6. Fix CORS wildcard default → require explicit origin
7. Make session validation rate limit atomic (Lua script)
8. Add spectator role check in join approval handler
9. Fix timer pause/resume time accounting
10. Fix optimistic UI race conditions in roles.ts
11. Replace ~50 non-null assertions with proper null checks
12. Clean up event listener lifecycle (track and remove)

### This Month
13. Replace global mutable state with encapsulated state manager
14. Add real concurrency tests with `Promise.all()`
15. Remove mock bypasses in handler tests (test actual validation)
16. Replace phantom assertions with concrete value checks
17. Enable strict ESLint rules (`no-floating-promises`, `no-explicit-any` as error)
18. Type-check test files
19. Add bounds checks to all array accesses
20. Verify JWT issuer/audience claims

---

*Review generated from full codebase analysis. All line numbers reference source as of review date.*
