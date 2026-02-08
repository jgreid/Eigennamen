# Codenames Online - Future Development Plan

This document outlines a comprehensive plan to harden existing functionality and introduce essential new features based on a thorough code review of the codebase.

## Executive Summary

The Codenames Online codebase is **well-architected with strong defensive programming** patterns, including Lua script optimizations, comprehensive error handling, and race condition prevention. However, several areas require attention for production robustness:

| Area | Current State | Priority |
|------|---------------|----------|
| Backend Services | Good, with race condition edge cases | High |
| WebSocket Layer | Solid, but emissions lack error handling | High |
| Frontend | Well-structured, modal/state issues | Medium |
| Testing | 80%+ coverage, gaps in edge cases | Medium |
| Security | Good fundamentals, token TTL concerns | High |

---

## Phase 1: Critical Hardening (Immediate) ✅ COMPLETED

> **Status**: All 11 items implemented and verified. See commit history for details.
> - 1.1.1-1.1.4: Backend service fixes (NFKC normalization, atomic Lua tokens, room rollback, timer pause validation)
> - 1.2.1-1.2.4: WebSocket hardening (safeEmit integration, LRU metrics cleanup, 5min token TTL, host transfer re-check)
> - 1.3.1-1.3.3: Security enhancements (3x IP multiplier, 2/10s token rate limit, game data validation)

### 1.1 Backend Service Fixes

#### 1.1.1 Fix Unicode Normalization in Clue Validation
**Location**: `server/src/services/gameService.js:811`
**Issue**: Uses NFC normalization only, but some scripts use NFD. "café" (NFC) vs "café" (NFD) could bypass clue validation.
**Fix**:
```javascript
// Test against both NFC and NFD forms, or use NFKC normalization
const normalizedClue = toEnglishUpperCase(
    String(clue).normalize('NFKC').trim()
);
```

#### 1.1.2 Fix Reconnection Token Race Condition
**Location**: `server/src/services/playerService.js:722-745`
**Issue**: Race condition window between NX check and overwrite allows potential token sharing between sessions.
**Fix**: Use Lua script for atomic read-check-set pattern:
```lua
local existing = redis.call('GET', KEYS[1])
if existing then
    return existing
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[2])
redis.call('SET', KEYS[2], ARGV[3], 'EX', ARGV[2])
return ARGV[1]
```

#### 1.1.3 Fix Room Creation Rollback
**Location**: `server/src/services/roomService.js:83-104`
**Issue**: If player creation fails after room creation, room exists without host.
**Fix**:
```javascript
try {
    const player = await playerService.createPlayer(...);
} catch (error) {
    await redis.del(`room:${normalizedRoomId}`);
    throw error;
}
```

#### 1.1.4 Fix Paused Timer Resume Bug
**Location**: `server/src/services/timerService.js:270-290`
**Issue**: If timer expires while paused, resuming starts a fresh timer instead of being invalidated.
**Fix**: Add timestamp validation:
```javascript
const pausedDuration = Date.now() - timer.pausedAt;
if (pausedDuration > timer.remainingWhenPaused * 1000) {
    return null; // Timer would have expired
}
```

### 1.2 WebSocket Hardening

#### 1.2.1 Add Error Handling to All Emissions
**Location**: All handler files in `server/src/socket/handlers/`
**Issue**: Most `io.to()` and `socket.emit()` calls lack error handling.
**Fix**: Create standardized wrapper:
```javascript
// server/src/socket/safeEmit.js
export async function safeEmit(io, target, event, data, logger) {
    try {
        io.to(target).emit(event, data);
        logger.debug(`Emitted ${event} to ${target}`);
    } catch (error) {
        logger.error(`Failed to emit ${event} to ${target}:`, error);
        // Optional: Queue for retry
    }
}
```

#### 1.2.2 Fix Rate Limit Metrics Unbounded Growth
**Location**: `server/src/socket/rateLimitHandler.js:90-99`
**Issue**: `uniqueSockets` and `uniqueIPs` Sets grow indefinitely.
**Fix**: Add LRU cleanup:
```javascript
const MAX_METRICS_SIZE = 10000;
if (uniqueSockets.size > MAX_METRICS_SIZE) {
    const toDelete = Array.from(uniqueSockets).slice(0, MAX_METRICS_SIZE * 0.1);
    toDelete.forEach(s => uniqueSockets.delete(s));
}
```

#### 1.2.3 Reduce Reconnection Token TTL
**Location**: `server/src/config/constants.js`
**Issue**: 15-minute TTL is excessive; allows long session hijacking window.
**Fix**: Reduce to 5 minutes:
```javascript
RECONNECTION_TOKEN_TTL: 300, // 5 minutes instead of 15
```

#### 1.2.4 Fix Host Transfer Race Condition
**Location**: `server/src/socket/index.js:474-549`
**Issue**: Host can be transferred even though they successfully reconnected within grace period.
**Fix**: Check connected status before transfer:
```javascript
const hostPlayer = await playerService.getPlayer(room.hostSessionId);
if (hostPlayer?.connected) {
    logger.info('Host reconnected before transfer, skipping');
    return;
}
```

### 1.3 Security Enhancements

#### 1.3.1 Reduce IP Rate Limit Multiplier
**Location**: `server/src/socket/rateLimitHandler.js`
**Issue**: 5x multiplier allows 25 events/second from single IP (DoS vector).
**Fix**: Reduce to 2-3x multiplier.

#### 1.3.2 Add Rate Limiting to Token Generation
**Location**: Socket event handlers
**Issue**: `room:getReconnectionToken` allows 5 requests per 10 seconds.
**Fix**: Reduce to 2/10s to prevent CPU exhaustion from crypto operations.

#### 1.3.3 Validate Game Data Before History Save
**Location**: `server/src/services/gameHistoryService.js:37-74`
**Issue**: No validation that gameData fields are correct types.
**Fix**:
```javascript
const historySchema = z.object({
    words: z.array(z.string()).length(25),
    types: z.array(z.string()).length(25),
    seed: z.string(),
    redScore: z.number().int().min(0),
    blueScore: z.number().int().min(0),
});
```

---

## Phase 2: Frontend Improvements (Short-term)

### 2.1 Fix Modal Stacking Issue
**Location**: `server/public/js/modules/ui.js`
**Issue**: Opening second modal while first is open loses focus context.
**Fix**: Implement modal stack:
```javascript
const modalStack = [];

export function openModal(modal) {
    modalStack.push({
        modal,
        previousFocus: document.activeElement
    });
    state.activeModal = modal;
    // ... existing focus logic
}

export function closeModal(modal) {
    const entry = modalStack.pop();
    if (entry?.previousFocus) {
        entry.previousFocus.focus();
    }
    state.activeModal = modalStack[modalStack.length - 1]?.modal || null;
}
```

### 2.2 Add Request Cancellation
**Location**: `server/public/js/modules/multiplayer.js`
**Issue**: No way to cancel in-flight requests when user navigates away.
**Fix**: Use AbortController:
```javascript
let joinAbortController = null;

export async function joinRoom(roomId, nickname) {
    if (joinAbortController) {
        joinAbortController.abort();
    }
    joinAbortController = new AbortController();

    try {
        await CodenamesClient.joinRoom(roomId, nickname, {
            signal: joinAbortController.signal
        });
    } catch (e) {
        if (e.name !== 'AbortError') throw e;
    }
}
```

### 2.3 Extract Hardcoded Limits to Constants
**Location**: Multiple files
**Issue**: Max nickname length (30) hardcoded in multiplayer.js, validator, etc.
**Fix**: Create shared constants module:
```javascript
// server/public/js/modules/constants.js
export const VALIDATION = {
    NICKNAME_MAX_LENGTH: 30,
    ROOM_CODE_MIN_LENGTH: 3,
    ROOM_CODE_MAX_LENGTH: 20,
    CLUE_MAX_LENGTH: 50,
};
```

### 2.4 Fix Timer Aria-Live Region
**Location**: `index.html:87`
**Issue**: `aria-live="polite"` on parent, but text updates in child span.
**Fix**:
```html
<div class="timer-display" id="timer-display" role="timer">
    <span class="timer-value" id="timer-value" aria-live="polite">--:--</span>
</div>
```

### 2.5 Add Colorblind-Friendly Card Patterns
**Location**: `server/public/css/components.css`
**Issue**: Revealed cards only show color (accessibility concern).
**Fix**: Add patterns:
```css
.card.red.revealed::before {
    content: '';
    background-image: url("data:image/svg+xml,..."); /* diagonal lines */
}
.card.blue.revealed::before {
    background-image: url("data:image/svg+xml,..."); /* dots pattern */
}
```

---

## Phase 3: Testing Improvements (Medium-term)

### 3.1 Create Test Helper Library
Extract common mocks to reduce duplication:
```javascript
// server/src/__tests__/helpers/mockRedis.js
export function createMockRedis() {
    return {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        eval: jest.fn(),
        // ... common setup
    };
}

// server/src/__tests__/helpers/mockSocket.js
export function createMockSocket(overrides = {}) {
    return {
        id: 'test-socket-id',
        join: jest.fn(),
        leave: jest.fn(),
        emit: jest.fn(),
        ...overrides
    };
}
```

### 3.2 Add Missing Middleware Tests
Create new test files:
- `server/src/__tests__/contextHandler.test.js`
- `server/src/__tests__/playerContext.test.js`
- `server/src/__tests__/socketFunctionProvider.test.js`

### 3.3 Add Error Scenario Tests
Cover currently untested paths:
```javascript
describe('Error Scenarios', () => {
    test('handles Redis timeout during game reveal', async () => {
        redis.eval.mockRejectedValue(new Error('Timeout'));
        await expect(gameService.revealCard(...)).rejects.toThrow('SERVER_ERROR');
    });

    test('handles corrupted JSON in game state', async () => {
        redis.get.mockResolvedValue('{ invalid json }');
        const game = await gameService.getGame('ROOM1');
        expect(game).toBeNull();
    });
});
```

### 3.4 Add Database Integration Tests
```javascript
// server/src/__tests__/integration/database.test.js
import { PrismaClient } from '@prisma/client';

describe('Database Integration', () => {
    let prisma;

    beforeAll(async () => {
        prisma = new PrismaClient({
            datasources: { db: { url: process.env.TEST_DATABASE_URL } }
        });
    });

    test('creates and retrieves word list', async () => {
        const list = await prisma.wordList.create({...});
        const retrieved = await prisma.wordList.findUnique({...});
        expect(retrieved).toEqual(list);
    });
});
```

### 3.5 Add E2E Tests for Critical Flows
Expand Playwright tests:
```typescript
// tests/e2e/multiplayer.spec.ts
test('two players can complete a game', async ({ browser }) => {
    const player1 = await browser.newPage();
    const player2 = await browser.newPage();

    // Player 1 creates room
    await player1.goto('/');
    await player1.click('[data-action="openMultiplayerModal"]');
    await player1.fill('#new-room-nickname', 'Player1');
    await player1.click('[data-action="createRoom"]');

    // Get room code and have player 2 join
    const roomCode = await player1.textContent('#room-code');
    await player2.goto(`/?room=${roomCode}`);
    // ... complete game flow
});
```

---

## Phase 4: Essential New Features (Longer-term)

### 4.1 Spectator Mode Enhancements
**Current**: Spectators can view games but with limited interaction.
**Proposed Features**:
- Spectator chat (separate from team chat)
- Live game statistics overlay
- Ability to request to join a team
- Spectator count display

**Implementation**:
```javascript
// New socket events
'spectator:requestJoinTeam'
'spectator:chatMessage'
'room:spectatorCountUpdated'

// New UI components
- Spectator sidebar with list
- "Request to join" button
- Spectator chat panel
```

### 4.2 Tournament Mode
**Purpose**: Support organized competitive play.
**Features**:
- Multi-round bracket system
- Automatic room assignment
- Score tracking across rounds
- Tournament admin controls

**Schema Addition**:
```prisma
model Tournament {
    id            String   @id @default(uuid())
    name          String
    status        TournamentStatus
    rounds        Round[]
    participants  TournamentParticipant[]
    createdAt     DateTime @default(now())
}

model Round {
    id            String   @id @default(uuid())
    tournamentId  String
    tournament    Tournament @relation(fields: [tournamentId], references: [id])
    matches       Match[]
    roundNumber   Int
}
```

### 4.3 Game Replay System Improvements
**Current**: Basic replay from history.
**Proposed Enhancements**:
- Playback speed control
- Step-by-step navigation
- Exportable replay links
- Analysis mode with annotations

**Implementation**:
```javascript
// New replay controls
export function createReplayControls() {
    return {
        play: () => { ... },
        pause: () => { ... },
        setSpeed: (multiplier) => { ... }, // 0.5x, 1x, 2x
        seekToMove: (moveIndex) => { ... },
        exportLink: () => { ... }
    };
}
```

### 4.4 Custom Game Modes
**Proposed Modes**:
1. **Duet Mode**: Cooperative 2-player version
2. **Timed Mode**: Speed round with short timers
3. **Draft Mode**: Teams draft words before game starts
4. **Asymmetric Mode**: Different team sizes

**Configuration Schema**:
```javascript
const gameModeSchema = z.object({
    mode: z.enum(['classic', 'duet', 'timed', 'draft', 'asymmetric']),
    settings: z.object({
        // Mode-specific settings
        duet: z.object({
            mistakes: z.number().default(9),
            targetCards: z.number().default(15)
        }).optional(),
        timed: z.object({
            turnSeconds: z.number().default(30),
            totalSeconds: z.number().default(300)
        }).optional()
    })
});
```

### 4.5 Player Statistics & Profiles
**Features**:
- Win/loss tracking per player
- Average clue success rate
- Games played history
- Achievement badges

**Schema**:
```prisma
model PlayerStats {
    userId        String   @id
    user          User     @relation(fields: [userId], references: [id])
    gamesPlayed   Int      @default(0)
    gamesWon      Int      @default(0)
    cluesGiven    Int      @default(0)
    cardsGuessed  Int      @default(0)
    assassinHits  Int      @default(0)
    achievements  Achievement[]
}

model Achievement {
    id            String   @id @default(uuid())
    playerId      String
    player        PlayerStats @relation(fields: [playerId], references: [userId])
    type          AchievementType
    earnedAt      DateTime @default(now())
}
```

### 4.6 Mobile App Wrapper
**Purpose**: Native mobile experience with push notifications.
**Implementation Options**:
1. PWA enhancement (current approach + improvements)
2. Capacitor/Ionic wrapper for app stores
3. React Native rewrite (highest effort)

**PWA Improvements**:
```javascript
// Enhanced service worker with offline support
self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// Better push notifications
self.addEventListener('push', (event) => {
    const data = event.data.json();
    self.registration.showNotification(data.title, {
        body: data.body,
        icon: '/icon-192.png',
        badge: '/badge.png',
        tag: data.roomCode, // Collapse notifications per room
        actions: [
            { action: 'open', title: 'Open Game' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    });
});
```

### 4.7 Admin Dashboard Enhancements
**Current**: Basic admin routes exist.
**Proposed Features**:
- Real-time server metrics visualization
- Active room monitoring
- Player ban/kick management
- Word list moderation queue
- System health alerts

**Implementation**:
```javascript
// New admin socket events
'admin:getRooms' // List all active rooms
'admin:kickPlayer' // Remove player from room
'admin:closeRoom' // Force close a room
'admin:getMetrics' // Real-time metrics stream

// Admin dashboard component
// server/public/admin/dashboard.js
```

---

## Phase 5: Infrastructure & DevOps (Ongoing)

### 5.1 Observability Improvements
- Add distributed tracing (OpenTelemetry)
- Enhance metrics collection
- Create Grafana dashboards
- Set up alerting rules

### 5.2 Horizontal Scaling Preparation
- Verify Redis Pub/Sub works across instances
- Add sticky sessions for WebSocket
- Test with multiple Fly.io machines
- Document scaling procedures

### 5.3 Database Optimization
- Add database indexes for common queries
- Implement connection pooling
- Add query performance monitoring
- Create database backup strategy

### 5.4 CI/CD Enhancements
- Add automated security scanning
- Implement preview deployments
- Add performance regression tests
- Create automated changelog generation

---

## Implementation Timeline

| Phase | Duration | Priority | Dependencies |
|-------|----------|----------|--------------|
| Phase 1: Critical Hardening | 2-3 weeks | P0 | None |
| Phase 2: Frontend Improvements | 2 weeks | P1 | None |
| Phase 3: Testing Improvements | 3 weeks | P1 | Phase 1 |
| Phase 4.1-4.3: Core Features | 4-6 weeks | P2 | Phases 1-3 |
| Phase 4.4-4.7: Advanced Features | 6-8 weeks | P3 | Phase 4.1-4.3 |
| Phase 5: Infrastructure | Ongoing | P2 | Parallel work |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Breaking changes in Phase 1 | Medium | High | Comprehensive testing, staged rollout |
| Database migration issues | Low | High | Test migrations in staging first |
| Performance regression | Medium | Medium | Load testing before deployment |
| WebSocket scaling issues | Low | High | Verify Redis Pub/Sub under load |

---

## Success Metrics

### Phase 1 Success Criteria
- Zero race condition bugs in production
- All critical security issues resolved
- 99.9% uptime maintained

### Overall Project Success Criteria
- Test coverage > 85%
- Time to First Byte < 200ms
- WebSocket connection success rate > 99%
- Player satisfaction score (if tracked) > 4.5/5

---

## Conclusion

This development plan prioritizes stability and security before feature development. The phased approach ensures that each improvement builds on a solid foundation, reducing the risk of introducing new issues while adding capabilities.

The codebase is already well-structured with good patterns (service layer, atomic operations, graceful degradation). These improvements will bring it to production-grade quality suitable for high-traffic deployment.
