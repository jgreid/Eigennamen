# Multiplayer Hardening Plan

## Tier 1 — High-impact fixes (data loss, broken UX, race conditions)

### 1. Listeners registered too late — missed game events
**Files:** `multiplayer.ts` (line 319), `multiplayerSync.ts`
**Bug:** `setupMultiplayerListeners()` runs inside `onMultiplayerJoined()` *after* the
server has already sent `room:joined`. If the server sends `game:started` in rapid
succession, the client misses it because listeners aren't registered yet.
**Fix:** Call `setupMultiplayerListeners()` immediately after `CodenamesClient.connect()`
resolves — before emitting `room:join` or `room:create`. Guard with the existing
`state.multiplayerListenersSetup` flag so it's idempotent.

### 2. Auto-rejoin failure leaves UI in limbo
**Files:** `socket-client.js` (line 118-121), `multiplayerListeners.ts` (line 498-509)
**Bug:** When auto-rejoin fires on reconnect and fails (room deleted while offline), the
`rejoinFailed` handler calls `leaveMultiplayerMode()`, but if any part of that cleanup
throws, the user is stuck with `state.isMultiplayerMode = true` and a dead room code.
The multiplayer UI stays visible but nothing works.
**Fix:** Wrap the `rejoinFailed` handler in a defensive try/catch that always resets
`state.isMultiplayerMode = false` and clears `state.currentRoomId`. Also disable
`autoRejoin` during explicit create/join operations to prevent event contamination
(the `room:error` from a failed rejoin can be caught by a concurrent `createRoom`
promise's error listener).

### 3. Role-change buttons stuck in loading state after disconnect
**Files:** `multiplayerListeners.ts` (line 452-458)
**Bug:** On disconnect, `clearRoleChange()` resets the state machine to `idle`, but
doesn't revert the DOM — buttons keep the `loading` class and remain disabled. The
`revertAndClearRoleChange()` function exists but isn't called on disconnect.
**Fix:** Replace `clearRoleChange()` with `revertAndClearRoleChange()` in the
`disconnected` event handler.

### 4. Room TTL not refreshed on game mutations
**Files:** `roomService.ts` (updateSettings), `gameHandlers.ts` (reveal, clue, endTurn)
**Bug:** `refreshRoomTTL()` is only called during `joinRoom()`. Room mutations like
settings updates, card reveals, and clue giving don't refresh the TTL. An active game
can expire if no new players join for 4h (memory mode) or 24h (Redis mode).
**Fix:** Call `refreshRoomTTL()` inside `updateSettings()` and after successful game
mutations (start, reveal, clue, endTurn). Use a simple debounce (skip refresh if last
refresh was <60s ago) to avoid hammering Redis.

### 5. Timer expiration races with game-over reveal
**Files:** `disconnectHandler.ts` (line 39-82), `gameHandlers.ts` (line 227-238)
**Bug:** If a card reveal ends the game at nearly the same time as a timer expiry,
both handlers broadcast conflicting events. The timer callback holds a distributed lock
for `timer-expire:${roomCode}`, but the reveal handler doesn't acquire the same lock —
it only calls `stopTurnTimer()`, which may not cancel an already-queued callback.
**Fix:** In the timer expiration callback, re-check `game.gameOver` *after* acquiring
the lock (already done at line 59). In the reveal handler, also acquire the
`timer-expire:${roomCode}` lock before broadcasting game-over, so the two can't
overlap.

---

## Tier 2 — Medium-impact (state inconsistencies, error handling)

### 6. Reconnection token TOCTOU vulnerability
**Files:** `playerService.ts` (line 743-753, 963-1001)
**Bug:** Socket auth validates the reconnection token without consuming it (by design,
to let `room:reconnect` use it). But two sockets from the same player can both pass
auth with the same token, then race to consume it. The second socket gets
`TOKEN_EXPIRED`.
**Fix:** Use an atomic Lua script that validates + marks-as-consumed in one operation.
The second socket would see `already_consumed` and get a clean error.

### 7. Duplicate listener registration on rapid reconnect
**Files:** `multiplayerListeners.ts`, `multiplayerSync.ts`
**Bug:** If the socket disconnects and auto-rejoins quickly, `setupMultiplayerListeners()`
can be called while old listeners are still active, stacking duplicate handlers. This
causes double toast notifications and doubled event processing.
**Fix:** Always call `cleanupMultiplayerListeners()` at the top of
`setupMultiplayerListeners()` before registering anything new. This makes setup
idempotent.

### 8. `getPlayersInRoom` null/type-safety gaps
**Files:** `roomHandlers.ts` (line 281), `playerHandlers.ts` (line 281), `gameHandlers.ts`
**Bug:** `getPlayersInRoom()` can return `null` in edge cases, but callers annotate
the return as `Player[]` and use fallback `|| []` only at the point of emission.
Intermediate operations (`.find()`, `.filter()`, `.length`) can crash.
**Fix:** Have `getPlayersInRoom()` always return `[]` (never null) at the service level,
and add a runtime guard at the top of the function.

### 9. Socket.roomCode can drift from Redis state
**Files:** `roomHandlers.ts` (lines 164-166, 210-212, 448-450), `playerContext.ts`
**Bug:** `socket.roomCode` is assigned after `socket.join()` succeeds, but if any
subsequent operation fails (e.g., `getRoomStats()` in the create handler), the error
propagates, the handler's catch block fires, and the client sees an error — but the
socket is already in the room with `roomCode` set. On the next event, `playerContext`
uses the stale `roomCode`.
**Fix:** Move `socket.roomCode` assignment to after ALL handler work completes
(after the final `socket.emit`), or clear it in the error path.

---

## Tier 3 — Lower-impact (cleanup, edge cases, DX)

### 10. Player-Room TTL desynchronization
Players and rooms have the same TTL but are set independently. If a room expires
naturally, player keys linger. Add a cron-style cleanup that scans `player:*` keys
and verifies their `roomCode` still exists.

### 11. Orphaned reconnection token keys
If the second DEL in `invalidateRoomReconnectToken()` fails, the session→token
mapping key lingers. Use an atomic Lua script for token invalidation.

### 12. DOM listener leaks in `initPlayerListUI()`
`playerCountBtn` click handler and kick delegation handler are added without cleanup.
Track and remove on `leaveMultiplayerMode()`.

### 13. Offline queue messages silently dropped
Chat messages queued while offline are dropped after 2 minutes with no user
notification. Show a subtle "message not sent" indicator.

### 14. Error context lost in double-catch chain
`contextHandler` → `rateLimitHandler` error path catches twice, losing the original
validation context. Consolidate error handling to one layer.
