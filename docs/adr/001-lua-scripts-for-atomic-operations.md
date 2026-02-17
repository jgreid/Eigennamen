# ADR 001: Lua Scripts for Atomic Redis Operations

## Status
Adopted (2024)

## Context
Card reveal operations in Eigennamen games were causing race conditions when multiple players clicked cards simultaneously. Additionally, the full JSON serialization/deserialization cycle for each operation created CPU overhead, especially in rooms with active games.

### Problem Statement
1. **Race Conditions**: Without atomic operations, two players clicking cards at the same time could both modify the game state, leading to inconsistent scores or invalid states.
2. **Performance**: Each operation required:
   - GET game state from Redis
   - Parse JSON in Node.js
   - Modify state
   - Serialize back to JSON
   - SET to Redis

   This created ~2-5ms overhead per operation and potential for WATCH/MULTI failures under load.

## Decision
Use Redis Lua scripts for all performance-critical atomic operations:

1. **Card Reveal** (`OPTIMIZED_REVEAL_SCRIPT`): Handles reveal, score updates, turn switching, win detection, and history logging in a single atomic operation.

2. **Give Clue** (`GIVE_CLUE_SCRIPT`): Atomically validates and records clues with guess limits.

3. **End Turn** (`END_TURN_SCRIPT`): Atomically switches turns and resets clue state.

4. **Team Change** (`ATOMIC_SET_TEAM_SCRIPT`): Atomically changes teams and clears role if switching.

5. **Timer Operations** (`ATOMIC_TIMER_CLAIM_SCRIPT`, `ATOMIC_ADD_TIME_SCRIPT`): Prevents duplicate timer handling across instances.

## Consequences

### Positive
- **Atomicity**: All state changes happen in a single Redis operation, eliminating race conditions
- **Performance**: 50-70% reduction in operation time by avoiding Node.js JSON parsing
- **Consistency**: WATCH/MULTI pattern falls back gracefully if Lua fails
- **Scalability**: Works across multiple Node.js instances without coordination

### Negative
- **Complexity**: Lua scripts are harder to debug than JavaScript
- **Maintenance**: Changes require updating both Lua and JavaScript fallback code
- **Testing**: Lua scripts require Redis to test; can't easily unit test in isolation
- **Learning Curve**: Team members need to understand Lua and Redis scripting

### Mitigations
1. Keep JavaScript fallback implementations for all Lua scripts
2. Use consistent error codes between Lua and JavaScript paths
3. Log when falling back to JavaScript for monitoring
4. Document each Lua script with inline comments

## Implementation
```javascript
// Example: Optimized reveal uses Lua with JavaScript fallback
async function revealCard(roomCode, index, playerNickname) {
    try {
        // Try optimized Lua script first
        return await revealCardOptimized(roomCode, index, playerNickname);
    } catch (luaError) {
        // Propagate game logic errors
        if (luaError.code && luaError.code !== ERROR_CODES.SERVER_ERROR) {
            throw luaError;
        }
        // Fall back to JavaScript implementation
        logger.warn(`Lua reveal failed, using fallback for room ${roomCode}`);
        return await revealCardFallback(roomCode, index, playerNickname);
    }
}
```

## References
- [Redis Lua Scripting](https://redis.io/docs/interact/programmability/eval-intro/)
- Issue #32: Race condition in card reveals
- Issue #36: Performance optimization for card reveals
