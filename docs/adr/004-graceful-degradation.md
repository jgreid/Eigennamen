# ADR 004: Graceful Degradation Without External Redis

## Status
Adopted (2024), Updated (2026)

## Context
Eigennamen Online is designed to be easy to deploy and run. Requiring external Redis for all deployments creates barriers for:
- Local development
- Simple single-server deployments
- Quick demos and testing
- Environments without managed cache services

### Problem Statement
How can we support the full feature set when infrastructure is available while still working in minimal environments?

## Decision
Implement a tiered architecture where Redis is optional:

### Tier 1: External Redis
- All game functionality works
- Multi-instance horizontal scaling via Redis pub/sub
- Session persistence across restarts
- Distributed locks for concurrency control
- Game history and replay data stored in Redis

### Tier 2: Memory Only (Single Instance)
- All game functionality works
- `REDIS_URL=memory` triggers an embedded redis-server process
- Data lost on restart
- Single instance only (no horizontal scaling)

### Implementation Strategy
```javascript
// Memory mode detection
function isMemoryMode() {
    return process.env.REDIS_URL === 'memory' ||
           process.env.REDIS_URL === 'mem' ||
           process.env.USE_MEMORY_STORAGE === 'true';
}

// Redis client with memory fallback
async function connectRedis() {
    if (isMemoryMode()) {
        // Spawns an embedded redis-server process
        return startEmbeddedRedis();
    }
    return createRedisClient(process.env.REDIS_URL);
}
```

## Consequences

### Positive
- **Easy Development**: `npm run dev` works without Docker or external services
- **Flexible Deployment**: Works on anything from Raspberry Pi to Kubernetes
- **Reduced Costs**: Small deployments don't need managed cache services
- **Fast CI/CD**: Tests run without external dependencies

### Negative
- **Feature Gaps**: Multi-instance scaling unavailable in memory mode
- **Code Complexity**: Conditional logic for pub/sub adapter setup
- **Testing Surface**: Need to test both tier configurations
- **Documentation**: Must clearly explain tier differences

### Feature Availability by Tier

| Feature | Memory | Redis |
|---------|--------|-------|
| Create/Join Rooms | ✅ | ✅ |
| Play Games | ✅ | ✅ |
| Turn Timers | ✅ | ✅ |
| Reconnection | ✅ | ✅ |
| Game History/Replays | ✅ | ✅ |
| Multi-Instance | ❌ | ✅ |
| Data Persistence | ❌ | ✅ |

## Alternatives Considered

### 1. Require Redis for All Deployments
Make Redis mandatory for all deployments.
**Rejected**: Creates unnecessary barriers for simple use cases

### 2. SQLite Fallback
Use SQLite for single-instance deployments.
**Rejected**: Added complexity; embedded redis-server is simpler and provides a compatible API

### 3. In-Memory Map Implementation
Implement a custom in-memory Redis-compatible API.
**Rejected**: Significant complexity maintaining compatibility; embedded redis-server is simpler

## Implementation Examples

### Embedded Redis (Memory Mode)
```javascript
// server/src/config/redis.ts
async function startEmbeddedRedis() {
    const { spawn } = require('child_process');
    const redisProcess = spawn('redis-server', [
        '--port', port.toString(),
        '--save', '""',           // No RDB persistence
        '--appendonly', 'no',     // No AOF persistence
        '--maxmemory', '100mb',
        '--maxmemory-policy', 'allkeys-lru'
    ]);
    // Connect client to embedded server
    return createRedisClient(`redis://localhost:${port}`);
}
```

## References
- [The Twelve-Factor App: Backing Services](https://12factor.net/backing-services)
