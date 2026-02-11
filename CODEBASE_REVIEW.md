# Codebase Review & Development Plan

**Date**: 2026-02-11 (Deep Review)
**Scope**: Line-by-line review of all services, socket handlers, frontend modules, configuration, middleware, types, validators, infrastructure, and tests
**Version Reviewed**: v2.2.0 (commit f3da83e, post-Tier A hardening)
**Previous Reviews**: 2026-02-09 (Tiers 1-3), 2026-02-11 (Tier A completed)

---

## Executive Summary

Codenames Online (Die Eigennamen) is a **mature, production-ready** multiplayer web application. After completing Tiers 1-3 plus Tier A hardening (Zod schema hardening, timeout wrappers, documentation fixes), this deep line-by-line review examined every source file across all layers.

The codebase demonstrates **excellent engineering fundamentals**: strict TypeScript, comprehensive Zod validation, atomic Lua operations, defense-in-depth security, and 2,675+ tests. This review identified **2 critical bugs** and **8 high-priority issues** — **all now fixed**. **25+ medium-priority improvements** remain across backend services, socket handlers, frontend modules, and infrastructure.

### Scorecard

| Category | Score | Notes |
|----------|-------|-------|
| Type Safety | 10/10 | Zero `any` types, strict TS compilation, explicit Zod schemas |
| Security | 8/10 | Defense-in-depth strong; spectator handler bug + token invalidation gap found |
| Backend Testing | 9/10 | 2,308 tests across 77 suites, 94%+ coverage |
| Architecture | 9/10 | Clean service layer, atomic Lua ops, handler pattern, graceful degradation |
| Frontend Code | 8/10 | Good patterns; event listener leaks, i18n dead code, className misuse |
| Code Organization | 9/10 | Domain-split config, extracted handlers, modular CSS |
| Infrastructure | 9/10 | Multi-env Docker, Fly.io, CI/CD with 6 quality gates |
| Accessibility | 8/10 | WCAG 2.1 AA mostly; replay keyboard nav missing, focus gaps |
| Documentation | 9/10 | 15+ docs, 5 ADRs; directory references fixed, metrics current |

---

## Table of Contents

1. [Critical Issues](#1-critical-issues)
2. [High Priority Issues](#2-high-priority-issues)
3. [Backend Service Findings](#3-backend-service-findings)
4. [Socket Handler Findings](#4-socket-handler-findings)
5. [Frontend Findings](#5-frontend-findings)
6. [Security Findings](#6-security-findings)
7. [Configuration & Middleware Findings](#7-configuration--middleware-findings)
8. [Infrastructure & Testing Findings](#8-infrastructure--testing-findings)
9. [Development Plan](#9-development-plan)

---

## 1. Critical Issues

### CRIT-1: Spectator Join Handler Signatures Wrong (playerHandlers.ts)

**File**: `server/src/socket/handlers/playerHandlers.ts`, lines 282-283, 314-315
**Severity**: CRITICAL — handlers are non-functional

The `spectator:requestJoin` and `spectator:approveJoin` handlers pass `io` as the first argument to `createRoomHandler`/`createHostHandler`, but these factory functions expect `socket` first:

```typescript
// BROKEN: 5 params with io first
socket.on(SOCKET_EVENTS.SPECTATOR_REQUEST_JOIN, createRoomHandler(
    io, socket, 'spectator:requestJoin', handler, schema
));

// CORRECT pattern used by all other handlers: 4 params, socket first
socket.on(SOCKET_EVENTS.PLAYER_KICK, createHostHandler(
    socket, SOCKET_EVENTS.PLAYER_KICK, schema, handler
));
```

**Impact**: Spectator join request/approval flow is completely broken. The `io` server instance is being passed where a `socket` is expected, causing the handler to fail silently or behave unpredictably.

**Fix**: Rewrite to match the 4-parameter pattern, passing `io` through closure instead.

---

### CRIT-2: No Maximum Word Count Validation — DoS Vector (wordListService.ts + settings.js)

**File**: `server/src/services/wordListService.ts`, lines 232-244
**File**: `server/public/js/modules/settings.js`, `parseWords()` function
**Severity**: CRITICAL — denial of service

Neither the backend `createWordList`/`updateWordList` nor the frontend `parseWords()` enforces a maximum word count. The minimum (25 words for BOARD_SIZE) is validated, but a user can submit an arbitrarily large word list (100,000+ words).

**Impact**: Memory exhaustion on server (Redis storage) or client (DOM rendering). Could crash the server or Redis instance.

**Fix**: Add `max(10000)` to word list Zod schema; add frontend validation cap.

---

## 2. High Priority Issues

### HIGH-1: Player Kick Does Not Invalidate Reconnection Token

**File**: `server/src/socket/handlers/playerHandlers.ts`, lines 227-266
**Severity**: HIGH — security issue

When a host kicks a player, `playerService.removePlayer()` is called but `invalidateRoomReconnectToken()` is NOT called. The kicked player retains a valid reconnection token and could rejoin the room within the 5-minute TTL window.

**Compare**: Explicit leave (`room:leave`) DOES invalidate the token. Kick should do the same.

**Fix**: Add `await playerService.invalidateRoomReconnectToken(validated.targetSessionId)` before `removePlayer()`.

---

### HIGH-2: cleanupOldHistory May Delete Wrong Games (gameHistoryService.ts)

**File**: `server/src/services/gameHistoryService.ts`, line 672
**Severity**: HIGH — data loss risk

```typescript
const oldGameIds = await redis.zRange(indexKey, 0, -(MAX_HISTORY_PER_ROOM + 1));
```

Redis `zRange` with `0` to `-(N+1)` returns entries from the start up to (but excluding) the Nth element from the end. If the sorted set is ordered by timestamp ascending (oldest first), this correctly returns the oldest entries to delete. However, if `zAdd` uses timestamps as scores (which it does), and entries are in ascending order, the range `0..-6` on a 5-element set would return an empty array — meaning no cleanup ever happens until the set grows to `MAX_HISTORY_PER_ROOM + 1` entries. The logic needs verification against the actual sort order and set size.

**Fix**: Verify `zRange` behavior with negative indices against the sorted set direction. Add integration tests for cleanup.

---

### HIGH-3: Localized Word Lists Loaded But Never Used (i18n.js)

**File**: `server/public/js/modules/i18n.js`, lines 80-86
**Severity**: HIGH — dead code / broken feature

When a non-English language is selected, `state.localizedDefaultWords` is populated from the localized word list file. However, `game.js` never reads `state.localizedDefaultWords` — it always uses `state.activeWords` set by `settings.js`. The localized word lists (German, Spanish, French) are loaded asynchronously but then completely ignored.

**Impact**: Non-English users always get English words even though the UI says their language is active. This is a visible user-facing bug.

**Fix**: Wire `state.localizedDefaultWords` into the word selection logic in `game.js` when word source is `'default'`.

---

### HIGH-4: escapeHTML Misused in CSS className Context (history.js)

**File**: `server/public/js/modules/history.js`, lines 66, 161
**Severity**: HIGH — incorrect API usage

```javascript
winnerDiv.className = `history-item-winner ${escapeHTML(game.winner)}`;
```

`escapeHTML()` converts `<`, `>`, `&` to HTML entities — but CSS class names don't interpret HTML entities. If `game.winner` contained `&` it would produce class name `history-item-winner &amp;` which is an invalid CSS class. The correct approach is to validate against expected values (`'red'` or `'blue'`).

**Fix**: Replace with `game.winner === 'red' ? 'red' : 'blue'` whitelist check.

---

### HIGH-5: Event Listener Accumulation in History Replay (history.js)

**File**: `server/public/js/modules/history.js`, lines 307-355
**Severity**: HIGH — memory leak

`setupReplayControls()` clones replay control buttons via `cloneNode(true)` and attaches new event listeners each time it's called. If a user opens multiple replays in succession, each call creates new cloned nodes with fresh listeners. While `replaceChild` removes old nodes, the pattern accumulates closure memory and doesn't track/cleanup consistently.

**Fix**: Use event delegation on a stable parent element or maintain button references and remove/re-add listeners.

---

### HIGH-6: refreshRoomTTL Error Propagation Unhandled (roomService.ts)

**File**: `server/src/services/roomService.ts`, line 342 (caller in `joinRoom`)
**Severity**: HIGH — room expiration during active game

`refreshRoomTTL` is `await`ed and wrapped in `withTimeout`, which is good. However, if the Lua script or timeout fails, the error propagates to `joinRoom` and the entire join fails. More critically, other callers (game actions) may not refresh TTL at all, meaning a room with a slow Redis could expire mid-game.

**Fix**: Wrap `refreshRoomTTL` calls in try-catch with warning log; room should not expire if a single TTL refresh fails.

---

### HIGH-7: Accessibility Keyboard Listener Leak (accessibility.js)

**File**: `server/public/js/modules/accessibility.js`, lines 94-169
**Severity**: HIGH — progressive memory leak

The keyboard shortcut overlay adds a `closeOnEsc` listener to `document` that self-removes when Escape is pressed. But if the overlay is closed by clicking (not pressing Escape), the keyboard listener persists. Opening/closing the overlay repeatedly without pressing Escape accumulates listeners.

**Fix**: Store the listener reference and remove it in all close paths (click and keypress).

---

### HIGH-8: connectionsPerIP Map Unbounded Under IP Spoofing (connectionTracker.ts)

**File**: `server/src/socket/connectionTracker.ts`, lines 27-43
**Severity**: HIGH — memory DoS

The `connectionsPerIP` Map uses raw IP strings as keys with no max size check. An attacker controlling `X-Forwarded-For` headers could generate millions of unique IPs, growing the map unboundedly between cleanup cycles (every 5 minutes).

**Fix**: Add LRU eviction or max Map size cap (e.g., 10,000 entries). Reject connections when map is full.

---

## 3. Backend Service Findings

### gameService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| GS-1 | Non-atomic room status + TTL update after game creation | Medium | 474-486 |
| GS-2 | `types[index] as CardType` non-null assertion without bounds check | Medium | 676, 678 |
| GS-3 | Clue number validation allows 26 (should max at BOARD_SIZE=25) | Low | 1249 |
| GS-4 | History array lazy slicing allows 1.5x growth before cleanup | Low | 622-626 |
| GS-5 | Lock release `.catch()` may swallow important errors | Medium | 492-498 |

### playerService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| PS-1 | Optimistic locking retry loop can silently lose updates | Medium | 240-271 |
| PS-2 | `setNickname` doesn't validate minimum length (empty string possible) | Medium | 455-456 |
| PS-3 | Orphaned team set cleanup has TOCTOU race condition | Medium | 515-519 |
| PS-4 | `resetRolesForNewGame` updates each player individually (N Redis ops) | Medium | 1166-1172 |
| PS-5 | Reconnection token can be consumed via two separate paths | Medium | 679-709, 955 |
| PS-6 | `cleanupOrphanedReconnectionTokens` scan could be expensive | Medium | 1002-1018 |
| PS-7 | `getRoomStats` double-iterates players (2x O(n)) | Low | 1140-1152 |

### roomService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| RS-1 | `joinRoom` has TOCTOU between getRoom and Lua script | Medium | 275-302 |
| RS-2 | `updateSettings` validates keys but not values (team names unvalidated) | Medium | 428 |
| RS-3 | Blitz mode timer constraint applied after settings update (brief invalid state) | Low | 442-444 |
| RS-4 | `leaveRoom` doesn't validate room code is non-empty | Medium | 363 |
| RS-5 | Fallback host transfer (non-Lua path) is non-atomic | Medium | 387-389 |

### timerService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| TS-1 | Pause duration not subtracted from remaining time | Medium | 372-398 |
| TS-2 | Local timer state can desync from Redis on write failure | Medium | 223-226 |
| TS-3 | `addTimeLocal` doesn't validate roomCode | Medium | 420-421 |
| TS-4 | Timer expiry callback doesn't verify owning instance | Medium | 164-183 |
| TS-5 | `getTimerStatus` doesn't account for clock skew | Low | 273 |

### wordListService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| WL-1 | **No max word count** — CRITICAL (see CRIT-2) | Critical | 232 |
| WL-2 | Word deduplication is silent (user not warned) | Low | 237-241 |
| WL-3 | `getPublicWordLists` returns empty array silently when DB disabled | Medium | 137-138 |
| WL-4 | `incrementUsageCount` fire-and-forget (never awaited) | Low | 424-426 |
| WL-5 | Pagination offset not validated (could be negative) | Medium | 166 |

### gameHistoryService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| GH-1 | **cleanupOldHistory index direction** — HIGH (see HIGH-2) | High | 672 |
| GH-2 | `getFirstTeam` fragile logic (assumes redTotal=9 means red goes first) | Medium | 420-425 |
| GH-3 | Duplicate history index entries if same game saved twice | Medium | 385-386 |
| GH-4 | `buildReplayEvents` doesn't handle corrupted entries | Medium | 561 |
| GH-5 | Pipeline not error-safe (partial success possible) | Medium | 380-394 |

### auditService.ts

| ID | Issue | Severity | Line |
|----|-------|----------|------|
| AS-1 | Memory mode audit logs never expire (memory leak) | Medium | 127-145 |
| AS-2 | Audit log pagination missing (no offset, only limit) | Medium | 254-272 |
| AS-3 | Severity classification incomplete (new events default to 'low') | Low | 151-176 |

---

## 4. Socket Handler Findings

### Critical

| ID | Issue | File | Line |
|----|-------|------|------|
| SH-1 | **Spectator handler signatures wrong** (CRIT-1) | playerHandlers.ts | 282, 314 |
| SH-2 | **Kick doesn't invalidate token** (HIGH-1) | playerHandlers.ts | 227-266 |

### Medium

| ID | Issue | File | Line |
|----|-------|------|------|
| SH-3 | Chat handlers use raw `io.to().emit()` instead of `safeEmit` | chatHandlers.ts | 80-106 |
| SH-4 | `game:clue` handler missing `withTimeout()` wrapper | gameHandlers.ts | 278-284 |
| SH-5 | Room stats re-fetched on every setTeam/setRole/setNickname | playerHandlers.ts | 144, 182 |
| SH-6 | Reconnect handler joins socket rooms after potentially stale fetch | roomHandlers.ts | 453-469 |
| SH-7 | `spectator:requestJoin` chat handler not marked async | chatHandlers.ts | 114 |

### Low

| ID | Issue | File | Line |
|----|-------|------|------|
| SH-8 | All files export both CommonJS and ES6 (redundant) | all handlers | — |
| SH-9 | Inconsistent defensive checks (`requireTeam` not standardized) | gameHandlers.ts | 164-165 |

---

## 5. Frontend Findings

### Critical / High

| ID | Issue | File | Severity |
|----|-------|------|----------|
| FE-1 | **Localized words never used** (HIGH-3) | i18n.js:80-86 | High |
| FE-2 | **escapeHTML in className** (HIGH-4) | history.js:66,161 | High |
| FE-3 | **Event listener accumulation** (HIGH-5) | history.js:307-355 | High |
| FE-4 | **Keyboard listener leak** (HIGH-7) | accessibility.js:94-169 | High |

### Medium

| ID | Issue | File | Line |
|----|-------|------|------|
| FE-5 | Replay board has no keyboard navigation or ARIA roles | history.js | 181-192 |
| FE-6 | `response.json()` not wrapped in try-catch (history URL replay load) | history.js | 465-502 |
| FE-7 | Replay playback: rapid toggle can create duplicate intervals | history.js | 357-387 |
| FE-8 | Nickname validation regex differs from constants.js pattern | multiplayer.js | 174 |
| FE-9 | `fitCardText` causes layout thrashing (read/write loop per card) | utils.js | 195-207 |
| FE-10 | No max word length validation in `parseWords()` | settings.js | 135-140 |
| FE-11 | Hardcoded English strings in game.js, roles.js, multiplayer.js | multiple | — |
| FE-12 | `role:change` stale closure in two-phase team+role operation | roles.js | 261-355 |

### Low

| ID | Issue | File | Line |
|----|-------|------|------|
| FE-13 | Magic numbers in `fitCardText` font size thresholds | utils.js | 181-187 |
| FE-14 | `multiplayerEventNames` array manually maintained | multiplayer.js | 1219 |
| FE-15 | Missing focus management when replay board renders | history.js | 181-192 |

---

## 6. Security Findings

### 6.1 Strengths (All Maintained)

- Input validation via Zod at all socket and REST entry points with Unicode-aware regex
- Rate limiting per-event with LRU eviction and in-memory fallback
- CSRF protection via `X-Requested-With` header + origin validation; violations audit-logged
- Session security: 8h age limits, IP consistency enforcement, atomic token rotation
- JWT hardening: production rejects dev secrets, enforces minimum secret length
- Helmet.js with enhanced CSP, HSTS, X-Frame-Options, Referrer-Policy
- Spymaster data protection: `getGameStateForPlayer()` strips card types
- NFKC Unicode normalization for clue validation
- Distributed locks for concurrent operations with owner-verified release
- Audit logging with severity levels and in-memory fallback
- Non-root Docker user

### 6.2 New Findings

| ID | Issue | Severity | Description |
|----|-------|----------|-------------|
| SEC-1 | Kicked player retains reconnection token | High | See HIGH-1 |
| SEC-2 | Reconnection token dual consumption paths | Medium | Token validated by both `validateSocketAuthToken` and `validateRoomReconnectToken` — could allow double-use |
| SEC-3 | Session age validation uses `connectedAt` fallback | Medium | `socketAuth.ts` falls back to `connectedAt` (last reconnect) instead of `createdAt` — frequent reconnectors never hit 8h limit |
| SEC-4 | JWT secret length only warned, not enforced in production | Medium | Short JWT secrets produce warning log but server starts anyway |
| SEC-5 | `connectionsPerIP` map unbounded | High | See HIGH-8 |
| SEC-6 | CSRF doesn't validate Content-Type | Low | Only requires `X-Requested-With` header; adding Content-Type check is defense-in-depth |
| SEC-7 | `toEnglishLowerCase()` not used consistently for room codes | Low | `csrf.ts` and `socketAuth.ts` use default `.toLowerCase()` — Turkish locale could cause mismatches |

---

## 7. Configuration & Middleware Findings

### Configuration

| ID | Issue | File | Severity |
|----|-------|------|----------|
| CF-1 | `DATABASE_URL` substring check for `'skip'` is fragile | env.ts | Medium |
| CF-2 | Host transfer lock TTL reduced to 3s (may be too aggressive) | securityConfig.ts | Medium |
| CF-3 | Error code `NO_CLUE` defined but never used | errorCodes.ts | Low |
| CF-4 | `SAFE_ERROR_CODES` includes `GAME_NOT_STARTED` with no factory method | GameError.ts | Low |
| CF-5 | Timeout values not configurable via env vars | timeout.ts | Medium |

### Middleware

| ID | Issue | File | Severity |
|----|-------|------|----------|
| MW-1 | Memory-based rate limit fallback has no LRU eviction | socketAuth.ts | Medium |
| MW-2 | `redis.expire()` in validation rate limit not atomic with `redis.incr()` | socketAuth.ts | Medium |
| MW-3 | Validation middleware mutates `req.body`/`req.query` directly | validation.ts | Low |
| MW-4 | Malformed CSRF origin silently returns false (no security log) | csrf.ts | Low |

### Validators

| ID | Issue | File | Severity |
|----|-------|------|----------|
| VL-1 | Word list schema doesn't validate uniqueness | schemas.ts | Medium |
| VL-2 | Reconnection token: redundant length check + regex | schemas.ts | Low |
| VL-3 | Clue word regex not tested against ReDoS attacks | schemas.ts | Medium |

---

## 8. Infrastructure & Testing Findings

### Infrastructure

| ID | Issue | Severity | Description |
|----|-------|----------|-------------|
| INF-1 | Docker Compose missing resource limits | Medium | No memory/CPU caps on containers |
| INF-2 | No `.dockerignore` file | Low | Node_modules, .git included in Docker context |
| INF-3 | No `SECURITY.md` vulnerability disclosure policy | Low | |
| INF-4 | No Dependabot configuration | Low | No automated dependency updates |
| INF-5 | CI lacks `timeout-minutes` on jobs | Low | Runaway tests could hang indefinitely |
| INF-6 | E2E tests only run on Chromium | Low | Firefox/Safari not tested |
| INF-7 | Missing XS breakpoint (<480px) for very small phones | Low | responsive.css |

### Testing Gaps

| ID | Issue | Severity | Description |
|----|-------|----------|-------------|
| TG-1 | No tests for malformed WebSocket messages | Medium | Could cause unhandled errors |
| TG-2 | No tests for spectator join flow (CRIT-1 fixed, tests still needed) | Medium | |
| TG-3 | No ReDoS regression tests for clue regex | Medium | |
| TG-4 | No cleanup/history index correctness integration tests | Medium | |
| TG-5 | E2E selectors use classes/IDs instead of `data-testid` | Low | Fragile against CSS refactors |

---

## 9. Development Plan

### Previously Completed (Tiers 1-3 + Tier A)

All items from Tiers 1, 2, 3, and Tier A remain completed and verified:
- Magic numbers, safe JSON, Redis keys, Zod builders, token validation ✅
- Domain split, auth refactor, connection tracker, frontend tests, focus trap ✅
- setState docs, retry logic, loading states, staging, backups, Docker ✅
- Zod `.passthrough()` removal, timeout wrappers, IP docs, directory refs ✅
- Multiplayer E2E tests (11 tests) ✅

### Tier A: Critical Fixes ✅ COMPLETED

| ID | Task | Description | Status |
|----|------|-------------|--------|
| CRIT-1 | Fix spectator handler signatures | Corrected to 4-param pattern with `io` from closure | ✅ |
| CRIT-2 | Add max word count validation | Server: MAX_WORD_LIST_SIZE=10000; Client: parseWords cap | ✅ |

### Tier B: High Priority Fixes ✅ COMPLETED

| ID | Task | Description | Status |
|----|------|-------------|--------|
| HIGH-1 | Invalidate token on player kick | Token invalidated before removePlayer | ✅ |
| HIGH-2 | Verify history cleanup index direction | Verified correct — returns only excess entries | ✅ |
| HIGH-3 | Wire localized words into game logic | localizedDefaultWords merged in initGame() | ✅ |
| HIGH-4 | Fix className escapeHTML misuse | Replaced with 'red'/'blue' whitelist check | ✅ |
| HIGH-5 | Fix event listener accumulation in replays | Event delegation on .replay-controls | ✅ |
| HIGH-6 | Handle refreshRoomTTL failures gracefully | try-catch with warning log, no join failure | ✅ |
| HIGH-7 | Fix accessibility keyboard listener leak | Shared closeOverlay() for all close paths | ✅ |
| HIGH-8 | Cap connectionsPerIP map size | MAX_TRACKED_IPS=10000, reject new IPs when full | ✅ |

### New Tier C: Medium Priority Improvements

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| C-1 | Use safeEmit in chat handlers | Replace raw `io.to().emit()` with `safeEmitToRoom` | Low |
| C-2 | Add withTimeout to game:clue handler | Wrap `giveClue` service call with timeout | Low |
| C-3 | Fix session age validation fallback | Always use `createdAt`, never `connectedAt` | Low |
| C-4 | Enforce JWT secret length in production | Throw error (not just warn) if < 32 chars | Low |
| C-5 | Add word list uniqueness validation | Zod `.refine()` for unique words in schema | Low |
| C-6 | Fix replay board accessibility | Add ARIA roles, tabindex, keyboard nav | Medium |
| C-7 | Batch `resetRolesForNewGame` updates | Lua script or pipeline instead of N individual updates | Medium |
| C-8 | Fix nickname validation regex consistency | Use shared constant from `constants.js` | Low |
| C-9 | Fix `fitCardText` layout thrashing | Batch reads then writes using `requestAnimationFrame` | Low |
| C-10 | Add replay playback interval guard | Check `!state.replayInterval` before setting new | Low |
| C-11 | Add memory audit log expiration | Implement TTL or max entries for memory mode | Low |
| C-12 | Make timeout values configurable via env | Allow `OPERATION_TIMEOUT_MS` overrides | Low |
| C-13 | Add Docker Compose resource limits | Memory/CPU caps on containers | Low |
| C-14 | Add settings value validation | Validate team name values in `updateSettings` | Low |
| C-15 | Implement token rotation on use | Rotate reconnection tokens after successful use | Medium |

### Existing Tier D: Lower Priority / Future Work

| ID | Task | Description | Effort |
|----|------|-------------|--------|
| D-1 | Implement chat UI | Frontend chat panel with team/spectator tabs | Medium |
| D-2 | Complete i18n markup | Audit all hardcoded English strings | Medium |
| D-3 | Gate frontend debug logging | Make state.js logging conditional on config | Low |
| D-4 | Add CHANGELOG.md | Structured changelog following Keep a Changelog | Low |
| D-5 | Split multiplayer.js | Decompose 1,922-line file into submodules | Medium |
| D-6 | Migrate all transactions to Lua | Replace watch/unwatch patterns | Medium |
| D-7 | Add chaos/resilience testing | Simulate Redis failures during operations | Medium |
| D-8 | Add SRI hashes for vendored JS | Subresource Integrity for socket.io, qrcode | Low |
| D-9 | Improve admin dashboard a11y | Skip link, contrast review | Low |
| D-10 | Add i18n plural support | Plural form handling in i18n.js | Low |
| D-11 | Automated perf regression tests | Schedule k6 in CI | Medium |
| D-12 | Add `.dockerignore` file | Exclude node_modules, .git from Docker context | Low |
| D-13 | Add `SECURITY.md` | Vulnerability disclosure policy | Low |
| D-14 | Add Dependabot config | Automated dependency updates | Low |
| D-15 | Add ReDoS regression tests | Test clue regex against pathological inputs | Low |

---

## Appendix A: Issue Count by Severity

| Severity | Count | Status |
|----------|-------|--------|
| Critical | 2 | ✅ All fixed |
| High | 8 | ✅ All fixed (HIGH-2 verified correct as-is) |
| Medium | 35+ | New — plan and address |
| Low | 20+ | New — backlog |
| Previously Fixed | 23+ | Tiers 1-3 + Tier A |

## Appendix B: File Size Inventory

Files over 500 lines (current state after all refactoring):

| File | Lines | Status |
|------|-------|--------|
| `server/public/js/modules/multiplayer.js` | 1,922 | Consider splitting (Tier D) |
| `server/src/services/gameService.ts` | 1,573 | Acceptable — core domain logic |
| `server/src/services/playerService.ts` | 1,119 | Acceptable — consider future split |
| `server/public/js/socket-client.js` | 1,019 | Acceptable — WebSocket communication |
| `server/src/services/gameHistoryService.ts` | 739 | Acceptable — single responsibility |
| `server/public/js/modules/game.js` | 736 | Acceptable — game logic |
| `server/public/js/modules/app.js` | 644 | Acceptable — app orchestration |
| `index.html` | ~625 | Acceptable — SPA entry point |
| `server/src/middleware/socketAuth.ts` | 593 | Refactored — composable functions |
| `server/src/services/roomService.ts` | 534 | Acceptable — clean service |
| `server/public/js/modules/ui.js` | 534 | Acceptable — UI rendering |
| `server/src/services/timerService.ts` | 503 | Acceptable — clean service |
| `server/public/js/modules/history.js` | 503 | Acceptable — replay system |
| `server/public/js/modules/roles.js` | 499 | Acceptable — role management |

## Appendix C: Test Suite Health

```
Backend:  77 suites passing | 2,308 tests passing
Frontend: 4 suites passing  | 303 tests passing
E2E:      8 spec files | 64+ tests (Playwright + Chromium)

Total:    ~2,675 tests passing

Known issues:
- timing.test.ts: 3 flaky memory monitoring tests (pass in isolation)
- Spectator join flow untestable (CRIT-1: handler signatures wrong)
```

## Appendix D: Dependency Audit

Key dependencies and their status:

| Package | Version | Notes |
|---------|---------|-------|
| express | 4.18.2 | Stable; Express 5.x available for future upgrade |
| socket.io | 4.7.2 | Current stable WebSocket transport |
| typescript | 5.3.3 | 5.7+ available; consider upgrading |
| @prisma/client | 5.22.0 | Latest patch version |
| zod | 3.22.4 | 3.24+ available; minor improvements |
| jest | 29.7.0 | Current stable |
| helmet | 7.2.0 | Current stable |
| playwright | 1.58+ | Current stable for E2E |
| eslint | 9.x | Flat config migration complete |

**0 known vulnerabilities** (npm audit clean).
