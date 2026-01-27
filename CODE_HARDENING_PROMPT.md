# Code Hardening and Bug Fix Review Prompt

## Objective
Systematically identify and fix bugs, edge cases, error handling gaps, and security vulnerabilities throughout the codebase. Focus on defensive programming and making the code resilient to failures.

---

## Phase 1: Error Handling Audit

### 1.1 Async/Await Error Handling
- [ ] All async functions have try/catch blocks
- [ ] Promise rejections are properly caught
- [ ] No unhandled promise rejections
- [ ] Error propagation is correct (not swallowing errors)
- [ ] Errors are logged with sufficient context

### 1.2 Service Layer Error Handling
- [ ] Redis operations handle connection failures
- [ ] Database operations handle connection failures
- [ ] External service calls have timeouts
- [ ] Retry logic has backoff and max attempts
- [ ] Circuit breaker patterns where appropriate

### 1.3 Socket Event Error Handling
- [ ] All socket handlers have error responses
- [ ] Errors don't crash the server
- [ ] Error messages don't leak sensitive info
- [ ] Rate limit errors are handled gracefully

---

## Phase 2: Edge Case Analysis

### 2.1 Null/Undefined Checks
- [ ] All function parameters validated
- [ ] Optional chaining used appropriately
- [ ] Default values for missing data
- [ ] Array bounds checking
- [ ] Object property access is safe

### 2.2 State Transition Edge Cases
- [ ] Game state transitions are valid
- [ ] Player state changes are atomic
- [ ] Room state is consistent
- [ ] Timer state handles edge cases
- [ ] Disconnection/reconnection flows

### 2.3 Concurrent Operation Handling
- [ ] Race conditions identified and fixed
- [ ] Distributed locks used correctly
- [ ] Atomic operations where needed
- [ ] State versioning/optimistic locking

---

## Phase 3: Resource Management

### 3.1 Memory Management
- [ ] Event listeners are cleaned up
- [ ] Intervals/timeouts are cleared
- [ ] Large objects are dereferenced
- [ ] Caches have size limits
- [ ] No circular references

### 3.2 Connection Management
- [ ] Redis connections are pooled
- [ ] Database connections are pooled
- [ ] Socket connections are tracked
- [ ] Connections are closed on shutdown
- [ ] Connection limits enforced

### 3.3 Graceful Shutdown
- [ ] SIGTERM/SIGINT handlers exist
- [ ] In-flight requests complete
- [ ] Timers are stopped
- [ ] Connections are closed
- [ ] State is persisted

---

## Phase 4: Input Validation Hardening

### 4.1 Type Coercion Issues
- [ ] String/number type mismatches
- [ ] Boolean coercion edge cases
- [ ] Array vs object handling
- [ ] Date parsing edge cases
- [ ] JSON parsing failures

### 4.2 Boundary Conditions
- [ ] Min/max value validation
- [ ] Empty string handling
- [ ] Empty array handling
- [ ] Zero and negative numbers
- [ ] Unicode and special characters

### 4.3 Injection Prevention
- [ ] SQL injection (parameterized queries)
- [ ] NoSQL injection (operator injection)
- [ ] Command injection
- [ ] Template injection
- [ ] Log injection

---

## Phase 5: Socket.io Specific Issues

### 5.1 Connection State
- [ ] Socket disconnection handling
- [ ] Room membership cleanup
- [ ] Event listener accumulation
- [ ] Reconnection token validation
- [ ] Session recovery

### 5.2 Event Ordering
- [ ] Event acknowledgments
- [ ] Message ordering guarantees
- [ ] Duplicate event handling
- [ ] Event replay on reconnection

### 5.3 Broadcast Safety
- [ ] Room existence checks before emit
- [ ] Player existence checks
- [ ] Data sanitization before broadcast
- [ ] Error handling in broadcasts

---

## Phase 6: Timer Service Hardening

### 6.1 Timer State Consistency
- [ ] Timer start/stop race conditions
- [ ] Pause/resume edge cases
- [ ] Timer expiration during operations
- [ ] Orphaned timer cleanup
- [ ] Multi-instance coordination

### 6.2 Timer Edge Cases
- [ ] Zero or negative remaining time
- [ ] Very long durations
- [ ] Rapid start/stop cycles
- [ ] Timer during game end
- [ ] Timer with disconnected host

---

## Phase 7: Game Logic Bugs

### 7.1 Turn Management
- [ ] Turn order validation
- [ ] Clue number bounds
- [ ] Guess counting accuracy
- [ ] Turn end conditions
- [ ] Team switching during turn

### 7.2 Card Reveal Logic
- [ ] Already revealed cards
- [ ] Invalid card indices
- [ ] Assassin card handling
- [ ] Score calculation
- [ ] Game over conditions

### 7.3 Player/Team Logic
- [ ] Team balance requirements
- [ ] Role assignment rules
- [ ] Spymaster uniqueness
- [ ] Host transfer logic
- [ ] Spectator restrictions

---

## Phase 8: Critical File Review

### Files to Audit (in priority order):
1. `server/src/services/gameService.js` - Core game logic
2. `server/src/services/playerService.js` - Player management
3. `server/src/services/roomService.js` - Room lifecycle
4. `server/src/services/timerService.js` - Timer logic
5. `server/src/socket/handlers/gameHandlers.js` - Game events
6. `server/src/socket/handlers/roomHandlers.js` - Room events
7. `server/src/socket/handlers/playerHandlers.js` - Player events
8. `server/src/socket/index.js` - Socket setup
9. `server/src/middleware/socketAuth.js` - Authentication
10. `server/src/config/redis.js` - Redis connection

---

## Execution Checklist

For each issue found:
1. Identify the bug/vulnerability
2. Determine root cause
3. Implement fix
4. Add test if needed
5. Verify fix doesn't break existing tests

### Output Format
```
### Bug: [Brief Description]
- **File**: [path:line]
- **Severity**: [Critical/High/Medium/Low]
- **Type**: [Error Handling/Edge Case/Race Condition/etc.]
- **Issue**: [Detailed description]
- **Fix**: [Description of fix applied]
- **Test**: [Test added or existing test covers]
```

---

## Success Criteria

- [ ] All critical bugs fixed
- [ ] All high severity bugs fixed
- [ ] Tests pass after fixes
- [ ] No new test failures introduced
- [ ] Code coverage maintained or improved
