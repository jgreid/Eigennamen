# Codenames Online - Codebase Summary

This document provides a comprehensive overview of the Codenames Online codebase, capturing the current state of development efforts.

---

## 1. Project Overview

**Codenames Online** is a web-based implementation of the popular board game "Codenames" supporting two deployment modes:

| Mode | Description | Server Required |
|------|-------------|-----------------|
| **Standalone** | Offline play with game state encoded in URL | No |
| **Multiplayer** | Real-time synchronization via WebSockets | Yes |

**License**: GPL v3.0

---

## 2. Directory Structure

```
Risley-Codenames/
├── index.html                 # Standalone SPA (3,100+ lines, vanilla JS)
├── wordlist.txt               # Default word list (400 words)
├── fly.toml                   # Fly.io production deployment
├── docker-compose.yml         # Local development environment
├── CLAUDE.md                  # AI assistant instructions
├── README.md                  # Project overview
├── QUICKSTART.md              # Getting started guide
├── CODE_REVIEW_FINDINGS.md    # Technical findings
├── docs/
│   ├── SERVER_SPEC.md         # Technical architecture
│   ├── WINDOWS_SETUP.md       # Windows setup guide
│   └── CODEBASE_SUMMARY.md    # This document
└── server/
    ├── src/
    │   ├── index.js           # Entry point (115 lines)
    │   ├── app.js             # Express configuration (267 lines)
    │   ├── config/            # Configuration modules
    │   ├── middleware/        # Express & Socket middleware
    │   ├── services/          # Core business logic
    │   ├── socket/            # WebSocket handlers
    │   ├── routes/            # REST API routes
    │   ├── validators/        # Zod validation schemas
    │   ├── errors/            # Custom error classes
    │   ├── utils/             # Logger and utilities
    │   └── __tests__/         # Jest test suites
    ├── prisma/
    │   └── schema.prisma      # Database schema
    ├── public/
    │   ├── index.html         # Web frontend
    │   └── js/                # Modular frontend components
    ├── package.json           # Dependencies (46 packages)
    ├── Dockerfile             # Production container
    └── README.md              # Server documentation
```

---

## 3. Technology Stack

### Frontend

| Technology | Purpose |
|------------|---------|
| Vanilla JavaScript | No build tools required |
| HTML5/CSS3 | Glassmorphism UI design |
| Socket.io Client | Real-time communication |
| URL State Encoding | Standalone mode sharing |

### Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| Node.js | 18+ | Runtime |
| Express.js | 4.18 | HTTP framework |
| Socket.io | 4.7 | Real-time WebSockets |
| PostgreSQL | 15+ | Persistent storage (optional) |
| Redis | 7+ | Cache/sessions (optional) |
| Prisma | 5.x | Database ORM |
| Zod | 3.22 | Runtime validation |
| Jest | 29 | Testing framework |
| Winston | 3.11 | Logging |
| Helmet.js | 7.x | Security headers |

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT (Browser)                         │
│  ┌────────────────┐    ┌────────────────┐                   │
│  │  Standalone    │    │  Multiplayer   │                   │
│  │  (index.html)  │    │  (Socket.io)   │                   │
│  └────────────────┘    └───────┬────────┘                   │
└────────────────────────────────┼────────────────────────────┘
                                 │ WebSocket + HTTP
┌────────────────────────────────┼────────────────────────────┐
│                          SERVER                              │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   MIDDLEWARE LAYER                   │    │
│  │  Auth → Rate Limit → CSRF → Validation → Logging    │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   HANDLER LAYER                      │    │
│  │  roomHandlers │ gameHandlers │ playerHandlers │ ...  │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   SERVICE LAYER                      │    │
│  │  gameService │ roomService │ playerService │ ...     │    │
│  └─────────────────────────────────────────────────────┘    │
│                           │                                  │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   STORAGE LAYER                      │    │
│  │     Redis (sessions)  │  PostgreSQL (persistence)    │    │
│  │           └── Memory fallback available ──┘          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 5. Core Services

### 5.1 Service Summary

| Service | File | Lines | Purpose |
|---------|------|-------|---------|
| **gameService** | `gameService.js` | 775 | Core game logic, PRNG, board generation |
| **roomService** | `roomService.js` | 419 | Room lifecycle, atomic operations |
| **playerService** | `playerService.js` | 351 | Player/team/role management |
| **timerService** | `timerService.js` | 678 | Turn timers with Redis backing |
| **wordListService** | `wordListService.js` | 392 | Custom word list CRUD |

### 5.2 Game Service Details

**Key Functions:**
- `seededRandom(seed)` - Mulberry32 PRNG for deterministic shuffling
- `shuffleWithSeed(array, seed)` - Deterministic array shuffle
- `createGame(roomCode, words, seed)` - Initialize new game
- `revealCard(roomCode, cardIndex, team)` - Process card reveal
- `endTurn(roomCode)` - End current team's turn
- `checkGameOver(game)` - Check win conditions
- `getGameStateForPlayer(game, role)` - Role-based state filtering

**Card Distribution:**
```
Total Cards: 25 (5x5 grid)
├── Red Team:    9 cards (first team)
├── Blue Team:   8 cards (second team)
├── Neutral:     7 cards
└── Assassin:    1 card
```

### 5.3 Room Service Details

**Key Functions:**
- `createRoom(hostId, settings)` - Create room with Lua atomicity
- `joinRoom(roomCode, playerId, password?)` - Join with validation
- `leaveRoom(roomCode, playerId)` - Handle departure and host transfer
- `updateSettings(roomCode, playerId, settings)` - Host-only settings update
- `roomExists(roomCode)` - Check room availability

**Room Code Generation:**
- 6 alphanumeric characters
- Excludes confusing characters: I, L, O, 1, 0

### 5.4 Timer Service Details

**Features:**
- Redis-backed for multi-instance coordination
- Configurable duration (30-300 seconds)
- Pause/resume functionality
- Orphan timer detection and cleanup
- Atomic timer claiming via Lua scripts

---

## 6. Socket.io Events

### 6.1 Event Categories

**Room Events** (`roomHandlers.js`):
| Client Event | Server Response | Description |
|--------------|-----------------|-------------|
| `room:create` | `room:created` | Create new room |
| `room:join` | `room:joined`, `room:playerJoined` | Join existing room |
| `room:leave` | `room:playerLeft` | Leave room |
| `room:settings` | `room:settingsUpdated` | Update room settings |

**Game Events** (`gameHandlers.js`):
| Client Event | Server Response | Description |
|--------------|-----------------|-------------|
| `game:start` | `game:started` | Start game |
| `game:reveal` | `game:cardRevealed`, `game:turnEnded` | Reveal card |
| `game:clue` | `game:clueGiven` | Give clue (spymaster) |
| `game:endTurn` | `game:turnEnded` | End turn manually |
| `game:forfeit` | `game:gameEnded` | Forfeit game |

**Player Events** (`playerHandlers.js`):
| Client Event | Server Response | Description |
|--------------|-----------------|-------------|
| `player:setTeam` | `player:updated` | Change team |
| `player:setRole` | `player:updated` | Change role |
| `player:setNickname` | `player:updated` | Set nickname |

**Chat Events** (`chatHandlers.js`):
| Client Event | Server Response | Description |
|--------------|-----------------|-------------|
| `chat:message` | `chat:message` | Send chat (supports team-only) |

### 6.2 Rate Limits

```javascript
// Per-event limits (from constants.js)
'room:create':    { window: 60000, max: 5 }    // 5 per minute
'game:reveal':    { window: 1000,  max: 5 }    // 5 per second
'player:team':    { window: 2000,  max: 5 }    // 5 per 2 seconds
'chat:message':   { window: 5000,  max: 10 }   // 10 per 5 seconds
```

---

## 7. REST API Endpoints

### Health & Monitoring
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Basic liveness check |
| GET | `/health/ready` | Full dependency check |
| GET | `/health/live` | Kubernetes probe |
| GET | `/metrics` | Server metrics |

### Room Management
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/rooms/:code/exists` | Check room existence |
| GET | `/api/rooms/:code` | Get room public info |

### Word Lists (requires database)
| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/wordlists` | List public word lists |
| GET | `/api/wordlists/:id` | Get specific word list |
| POST | `/api/wordlists` | Create word list |
| PUT | `/api/wordlists/:id` | Update word list |
| DELETE | `/api/wordlists/:id` | Delete word list |

---

## 8. Data Validation

### Zod Schemas (`validators/schemas.js`)

**Room Schemas:**
```javascript
roomCreateSchema: {
  teamNames: /^[a-zA-Z0-9\s-]+$/,  // XSS prevention
  turnTimer: 30-300,               // seconds
  password: max 50 chars           // bcrypt hashed
}
```

**Player Schemas:**
```javascript
playerTeamSchema: { team: 'red' | 'blue' | null }
playerRoleSchema: { role: 'spymaster' | 'clicker' | 'spectator' }
playerNicknameSchema: { nickname: 1-30 chars }
```

**Game Schemas:**
```javascript
gameRevealSchema: { cardIndex: 0-24 }
gameClueSchema: {
  clueWord: 1-50 chars, letters/spaces/hyphens/apostrophes
  clueNumber: 0-25
}
```

---

## 9. Error Handling

### Error Hierarchy

```
GameError (base)
├── RoomError
│   ├── .notFound (404)
│   ├── .full (403)
│   ├── .expired (410)
│   └── .gameInProgress (409)
├── PlayerError
│   ├── .notHost (403)
│   ├── .notSpymaster (403)
│   ├── .notClicker (403)
│   ├── .notYourTurn (400)
│   └── .notAuthorized (403)
├── GameStateError
│   ├── .cardAlreadyRevealed (400)
│   ├── .gameOver (400)
│   ├── .noActiveGame (400)
│   └── .corrupted (500)
├── ValidationError
│   ├── .invalidCardIndex (400)
│   ├── .noGuessesRemaining (400)
│   └── .clueAlreadyGiven (400)
├── RateLimitError (429)
├── ServerError (500)
└── WordListError
    ├── .notFound (404)
    └── .notAuthorized (403)
```

---

## 10. Database Schema

### PostgreSQL Models (Prisma)

**User** (optional accounts):
```prisma
model User {
  id           String   @id @default(uuid())
  email        String   @unique
  username     String   @unique
  passwordHash String
  gamesPlayed  Int      @default(0)
  gamesWon     Int      @default(0)
  createdAt    DateTime @default(now())
  lastLogin    DateTime?
}
```

**Room** (game sessions):
```prisma
model Room {
  id        String   @id @default(uuid())
  code      String   @unique
  hostId    String
  settings  Json
  status    String   @default("lobby")
  createdAt DateTime @default(now())
  expiresAt DateTime // TTL: 24 hours
}
```

**Game** (game records):
```prisma
model Game {
  id          String   @id @default(uuid())
  roomId      String
  seed        Int
  words       String[]
  types       Int[]
  revealed    Boolean[]
  currentTurn String
  scores      Json
  clues       Json
  gameOver    Boolean  @default(false)
  winner      String?
  endReason   String?
}
```

**WordList** (custom words):
```prisma
model WordList {
  id          String   @id @default(uuid())
  ownerId     String
  name        String
  description String?
  words       String[]
  isPublic    Boolean  @default(false)
  timesUsed   Int      @default(0)
}
```

---

## 11. Middleware Pipeline

### Request Processing Order

```
1. helmet.js         → Security headers (CSP, HSTS)
2. CORS              → Cross-origin configuration
3. compression       → Response compression
4. body-parser       → JSON/form parsing
5. rate-limiter      → Request throttling
6. CSRF protection   → Token validation
7. route handlers    → API endpoints
8. static files      → Public directory
9. error handler     → Global error catching
```

### Socket Authentication

```
1. Extract session ID from handshake
2. Validate/generate UUID session
3. Track client IP (proxy-aware)
4. Verify JWT (if configured)
5. Create socket-session mapping
```

---

## 12. Storage Configuration

### Redis Keys

| Pattern | Purpose | TTL |
|---------|---------|-----|
| `room:{code}` | Room state | 24h |
| `room:{code}:players` | Player set | 24h |
| `player:{sessionId}` | Player data | 24h |
| `game:{roomCode}` | Game state | 24h |
| `timer:{roomCode}` | Turn timer | Dynamic |
| `ratelimit:{event}:{id}` | Rate limit counter | Window |

### Memory Fallback

When `REDIS_URL=memory`:
- In-memory storage for single-instance deployments
- Periodic cleanup of expired keys (60s interval)
- Compatible with all Redis operations used

### Database Fallback

When database unavailable:
- Game works fully without persistence
- No user accounts or game history
- Word lists served from defaults

---

## 13. Frontend Architecture

### Standalone Mode (`index.html`)

**Single-file SPA** (3,100+ lines):
- No external dependencies
- Works completely offline
- Game state encoded in URL for sharing
- Seeded PRNG (Mulberry32) for determinism

**Key Sections:**
```html
<head>   CSS styles (Glassmorphism design)
<body>   Game board, panels, modals
<script> All JavaScript (state, game logic, UI)
```

### Modular Mode (`server/public/js/`)

| Module | Purpose |
|--------|---------|
| `state.js` | EventEmitter, StateStore, AppState |
| `game.js` | PRNG, shuffle, game logic |
| `ui.js` | Components (Toast, Modal, Board) |
| `socket-client.js` | Socket.io integration |
| `app.js` | Main application coordinator |

---

## 14. Testing

### Test Suites

| File | Coverage |
|------|----------|
| `gameService.test.js` | PRNG, shuffling, game logic |
| `timerService.test.js` | Timer lifecycle, Redis backing |
| `validators.test.js` | Zod schema validation |
| `socketReconnection.test.js` | Session recovery |

### Commands

```bash
npm test                # Run all tests
npm run test:watch      # Watch mode
npm run test:coverage   # Coverage report
```

### Coverage Requirements

```javascript
coverageThreshold: {
  global: {
    branches: 70,
    functions: 70,
    lines: 70,
    statements: 70
  }
}
```

---

## 15. Deployment

### Local Development (Docker)

```bash
docker-compose up -d --build
# Starts: API (3000), PostgreSQL (5432), Redis (6379)
```

### Local Development (Minimal)

```bash
cd server
npm install
REDIS_URL=memory npm run dev
# Single instance, no external dependencies
```

### Production (Fly.io)

```bash
fly deploy
```

**Configuration** (`fly.toml`):
```toml
app = "risley-codenames"
primary_region = "iad"
memory = "512mb"
cpu_kind = "shared"
min_machines_running = 1
```

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NODE_ENV` | Yes | `development` or `production` |
| `PORT` | No | Server port (default: 3000) |
| `DATABASE_URL` | No | PostgreSQL connection |
| `REDIS_URL` | No | Redis connection or `memory` |
| `JWT_SECRET` | No | JWT signing key |
| `CORS_ORIGIN` | No | Allowed origins |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, `error` |

---

## 16. Security Features

| Feature | Implementation |
|---------|----------------|
| Input Validation | Zod schemas at all entry points |
| Rate Limiting | Per-event socket + HTTP limits |
| CSRF Protection | Token validation for state changes |
| XSS Prevention | HTML escaping in chat/names |
| Password Hashing | bcryptjs (salt rounds: 8) |
| Security Headers | Helmet.js (CSP, HSTS, X-Frame) |
| Session Security | IP tracking, JWT verification |
| Non-root Container | Docker USER directive |

---

## 17. Code Statistics

| Component | Lines | Files |
|-----------|-------|-------|
| Backend Services | 2,615 | 5 |
| Socket Handlers | ~600 | 4 |
| Middleware | 791 | 5 |
| Routes | 297 | 2 |
| Config/Utils | 635 | 6 |
| Tests | ~400 | 4 |
| **Backend Total** | ~10,720 | 34 |
| Frontend (standalone) | 3,101 | 1 |
| Frontend (modular) | ~1,500 | 5 |

---

## 18. Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Files | camelCase | `gameService.js` |
| Classes | PascalCase | `GameError` |
| Functions | camelCase | `createGame()` |
| Events | colon-separated | `game:start` |
| Error Codes | SCREAMING_SNAKE | `ROOM_NOT_FOUND` |
| Constants | SCREAMING_SNAKE | `BOARD_SIZE` |

---

## 19. Key Implementation Details

### Seeded PRNG

The game uses **Mulberry32** algorithm for deterministic shuffling:
- Same seed produces identical board on client and server
- Prevents cheating in multiplayer
- Enables standalone mode URL sharing

### Graceful Degradation

```
Full stack:     PostgreSQL + Redis + Node.js
Minimal stack:  Node.js + in-memory storage
Standalone:     Browser only (index.html)
```

### Atomic Operations

Redis Lua scripts prevent race conditions:
- Room creation (SETNX pattern)
- Timer claiming (atomic claim)
- Player updates (check-and-set)

### Multi-Instance Support

- Redis Pub/Sub coordinates Socket.io
- Shared session storage
- Consistent timer state

---

## 20. Common Development Tasks

### Adding a Socket Event

1. Add Zod schema in `validators/schemas.js`
2. Create handler in `socket/handlers/*.js`
3. Register in `socket/index.js`
4. Add client handling in frontend

### Adding a REST Endpoint

1. Add route in `routes/*.js`
2. Add validation middleware
3. Implement service logic
4. Register in `routes/index.js`

### Modifying Game Rules

1. Update `config/constants.js`
2. Modify `services/gameService.js`
3. Update client logic
4. Add/update tests

### Adding Database Models

1. Update `prisma/schema.prisma`
2. Run `npm run db:migrate`
3. Run `npm run db:generate`

---

## 21. Related Documentation

| Document | Description |
|----------|-------------|
| [README.md](../README.md) | Project overview, gameplay |
| [QUICKSTART.md](../QUICKSTART.md) | Getting started guide |
| [CLAUDE.md](../CLAUDE.md) | AI assistant instructions |
| [SERVER_SPEC.md](SERVER_SPEC.md) | Technical architecture |
| [WINDOWS_SETUP.md](WINDOWS_SETUP.md) | Windows development setup |
| [server/README.md](../server/README.md) | Server documentation |

---

*Last updated: January 2026*
