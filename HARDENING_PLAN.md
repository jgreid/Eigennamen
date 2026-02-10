# Code Review & Hardening Plan

**Date**: 2026-02-10
**Scope**: Full codebase review — server, client, tests, deployment
**Baseline**: 75 test suites, 2,269 tests passing (1 skipped), ~79% line coverage, 68% branch coverage
**Current**: 77 test suites, 2,304 tests passing, 94%+ coverage, 303 frontend tests, 53 E2E tests

---

## Summary

The codebase has undergone five rounds of hardening. **All 7 phases are now complete or substantially complete.** The latest review (2026-02-10) verified all fixes against actual code.

**Security posture**: Strong — Zod validation at all entry points, rate limiting with in-memory fallback, atomic Lua scripts, DOM-safe rendering, CSRF audit logging, AbortController disconnect cleanup, IP mismatch defaulting to blocked.

---

## Completed Fixes (All Rounds)

### Round 5 (2026-02-10) — Documentation & Cleanup

| Fix | Description |
|-----|-------------|
| CLAUDE.md overhaul | Fixed services, events, endpoints, directory structure, testing info |
| ROADMAP.md version fix | Corrected v2.4.0 → v2.2.0, moved completed features from "Remaining" |
| Coverage threshold docs | Fixed CONTRIBUTING.md, TESTING_GUIDE.md to match jest.config.ts.js |
| bcryptjs removal | Removed unused dependency and @types/bcryptjs |
| CODEBASE_REVIEW.md | Fixed version reference, marked eventLogService as resolved |

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

## Phase 1: Critical Fixes ✅ ALL COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 1.1 Timer validation mismatch | ✅ Fixed | Both client and server use `MAX_TURN_SECONDS: 600` from config |
| 1.2 Stuck reconnection overlay | ✅ Fixed | 15-second timeout in multiplayer.js with toast fallback |
| 1.3 Button/loading state recovery | ✅ Fixed | `finally` blocks in all connection handlers |
| 1.4 Typecheck enforcement | ✅ Fixed | Dedicated `typecheck` job in CI workflow |

---

## Phase 2: Validation & Error Handling ✅ ALL COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 2.1 Client/server regex alignment | ✅ Fixed | Both use `[\p{L}\p{N}\-_]+` Unicode regex |
| 2.2 Client clue validation | ✅ Fixed | `socket-client.js:giveClue()` validates before emit |
| 2.3 Parallel error handling | ✅ Fixed | `room:warning` event sent when stats use fallback |
| 2.4 Spectator chat validation | ✅ Fixed | `chatHandlers.ts` validates spectator role |

---

## Phase 3: State Management & Reconnection ✅ ALL COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 3.1 Clear stale state | ✅ Fixed | `resetMultiplayerState()` on room change detection |
| 3.2 Offline state detection | ✅ Fixed | `detectOfflineChanges()` shows toast summaries |
| 3.3 Offline message queue | ✅ Fixed | `_offlineQueue` with max size and flush on reconnect |

---

## Phase 4: Testing Gaps ⚠️ MOSTLY COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 4.1 Middleware tests | ✅ Done | `errorHandlerExtended.test.ts`, `errorScenarios.test.ts` |
| 4.2 REST API route tests | ✅ Done | `adminRoutes.test.ts`, `routes.test.ts`, `routesExtended.test.ts` |
| 4.3 E2E test expansion | ⚠️ Partial | 53 tests in 5 files; reconnection/full-game E2E still needed |
| 4.4 Coverage thresholds | ✅ Aligned | Docs now match `jest.config.ts.js` (65/80/75/75) |

---

## Phase 5: Security Hardening ✅ ALL COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 5.1 Rate limit /exists | ✅ Fixed | `roomRoutes.ts` applies rate limiter |
| 5.2 Token cleanup | ✅ Fixed | `playerService.ts:cleanupOrphanedReconnectionTokens()` |
| 5.3 Crypto API | ✅ Acceptable | Socket.io handles fallback internally |
| 5.4 Timer lock TTL | ✅ Configured | Lock TTLs appropriate for operation durations |

---

## Phase 6: UX & Accessibility ✅ ALL COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 6.1 Board accessibility | ✅ Fixed | ARIA grid roles, `aria-label` with row/column positions |
| 6.2 Keyboard navigation | ✅ Fixed | Arrow keys, Home/End, Enter/Space in `board.js` |
| 6.3 Clipboard API | ✅ Fixed | Modern Clipboard API with fallback |
| 6.4 Loading states | ✅ Fixed | Loading class + disabled state on all async buttons |

---

## Phase 7: Documentation & Config ⚠️ MOSTLY COMPLETE

| Item | Status | Evidence |
|------|--------|----------|
| 7.1 CLAUDE.md fixes | ✅ Done | Complete rewrite with accurate structure |
| 7.2 TESTING_GUIDE.md | ✅ Done | Fixed framework refs, directory structure, thresholds |
| 7.3 Centralize constants | ⚠️ Partial | Main constants centralized; some lock TTLs remain in services |
| 7.4 CORS production docs | ⚠️ Pending | `.env.example` has guidance but deployment docs need update |

---

## Success Criteria — Updated

| Metric | Baseline | Target | Current |
|--------|----------|--------|---------|
| Test suites passing | 75/76 | 76/76 | ✅ 77/77 |
| Line coverage | 79% | 85%+ | ✅ 91%+ |
| Branch coverage | 68% | 75%+ | ✅ 84%+ |
| E2E test cases | ~53 | 70+ | ⚠️ 53 (expansion needed) |
| Client/server validation parity | ~80% | 95%+ | ✅ ~95% |
| Zero stuck-UI paths | No | Yes | ✅ Yes |
| WCAG 2.1 AA (core flows) | Partial | Full | ✅ Done |

---

## Remaining Items (Future Sprints)

1. **E2E test expansion**: Add reconnection, full game completion, host transfer E2E tests
2. **Lock TTL centralization**: Move remaining hardcoded lock TTLs to config
3. **Production CORS docs**: Add explicit guidance to deployment documentation
4. **ES module migration**: Standardize mixed require/import across TypeScript files

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

*Last updated: 2026-02-10 after comprehensive holistic review.*
