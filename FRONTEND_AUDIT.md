# Frontend Audit Report

**Date:** 2026-02-27
**Scope:** All 52 TypeScript modules in `server/src/frontend/` (35 test files in `__tests__/frontend/`)
**Method:** Full source read of every frontend module + cross-referencing against test suite

---

## Executive Summary

The frontend is well-structured vanilla TypeScript with strong XSS protections, good accessibility foundations, and a solid reactive state layer. However, four systemic problem areas emerged:

1. **No global error boundary** — unhandled exceptions and promise rejections are silently lost
2. **Reconnection path fragility** — offline queue processing, listener cleanup, and state sync have race conditions and gaps
3. **Resource lifecycle gaps** — event listeners and intervals accumulate in specific paths (history replay, room transitions)
4. **Test coverage holes** — 4 modules have zero dedicated tests (`app.ts`, `url-state.ts`, `socket-client-storage.ts`, `multiplayerListeners.ts`); event handlers are tested in a single monolithic file

The core game loop (card reveal, scoring, turn management) is rock-solid in both standalone and multiplayer modes. The problems concentrate around session lifecycle edges: connect, reconnect, room transition, and cleanup.

---

## Findings by Severity

### CRITICAL

#### C1. No global error handler
**Location:** Entire frontend — no `window.addEventListener('error')` or `'unhandledrejection'` handler anywhere
**Impact:** Any unhandled exception or rejected promise silently disappears into the console. Users see a frozen UI with no feedback. Particularly dangerous because:
- `_attemptRejoin()` failure in `socket-client.ts:138` is `.catch()`-logged but never surfaced to the user
- Several async paths in `multiplayer.ts` and `history.ts` could throw without try/catch
**Fix:** Add global handlers in `app.ts` init that show a toast and log to the logger

#### C2. Offline queue replays without server acknowledgment
**Location:** `socket-client.ts` — `_flushOfflineQueue()` method
**Impact:** After reconnection, queued events are replayed with 50ms spacing but no ack. If the server rejects an event (stale state, game ended), subsequent queued events still fire. Worst case: 20 queued `revealCard` calls replay against a new game.
**Fix:** Process queue sequentially with ack callbacks; discard remaining items on first rejection. Consider tagging queue items with a game generation ID so stale items are auto-discarded.

#### C3. Auto-rejoin failure is silently swallowed
**Location:** `socket-client.ts:137-141`
```typescript
if (wasReconnecting && this.autoRejoin) {
    this._attemptRejoin().catch((err: Error) => {
        logger.error('Auto-rejoin failed:', err);
    });
}
```
**Impact:** If `_attemptRejoin()` fails (network error, room deleted, kicked), the user sees no feedback. The UI stays in a "connected" state but the player isn't in any room. `joinInProgress`/`createInProgress` flags may not be cleared, blocking manual rejoin.
**Fix:** Surface rejoin failure to the UI. Show a "Reconnection failed — rejoin?" prompt. Ensure all progress flags are cleared in the catch path.

---

### HIGH

#### H1. Replay board accumulates keydown listeners
**Location:** `history.ts:222` — `board.addEventListener('keydown', ...)` inside `renderReplayBoard()`
**Impact:** Every call to `renderReplayBoard()` (open replay, switch replay, step through) adds a new `keydown` listener. After 10 replays, 10 listeners fight over focus management. The old listeners reference stale DOM nodes via `document.activeElement`.
**Fix:** Store listener reference in module scope; remove before adding. Or use event delegation on a persistent parent.

#### H2. Replay interval not cleaned up on modal close
**Location:** `history.ts:418` — `state.replayInterval = setInterval(...)` created in play mode; cleanup in `stopReplay()` requires explicit call
**Impact:** If user closes the history modal (via Escape or overlay click) without pressing Stop, the interval keeps firing. Each tick calls `advanceReplay()` which mutates state and queries DOM elements that no longer exist.
**Fix:** Hook into the modal close handler to call `stopReplay()`. The modal system in `ui.ts` supports `getModalCloseHandler()` — register cleanup there.

#### H3. Timer interval can orphan on room leave
**Location:** `timer.ts:71` — `state.timerState.intervalId = setInterval(...)`
**Impact:** If `stopTimerCountdown()` isn't called during room leave/cleanup (e.g., kicked, disconnect), the interval persists. `multiplayerSync.ts` does call cleanup in reset paths, but not all exit paths are covered (force disconnect, page navigation away from room).
**Fix:** Add defensive `stopTimerCountdown()` call in `cleanupMultiplayerState()`. Consider clearing in `beforeunload` as well.

#### H4. Role change timeout doesn't revert UI on safety expiry
**Location:** `roles.ts:260-266`
```typescript
setTimeout(() => {
    if (state.roleChange.phase === 'changing_team' && state.roleChange.operationId === operationId) {
        clearRoleChange();  // ← Clears state but doesn't revert UI
        updateControls();
    }
}, 5000);
```
**Impact:** If the server never responds to a team/role change, the 5-second timeout calls `clearRoleChange()` but not `revertAndClearRoleChange()`. The role banner and controls may show the optimistic (unconfirmed) state.
**Fix:** Call `revertAndClearRoleChange()` instead of `clearRoleChange()` in the timeout path. The function exists at `roles.ts:51-60` and properly restores previous values.

#### H5. `connectionState` diverges from `state.isConnected`
**Location:** `socket-client.ts` maintains an internal `connected` boolean; other modules read `state.isConnected` (set via state mutation)
**Impact:** During the AUTHENTICATING phase after reconnect, `socket-client.connected` is true (TCP connected) but the player isn't authenticated yet. If `state.isConnected` is set from the Socket.io `connect` event rather than the auth completion, UI components may attempt operations before the session is valid.
**Fix:** Only set `state.isConnected = true` after auth completes (after `room:reconnected` or `room:joined` succeeds), not on raw `connect`.

#### H6. Multiplayer listeners not tracked for cleanup across room transitions
**Location:** `multiplayer.ts:407-418` — direct `addEventListener` calls on modal buttons during `initMultiplayerModal()`
**Impact:** These listeners are not tracked in the `domListenerCleanup` array used by `multiplayerSync.ts:cleanupDOMListeners()`. On room-leave → room-join cycles, they accumulate. The `initMultiplayerModal()` guard prevents double-init of the modal itself, but if the modal is recreated (DOM replacement), old listeners are orphaned and new ones aren't attached.
**Fix:** Track all manually-added DOM listeners in a central cleanup list, or switch to event delegation on the modal root.

---

### MEDIUM

#### M1. No `AbortController` timeout on fetch calls
**Location:** `i18n.ts:60-73` (language file fetch), `history.ts` (replay data fetch)
**Impact:** A hanging fetch blocks the operation indefinitely. Language switch blocks app initialization if the locale file request stalls.
**Fix:** Add `AbortController` with a 5-second timeout on all fetch calls.

#### M2. Non-null assertions on DOM elements (`!` operator)
**Location:** ~35 instances across frontend modules — `document.getElementById('board')!`, `document.getElementById('timer-display')!`, etc.
**Impact:** If any element is missing from the HTML template (during a refactor, SSR mismatch, or partial load), the code throws with an unhelpful error deep in the call stack.
**Fix:** Create a `getElement(id)` helper that logs the missing ID and returns `null`, then use optional chaining. Prioritize the ~10 most critical elements (board, timer, role controls).

#### M3. No runtime validation of socket event data
**Location:** All handler files in `handlers/` — event data is TypeScript-typed but not validated at runtime
**Impact:** If server sends malformed data (version mismatch, corrupted state, or a compromised server), the client trusts it completely. Type narrowing happens at compile time only.
**Fix:** Add lightweight runtime checks for critical events (`gameStarted`, `cardRevealed`, `roomResynced`). Full Zod validation is overkill for the client; simple shape checks are sufficient.

#### M4. Player list re-renders aren't batched
**Location:** `multiplayerUI.ts:72-115` — `updatePlayerList()` clears and rebuilds the entire `<ul>` on every `playerUpdated` event
**Impact:** When multiple players join simultaneously (room entry), each event triggers a full DOM rebuild. With 8+ players, this causes visible flicker.
**Fix:** Debounce `updatePlayerList()` with `requestAnimationFrame`, similar to how `revealCard` batches updates.

#### M5. Settings save doesn't confirm `localStorage` write succeeded
**Location:** `settings.ts` — `safeSetItem()` returns `void` and silently swallows `QuotaExceededError`
**Impact:** User changes settings, modal closes with success appearance, but settings weren't actually persisted. On reload, old settings reappear.
**Fix:** Have `safeSetItem()` return a boolean success indicator. Show a warning toast on failure.

#### M6. `renderReplayBoard` uses `board.innerHTML = ''` then `createElement`
**Location:** `history.ts:206-219`
**Impact:** This is safe (no XSS) but unnecessarily destroys and recreates all DOM nodes. Combined with H1 (listener accumulation), each replay open creates more garbage.
**Fix:** Consider `replaceChildren()` or diffing against existing children for incremental updates.

#### M7. `batch()` in sync but not in reconnection data application
**Location:** `multiplayerSync.ts:166` uses `batch()` for `syncGameStateFromServer`, but `roomEventHandlers.ts` applies reconnection data without batching
**Impact:** During reconnection, multiple state mutations fire individual subscriber notifications, causing intermediate renders with incomplete state.
**Fix:** Wrap reconnection state application (`syncLocalPlayerState` + `syncGameStateFromServer`) in `batch()`.

---

### LOW

#### L1. `parseInt()` without radix in `settings.ts`
Technically allows octal interpretation of values starting with `0`.

#### L2. Toast max (5) not communicated to user
Old toasts are dismissed when new ones exceed the limit, with no indication.

#### L3. `history.ts:420` — `clearInterval(state.replayInterval ?? undefined)` — `?? undefined` is a no-op
Harmless but confusing to readers.

#### L4. Replay board arrow-key navigation doesn't wrap at grid edges
Unlike `board.ts` which wraps navigation, the replay board silently stops at boundaries. Inconsistent UX.

#### L5. Keyboard shortcuts silently disabled during modals
No visual indicator that shortcuts won't work while a modal is open.

#### L6. `structuredClone()` used without feature detection
`state.ts` uses `structuredClone()` which requires Chrome 98+ / Safari 15.4+. No polyfill or fallback.

---

## False Positives from Initial Analysis (Verified Safe)

These were flagged by automated analysis but confirmed safe on manual review:

| Flagged Issue | Actual Status | Why It's Safe |
|---|---|---|
| Chat XSS via innerHTML | **SAFE** | `chat.ts:97-102` uses `textContent` exclusively |
| multiplayerUI.ts player list XSS | **SAFE** | `multiplayerUI.ts:76-115` uses `createElement` + `textContent` |
| No reconnection attempt limit | **SAFE** | `socket-client.ts:121` passes `this.maxReconnectAttempts` to Socket.io config |
| Board render race condition (flag non-atomic) | **SAFE** | JavaScript is single-threaded; the `renderingInProgress` flag works correctly |
| Standalone double-click on reveal | **SAFE** | `reveal.ts:24` checks `state.gameState.revealed[index]` synchronously before mutation at line 79 |
| `board.ts` array bounds missing | **SAFE** | Line 273 has explicit `if (index >= wordCount) break` guard |
| roles.ts innerHTML XSS | **SAFE** | All interpolated values wrapped in `escapeHTML()` |

---

## Test Coverage Assessment

### Summary

| Category | Source Files | Test Files | Assessment |
|---|---|---|---|
| Socket/Connection | 5 | 3 | Good (core tested, storage/listeners untested) |
| Game Logic | 4 | 3 | Excellent |
| Board Rendering | 1 | 1 | Good |
| Multiplayer Sync | 4 | 2 | Good |
| Event Handlers | 6 | 1 (combined) | Partial — needs splitting |
| UI / Modals | 2 | 1 | Partial |
| State Management | 9 | 8 | Excellent |
| Settings / Words | 1 | 1 | Good |
| Roles / Teams | 1 | 1 | Good |
| History / Replay | 1 | 1 | Good |
| Utilities | 3 | 1 | Partial |

### Modules with ZERO dedicated tests

| Module | Size | Risk | What Needs Testing |
|---|---|---|---|
| **`app.ts`** | ~265 LOC | HIGH | Event delegation setup, modal registration, init sequencing |
| **`url-state.ts`** | ~28 LOC | MEDIUM | URL encoding edge cases (special chars in team names, long custom word lists) |
| **`socket-client-storage.ts`** | ~50 LOC | HIGH | Storage quota exceeded, private browsing fallback, cross-tab behavior |
| **`multiplayerListeners.ts`** | ~30 LOC | MEDIUM | Idempotent registration, cleanup completeness |

### Critical untested paths in tested modules

| Module | Tested File | Gap |
|---|---|---|
| `socket-client.ts` | `socket-client.test.ts` | Reconnection flow end-to-end: connect → auth → rejoin → resync → queue flush |
| `socket-client.ts` | `socketClientOfflineQueue.test.ts` | Queue processing after reconnect with server rejection |
| `multiplayerSync.ts` | `multiplayerSync.test.ts` | Concurrent full-sync + incremental update race |
| `handlers/*` | `handlers.test.ts` (single file) | Individual handler error paths; handler cleanup on disconnect |
| `history.ts` | `history.test.ts` | Replay play/pause/speed with interval lifecycle |
| `ui.ts` | `ui.test.ts` | Modal stack race (concurrent open/close), focus restoration after nested modal |

---

## Proposed Sprints

### Sprint 1: Error Resilience & Safety Nets (1-2 weeks)

**Goal:** Ensure no user-visible failure mode is silent.

| # | Task | Files | Effort | Addresses |
|---|---|---|---|---|
| 1.1 | Add global `error` + `unhandledrejection` handlers with toast | `app.ts` | S | C1 |
| 1.2 | Surface auto-rejoin failure with "Reconnection failed" prompt | `socket-client.ts`, `multiplayerUI.ts` | M | C3 |
| 1.3 | Replace `clearRoleChange()` with `revertAndClearRoleChange()` in timeout path | `roles.ts` | XS | H4 |
| 1.4 | Add `AbortController` with timeout to all `fetch()` calls | `i18n.ts`, `history.ts` | S | M1 |
| 1.5 | Settings save: surface `safeSetItem()` failure as toast | `settings.ts`, `utils.ts` | S | M5 |
| 1.6 | Fix `parseInt()` radix, `?? undefined` cleanup | `settings.ts`, `history.ts` | XS | L1, L3 |

**Test deliverables:**
- New test file: `app.test.ts` — init, global error handler, event delegation (addresses test gap)
- New test file: `url-state.test.ts` — encoding edge cases

---

### Sprint 2: Reconnection Hardening (2-3 weeks)

**Goal:** Make the reconnection path as robust as the happy path.

| # | Task | Files | Effort | Addresses |
|---|---|---|---|---|
| 2.1 | Offline queue: add game-generation tagging to auto-discard stale events | `socket-client.ts` | M | C2 |
| 2.2 | Offline queue: process sequentially with ack, halt on rejection | `socket-client.ts` | L | C2 |
| 2.3 | Only set `state.isConnected = true` after auth completes, not on raw `connect` | `socket-client.ts`, `socket-client-events.ts` | M | H5 |
| 2.4 | Clear `joinInProgress`/`createInProgress` on `connect_error` in addition to `disconnect` | `socket-client.ts` | S | C3 |
| 2.5 | Wrap reconnection state application in `batch()` | `roomEventHandlers.ts` | S | M7 |
| 2.6 | Add lightweight runtime shape checks on critical event data | `handlers/gameEventHandlers.ts`, `handlers/roomEventHandlers.ts` | M | M3 |

**Test deliverables:**
- New test file: `socket-client-storage.test.ts` — quota, private browsing, corruption recovery
- Expand `socket-client.test.ts` — full reconnection lifecycle (connect → disconnect → reconnect → rejoin → queue flush → rejection handling)
- Expand `socketClientOfflineQueue.test.ts` — generation tagging, ack-based processing

---

### Sprint 3: Resource Lifecycle & Cleanup (1-2 weeks)

**Goal:** Eliminate all listener/interval leaks across room transitions and modal lifecycle.

| # | Task | Files | Effort | Addresses |
|---|---|---|---|---|
| 3.1 | Replay board: store keydown listener ref, remove before re-adding | `history.ts` | S | H1 |
| 3.2 | Replay interval: hook `stopReplay()` into modal close handler | `history.ts`, `app.ts` | S | H2 |
| 3.3 | Timer interval: add defensive `stopTimerCountdown()` in all cleanup paths | `timer.ts`, `multiplayerSync.ts` | S | H3 |
| 3.4 | Track multiplayer modal DOM listeners for cleanup | `multiplayer.ts`, `multiplayerSync.ts` | M | H6 |
| 3.5 | Replace `!` non-null assertions with safe `getElement()` helper (top 15 call sites) | `board.ts`, `timer.ts`, `roles.ts`, `multiplayer.ts` | M | M2 |
| 3.6 | Debounce `updatePlayerList()` with `requestAnimationFrame` | `multiplayerUI.ts` | S | M4 |

**Test deliverables:**
- New test file: `multiplayerListeners.test.ts` — idempotency, cleanup completeness
- Expand `history.test.ts` — replay interval lifecycle, modal close cleanup, listener count assertions
- Expand `ui.test.ts` — modal stack concurrent open/close, focus restoration

---

### Sprint 4: Test Coverage Expansion (2-3 weeks)

**Goal:** Close remaining coverage gaps with meaningful, scenario-driven tests.

| # | Task | Files | Effort | Priority |
|---|---|---|---|---|
| 4.1 | Split `handlers.test.ts` into per-handler test files | `__tests__/frontend/handlers/` | M | HIGH |
| 4.2 | Add handler error-path tests (malformed data, null fields) | `__tests__/frontend/handlers/` | M | HIGH |
| 4.3 | Add handler cleanup-on-disconnect tests | `__tests__/frontend/handlers/` | S | HIGH |
| 4.4 | Expand `multiplayerSync.test.ts` — concurrent sync+update race | `__tests__/frontend/multiplayerSync.test.ts` | M | HIGH |
| 4.5 | Add `roles.test.ts` — compound team+role change timeout paths | `__tests__/frontend/roles.test.ts` | S | MEDIUM |
| 4.6 | Add `board.test.ts` — incremental update with mismatched arrays, resize cleanup | `__tests__/frontend/board.test.ts` | S | MEDIUM |
| 4.7 | Add `multiplayer.test.ts` — abort controller races, settings rejection | `__tests__/frontend/multiplayer.test.ts` | M | MEDIUM |
| 4.8 | Add E2E: full game lifecycle (create → play → win → new game) | `e2e/` | L | MEDIUM |
| 4.9 | Add E2E: reconnection during active game | `e2e/` | L | HIGH |
| 4.10 | Add E2E: multi-browser multiplayer (2+ contexts) | `e2e/` | L | MEDIUM |

---

## Sprint Sizing Key

| Size | Meaning |
|---|---|
| XS | < 1 hour, isolated change |
| S | Half day, single module |
| M | 1-2 days, cross-module |
| L | 3-5 days, significant implementation |

## Recommended Execution Order

```
Sprint 1 (Safety Nets)     ████████░░░░  Week 1-2
Sprint 2 (Reconnection)    ░░░░████████████░░  Week 2-4
Sprint 3 (Cleanup)         ░░░░░░░░░░████████  Week 4-5
Sprint 4 (Tests)           ░░░░██████████████  Week 2-5 (parallel)
```

Sprints 1 and 4 can start in parallel. Sprint 4 work should be interleaved with the other sprints — write tests as you fix each issue.
