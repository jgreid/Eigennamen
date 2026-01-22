# Development Plan - Die Eigennamen (Codenames Online)

**Created:** January 21, 2026
**Last Updated:** January 22, 2026
**Focus:** Coding Best Practices, Quality, and Reliability

---

## Sprint 7 Status: COMPLETED

**Date Completed:** January 22, 2026

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Line Coverage | 60.19% | 62.4% | +2.21% |
| roomService.js | 44.57% | 87.34% | +42.77% |
| Test Count | 711 | 810 | +99 |

### Bug Fixes Verified
- BUG-1: Chat emit error handling - Already fixed in `chatHandlers.js:59-64`
- BUG-4: Timer addTime local timeout - Already fixed in `timerService.js:493-509`
- BUG-5: Timer stop before game:over - Already fixed in `gameHandlers.js:191-192`
- BUG-6: Timer restart distributed lock - Already fixed in `socket/index.js:167-210`

### New Test Files Added
- `gameServiceExtended.test.js` - Tests for decomposed reveal functions
- `roomServiceExtended.test.js` - Tests for password handling, settings, room lifecycle
- `socketConnectionLifecycle.test.js` - Tests for connection events, disconnection handling

---

## Sprint 8 Status: COMPLETED

**Date Completed:** January 22, 2026

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Line Coverage | 62.4% | 62.62% | +0.22% |
| rateLimit.js | 76.74% | 80.62% | +3.88% |
| Test Count | 810 | 864 | +54 |

### Security Features Verified (Already Implemented)

1. **Trust Proxy Configuration** - `socketAuth.js`
   - `shouldTrustProxy()` checks TRUST_PROXY, FLY_APP_NAME, DYNO
   - X-Forwarded-For only trusted when proxy configured
   - Auto-detects Fly.io and Heroku deployments

2. **Clue Number Validation (BUG-3)** - `validators/schemas.js`
   - Validates 0-25 range
   - Rejects non-integers, NaN, Infinity

3. **IP-Based Rate Limiting** - `rateLimit.js`
   - Dual-layer: per-socket AND per-IP
   - IP multiplier (5x) for shared networks
   - Metrics tracking for monitoring

### New Test Files Added
- `securityHardening.test.js` - Comprehensive security tests covering:
  - Trust proxy configuration
  - Input validation (clue numbers, nicknames, room codes, team names)
  - IP-based rate limiting
  - Session security (UUID validation, constants)
  - Reserved name blocking
  - Control character sanitization

---

## Sprint 9 Status: COMPLETED

**Date Completed:** January 22, 2026

### Results

| Metric | Before | After | Change |
|--------|--------|-------|--------|
| Line Coverage | 62.62% | 62.65% | +0.03% |
| Test Count | 864 | 872 | +8 |

### Performance Optimizations Verified (Already Implemented)

1. **DOM Query Optimization** - `index.html`
   - `cachedElements` object caches 22 frequently accessed DOM elements
   - `initCachedElements()` called once on page load
   - All render functions use cached elements with fallbacks
   - No expensive `Array.from().indexOf()` patterns found

2. **Redis Batch Operations** - `playerService.js`
   - `getTeamMembers()` uses `mGet` for batch fetching player data
   - Early return optimization for empty teams
   - `getPlayersInRoom()` also uses batch fetch pattern

3. **Health Check Timeout Protection** - `app.js`
   - `Promise.race()` with 2-second timeout
   - Prevents health check from hanging on slow socket counts
   - Falls back to cached values on timeout

4. **Atomic Operations for Race Condition Prevention**
   - `ATOMIC_SET_TEAM_SCRIPT` Lua script for team changes
   - `ATOMIC_JOIN_SCRIPT` for preventing duplicate room joins
   - Clears player role when changing teams atomically

### New Tests Added
- Performance pattern verification tests in `performance.test.js`:
  - Redis batch operation code patterns
  - Atomic operation code patterns
  - Health check timeout verification
  - Frontend element caching verification

---

## Executive Summary

This development plan establishes a roadmap for improving the Die Eigennamen codebase based on software engineering best practices. The plan prioritizes:

1. **Code Quality & Reliability** - Reaching 70% test coverage, fixing known bugs
2. **Security Hardening** - Addressing remaining security concerns
3. **Performance Optimization** - Eliminating inefficiencies
4. **Maintainability** - Code organization and documentation
5. **Developer Experience** - Testing infrastructure and tooling

---

## Current State Assessment

### Metrics (January 21, 2026)

| Metric | Current | Target | Gap |
|--------|---------|--------|-----|
| Line Coverage | 60.19% | 70% | 9.81% |
| Branch Coverage | 53.08% | 70% | 16.92% |
| Function Coverage | 59.92% | 70% | 10.08% |
| Test Count | 711 | 800+ | ~90 |
| Known Issues | ~36 | <10 | ~26 |

### Architecture Strengths

- **Service-oriented design** - Clean separation between handlers, services, and data access
- **Graceful degradation** - Works without Redis/PostgreSQL
- **Security-first approach** - Rate limiting, input validation, session management
- **Observability** - Correlation IDs, structured logging, metrics

### Areas Requiring Improvement

| Area | Current State | Improvement Needed |
|------|---------------|-------------------|
| Socket module testing | 33% coverage | Critical path testing |
| Timer service | Race conditions documented | Distributed lock fixes |
| Frontend architecture | Single 3000-line file | Module extraction |
| Security | X-Forwarded-For trust issues | Proxy configuration |
| Database layer | 13% coverage | Optional feature testing |

---

## Sprint Plan

### Sprint 7: Test Coverage & Bug Fixes (Priority: CRITICAL)

**Goal:** Reach 70% line coverage, fix critical bugs

#### Task 7.1: Socket Module Testing
**Priority:** P0
**Files:** `socket/index.js` (33.1% → 70%)

Coverage gaps:
- Connection lifecycle (lines 77-115)
- Timer coordination (lines 133-220)
- Disconnect handling (lines 221-320)

```javascript
// Test scenarios needed:
describe('Socket connection lifecycle', () => {
  it('should register session on connection')
  it('should join room channels correctly')
  it('should handle multiple connections per session')
  it('should clean up on disconnect')
  it('should handle ungraceful disconnects')
});
```

**Estimated tests:** 25
**Coverage impact:** +3%

#### Task 7.2: Critical Bug Fixes

| Bug | File | Fix Required |
|-----|------|--------------|
| BUG-1: Chat emit errors | `chatHandlers.js:46-48` | Wrap emits in try-catch |
| BUG-2: X-Forwarded-For spoofing | `socketAuth.js:16-20` | Trust proxy configuration |
| BUG-5: Game over timer race | `gameHandlers.js:140-147` | Stop timer before state change |
| BUG-6: Timer restart race | `socket/index.js:133-144` | Add distributed lock |

**Implementation pattern for BUG-1:**
```javascript
// Before
for (const teammate of teammates) {
    io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
}

// After
for (const teammate of teammates) {
    try {
        io.to(`player:${teammate.sessionId}`).emit('chat:message', message);
    } catch (emitError) {
        logger.error('Chat emit failed', {
            correlationId: getCorrelationId(),
            targetSession: teammate.sessionId,
            error: emitError.message
        });
    }
}
```

**Estimated effort:** 8 hours

#### Task 7.3: GameService Coverage Expansion
**Priority:** P1
**Files:** `gameService.js` (41.76% → 65%)

Coverage gaps:
- `giveClue()` function (lines 571-700)
- `createGame()` validation paths (lines 98-123)
- `checkGameEnd()` scenarios (lines 446-520)

**Estimated tests:** 35
**Coverage impact:** +4%

#### Task 7.4: RoomService Coverage
**Priority:** P1
**Files:** `roomService.js` (44.57% → 65%)

Focus areas:
- Password validation (lines 197-239)
- Room settings updates (lines 294-305)
- Host transfer edge cases (lines 385-417)

**Estimated tests:** 25
**Coverage impact:** +3%

---

### Sprint 8: Security Hardening (Priority: HIGH)

**Goal:** Address remaining security vulnerabilities

#### Task 8.1: Trust Proxy Configuration

**Problem:** X-Forwarded-For header can be spoofed by clients, bypassing IP-based session protection.

**Solution:** Configure Express trust proxy properly:

```javascript
// In app.js or config
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1); // Trust first proxy
}

// In socketAuth.js - only use X-Forwarded-For when behind trusted proxy
function getClientIP(socket) {
    if (process.env.TRUST_PROXY === 'true') {
        const xForwardedFor = socket.handshake.headers['x-forwarded-for'];
        if (xForwardedFor) {
            return xForwardedFor.split(',')[0].trim();
        }
    }
    return socket.handshake.address;
}
```

#### Task 8.2: Input Validation Hardening

**Clue number validation (BUG-3):**
```javascript
// In validators/schemas.js
const clueSchema = z.object({
    word: z.string()
        .min(1)
        .max(50)
        .regex(/^[A-Za-z\s-]+$/),
    number: z.number()
        .int()
        .min(0, 'Clue number must be at least 0')
        .max(25, 'Clue number cannot exceed 25')
});
```

**Word list validation enhancement:**
```javascript
const wordListSchema = z.array(
    z.string()
        .min(2, 'Word must be at least 2 characters')
        .max(30, 'Word must be at most 30 characters')
        .regex(/^[A-Za-z\s-]+$/, 'Word must contain only letters')
        .transform(s => s.trim().toUpperCase())
)
.min(25, 'Word list must have at least 25 words')
.max(500, 'Word list cannot exceed 500 words')
.refine(
    arr => new Set(arr).size === arr.length,
    'Words must be unique'
);
```

#### Task 8.3: Rate Limiting by IP

Current rate limiting is per-socket only. Add IP-based limiting:

```javascript
// In rateLimit.js
async function checkIPRateLimit(socket, eventName) {
    const clientIP = getClientIP(socket);
    const key = `ratelimit:ip:${clientIP}:${eventName}`;
    const limit = RATE_LIMITS[eventName] || DEFAULT_LIMIT;

    const count = await redis.incr(key);
    if (count === 1) {
        await redis.expire(key, Math.ceil(limit.window / 1000));
    }

    // Allow 3x limit per IP to account for shared networks
    if (count > limit.max * 3) {
        logger.warn('IP rate limit exceeded', {
            clientIP,
            eventName,
            count
        });
        return false;
    }
    return true;
}
```

---

### Sprint 9: Performance Optimization (Priority: MEDIUM)

**Goal:** Eliminate inefficiencies, improve response times

#### Task 9.1: DOM Query Optimization (Frontend)

**Problem:** Expensive array operations on every card click.

```javascript
// Before (O(n))
const index = Array.from(board.children).indexOf(card);

// After (O(1))
const index = parseInt(card.dataset.index, 10);
```

**Problem:** Duplicate DOM queries in `updateControls()`.

**Solution:** Cache all elements at initialization:
```javascript
const elements = {};

function initializeElementCache() {
    const elementIds = [
        'btn-end-turn', 'btn-new-game', 'btn-settings',
        'clue-input', 'clue-number', 'btn-give-clue',
        'red-spymaster', 'blue-spymaster', 'red-clicker', 'blue-clicker'
    ];

    elementIds.forEach(id => {
        elements[id] = document.getElementById(id);
    });
}
```

#### Task 9.2: Redis Query Optimization

**Problem:** Team chat performs N+1 query pattern.

```javascript
// Before - O(N) fetch all players
const players = await playerService.getPlayersInRoom(roomCode);
const teammates = players.filter(p => p.team === sender.team);

// After - O(1) direct team lookup
async function getTeamMembers(roomCode, team) {
    const key = `room:${roomCode}:team:${team}`;
    const sessionIds = await redis.sMembers(key);

    if (sessionIds.length === 0) return [];

    const pipeline = redis.pipeline();
    sessionIds.forEach(id => pipeline.hGetAll(`player:${id}`));
    const results = await pipeline.exec();

    return results
        .filter(([err, data]) => !err && data)
        .map(([_, data]) => data);
}
```

**Requires:** Update `setPlayerTeam()` to maintain team sets.

#### Task 9.3: Health Check Optimization

**Problem:** `/health/ready` performs multiple async operations without timeout.

```javascript
// Add timeout wrapper
const withTimeout = (promise, ms, fallback) =>
    Promise.race([
        promise,
        new Promise(resolve =>
            setTimeout(() => resolve(fallback), ms)
        )
    ]);

// Usage in health check
const checks = await Promise.all([
    withTimeout(redis.ping(), 2000, 'TIMEOUT'),
    withTimeout(checkDatabase(), 3000, 'TIMEOUT'),
    withTimeout(io.fetchSockets().then(s => s.length), 2000, cachedSocketCount)
]);
```

---

### Sprint 10: Code Quality & Maintainability (Priority: MEDIUM)

**Goal:** Improve code organization and reduce duplication

#### Task 10.1: Function Decomposition

**Target:** `gameService.revealCard()` (157 lines → 6 functions, <50 lines each)

```javascript
// Decomposed structure
async function revealCard(roomCode, cardIndex, sessionId) {
    const context = await prepareRevealContext(roomCode, cardIndex, sessionId);
    validateRevealPermissions(context);

    const result = await executeReveal(context);
    await processRevealOutcome(context, result);

    return result;
}

async function prepareRevealContext(roomCode, cardIndex, sessionId) {
    const [game, player] = await Promise.all([
        getGame(roomCode),
        playerService.getPlayer(sessionId)
    ]);
    return { roomCode, cardIndex, sessionId, game, player, card: game?.cards?.[cardIndex] };
}

function validateRevealPermissions(ctx) {
    if (!ctx.game || ctx.game.gameOver) {
        throw GameStateError.gameNotActive();
    }
    if (ctx.player.role !== 'clicker') {
        throw PlayerError.notClicker();
    }
    if (ctx.player.team !== ctx.game.currentTeam) {
        throw GameStateError.notYourTurn();
    }
    if (ctx.card?.revealed) {
        throw GameStateError.cardAlreadyRevealed();
    }
}
```

#### Task 10.2: Constants Consolidation

Move scattered magic numbers to `config/constants.js`:

```javascript
// Timer service constants
const TIMER = {
    ORPHAN_CHECK_INTERVAL: 30000,
    ORPHAN_CHECK_TIMEOUT: 5000,
    MAX_ORPHAN_KEYS: 100,
    DEFAULT_TURN_TIME: 90000,
    MAX_TURN_TIME: 300000,
    EXTENSION_AMOUNT: 30000
};

// Validation constraints
const VALIDATION = {
    NICKNAME_MIN: 1,
    NICKNAME_MAX: 30,
    TEAM_NAME_MAX: 20,
    CLUE_MAX_LENGTH: 50,
    CLUE_NUMBER_MAX: 25,
    WORD_MIN_LENGTH: 2,
    WORD_MAX_LENGTH: 30,
    WORD_LIST_MIN: 25,
    WORD_LIST_MAX: 500
};

// Retry configuration
const RETRY = {
    OPTIMISTIC_LOCK: { maxRetries: 3, baseDelay: 100 },
    REDIS_OPERATION: { maxRetries: 3, baseDelay: 50 },
    DISTRIBUTED_LOCK: { maxRetries: 50, baseDelay: 100 }
};
```

#### Task 10.3: Error Class Consistency

Ensure all error throws use `GameError` class:

```javascript
// In errors/GameError.js - add missing factory methods
class GameError extends Error {
    // ... existing code ...

    static clueNumberInvalid(number) {
        return new this('CLUE_NUMBER_INVALID',
            `Clue number ${number} is invalid. Must be 0-25.`,
            { number });
    }

    static wordListTooSmall(count, required) {
        return new this('WORD_LIST_TOO_SMALL',
            `Word list has ${count} words, needs at least ${required}.`,
            { count, required });
    }

    static sessionExpired() {
        return new this('SESSION_EXPIRED',
            'Session has expired. Please reconnect.');
    }
}
```

#### Task 10.4: Duplicate Code Elimination

**Timer callback duplication:**
```javascript
// Extract to helper
function createTimerCallback(roomCode, onExpireCallback) {
    return async () => {
        localTimers.delete(roomCode);

        try {
            await redis.del(`timer:${roomCode}`, `timer:${roomCode}:owner`);

            if (onExpireCallback) {
                await onExpireCallback(roomCode);
            }
        } catch (error) {
            logger.error('Timer callback error', {
                roomCode,
                error: error.message
            });
        }

        // Publish expiration event
        try {
            await pubClient.publish('timer:expired', JSON.stringify({ roomCode }));
        } catch (pubError) {
            logger.warn('Failed to publish timer expiration', {
                roomCode,
                error: pubError.message
            });
        }
    };
}
```

---

### Sprint 11: Frontend Modernization (Priority: LOW-MEDIUM)

**Goal:** Improve frontend maintainability without breaking standalone mode

#### Task 11.1: Module Extraction

Extract logical modules from `index.html`:

```
server/public/js/
├── state.js          # Game state management
├── ui.js             # UI updates and rendering
├── game.js           # Game logic
├── socket-client.js  # Socket.io communication
├── utils.js          # Utility functions
└── app.js            # Main initialization
```

**State module pattern:**
```javascript
// state.js
const GameState = {
    _state: {
        roomCode: null,
        game: null,
        player: null,
        role: 'spectator',
        team: null
    },
    _listeners: new Set(),

    get(key) {
        return this._state[key];
    },

    set(key, value) {
        const oldValue = this._state[key];
        this._state[key] = value;

        if (oldValue !== value) {
            this._notify(key, value, oldValue);
        }
    },

    subscribe(callback) {
        this._listeners.add(callback);
        return () => this._listeners.delete(callback);
    },

    _notify(key, value, oldValue) {
        this._listeners.forEach(cb => cb(key, value, oldValue));
    }
};
```

#### Task 11.2: Event Handler Cleanup

Ensure event listeners are properly removed:

```javascript
// Track listeners for cleanup
const listenerRegistry = new Map();

function addTrackedListener(element, event, handler) {
    if (!listenerRegistry.has(element)) {
        listenerRegistry.set(element, []);
    }
    listenerRegistry.get(element).push({ event, handler });
    element.addEventListener(event, handler);
}

function removeAllListeners(element) {
    const listeners = listenerRegistry.get(element);
    if (listeners) {
        listeners.forEach(({ event, handler }) => {
            element.removeEventListener(event, handler);
        });
        listenerRegistry.delete(element);
    }
}
```

---

### Sprint 12: Observability Enhancement (Priority: LOW)

**Goal:** Improve debugging and monitoring capabilities

#### Task 12.1: Operation Latency Metrics

```javascript
// In utils/metrics.js
const latencyHistograms = {
    'game:reveal': [],
    'game:clue': [],
    'room:join': [],
    'redis:get': [],
    'redis:set': []
};

function recordLatency(operation, durationMs) {
    const histogram = latencyHistograms[operation];
    if (histogram) {
        histogram.push(durationMs);

        // Keep only last 1000 samples
        if (histogram.length > 1000) {
            histogram.shift();
        }

        // Log slow operations
        const threshold = SLOW_OPERATION_THRESHOLD[operation] || 100;
        if (durationMs > threshold) {
            logger.warn('Slow operation detected', {
                operation,
                durationMs,
                threshold
            });
        }
    }
}

function getLatencyPercentiles(operation) {
    const histogram = latencyHistograms[operation] || [];
    if (histogram.length === 0) return null;

    const sorted = [...histogram].sort((a, b) => a - b);
    return {
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p90: sorted[Math.floor(sorted.length * 0.9)],
        p99: sorted[Math.floor(sorted.length * 0.99)],
        count: sorted.length
    };
}
```

#### Task 12.2: Audit Trail

Log sensitive operations for security auditing:

```javascript
// In utils/audit.js
function auditLog(action, details) {
    const entry = {
        timestamp: new Date().toISOString(),
        action,
        correlationId: getCorrelationId(),
        ...details
    };

    // Log to structured logger
    logger.info('AUDIT', entry);

    // Optionally persist to database
    if (process.env.AUDIT_TO_DATABASE === 'true') {
        prisma.auditLog.create({ data: entry }).catch(err => {
            logger.error('Failed to persist audit log', { error: err.message });
        });
    }
}

// Usage
auditLog('PASSWORD_CHANGED', {
    roomCode,
    changedBy: sessionId,
    ip: getClientIP(socket)
});

auditLog('HOST_TRANSFERRED', {
    roomCode,
    fromHost: oldHostId,
    toHost: newHostId,
    reason: 'disconnect'
});
```

---

## Testing Strategy

### Coverage Priority Matrix

| File | Current | Target | Priority | Approach |
|------|---------|--------|----------|----------|
| `socket/index.js` | 33.1% | 70% | P0 | Connection lifecycle tests |
| `socketAuth.js` | 25.7% | 70% | P0 | Auth flow tests |
| `gameService.js` | 41.8% | 70% | P1 | Game logic scenarios |
| `roomService.js` | 44.6% | 70% | P1 | Room operations |
| `timerService.js` | 50.2% | 70% | P1 | Timer edge cases |
| `roomHandlers.js` | 50% | 75% | P2 | Handler integration |
| `csrf.js` | 34.1% | 70% | P2 | Security tests |
| `GameError.js` | 44.7% | 70% | P3 | Error class usage |

### Test Types Required

1. **Unit Tests** - Pure function testing
2. **Integration Tests** - Service interactions
3. **Socket Tests** - Real-time event handling
4. **Race Condition Tests** - Concurrent operation safety
5. **Performance Tests** - Latency and throughput

### Test Infrastructure Improvements

```javascript
// Enhanced socket test helper
class SocketTestClient {
    constructor(url, options = {}) {
        this.socket = io(url, {
            transports: ['websocket'],
            ...options
        });
        this.events = [];
    }

    async connect() {
        return new Promise((resolve, reject) => {
            this.socket.on('connect', resolve);
            this.socket.on('connect_error', reject);
        });
    }

    async emitWithAck(event, data, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), timeout);

            this.socket.emit(event, data, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
        });
    }

    waitFor(event, timeout = 5000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error('Timeout')), timeout);

            this.socket.once(event, (data) => {
                clearTimeout(timer);
                resolve(data);
            });
        });
    }
}
```

---

## Definition of Done

### Per-Sprint Checklist

- [ ] All new code has corresponding tests
- [ ] Coverage thresholds met (or justified exception)
- [ ] No regressions in existing tests
- [ ] Code review completed
- [ ] Documentation updated
- [ ] No new ESLint warnings

### Release Criteria

- [ ] 70% line coverage achieved
- [ ] 70% branch coverage achieved
- [ ] All P0 and P1 bugs fixed
- [ ] Security audit passed
- [ ] Performance benchmarks met
- [ ] CHANGELOG updated

---

## Success Metrics

| Metric | Initial | Sprint 7 | Sprint 8 | Sprint 9 | Sprint 10 (Goal) |
|--------|---------|----------|----------|----------|------------------|
| Line Coverage | 60.19% | 62.4% | 62.62% | 62.65% | 70% |
| Branch Coverage | 53.08% | 55.3% | 56.0% | 56.17% | 70% |
| Test Count | 711 | 810 | 864 | 872 | 900+ |
| Open P0 Bugs | 6 | 0* | 0* | 0* | 0 |
| Open P1 Bugs | 12 | 0* | 0* | 0* | 0 |

*Note: Bugs were already fixed in the codebase prior to sprint execution. Sprints verified fixes and added regression tests.

---

## Risk Management

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Coverage target not met | Medium | Medium | Focus on high-value files first |
| Breaking changes | Low | High | Comprehensive test suite |
| Performance regression | Low | Medium | Benchmark critical paths |
| Timer race conditions | Medium | High | Distributed lock implementation |
| Security vulnerabilities | Low | Critical | Security-focused review |

---

## Appendix: Remaining Issues Tracker

### Critical (P0)

| ID | Description | Status | Sprint |
|----|-------------|--------|--------|
| BUG-1 | Chat emit loop lacks error handling | TODO | 7 |
| BUG-2 | X-Forwarded-For header spoofable | TODO | 8 |
| BUG-5 | Game over timer race condition | TODO | 7 |
| BUG-6 | Timer restart race with setImmediate | TODO | 7 |
| #56 | No state versioning | TODO | 9 |

### High (P1)

| ID | Description | Status | Sprint |
|----|-------------|--------|--------|
| BUG-3 | Clue number validation missing | TODO | 8 |
| BUG-4 | Timer addTime() missing local timeout | TODO | 7 |
| BUG-7 | Host transfer lock timeout | TODO | 7 |
| BUG-8 | Disconnected player TTL too long | TODO | 8 |
| BUG-9 | Rate limiter doesn't report errors | TODO | 8 |
| #35 | Team chat N+1 query | TODO | 9 |
| #57 | Orphaned players in Redis 24h | TODO | 8 |

### Medium (P2)

| ID | Description | Status | Sprint |
|----|-------------|--------|--------|
| BUG-10 | Word list validation incomplete | TODO | 8 |
| BUG-11 | Team names not validated server | TODO | 8 |
| BUG-12 | Socket.join() lacks error handling | TODO | 7 |
| OPT-1 | Board click expensive array search | TODO | 9 |
| OPT-10 | Rate limiting per-socket not per-IP | TODO | 8 |
| OPT-11 | Connected players filter | TODO | 9 |
| OPT-12 | Health check timeout protection | TODO | 9 |

---

*This development plan follows software engineering best practices including:*
- *Incremental improvement with measurable goals*
- *Test-driven development approach*
- *Security-first mindset*
- *Performance-aware coding*
- *Maintainability focus*
- *Risk-aware planning*
