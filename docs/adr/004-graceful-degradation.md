# ADR 004: Graceful Degradation Without Database

## Status
Adopted (2024)

## Context
Codenames Online is designed to be easy to deploy and run. Requiring PostgreSQL and Redis for all deployments creates barriers for:
- Local development
- Simple single-server deployments
- Quick demos and testing
- Environments without managed database services

### Problem Statement
How can we support the full feature set when infrastructure is available while still working in minimal environments?

## Decision
Implement a tiered architecture where each external dependency is optional:

### Tier 1: Full Stack (PostgreSQL + Redis)
- Persistent user accounts and word lists
- Multi-instance horizontal scaling
- Pub/sub for real-time coordination
- Durable game history

### Tier 2: Redis Only
- All game functionality works
- Multi-instance scaling via Redis pub/sub
- Session persistence across restarts
- No persistent user accounts

### Tier 3: Memory Only (Single Instance)
- All game functionality works
- `REDIS_URL=memory` triggers in-memory storage
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
        return getMemoryStorage();
    }
    return createRedisClient(process.env.REDIS_URL);
}

// Database-optional word lists
async function getWordsForGame(wordListId) {
    if (!prisma) {
        return null; // Fall back to default words
    }
    return await prisma.wordList.findUnique({ where: { id: wordListId }});
}
```

## Consequences

### Positive
- **Easy Development**: `npm run dev` works without Docker or external services
- **Flexible Deployment**: Works on anything from Raspberry Pi to Kubernetes
- **Reduced Costs**: Small deployments don't need managed databases
- **Fast CI/CD**: Tests run without external dependencies

### Negative
- **Feature Gaps**: Some features unavailable in lower tiers
- **Code Complexity**: Conditional logic for optional dependencies
- **Testing Surface**: Need to test all tier combinations
- **Documentation**: Must clearly explain tier differences

### Feature Availability by Tier

| Feature | Memory | Redis | Full Stack |
|---------|--------|-------|------------|
| Create/Join Rooms | ✅ | ✅ | ✅ |
| Play Games | ✅ | ✅ | ✅ |
| Turn Timers | ✅ | ✅ | ✅ |
| Reconnection | ✅ | ✅ | ✅ |
| Multi-Instance | ❌ | ✅ | ✅ |
| Data Persistence | ❌ | ✅ | ✅ |
| Custom Word Lists (DB) | ❌ | ❌ | ✅ |
| User Accounts | ❌ | ❌ | ✅ |
| Game History | ❌ | ❌ | ✅ |

## Alternatives Considered

### 1. Require All Dependencies
Make PostgreSQL and Redis mandatory for all deployments.
**Rejected**: Creates unnecessary barriers for simple use cases

### 2. SQLite Fallback
Use SQLite instead of PostgreSQL for single-instance deployments.
**Rejected**: Added complexity; most features work without any database

### 3. Embedded Redis
Bundle an embedded Redis-compatible server.
**Rejected**: Significant complexity; memory mode is simpler

## Implementation Examples

### Memory Storage Service
```javascript
class MemoryStorage {
    constructor() {
        this.data = new Map();
        this.sets = new Map();
        this.ttls = new Map();
    }

    async get(key) { return this.data.get(key) || null; }
    async set(key, value, options = {}) {
        this.data.set(key, value);
        if (options.EX) {
            this.ttls.set(key, Date.now() + options.EX * 1000);
        }
        return 'OK';
    }
    // ... other Redis-compatible methods
}
```

### Prisma Optional Pattern
```javascript
let prisma = null;

async function initDatabase() {
    if (!process.env.DATABASE_URL) {
        logger.info('Running without database (user accounts disabled)');
        return null;
    }
    prisma = new PrismaClient();
    await prisma.$connect();
    return prisma;
}
```

## References
- [The Twelve-Factor App: Backing Services](https://12factor.net/backing-services)
- Issue #12: Default word list for database-free mode
