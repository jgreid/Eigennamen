# Multiplayer Code Review - Codenames Online

**Date**: January 24, 2026
**Branch**: `claude/review-multiplayer-code-Lh5Yj`
**Scope**: Socket handlers, services, client integration

---

## Executive Summary

This review examines the multiplayer implementation including Socket.io handlers, Redis-backed services, and client-side integration. While the codebase shows solid architectural decisions and comprehensive security measures, there are several **race conditions** and **resource cleanup issues** that need attention.

| Category | Severity Count | Status |
|----------|---------------|--------|
| Critical | 5 | Needs immediate attention |
| High | 6 | Should fix soon |
| Medium | 10 | Plan to address |
| Low | 8 | Minor improvements |

---

## Critical Issues

### 1. Non-Atomic Team Set Operations (CRITICAL)

**Location**: `server/src/services/playerService.js:193-242` (`setTeam()`) and `244-320` (`safeSetTeam()`)

**Problem**: The Lua script updates player data atomically, but team set maintenance (`sRem`/`sAdd`) happens **outside the script**. This creates a race condition window.

```javascript
// Line 209: Atomic Lua script updates player data
const result = await redis.eval(ATOMIC_SET_TEAM_SCRIPT, {...});

// Lines 226-234: NON-ATOMIC team set operations (outside script)
if (oldTeam) {
    await redis.sRem(`room:${roomCode}:team:${oldTeam}`, sessionId);  // Race point
}
if (team) {
    await redis.sAdd(`room:${roomCode}:team:${team}`, sessionId);     // Race point
}
```

**Race Scenario**:
1. Player A on Red calls `setTeam('blue')`
2. Lua script updates: `A.team = 'blue'`
3. **Race window** - Another request reads A as blue
4. `sRem` removes A from red set
5. Another `setTeam()` for A interleaves, causing wrong team set membership

**Impact**: Team sets can contain players not on the team, or miss players entirely.

**Fix**: Move team set operations into the Lua script or use a Redis transaction with WATCH.

---

### 2. Socket Room Assignment Race Condition (CRITICAL)

**Location**: `server/src/socket/handlers/roomHandlers.js:118-121` (`room:join`), `68-70` (`room:create`)

**Problem**: Socket room membership is assigned without atomic verification:

```javascript
socket.join(`room:${room.code}`);
socket.join(`player:${socket.sessionId}`);
socket.roomCode = room.code;
```

If an exception occurs after `socket.join()` but before the emit completes, the socket remains in the room namespace but the client believes they never joined.

**Impact**: Clients receive events for rooms they didn't successfully join, causing state desync.

**Fix**: Wrap in try/catch with `socket.leave()` on failure, or use a two-phase commit pattern.

---

### 3. Timer Restart Lock Incomplete (CRITICAL)

**Location**: `server/src/socket/index.js:193-245`

**Problem**: The `setImmediate` creates an execution gap, and the lock handling has edge cases:

```javascript
setImmediate(async () => {
    const lockAcquired = await redis.set(lockKey, process.pid.toString(), { NX: true, EX: 5 });
    if (!lockAcquired) {
        logger.debug(`Timer restart skipped...`);
        return;  // Gap: What if Redis fails here?
    }
    // If exception thrown before finally, lock may leak
});
```

**Issues**:
1. `setImmediate` creates window for multiple instances to queue timer restarts
2. If Redis `set` fails (network issue), lock isn't acquired but error isn't handled
3. Lock can leak if exception throws between acquisition and `finally` block

**Fix**: Add explicit error handling, increase lock TTL, ensure lock release in all code paths.

---

### 4. Missing Team Set Cleanup in Room Cleanup (CRITICAL)

**Location**: `server/src/services/roomService.js:519-550`

**Problem**: The `cleanupRoom()` function deletes player data and the players set, but **fails to clean up team sets**:

```javascript
// Lines 532-537
const keysToDelete = [
    ...sessionIds.map(sessionId => `player:${sessionId}`),
    `room:${code}`,
    `room:${code}:players`,
    `room:${code}:game`
];
// MISSING: room:${code}:team:red, room:${code}:team:blue
```

**Impact**: Redis accumulates orphaned team set keys that never expire.

**Fix**: Add `room:${code}:team:red` and `room:${code}:team:blue` to `keysToDelete`.

---

### 5. Unhandled localStorage/sessionStorage Quota Errors (CRITICAL)

**Location**: `server/public/js/socket-client.js:299, 303, 306` and `index.html` multiple locations

**Problem**: No try-catch around storage operations:

```javascript
// socket-client.js Line 299 (no error handling):
if (this.sessionId) {
    sessionStorage.setItem('codenames-session-id', this.sessionId);  // Can throw
}
```

**Impact**: App crashes in private browsing mode or when storage quota exceeded.

**Fix**: Wrap all `setItem`/`getItem` calls in try-catch blocks.

---

## High Severity Issues

### 6. Memory Leak in Event Listener Cleanup

**Location**: `server/public/js/socket-client.js:397-403, 449-453, 517-521`

**Problem**: Error handlers only remove listeners if error type matches:

```javascript
const onError = (error) => {
    if (error.type === 'room') {  // Only cleans up for specific type
        this.off('roomCreated', onCreated);
        this.off('error', onError);
        reject(error);
    }
    // Listeners NOT removed if error.type !== 'room'
};
```

If errors of other types are emitted, listeners remain attached until 10s timeout.

**Impact**: Long sessions with connection issues accumulate orphaned listeners.

---

### 7. Host Transfer Lock Gap

**Location**: `server/src/socket/index.js:308-363`

**Problem**: Between `finally` block execution and next line, another instance could acquire the lock:

```javascript
} finally {
    await redis.del(lockKey);  // Lock released
}
// Gap here - another instance could grab lock
```

Lock TTL of 3 seconds is too short for slow Redis operations.

**Impact**: Duplicate host transfers can occur in multi-instance deployments.

---

### 8. TTL Race Condition in refreshRoomTTL()

**Location**: `server/src/services/roomService.js:499-513`

**Problem**: TTLs refreshed separately for each key:

```javascript
await redis.expire(`room:${code}`, REDIS_TTL.ROOM);              // T1
// RACE WINDOW - room key might expire before next call
await redis.expire(`room:${code}:players`, REDIS_TTL.ROOM);      // T2
```

**Impact**: Partial room cleanup, orphaned player sets without room context.

---

### 9. Disconnect Handler No Timeout

**Location**: `server/src/socket/index.js:101-126`

**Problem**: No timeout wrapper on `handleDisconnect()`:

```javascript
socket.on('disconnect', async (reason) => {
    try {
        await handleDisconnect(io, socket, reason);  // Could hang indefinitely
    } catch (error) {
        logger.error('Error in disconnect handler:', error);
    }
});
```

**Impact**: If Redis/database is slow, disconnect stalls, preventing cleanup.

---

### 10. Unvalidated Room Operations in Player Handlers

**Location**: `server/src/socket/handlers/playerHandlers.js:21-75`

**Problem**: Player operations broadcast without verifying socket still in room:

```javascript
const player = await playerService.getPlayer(socket.sessionId);
// ... time passes ...
io.to(`room:${socket.roomCode}`).emit('player:updated', { ... });
// socket.roomCode might be null/undefined at this point
```

**Impact**: Broadcasts may fail silently or go to wrong room.

---

### 11. Fire-and-Forget Async in Connect Handler

**Location**: `server/public/js/socket-client.js:70`

**Problem**: `_attemptRejoin()` called without await:

```javascript
if (wasReconnecting && this.autoRejoin) {
    this._attemptRejoin();  // No await!
}
resolve(this.socket);
```

**Impact**: No visibility into reconnection success/failure from caller.

---

## Medium Severity Issues

### 12. Incomplete Orphan Cleanup in getPlayersInRoom()

**Location**: `server/src/services/playerService.js:437-491`

When cleaning orphaned session IDs, only removes from players set, not:
- Player data (`player:${sessionId}`)
- Team sets (`room:${code}:team:*`)
- Socket mappings

---

### 13. Empty Team Sets Never Deleted

**Location**: `server/src/services/playerService.js:224-234`

When last player leaves a team, the empty set persists forever (TTL only set on add).

---

### 14. Error Event Filtering Mismatch

**Location**: `index.html:3717-3729`

Global error listener catches all errors, but promise-based methods filter by type. A 'game' error during room creation shows confusing messages.

---

### 15. State Synchronization Gap on Player Disconnect

**Location**: `index.html:3623-3632`

When player disconnects, client updates local state but doesn't request full resync. If game state changed while offline, board state may be stale.

---

### 16. addTimeLocal() Return Value Mismatch

**Location**: `server/src/services/timerService.js:548-649`

When not timer owner, returns current status before pub/sub propagates the change. Client thinks addTime failed.

---

### 17. Lock Timeout Exceeded in revealCard()

**Location**: `server/src/services/gameService.js:905-1007`

Lock acquired for 5s, but retry loop could exceed this, allowing concurrent reveals.

---

### 18. Missing roomCode Null Check Pattern

**Location**: All handlers

Pattern throws error with null value:

```javascript
if (!socket.roomCode) {
    throw RoomError.notFound(socket.roomCode);  // Passes null/undefined
}
```

Makes debugging harder with undefined error details.

---

### 19. Non-Atomic Event Emissions

**Location**: `server/src/socket/handlers/gameHandlers.js:176-232`

Multiple related events emitted sequentially. If game over emit fails after card reveal emit, clients left in inconsistent state.

---

### 20. Timeout Callbacks Not Cancelled

**Location**: `server/public/js/socket-client.js:409-413, 459-462, 527-531`

setTimeout created but never cancelled when promise resolves early.

---

### 21. Password State Not Revalidated

**Location**: `server/src/socket/handlers/roomHandlers.js:226-263`

If host changes password after players join, joined players retain access but can't rejoin on disconnect.

---

## Low Severity Issues

### 22. Log Injection Risk

**Location**: Multiple handler files

User input (nicknames, clues) logged without sanitization. Malicious input with newlines could fake log entries.

---

### 23. Inconsistent Error Event Naming

Different error events across handlers:
- `SOCKET_EVENTS.GAME_ERROR`
- `'room:error'`
- `'player:error'`
- `'chat:error'`

---

### 24. XSS Defense-in-Depth Gap

Player nicknames broadcast without server-side HTML escaping, relying entirely on client sanitization.

---

### 25. Console Logging in Production

Multiple files have `console.log` statements that could leak info in production.

---

### 26. Inconsistent Transport Configuration

**Location**: `server/public/js/socket-client.js:42-46`

Protocol detection logic has edge case when serverUrl protocol differs from page protocol.

---

### 27. Rate Limit Key Naming Inconsistency

Event names don't always match rate limit keys (e.g., `'player:team'` vs `'player:setTeam'`).

---

### 28. No Retry Logic for Failed Emits

`io.to().emit()` fire-and-forget with no delivery verification or retry.

---

### 29. Chat Validation Type Check Missing

Chat handler doesn't validate `data` is object before passing to Zod schema.

---

## Recommendations

### Immediate Actions (Critical)

1. **Move team set operations into Lua scripts** - Ensure atomicity for team changes
2. **Add socket.leave() on join failure** - Prevent room membership desync
3. **Wrap storage operations in try-catch** - Prevent crashes in private browsing
4. **Add team sets to room cleanup** - Prevent Redis memory accumulation
5. **Add timeout to timer restart lock operations** - Prevent lock leaks

### Short-term Actions (High)

6. **Add timeout wrapper to disconnect handler** - Force cleanup after 10s
7. **Increase host transfer lock TTL** - Prevent duplicate transfers
8. **Use atomic TTL refresh** - Use Lua script for multi-key TTL refresh
9. **Fix event listener cleanup** - Remove listeners on any error type
10. **Validate socket.roomCode before emit** - Prevent silent broadcast failures

### Medium-term Actions

11. **Implement acknowledgment system** - Use Socket.io acks for critical events
12. **Add request context to errors** - Include operation name in error events
13. **Standardize error event names** - Use consistent naming across handlers
14. **Add comprehensive test coverage** - Unit tests for race condition scenarios
15. **Sanitize user input in logs** - Prevent log injection attacks

---

## Files Reviewed

| File | Lines | Issues Found |
|------|-------|--------------|
| `server/src/socket/handlers/roomHandlers.js` | 500+ | 5 |
| `server/src/socket/handlers/gameHandlers.js` | 450+ | 4 |
| `server/src/socket/handlers/playerHandlers.js` | 250+ | 3 |
| `server/src/socket/handlers/chatHandlers.js` | 100+ | 2 |
| `server/src/socket/index.js` | 450+ | 5 |
| `server/src/services/playerService.js` | 600+ | 6 |
| `server/src/services/roomService.js` | 550+ | 3 |
| `server/src/services/gameService.js` | 1000+ | 2 |
| `server/src/services/timerService.js` | 800+ | 2 |
| `server/public/js/socket-client.js` | 650+ | 5 |
| `index.html` (client socket code) | 5200+ | 3 |

---

*Report generated by Claude Code Review*
