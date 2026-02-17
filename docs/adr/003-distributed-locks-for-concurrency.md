# ADR 003: Distributed Locks for Concurrency Control

## Status
Adopted (2024)

## Context
Eigennamen runs on multiple Node.js instances behind a load balancer for horizontal scaling. Certain operations require exclusive access to prevent race conditions and data corruption.

### Problem Statement
Critical operations that need mutual exclusion:
1. **Card Reveal**: Two players clicking simultaneously could corrupt game state
2. **Spymaster Role**: Two players clicking "Be Spymaster" at once could both succeed
3. **Timer Resume**: Multiple instances could start duplicate timers
4. **Host Transfer**: Concurrent host changes could leave room without host

## Decision
Use Redis-based distributed locks with NX (Not Exists) and EX (Expiration) for all critical sections:

```javascript
// Acquire lock with 5-second expiration
const lockKey = `lock:${operation}:${resourceId}`;
const acquired = await redis.set(lockKey, processId, { NX: true, EX: 5 });
if (!acquired) {
    throw new Error('Resource is locked, try again');
}

try {
    // Critical section
    await performOperation();
} finally {
    // Always release lock
    await redis.del(lockKey);
}
```

### Lock Categories

| Lock | Key Pattern | TTL | Purpose |
|------|-------------|-----|---------|
| Card Reveal | `lock:reveal:${roomCode}` | 5s | Prevent duplicate reveals |
| Spymaster Role | `lock:spymaster:${roomCode}:${team}` | 5s | One spymaster per team |
| Clicker Role | `lock:clicker:${roomCode}:${team}` | 5s | One clicker per team |
| Timer Resume | `lock:timer:resume:${roomCode}` | 5s | Prevent duplicate timers |
| Host Transfer | `lock:host:${roomCode}` | 3s | Atomic host changes |

## Consequences

### Positive
- **Correctness**: Guarantees mutual exclusion across all instances
- **Simplicity**: NX/EX pattern is simple and well-understood
- **Fault Tolerance**: Lock expiration prevents deadlocks if instance crashes
- **No External Dependencies**: Uses existing Redis infrastructure

### Negative
- **Added Latency**: Lock acquisition adds ~1-2ms per operation
- **Lock Contention**: High-traffic rooms may see occasional lock failures
- **Clock Skew Risk**: Expiration relies on Redis server time

### Mitigations
1. Keep TTLs short (3-5 seconds) to minimize contention
2. Always use try/finally to release locks
3. Return user-friendly error messages when lock fails
4. Log lock acquisition times for monitoring

## Alternatives Considered

### 1. Optimistic Locking (WATCH/MULTI)
Redis WATCH allows optimistic concurrency:
```javascript
await redis.watch(key);
const data = await redis.get(key);
// modify data
const result = await redis.multi().set(key, newData).exec();
if (result === null) { /* retry */ }
```
**Used For**: Game state updates where conflicts are rare
**Not Used For**: Role assignment where deterministic winner is needed

### 2. Database Transactions
Could use PostgreSQL transactions with row-level locks.
**Rejected**: Adds database dependency for operations that need to work without PostgreSQL

### 3. Redlock Algorithm
More sophisticated distributed lock using multiple Redis instances.
**Rejected**: Single Redis instance is sufficient; added complexity not justified

## Implementation Details

### Lock Acquisition Helper
```javascript
async function withLock(lockKey, ttlSeconds, operation) {
    const acquired = await redis.set(lockKey, process.pid.toString(), { NX: true, EX: ttlSeconds });
    if (!acquired) {
        throw new Error('Resource is locked');
    }
    try {
        return await operation();
    } finally {
        await redis.del(lockKey).catch(e => {
            logger.error(`Failed to release lock ${lockKey}:`, e.message);
        });
    }
}
```

### Error Handling
```javascript
// User-friendly error for lock failure
if (!lockAcquired) {
    throw new ValidationError('Another player is becoming spymaster, please try again');
}
```

## References
- [Redis Distributed Locks](https://redis.io/docs/latest/develop/use/patterns/distributed-locks/)
- Issue #32: Race condition in card reveals
- Issue #33: Timer resume across instances
