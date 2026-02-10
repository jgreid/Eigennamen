# Code Review & Hardening Plan

**Date**: 2026-02-10
**Scope**: Full codebase review — server, client, tests, deployment
**Baseline**: 75 test suites, 2,269 tests passing (1 skipped), ~79% line coverage, 68% branch coverage

---

## Summary

The codebase has undergone four rounds of hardening. All original HIGH (H1-H4) and MEDIUM (M1-M8) items are fixed. The latest round (2026-02-10) addressed room ID normalization inconsistencies, reserved name validation gaps, and stale URL parameter handling. A comprehensive holistic review has now identified remaining work organized into 7 phases.

**Security posture**: Strong — Zod validation at all entry points, rate limiting with in-memory fallback, atomic Lua scripts, DOM-safe rendering, CSRF audit logging, AbortController disconnect cleanup, IP mismatch defaulting to blocked.

---

## Completed Fixes (All Rounds)

### Round 4 (2026-02-10) — Room ID Matching

| Fix | Description |
|-----|-------------|
| Consistent normalization | All Zod schemas now use `toEnglishLowerCase()` matching roomService and HTTP routes |
| Post-transform validation | `createRoomIdSchema` validates length after trim/sanitize, catching whitespace-padded inputs |
| Reserved name default | `createRoom` default nickname changed from reserved `'Host'` to `'Player'` |
| Client reserved name check | `validateNickname()` in constants.js now rejects reserved names before server round-trip |
| Better error diagnostics | Join failure messages include attempted room ID; stale `?room=` URL params cleared on ROOM_NOT_FOUND |

### Round 3 (2026-02-06) — Previous Hardening

All H1-H4 (HIGH) and M1-M8 (MEDIUM) items fixed. R1 regression fixed. L4, L5, L7 fixed. See git history for details.

---

## Phase 1: Critical Fixes

These are blockers or near-blockers for production reliability.

### 1.1 Fix timer validation mismatch
- **Files:** `server/public/js/modules/constants.js` (`MAX_TURN_SECONDS: 600`) vs `server/src/validators/schemas.ts` (`.max(300)`)
- **Severity:** Critical
- **Issue:** Client allows 600s timers but server rejects anything over 300s. Users setting 5+ minute timers get unexplained failures.
- **Fix:** Align both to the same value.

### 1.2 Fix stuck reconnection overlay
- **File:** `server/public/js/modules/multiplayer.js`
- **Severity:** Critical
- **Issue:** If `rejoinFailed` event never fires (socket disconnects during rejoin attempt), the reconnection overlay stays permanently, making the entire UI unusable.
- **Fix:** Add a 15-second timeout fallback that hides overlay and shows "Reconnection failed — please refresh" toast.

### 1.3 Fix button/loading state recovery
- **File:** `server/public/js/modules/multiplayer.js`
- **Severity:** Critical
- **Issue:** Action buttons remain disabled if the connection attempt fails before reaching the try/catch scope. Loading spinners persist on network errors.
- **Fix:** Move button re-enable and loading state cleanup into `finally` blocks that cover all paths including early returns and connection failures.

### 1.4 Add typecheck enforcement
- **File:** `server/package.json` (scripts section)
- **Severity:** Critical
- **Issue:** TypeScript type errors don't block deployment. `tsc --noEmit` exists but isn't run in CI.
- **Fix:** Add `typecheck` step to build/CI pipeline.

---

## Phase 2: Validation & Error Handling

### 2.1 Align client/server regex for room codes
- **Client:** `/^[a-zA-Z0-9\-_]+$/` (ASCII only)
- **Server:** `/^[\p{L}\p{N}\-_]+$/u` (Unicode)
- **Severity:** Medium
- **Fix:** Upgrade client regex to Unicode to match server, or document ASCII-only and add server-side ASCII-only constraint.

### 2.2 Add client-side clue word validation
- **File:** Clue submission in multiplayer.js
- **Severity:** Medium
- **Issue:** No client-side validation for clue words. Invalid clues cause server round-trip and cryptic INVALID_INPUT error.
- **Fix:** Add regex check matching server's `clueWordRegex` before submission.

### 2.3 Improve parallel operation error handling
- **File:** `server/src/socket/handlers/roomHandlers.ts` (join handler)
- **Severity:** Medium
- **Issue:** `Promise.all` for stats/token/game-state returns fallback zeroed data on partial failure. Join looks successful but shows wrong stats.
- **Fix:** Consider sending `room:warning` event so client can request resync if stats look stale.

### 2.4 Spectator chat handler validation
- **File:** `server/src/socket/handlers/chatHandlers.ts`
- **Severity:** Medium
- **Issue:** Spectator chat handler may not fully validate spectator room membership before broadcasting.
- **Fix:** Add explicit spectator role check with clear error message.

---

## Phase 3: State Management & Reconnection

### 3.1 Clear stale state on room change
- **File:** `server/public/js/modules/state.js`, `multiplayer.js`
- **Severity:** High
- **Issue:** Team/role/clicker flags (5+ interdependent state variables) persist after disconnect. Reconnecting to a different room shows stale role banners and incorrect UI state.
- **Fix:** Full state reset in `leaveMultiplayer()` and on `room:joined` when room code differs from previous.

### 3.2 Detect significant state changes during offline
- **File:** `server/public/js/socket-client.js`
- **Severity:** Medium
- **Issue:** Game starting/ending while player is offline produces no indication of what changed. Missed clues during disconnect are invisible.
- **Fix:** On reconnection, compare game state version and show summary toast of missed events.

### 3.3 Implement offline message queue
- **File:** `server/public/js/socket-client.js`
- **Severity:** Low
- **Issue:** Chat messages and actions sent while offline are silently lost.
- **Fix:** Queue outgoing events while disconnected, replay on reconnect with dedup.

---

## Phase 4: Testing Gaps

### 4.1 Add middleware tests
- **Files:** `errorHandler.ts`, `validation.ts`
- **Severity:** High
- **Issue:** Central error handling middleware has no dedicated tests. All handler errors flow through this code.
- **Target:** 90%+ coverage on error handler paths.

### 4.2 Add REST API route tests
- **Files:** `healthRoutes.ts`, `roomRoutes.ts`, `wordListRoutes.ts`
- **Severity:** Medium
- **Issue:** HTTP endpoints have limited test coverage.
- **Target:** Happy path + error paths for all REST endpoints.

### 4.3 Expand E2E test coverage
- **Missing scenarios:**
  - Full game completion flow (create → join → clue → guess → win)
  - Timer expiry during gameplay
  - Disconnection and reconnection mid-game
  - Spectator joining during active game
  - Host transfer when host disconnects
- **Target:** 15+ new E2E test cases (from ~53 to 70+).

### 4.4 Align coverage thresholds
- **Issue:** CLAUDE.md says 80% minimum but jest.config.ts.js allows 65% branches, 75% lines.
- **Fix:** Raise thresholds or update docs to reflect reality.

---

## Phase 5: Security Hardening

### 5.1 Rate limit room existence HTTP endpoint
- **File:** `server/src/routes/roomRoutes.ts`
- **Severity:** Medium
- **Issue:** `GET /api/rooms/:code/exists` allows unauthenticated room enumeration. No rate limit.
- **Fix:** Apply API rate limiting to room existence checks.

### 5.2 Clean up orphaned reconnection tokens
- **File:** `server/src/services/playerService.ts`
- **Severity:** Low
- **Issue:** Reconnection tokens persist after room cleanup until TTL expires. Wastes memory.
- **Fix:** Delete tokens explicitly during room cleanup.

### 5.3 Feature-detect crypto API
- **File:** Client JS modules
- **Severity:** Medium
- **Issue:** `crypto.getRandomValues()` unavailable in older browsers or HTTP contexts. No fallback.
- **Fix:** Feature detection with `Math.random()` fallback for non-security-critical uses.

### 5.4 Audit timer lock TTL
- **File:** `server/src/services/timerService.ts`
- **Severity:** Low
- **Issue:** Lock TTL could expire mid-operation under load, causing duplicate timer callbacks.
- **Fix:** Review lock TTLs relative to actual operation durations.

---

## Phase 6: UX & Accessibility

### 6.1 Board accessibility (WCAG 2.1 AA)
- **File:** `index.html`, `server/public/js/modules/board.js`
- **Severity:** Medium
- **Issue:** Board grid lacks `aria-rowindex`/`aria-colindex`. Screen readers can't navigate the 5x5 grid.
- **Fix:** Add ARIA grid role attributes and announce card reveals.

### 6.2 Fix keyboard navigation
- **File:** `server/public/js/modules/board.js`
- **Severity:** Medium
- **Issue:** Arrow key navigation documented but not functional — event listeners not attached.
- **Fix:** Implement working arrow key navigation between cards.

### 6.3 Replace deprecated clipboard API
- **File:** `server/public/js/modules/multiplayer.js`
- **Severity:** Low
- **Issue:** `document.execCommand('copy')` fallback is deprecated.
- **Fix:** Use textarea-based fallback for older browsers.

### 6.4 Loading states for async operations
- **Severity:** Low
- **Issue:** Team/role changes and game start have no visual loading indicator.
- **Fix:** Spinner/disabled state on buttons during async operations with timeout reset.

---

## Phase 7: Documentation & Config

### 7.1 Fix CLAUDE.md inaccuracies
- References non-existent test directory structures (`server/src/__tests__/services/`)
- Update to reflect actual flat test file organization.

### 7.2 Update TESTING_GUIDE.md
- Currently references Vitest (project uses Jest)
- Update directory paths and examples.

### 7.3 Centralize hardcoded constants
- Lock TTLs and timeouts scattered across service files
- Move to config files for easier tuning.

### 7.4 Production CORS documentation
- `CORS_ORIGIN=*` fine for dev, needs explicit guidance for production.

---

## Priority Matrix

| Priority | Items | Effort | Impact |
|----------|-------|--------|--------|
| **P0 Critical** | 1.1, 1.2, 1.3, 1.4 | 1 week | Prevents stuck UIs, silent failures |
| **P1 High** | 2.1-2.4, 3.1 | 1 week | Eliminates confusing error states |
| **P2 Medium** | 3.2-3.3, 4.1-4.4, 5.1, 5.3 | 2 weeks | Improves reliability, test confidence |
| **P3 Low** | 5.2, 5.4, 6.1-6.4, 7.1-7.4 | Ongoing | Polish, accessibility, documentation |

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Test suites passing | 75/76 | 76/76 |
| Line coverage | 79% | 85%+ |
| Branch coverage | 68% | 75%+ |
| E2E test cases | ~53 | 70+ |
| Client/server validation parity | ~80% | 95%+ |
| Zero stuck-UI paths | No | Yes |
| WCAG 2.1 AA (core flows) | Partial | Full |

---

## Positive Findings (Maintain These)

- **Input validation**: Comprehensive Zod schemas at all entry points with Unicode-aware regex, reserved name blocking, control character removal
- **Rate limiting**: Per-event socket rate limits, per-IP connection limits, LRU-evicting storage, in-memory fallback
- **Authorization**: Context handler pattern (`createRoomHandler`, `createHostHandler`, etc.) consistently enforces role/state requirements
- **Spymaster data protection**: `getGameStateForPlayer()` correctly strips card types for non-spymaster players
- **Distributed locks**: Card reveal and game creation use atomic Lua scripts
- **Security headers**: Helmet.js with CSP, HSTS, X-Frame-Options
- **CSRF protection**: Custom header + origin validation; violations audit-logged
- **Session security**: Age limits, IP consistency enforcement, reconnection token rotation with atomic Lua
- **JWT hardening**: Production rejects dev secret, enforces minimum length, validates claims
- **Graceful degradation**: Works without PostgreSQL or Redis; rate limiting continues via in-memory fallback
- **Async cleanup**: Disconnect handler uses AbortController to prevent orphaned background work

---

*Last updated: 2026-02-10 after holistic review of all recent changes.*
