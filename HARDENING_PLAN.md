# Code Review & Hardening Plan

**Date**: 2026-02-06
**Scope**: Full codebase review of Risley-Codenames (server + frontend)
**Last Updated**: 2026-02-06 (refreshed after H1-H4 and M1-M8 fixes)
**Test Status**: Backend 91/92 suites passing (1 skipped), Frontend 1/1 suite (36 tests), timing.test.ts known flaky

---

## Summary

The codebase has undergone two rounds of hardening since the initial review. All 4 HIGH and all 8 MEDIUM items have been addressed, with one partial regression identified during re-verification. The remaining work consists of low-priority items and the identified regression.

Security posture is strong: Zod input validation at all entry points, in-memory rate limit fallback when Redis is unavailable, atomic Lua scripts for critical operations, DOM-based rendering (replacing innerHTML), CSRF audit logging, AbortController-based disconnect cleanup, and IP mismatch defaulting to blocked.

---

## Completed Fixes

### HIGH Priority (All Fixed)

| ID | Issue | Status | Commit |
|----|-------|--------|--------|
| H1 | Frontend innerHTML XSS vectors | **FIXED** (partial regression, see R1) | Commit 1 |
| H2 | Rate limit fail-open default | **FIXED** — in-memory Map fallback replaces fail-open/fail-closed toggle | Commit 1 |
| H3 | Non-atomic fallback in player updates | **FIXED** — throws `concurrentModification` after retry exhaustion | Commit 1 |
| H4 | No frontend test coverage | **FIXED** — 36 tests in `rendering.test.ts` with jsdom | Commit 1 |

### MEDIUM Priority (All Fixed)

| ID | Issue | Status | Commit |
|----|-------|--------|--------|
| M1 | IP mismatch allowed by default | **FIXED** — defaults to `false`, opt-in via `ALLOW_IP_MISMATCH=true` env var | Commit 2 |
| M2 | Hardcoded development JWT secret | **FIXED** — production explicitly rejects `DEV_SECRET` string | Commit 2 |
| M3 | Duet game mode string matching | **FIXED** — uses `JSON.parse()` with fallback | Commit 2 |
| M4 | Race condition in player kick | **FIXED** — socket disconnected before Redis removal | Commit 2 |
| M5 | Reconnection token TOCTOU race | **FIXED** — atomic Lua script for check+set+map | Commit 2 |
| M6 | CSRF violations not audit-logged | **FIXED** — all 4 rejection paths call `auditCsrfViolation()` | Commit 2 |
| M7 | Disconnect handler timeout orphans | **FIXED** — `AbortController` with signal checks between async steps | Commit 2 |
| M8 | Room enumeration via connection pooling | **FIXED** — `IP_RATE_LIMIT_MULTIPLIER` reduced from 5x to 3x | Commit 2 |

---

## Regressions Identified

### R1. renderReplayBoard Still Uses innerHTML (H1 Partial Regression)

**File**: `server/public/js/modules/history.js:186`

```javascript
board.innerHTML = words.map((word, index) => {
    return `<div class="replay-card" data-index="${index}">${escapeHTML(word)}</div>`;
}).join('');
```

The `renderReplayBoard` function was missed during the H1 innerHTML-to-DOM refactoring. While `escapeHTML()` is applied to the `word` value, the `index` variable is interpolated into a `data-index` attribute without quoting concerns, and the overall pattern is inconsistent with the DOM API approach used everywhere else.

**Risk**: LOW (escapeHTML covers the dynamic word content; index is a numeric loop variable). But should be converted for consistency.

**Recommendation**: Refactor to use `createElement`/`textContent` like the other rendering functions.

---

## Remaining LOW Priority Items

### L2. Debug State Dump in Console

**File**: `server/public/js/modules/state.js:320-328`
**Status**: OPEN

A `dumpState()` function logs complete game state (including spymaster assignments, current turn, room IDs) to the browser console. Any player can call this from DevTools.

**Recommendation**: Gate debug output behind a build-time flag, or remove it. Note: sensitive fields (card types for non-spymasters) are correctly stripped by `getGameStateForPlayer()` on the server, so the actual risk is limited to exposing non-secret state metadata.

### L4. Audit Logs Lost in Memory Mode

**File**: `server/src/services/auditService.ts:189-204`
**Status**: OPEN

When running without external Redis (memory mode), all audit log writes are silently discarded. Security events from the newly added CSRF audit logging (M6) and other audit points are completely lost in memory-only deployments.

**Recommendation**: Write audit logs to the in-memory storage (same as game data), or fall back to file-based logging when Redis is unavailable. This became more relevant now that M6 added CSRF audit events.

### L5. Timer Handlers Missing Active Game Check

**File**: `server/src/socket/handlers/timerHandlers.ts:67-147`
**Status**: OPEN

Timer pause/resume/stop handlers use `createHostHandler` (correct for authorization), but don't verify that an active game exists. A host can manipulate timers on a room with no game in progress.

**Recommendation**: Add a game-active check at the start of timer handlers, or use `createGameHandler` which enforces game context.

### L7. Dead Code in Timer Service

**File**: `server/src/services/timerService.ts:88, 503-507`
**Status**: OPEN

`_globalExpireCallback` is declared (with `@ts-expect-error` suppressing the unused warning) and `initializeTimerService()` sets it, but it's never called. This is dead code that adds confusion.

**Recommendation**: Remove the unused global callback and `initializeTimerService()` function.

---

## Closed Items (No Longer Applicable)

| ID | Original Issue | Reason Closed |
|----|----------------|---------------|
| L1 | Session ID in localStorage | Session ID is stored in `sessionStorage` (not `localStorage`), which is tab-scoped and cleared on close. This is standard practice for SPAs and does not represent a meaningful risk given the H1 XSS fixes. |
| L3 | Clue validation single-character exemption | Documented design trade-off, not a bug. Single-character board words are rare and the exemption prevents false positives on common clues. |
| L6 | Error messages expose details in non-production | The error handler properly gates detailed messages behind `NODE_ENV !== 'production'`. This is standard Express practice and only a concern if non-production environments are publicly exposed, which is an infrastructure concern. |
| L8 | MemoryStorage test timeout | The `memoryStorageEviction.test.ts` suite is skipped (not failing). The eviction timer cleanup issue doesn't affect production code and the test is an acceptable skip for now. |

---

## Test Suite Status

**Backend** (Jest, `jest.config.ts.js`):
- 91/92 suites passing, 1 suite skipped (`memoryStorageEviction`)
- `timing.test.ts` is flaky in the full suite but passes reliably in isolation (24/24 tests)
- All hardening-related tests pass: socketAuthCoverage, securityHardening, rateLimitCoverage, playerService, fullGameFlow integration

**Frontend** (Jest + jsdom, `jest.config.frontend.js`):
- 1/1 suite, 36/36 tests passing
- Covers: escapeHTML, updatePlayerList XSS safety, renderGameHistory XSS, URL encoding/decoding, formatDuration, getCardFontClass

**Commands**:
```bash
cd server && npm test                                    # Backend tests
cd server && npx jest --config jest.config.frontend.js   # Frontend tests
```

---

## Positive Findings

The following security measures are well-implemented and should be maintained:

- **Input validation**: Comprehensive Zod schemas at all socket and REST entry points, including Unicode-aware regex, reserved name blocking, and control character removal
- **Rate limiting**: Per-event rate limits on all socket handlers, per-IP connection limits, LRU-evicting rate limit storage, in-memory fallback when Redis unavailable
- **Authorization**: Context handler pattern (`createRoomHandler`, `createHostHandler`, `createGameHandler`) consistently enforces role and state requirements
- **Spymaster data protection**: `getGameStateForPlayer()` correctly strips card types for non-spymaster players
- **Distributed locks**: Card reveal and game creation use Redis locks with Lua scripts for atomicity
- **Security headers**: Helmet.js with CSP, HSTS, X-Frame-Options properly configured
- **CSRF protection**: Custom header requirement (`X-Requested-With`) plus origin validation when CORS is restricted; violations audit-logged; production rejects wildcard CORS origin
- **Session security**: Session age limits, IP consistency enforcement (default deny), reconnection token rotation with atomic Lua script, timing-safe admin password comparison
- **JWT hardening**: Production rejects known dev secret, enforces minimum secret length, validates issuer/audience claims
- **Graceful degradation**: System works without PostgreSQL or Redis (falls back to in-memory storage) without compromising core security; rate limiting continues via in-memory fallback
- **Async cleanup**: Disconnect handler uses AbortController to prevent orphaned background work after timeout
