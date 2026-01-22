# Nuanced Development Plan - Codenames Online

**Created:** January 22, 2026
**Status:** Strategic roadmap for next phase of development
**Foundation:** Builds on 12 completed sprints (931 tests, 63.21% coverage, 88% issue resolution)

---

## Executive Summary

This plan takes a **strategic, prioritized approach** to development, recognizing that the codebase is production-ready but has opportunities for meaningful enhancement. Rather than pursuing exhaustive coverage targets, this plan focuses on **high-impact improvements** that deliver tangible value.

### Current State Assessment

| Dimension | Score | Rationale |
|-----------|-------|-----------|
| Security | A- | All critical issues fixed, comprehensive input validation |
| Reliability | B+ | Atomic operations, distributed locks, graceful degradation |
| Test Coverage | B | 63% coverage, 931 tests, some integration gaps |
| Maintainability | B+ | Clean architecture, some frontend debt |
| Observability | B | Correlation IDs, metrics, structured logging in place |
| Feature Completeness | A | Full Codenames implementation with extras |

### Strategic Priorities (Ranked)

1. **End-to-End Testing Framework** - Catch regressions in user flows
2. **Frontend Architecture Modernization** - Reduce 3,800-line monolith
3. **Enhanced Reconnection Experience** - Critical for multiplayer UX
4. **Operational Monitoring Dashboard** - Visibility in production
5. **Game Enhancements** - Tournament mode, statistics, themes

---

## Phase 1: Testing & Reliability Foundation

### Track 1.1: End-to-End Testing Framework

**Objective:** Automated testing of complete user journeys
**Impact:** HIGH - Prevents regressions in critical paths
**Complexity:** MEDIUM

#### Implementation Approach

```
e2e/
├── playwright.config.ts
├── fixtures/
│   ├── auth.fixture.ts
│   └── room.fixture.ts
├── pages/
│   ├── home.page.ts
│   ├── room.page.ts
│   └── game.page.ts
└── tests/
    ├── standalone-mode.spec.ts
    ├── multiplayer-game.spec.ts
    ├── reconnection.spec.ts
    └── edge-cases.spec.ts
```

#### Critical Test Scenarios

| Scenario | Priority | Complexity |
|----------|----------|------------|
| Complete game flow (create → play → win) | P0 | Medium |
| Reconnection after disconnect | P0 | High |
| Standalone mode URL encoding | P0 | Low |
| Multi-tab session handling | P1 | Medium |
| Mobile responsive behavior | P1 | Low |
| Colorblind mode accessibility | P2 | Low |

#### Test Implementation Strategy

**Phase 1A: Core Flows (2-3 days)**
```typescript
// Example: Complete game flow test
test('complete multiplayer game', async ({ page, context }) => {
  // Host creates room
  const host = await page.goto('/');
  await host.click('[data-testid="create-room"]');
  const roomCode = await host.textContent('.room-code');

  // Player joins
  const player = await context.newPage();
  await player.goto(`/?room=${roomCode}`);
  await player.fill('[data-testid="nickname"]', 'Player2');
  await player.click('[data-testid="join-room"]');

  // Assign teams and roles
  await host.click('[data-testid="red-spymaster"]');
  await player.click('[data-testid="blue-spymaster"]');

  // Start and play game
  await host.click('[data-testid="start-game"]');
  await host.fill('[data-testid="clue-input"]', 'ANIMAL');
  await host.fill('[data-testid="clue-number"]', '2');
  await host.click('[data-testid="give-clue"]');

  // Verify game state
  await expect(host.locator('.current-clue')).toContainText('ANIMAL: 2');
});
```

**Phase 1B: Edge Cases (2-3 days)**
- Network disconnection during card reveal
- Browser refresh mid-game
- Multiple rapid card clicks
- Timer expiration during action

**Phase 1C: Visual Regression (1-2 days)**
- Screenshot comparison for key states
- Mobile viewport testing
- Colorblind mode visual verification

#### Success Metrics

| Metric | Target |
|--------|--------|
| E2E test count | 25+ scenarios |
| Critical path coverage | 100% |
| CI run time | < 5 minutes |
| Flakiness rate | < 2% |

---

### Track 1.2: Integration Test Expansion

**Objective:** Fill gaps in service-level integration testing
**Impact:** MEDIUM - Validates service interactions
**Complexity:** LOW-MEDIUM

#### Current Gaps Analysis

| Service Interaction | Current Coverage | Target |
|---------------------|------------------|--------|
| gameService → roomService | Partial | Full |
| timerService → pub/sub | Partial | Full |
| playerService → session cleanup | Minimal | Full |
| wordListService → persistence | Good | Maintain |

#### New Test Files Needed

```
server/src/__tests__/integration/
├── fullGameFlow.integration.test.js     # Complete game lifecycle
├── multiInstanceTimer.integration.test.js  # Timer across instances
├── sessionRecovery.integration.test.js    # Reconnection flows
└── stateConsistency.integration.test.js   # Race condition scenarios
```

#### Key Integration Scenarios

**Full Game Lifecycle Test:**
```javascript
describe('Full Game Lifecycle Integration', () => {
  it('completes game from creation to win', async () => {
    // Create room with host
    const room = await roomService.create({ hostSessionId: 'host-1' });

    // Join players
    await roomService.join(room.code, 'player-2');
    await roomService.join(room.code, 'player-3');
    await roomService.join(room.code, 'player-4');

    // Set up teams
    await playerService.setTeam('player-2', 'red');
    await playerService.setTeam('player-3', 'blue');
    await playerService.setTeam('player-4', 'blue');

    // Assign spymasters
    await playerService.setRole('host-1', 'spymaster');
    await playerService.setRole('player-3', 'spymaster');

    // Start game
    const game = await gameService.startGame(room.code);
    expect(game.gameOver).toBe(false);

    // Play turns until game ends
    while (!game.gameOver) {
      // Give clue
      await gameService.giveClue(room.code, currentSpymaster, 'WORD', 1);

      // Reveal cards
      const safeCards = game.cards.filter(c => !c.revealed && c.type !== 'assassin');
      await gameService.revealCard(room.code, safeCards[0].index, currentClicker);
      await gameService.endTurn(room.code, currentClicker);
    }

    expect(game.winner).toBeDefined();
  });
});
```

---

## Phase 2: Frontend Architecture Modernization

### Track 2.1: Module Extraction Strategy

**Objective:** Transform 3,800-line monolith into maintainable modules
**Impact:** HIGH - Developer experience, testability
**Complexity:** HIGH (requires careful planning to maintain standalone mode)

#### Constraints & Considerations

1. **Standalone Mode Preservation** - URL-encoded state must continue working offline
2. **No Build Step Required** - Should work without bundler for simplicity
3. **Progressive Enhancement** - Modules loaded only when Socket.io available
4. **Backward Compatibility** - Existing shared URLs must continue working

#### Proposed Architecture

```
server/public/
├── index.html              # Slim shell, loads modules
├── js/
│   ├── standalone.js       # Self-contained standalone mode (bundled into HTML)
│   ├── modules/
│   │   ├── state.js        # Reactive state management
│   │   ├── ui.js           # DOM manipulation, rendering
│   │   ├── game.js         # Game logic, PRNG
│   │   ├── socket.js       # Socket.io client wrapper
│   │   ├── timer.js        # Timer UI and sync
│   │   └── chat.js         # Chat functionality
│   └── app.js              # Module orchestrator
└── css/
    └── styles.css          # Extracted styles (optional)
```

#### Module Dependency Graph

```
                    ┌─────────────┐
                    │   app.js    │
                    └──────┬──────┘
           ┌───────────────┼───────────────┐
           │               │               │
    ┌──────▼──────┐ ┌──────▼──────┐ ┌──────▼──────┐
    │  socket.js  │ │    ui.js    │ │   game.js   │
    └──────┬──────┘ └──────┬──────┘ └──────┬──────┘
           │               │               │
           └───────────────┼───────────────┘
                    ┌──────▼──────┐
                    │  state.js   │ (no dependencies)
                    └─────────────┘
```

#### Implementation Phases

**Phase 2A: State Management Extraction (1-2 days)**

```javascript
// js/modules/state.js
class EventEmitter {
  constructor() { this.listeners = new Map(); }
  on(event, fn) { /* ... */ }
  off(event, fn) { /* ... */ }
  emit(event, data) { /* ... */ }
}

class GameState extends EventEmitter {
  constructor() {
    super();
    this._state = {
      roomCode: null,
      game: null,
      player: null,
      players: [],
      settings: {},
      connected: false
    };
  }

  get(key) { return this._state[key]; }

  set(key, value) {
    const old = this._state[key];
    this._state[key] = value;
    if (old !== value) {
      this.emit('change', { key, value, old });
      this.emit(`change:${key}`, { value, old });
    }
  }

  // Batch updates for performance
  batch(updates) {
    const changes = [];
    for (const [key, value] of Object.entries(updates)) {
      if (this._state[key] !== value) {
        changes.push({ key, value, old: this._state[key] });
        this._state[key] = value;
      }
    }
    if (changes.length > 0) {
      this.emit('batch', changes);
    }
  }
}

// Singleton export
export const gameState = new GameState();
```

**Phase 2B: UI Module Extraction (2-3 days)**

```javascript
// js/modules/ui.js
import { gameState } from './state.js';

const elementCache = new Map();

export function getElement(id) {
  if (!elementCache.has(id)) {
    elementCache.set(id, document.getElementById(id));
  }
  return elementCache.get(id);
}

export function renderBoard(cards, isSpymaster) {
  const board = getElement('board');
  board.innerHTML = '';

  cards.forEach((card, index) => {
    const cardEl = createCardElement(card, index, isSpymaster);
    board.appendChild(cardEl);
  });
}

export function renderScoreboard(scores) {
  getElement('red-score').textContent = scores.red;
  getElement('blue-score').textContent = scores.blue;
}

// Reactive rendering based on state changes
gameState.on('change:game', ({ value: game }) => {
  if (game) {
    renderBoard(game.cards, gameState.get('player')?.role === 'spymaster');
    renderScoreboard(game.scores);
  }
});
```

**Phase 2C: Socket Client Extraction (1-2 days)**

```javascript
// js/modules/socket.js
import { gameState } from './state.js';

let socket = null;

export function connect(serverUrl) {
  socket = io(serverUrl, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  setupEventHandlers(socket);
  return socket;
}

function setupEventHandlers(socket) {
  socket.on('connect', () => {
    gameState.set('connected', true);
    const sessionId = sessionStorage.getItem('sessionId');
    if (sessionId) {
      socket.emit('player:reconnect', { sessionId });
    }
  });

  socket.on('disconnect', () => {
    gameState.set('connected', false);
  });

  socket.on('game:started', (data) => {
    gameState.batch({
      game: data.game,
      phase: 'playing'
    });
  });

  socket.on('game:cardRevealed', (data) => {
    const game = { ...gameState.get('game') };
    game.cards[data.cardIndex].revealed = true;
    game.cards[data.cardIndex].type = data.cardType;
    gameState.set('game', game);
  });
}

export function emit(event, data) {
  return new Promise((resolve, reject) => {
    socket.emit(event, data, (response) => {
      if (response.error) reject(response);
      else resolve(response);
    });
  });
}
```

#### Standalone Mode Strategy

The key challenge is maintaining standalone mode. Two approaches:

**Option A: Conditional Module Loading (Recommended)**
```html
<script>
  // Detect standalone mode from URL
  const urlParams = new URLSearchParams(window.location.search);
  const isStandalone = urlParams.has('state') && !urlParams.has('room');

  if (isStandalone) {
    // Load lightweight standalone bundle
    import('./js/standalone.js').then(m => m.init());
  } else {
    // Load full multiplayer modules
    import('./js/app.js').then(m => m.init());
  }
</script>
```

**Option B: Single Bundle with Feature Detection**
```javascript
// In app.js
const standaloneMode = detectStandaloneMode();

if (standaloneMode) {
  initStandalone();
} else {
  initMultiplayer();
}
```

#### Testing Strategy for Frontend

```javascript
// Use jsdom for unit tests
// js/__tests__/state.test.js
import { gameState } from '../modules/state.js';

describe('GameState', () => {
  beforeEach(() => gameState.reset());

  test('emits change events', () => {
    const listener = jest.fn();
    gameState.on('change:roomCode', listener);

    gameState.set('roomCode', 'ABCD');

    expect(listener).toHaveBeenCalledWith({
      value: 'ABCD',
      old: null
    });
  });

  test('batches updates efficiently', () => {
    const listener = jest.fn();
    gameState.on('batch', listener);

    gameState.batch({
      roomCode: 'ABCD',
      connected: true
    });

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
```

---

### Track 2.2: Event Handler Modernization

**Objective:** Replace inline handlers with event delegation
**Impact:** MEDIUM - Cleaner code, easier debugging
**Complexity:** LOW

#### Current State

```html
<!-- Current: 23 inline onclick handlers -->
<button onclick="startGame()">Start Game</button>
<button onclick="endTurn()">End Turn</button>
```

#### Target State

```javascript
// Centralized event delegation
document.addEventListener('click', (e) => {
  const action = e.target.dataset.action;
  if (action && handlers[action]) {
    handlers[action](e);
  }
});

const handlers = {
  'start-game': () => emit('game:start'),
  'end-turn': () => emit('game:endTurn'),
  'give-clue': () => {
    const word = getElement('clue-input').value;
    const number = parseInt(getElement('clue-number').value, 10);
    emit('game:clue', { word, number });
  }
};
```

```html
<!-- Updated: Data attributes -->
<button data-action="start-game">Start Game</button>
<button data-action="end-turn">End Turn</button>
```

---

## Phase 3: Enhanced User Experience

### Track 3.1: Reconnection UX Improvement

**Objective:** Seamless reconnection experience
**Impact:** HIGH - Critical for multiplayer UX
**Complexity:** MEDIUM

#### Current Pain Points

1. Users see blank screen during reconnection
2. No indication of reconnection progress
3. Game state may be stale after reconnect
4. Multi-tab conflicts cause confusion

#### Proposed Improvements

**Reconnection State Machine:**

```
┌──────────────────────────────────────────────────────────────┐
│                      Connection States                        │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌─────────────┐    ┌─────────────┐          │
│  │Connected│───▶│Disconnected │───▶│Reconnecting │          │
│  └─────────┘    └─────────────┘    └──────┬──────┘          │
│       ▲                                   │                  │
│       │         ┌─────────────┐           │                  │
│       └─────────│  Syncing    │◀──────────┘                  │
│                 └─────────────┘                              │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

**UI Indicators:**

```javascript
// Connection status component
function renderConnectionStatus(state) {
  const statusEl = getElement('connection-status');

  const configs = {
    connected: { icon: '🟢', text: '', class: '' },
    disconnected: { icon: '🔴', text: 'Disconnected', class: 'warning' },
    reconnecting: { icon: '🟡', text: 'Reconnecting...', class: 'warning pulse' },
    syncing: { icon: '🔵', text: 'Syncing...', class: 'info' }
  };

  const config = configs[state];
  statusEl.innerHTML = `${config.icon} ${config.text}`;
  statusEl.className = `connection-status ${config.class}`;
}

// Listen for state changes
gameState.on('change:connectionState', ({ value }) => {
  renderConnectionStatus(value);
});
```

**Stale State Detection:**

```javascript
// Server-side state versioning
const gameState = {
  version: 42,
  lastUpdated: Date.now(),
  // ...other state
};

// Client validates version on reconnect
socket.on('game:state', (state) => {
  const localVersion = gameState.get('game')?.version || 0;

  if (state.version > localVersion) {
    // Newer state from server
    gameState.set('game', state);
  } else if (state.version < localVersion) {
    // Local state is newer (shouldn't happen)
    logger.warn('Local state newer than server', {
      local: localVersion,
      server: state.version
    });
    // Request full state refresh
    socket.emit('game:requestState');
  }
});
```

---

### Track 3.2: Accessibility Enhancements

**Objective:** WCAG 2.1 AA compliance
**Impact:** MEDIUM - Broader user accessibility
**Complexity:** LOW-MEDIUM

#### Current Gaps

| Issue | Severity | Fix |
|-------|----------|-----|
| Missing ARIA labels on interactive elements | Medium | Add aria-label attributes |
| Color-only differentiation | Medium | Shape indicators (existing, verify) |
| Keyboard navigation incomplete | Medium | Add tabindex, focus management |
| Screen reader announcements | Medium | Add aria-live regions |

#### Implementation

**ARIA Labels:**
```html
<button data-action="start-game" aria-label="Start the game">
  Start Game
</button>

<div class="card"
     role="button"
     aria-label="Card: ELEPHANT, not yet revealed"
     tabindex="0">
  ELEPHANT
</div>
```

**Live Region for Game Events:**
```html
<div id="game-announcements" aria-live="polite" class="sr-only"></div>
```

```javascript
function announceToScreenReader(message) {
  const announcer = getElement('game-announcements');
  announcer.textContent = message;
  // Clear after announcement
  setTimeout(() => announcer.textContent = '', 1000);
}

// Usage
gameState.on('change:game', ({ value: game }) => {
  if (game?.currentClue) {
    announceToScreenReader(
      `Clue given: ${game.currentClue.word}, ${game.currentClue.number} cards`
    );
  }
});
```

**Keyboard Navigation:**
```javascript
// Enable keyboard interaction for cards
document.addEventListener('keydown', (e) => {
  if (e.target.classList.contains('card') && e.key === 'Enter') {
    const index = parseInt(e.target.dataset.index, 10);
    revealCard(index);
  }
});

// Focus management after card reveal
function focusNextUnrevealedCard(currentIndex) {
  const cards = document.querySelectorAll('.card:not(.revealed)');
  const nextCard = Array.from(cards).find(c =>
    parseInt(c.dataset.index, 10) > currentIndex
  );
  if (nextCard) nextCard.focus();
}
```

---

## Phase 4: Operational Excellence

### Track 4.1: Production Monitoring Dashboard

**Objective:** Real-time visibility into production health
**Impact:** MEDIUM - Faster incident response
**Complexity:** MEDIUM

#### Metrics to Track

| Metric | Type | Alert Threshold |
|--------|------|-----------------|
| Active rooms | Gauge | N/A (informational) |
| Connected players | Gauge | N/A (informational) |
| Games in progress | Gauge | N/A (informational) |
| Card reveal latency | Histogram | p99 > 500ms |
| Socket connection errors | Counter | > 10/minute |
| Rate limit triggers | Counter | > 100/minute |
| Redis operation latency | Histogram | p99 > 100ms |

#### Implementation

**Metrics Endpoint Enhancement:**

```javascript
// In routes/metrics.js
router.get('/metrics', async (req, res) => {
  const metrics = await collectMetrics();

  // Prometheus format
  const output = Object.entries(metrics)
    .map(([name, data]) => formatPrometheusMetric(name, data))
    .join('\n');

  res.set('Content-Type', 'text/plain');
  res.send(output);
});

async function collectMetrics() {
  const [rooms, sockets, histograms, counters] = await Promise.all([
    redis.scard('active:rooms'),
    io.fetchSockets().then(s => s.length),
    getAllHistograms(),
    getAllCounters()
  ]);

  return {
    codenames_active_rooms: { type: 'gauge', value: rooms },
    codenames_connected_players: { type: 'gauge', value: sockets },
    ...histograms,
    ...counters
  };
}
```

**Grafana Dashboard (JSON export):**

```json
{
  "title": "Codenames Production",
  "panels": [
    {
      "title": "Active Rooms",
      "type": "stat",
      "targets": [{ "expr": "codenames_active_rooms" }]
    },
    {
      "title": "Card Reveal Latency (p99)",
      "type": "graph",
      "targets": [{ "expr": "histogram_quantile(0.99, codenames_reveal_latency_bucket)" }]
    },
    {
      "title": "Error Rate",
      "type": "graph",
      "targets": [{ "expr": "rate(codenames_errors_total[5m])" }]
    }
  ]
}
```

---

### Track 4.2: Automated Alerting

**Objective:** Proactive incident detection
**Impact:** HIGH - Reduces downtime
**Complexity:** LOW

#### Alert Definitions

| Alert | Condition | Severity | Action |
|-------|-----------|----------|--------|
| HighErrorRate | errors > 10/min for 5min | Critical | Page on-call |
| SlowRevealLatency | p99 > 500ms for 5min | Warning | Slack notification |
| RedisConnectionLost | redis_connected == 0 | Critical | Page on-call |
| HighRateLimitRate | rate_limits > 100/min | Warning | Investigate abuse |

#### Implementation with Simple Webhook

```javascript
// utils/alerting.js
const ALERT_WEBHOOK = process.env.ALERT_WEBHOOK_URL;

const alertState = new Map();

async function checkAlerts() {
  const metrics = await collectMetrics();

  // Error rate check
  const errorRate = metrics.error_rate_per_minute;
  if (errorRate > 10) {
    await triggerAlert('HighErrorRate', {
      message: `Error rate ${errorRate}/min exceeds threshold`,
      severity: 'critical'
    });
  }

  // Latency check
  const revealP99 = metrics.reveal_latency_p99;
  if (revealP99 > 500) {
    await triggerAlert('SlowRevealLatency', {
      message: `Card reveal p99 latency ${revealP99}ms`,
      severity: 'warning'
    });
  }
}

async function triggerAlert(alertName, details) {
  const lastTriggered = alertState.get(alertName);
  const now = Date.now();

  // Dedupe: don't alert more than once per 5 minutes
  if (lastTriggered && now - lastTriggered < 5 * 60 * 1000) {
    return;
  }

  alertState.set(alertName, now);

  if (ALERT_WEBHOOK) {
    await fetch(ALERT_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alert: alertName,
        ...details,
        timestamp: new Date().toISOString()
      })
    });
  }

  logger.error(`ALERT: ${alertName}`, details);
}

// Run checks every minute
setInterval(checkAlerts, 60 * 1000);
```

---

## Phase 5: Game Feature Enhancements

### Track 5.1: Tournament Mode

**Objective:** Support competitive multi-round play
**Impact:** MEDIUM - New use case enablement
**Complexity:** HIGH

#### Feature Specification

```
Tournament Structure:
├── Best of N games (configurable: 1, 3, 5)
├── Team points carry across games
├── Role rotation between games
├── Finals/semifinals bracket (future)
└── Tournament history/stats (future)
```

#### Data Model Extension

```javascript
// Tournament schema
const tournamentSchema = {
  id: 'string',           // UUID
  roomCode: 'string',
  format: 'best_of_3',    // best_of_1, best_of_3, best_of_5
  teams: {
    red: { name: 'string', wins: 0, totalScore: 0 },
    blue: { name: 'string', wins: 0, totalScore: 0 }
  },
  games: [
    { gameId: 'string', winner: 'red|blue', redScore: 9, blueScore: 7 }
  ],
  currentGameIndex: 0,
  status: 'in_progress',  // in_progress, completed
  winner: null,           // null | 'red' | 'blue'
  createdAt: 'timestamp',
  completedAt: 'timestamp'
};
```

#### UI Mockup

```
┌─────────────────────────────────────────────────────┐
│                   TOURNAMENT                         │
│                   Best of 3                          │
├─────────────────────────────────────────────────────┤
│   RED TEAM        │        │      BLUE TEAM         │
│     ██            │   1-0  │                        │
│   WINS: 1         │        │      WINS: 0          │
├─────────────────────────────────────────────────────┤
│           Game 1: RED WIN (9-7)                     │
│           Game 2: IN PROGRESS                       │
│           Game 3: --                                │
└─────────────────────────────────────────────────────┘
```

---

### Track 5.2: Game Statistics & History

**Objective:** Player engagement through stats tracking
**Impact:** LOW-MEDIUM - Nice-to-have feature
**Complexity:** MEDIUM

#### Statistics to Track

| Stat | Scope | Storage |
|------|-------|---------|
| Games played | Session | localStorage |
| Win rate | Session | localStorage |
| Favorite words clicked | Session | localStorage |
| Average clue effectiveness | Session | localStorage |
| Personal bests | Session | localStorage |

#### Implementation (Client-Side Only)

```javascript
// stats.js - Client-side statistics
class GameStats {
  constructor() {
    this.storage = localStorage;
    this.data = this.load();
  }

  load() {
    const stored = this.storage.getItem('codenames_stats');
    return stored ? JSON.parse(stored) : this.defaultStats();
  }

  save() {
    this.storage.setItem('codenames_stats', JSON.stringify(this.data));
  }

  defaultStats() {
    return {
      gamesPlayed: 0,
      gamesWon: 0,
      cardsRevealed: 0,
      assassinHits: 0,
      cluesGiven: 0,
      totalGuessesFromClues: 0,
      lastPlayed: null
    };
  }

  recordGameEnd(winner, myTeam, role) {
    this.data.gamesPlayed++;
    if (winner === myTeam) this.data.gamesWon++;
    this.data.lastPlayed = new Date().toISOString();
    this.save();
  }

  recordCardReveal(cardType) {
    this.data.cardsRevealed++;
    if (cardType === 'assassin') this.data.assassinHits++;
    this.save();
  }

  getWinRate() {
    if (this.data.gamesPlayed === 0) return 0;
    return (this.data.gamesWon / this.data.gamesPlayed * 100).toFixed(1);
  }
}

export const stats = new GameStats();
```

---

### Track 5.3: Custom Themes

**Objective:** Visual customization options
**Impact:** LOW - User delight feature
**Complexity:** LOW

#### Theme Options

| Theme | Description |
|-------|-------------|
| Classic | Current glassmorphism design |
| Dark | High contrast dark mode |
| Retro | Board game aesthetic |
| Minimal | Simple, clean design |

#### Implementation

```css
/* Theme CSS custom properties */
:root {
  --bg-primary: #1a1a2e;
  --bg-secondary: #16213e;
  --text-primary: #eee;
  --card-red: #e94560;
  --card-blue: #0f3460;
  --card-neutral: #c4b7a6;
  --card-assassin: #1a1a2e;
}

[data-theme="light"] {
  --bg-primary: #f5f5f5;
  --bg-secondary: #ffffff;
  --text-primary: #333;
}

[data-theme="retro"] {
  --bg-primary: #d4a373;
  --bg-secondary: #ccd5ae;
  --card-red: #bc4749;
  --card-blue: #457b9d;
}
```

```javascript
function setTheme(themeName) {
  document.documentElement.dataset.theme = themeName;
  localStorage.setItem('codenames_theme', themeName);
}

function loadSavedTheme() {
  const saved = localStorage.getItem('codenames_theme');
  if (saved) setTheme(saved);
}
```

---

## Implementation Roadmap

### Recommended Execution Order

```
Week 1-2: E2E Testing Framework (Track 1.1)
  └─ Critical for catching regressions

Week 3-4: Frontend State Module (Track 2.1 Phase A)
  └─ Foundation for further frontend work

Week 5: Reconnection UX (Track 3.1)
  └─ High-impact user experience improvement

Week 6: Accessibility (Track 3.2)
  └─ Low-hanging fruit with broad impact

Week 7-8: Frontend UI/Socket Modules (Track 2.1 Phase B-C)
  └─ Complete frontend modernization

Week 9: Monitoring Dashboard (Track 4.1)
  └─ Production visibility

Week 10+: Game Enhancements (Phase 5)
  └─ Based on user feedback and priorities
```

### Success Criteria

| Phase | Metric | Target |
|-------|--------|--------|
| 1 | E2E test coverage | 25+ scenarios |
| 1 | Integration test coverage | 85%+ service interactions |
| 2 | Frontend file count | 6+ modules (from 1) |
| 2 | Inline handlers | 0 (from 23) |
| 3 | Reconnection success rate | 95%+ |
| 3 | WCAG compliance | AA level |
| 4 | Metrics coverage | 15+ key metrics |
| 4 | Alert response time | < 5 minutes |

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Frontend refactor breaks standalone | Medium | High | Comprehensive E2E tests first |
| Performance regression from modules | Low | Medium | Bundle size monitoring |
| Reconnection changes break sessions | Medium | High | Feature flag, gradual rollout |
| E2E tests become flaky | Medium | Medium | Strict timeout policies, retry logic |

---

## Not In Scope (Explicit Decisions)

The following are **intentionally excluded** from this plan:

1. **Server-side rendering** - Unnecessary complexity for this app
2. **TypeScript migration** - Would require significant effort with limited benefit
3. **Complete frontend framework** (React/Vue) - Overkill, breaks standalone simplicity
4. **Mobile native apps** - Web app works well on mobile
5. **User accounts/authentication** - Against design philosophy of drop-in play
6. **Database-backed statistics** - Privacy concerns, complexity vs. value

---

## Conclusion

This nuanced development plan prioritizes **high-impact, achievable improvements** over exhaustive coverage metrics. The focus is on:

1. **Preventing regressions** through E2E testing
2. **Improving developer experience** through frontend modularization
3. **Enhancing user experience** through reconnection and accessibility
4. **Enabling operational excellence** through monitoring and alerting
5. **Delighting users** through thoughtful game enhancements

Each track can be executed independently, allowing for flexible prioritization based on team capacity and user feedback.
