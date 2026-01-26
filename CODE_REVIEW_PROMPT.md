# Code Review Prompt: Risley-Codenames

Use this prompt to systematically review the codebase and identify broken functionality, bugs, security vulnerabilities, and areas for improvement.

---

## Instructions

Review this Codenames Online multiplayer game codebase thoroughly. Focus on finding **actual bugs and broken functionality** rather than style preferences. For each issue found, provide:

1. **File and line number** (e.g., `server/src/services/gameService.js:142`)
2. **Severity**: Critical / High / Medium / Low
3. **Description**: What's broken and why
4. **Evidence**: Code snippet or test case that demonstrates the issue
5. **Suggested fix**: How to resolve it

---

## Review Checklist

### 1. Socket.io Event Handler Bugs

Review `server/src/socket/handlers/` for:

- [ ] **Race conditions** in concurrent event handling (multiple players clicking same card)
- [ ] **Missing error handling** for malformed payloads
- [ ] **State inconsistencies** between client and server after events
- [ ] **Event handler registration** - are all events in `constants.js` properly registered?
- [ ] **Callback acknowledgment** - do handlers call `callback()` in all code paths?
- [ ] **Room/socket cleanup** on disconnect - any orphaned state?

```javascript
// Example pattern to check in handlers:
socket.on('game:reveal', async (data, callback) => {
  // Does this handle:
  // - Missing room?
  // - Player not in room?
  // - Game not started?
  // - Card already revealed?
  // - Invalid card index?
  // - Race with another reveal?
});
```

### 2. Game Logic Correctness

Review `server/src/services/gameService.js`:

- [ ] **PRNG determinism** - does Mulberry32 produce same sequence for same seed?
- [ ] **Card distribution** - exactly 9 red, 8 blue (or vice versa), 7 neutral, 1 assassin?
- [ ] **Turn order** - starting team has 9 cards and goes first?
- [ ] **Win conditions** - correct detection for all cases (all cards revealed, assassin hit)?
- [ ] **Clue validation** - clue word not matching any card word?
- [ ] **Guess limits** - can guess `clueNumber + 1` times maximum?

### 3. Room and Player State Management

Review `server/src/services/roomService.js` and `playerService.js`:

- [ ] **Room creation** - unique codes, no collisions?
- [ ] **Host transfer** - when host leaves, new host assigned correctly?
- [ ] **Team/role assignment** - can't have two spymasters on same team?
- [ ] **Reconnection** - player state restored correctly within timeout window?
- [ ] **Player limits** - enforced maximum players per room?
- [ ] **Spectator handling** - spectators can't take game actions?

### 4. Timer Service Issues

Review `server/src/services/timerService.js`:

- [ ] **Timer persistence** - survives server restart with Redis?
- [ ] **Orphan timers** - cleaned up when game ends or room deleted?
- [ ] **Pause/resume** - state preserved correctly?
- [ ] **Expiry handling** - turn ends and switches to other team?
- [ ] **Memory mode fallback** - timers work without Redis?
- [ ] **Concurrent timer operations** - race conditions on start/stop?

### 5. Authentication and Session Bugs

Review `server/src/middleware/socketAuth.js` and `server/src/config/jwt.js`:

- [ ] **Token validation** - expired tokens rejected?
- [ ] **Session recovery** - reconnection token matches socket/player?
- [ ] **JWT payload** - all required fields present and validated?
- [ ] **Rate limiting bypass** - can auth be spammed?
- [ ] **Host verification** - host-only actions properly gated?

### 6. Input Validation Gaps

Review `server/src/validators/schemas.js`:

- [ ] **Missing schemas** - any event handlers without validation?
- [ ] **Regex bypasses** - can malicious input slip through?
- [ ] **Length limits** - nickname, room code, clue word bounded?
- [ ] **Type coercion** - number vs string handling correct?
- [ ] **Nested object validation** - deep properties validated?

### 7. Frontend-Backend Synchronization

Review `index.html` and `src/js/` modules:

- [ ] **Event name mismatches** - client sending events server doesn't handle?
- [ ] **Payload structure mismatches** - client format vs server expectation?
- [ ] **State desync scenarios** - what happens on partial message loss?
- [ ] **Error display** - server errors shown to user meaningfully?
- [ ] **Reconnection UI** - user informed of connection state?
- [ ] **Standalone vs multiplayer** - mode switching without bugs?

### 8. Redis/Database Operations

Review `server/src/config/redis.js` and `memoryStorage.js`:

- [ ] **Connection failure handling** - graceful fallback to memory mode?
- [ ] **Lua script correctness** - atomic operations actually atomic?
- [ ] **Key expiration** - TTLs set correctly, no memory leaks?
- [ ] **Serialization** - JSON parse/stringify for complex objects?
- [ ] **Transaction boundaries** - multi-step operations consistent?

### 9. Error Handling Coverage

Review all service and handler files:

- [ ] **Unhandled promise rejections** - all async/await wrapped in try-catch?
- [ ] **Error propagation** - errors reach client with useful messages?
- [ ] **Error code consistency** - using constants, not magic strings?
- [ ] **Logging on errors** - sufficient context for debugging?
- [ ] **Graceful degradation** - partial failures don't crash server?

### 10. Security Vulnerabilities

- [ ] **XSS in chat/nicknames** - HTML entities escaped before display?
- [ ] **Prototype pollution** - object spreading from untrusted input?
- [ ] **Path traversal** - file operations use validated paths?
- [ ] **Rate limit bypasses** - can limits be circumvented?
- [ ] **CSRF token validation** - all state-changing endpoints protected?
- [ ] **Secret exposure** - no API keys/secrets in client code or logs?

---

## Specific Areas to Investigate

### A. Game State Machine

```
Check: server/src/utils/stateMachine.js

Questions:
1. Are all valid state transitions defined?
2. Can invalid transitions occur via race conditions?
3. Is the state machine used consistently in all handlers?
```

### B. Distributed Locking

```
Check: server/src/utils/distributedLock.js

Questions:
1. Are locks released in finally blocks?
2. What happens on lock acquisition timeout?
3. Can deadlocks occur between services?
```

### C. Event Log for Reconnection

```
Check: server/src/services/eventLogService.js

Questions:
1. Is event log pruned to prevent memory growth?
2. Are events replayed in correct order?
3. Are idempotent - can same event be applied twice safely?
```

### D. Word List Handling

```
Check: server/src/services/wordListService.js

Questions:
1. Can word lists contain duplicates?
2. What if word list has fewer than 25 words?
3. Are custom word lists persisted correctly?
```

---

## Test Gap Analysis

Run tests and analyze coverage:

```bash
cd server && npm run test:coverage
```

Look for:
- [ ] Uncovered lines in critical services
- [ ] Missing edge case tests (empty input, max values, concurrent operations)
- [ ] Integration tests for full game flows
- [ ] Tests for error conditions, not just happy paths

---

## Performance Issues

- [ ] **N+1 queries** - multiple Redis calls that could be batched?
- [ ] **Memory leaks** - event listeners not removed, timers not cleared?
- [ ] **Large payloads** - full game state sent when diff would suffice?
- [ ] **Socket.io rooms** - proper join/leave, no orphaned memberships?

---

## Documentation vs Implementation Drift

Compare `CLAUDE.md` and `docs/SERVER_SPEC.md` against actual code:

- [ ] Do documented events match implementation?
- [ ] Are error codes in docs same as in code?
- [ ] Do API endpoints match routes?

---

## Output Format

Structure findings as:

```markdown
## [Severity] Issue Title

**Location:** `file/path.js:lineNumber`

**Description:**
What's wrong and the impact.

**Code:**
```javascript
// Problematic code snippet
```

**Fix:**
```javascript
// Suggested correction
```

**Test Case:**
Steps to reproduce or test that would catch this.
```

---

## Priority Order

1. **Critical**: Data loss, security vulnerabilities, game-breaking bugs
2. **High**: Incorrect game behavior, state corruption, crashes
3. **Medium**: Poor error handling, edge cases, performance issues
4. **Low**: Code quality, missing validation, minor UX issues

Focus first on issues that affect real gameplay and could frustrate users.
