# Codenames Online - Server Platform Technical Specification

## 1. Overview

This document describes the technical architecture for the Codenames Online real-time multiplayer platform.

### 1.1 Goals

- Real-time synchronization across all players
- Secure spymaster view (card types hidden from guessers)
- Room-based multiplayer with join codes
- Optional user accounts and game history
- Scalable architecture

### 1.2 Non-Goals (MVP)

- Voice/video chat (use external tools)
- Tournament/ranked play
- Mobile native apps

---

## 2. System Architecture

### 2.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         CLIENTS                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Browser  │  │ Browser  │  │ Browser  │  │ Browser  │        │
│  │ (Host)   │  │ (RedSpy) │  │ (BlueSpy)│  │ (Guesser)│        │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│       │             │             │             │                │
│       └─────────────┴──────┬──────┴─────────────┘                │
│                            │                                     │
│                     WebSocket + HTTP                             │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                      LOAD BALANCER                               │
│                    (nginx / AWS ALB)                             │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                       API SERVERS                                │
│  ┌─────────────────────────┴─────────────────────────┐          │
│  │              Node.js + Socket.io                   │          │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐           │          │
│  │  │ HTTP    │  │WebSocket│  │  Game   │           │          │
│  │  │ Routes  │  │ Handler │  │  Logic  │           │          │
│  │  └─────────┘  └─────────┘  └─────────┘           │          │
│  └───────────────────────────────────────────────────┘          │
└────────────────────────────┼─────────────────────────────────────┘
                             │
┌────────────────────────────┼─────────────────────────────────────┐
│                       DATA LAYER                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Redis      │    │  PostgreSQL  │    │ S3/Storage   │       │
│  │  (Sessions,  │    │   (Users,    │    │ (Word Lists) │       │
│  │   Pub/Sub)   │    │   History)   │    │              │       │
│  └──────────────┘    └──────────────┘    └──────────────┘       │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| **Runtime** | Node.js 18+ | JavaScript everywhere, excellent WebSocket support |
| **Framework** | Express.js | Simple, well-documented, middleware ecosystem |
| **WebSockets** | Socket.io | Automatic reconnection, rooms, fallback support |
| **Database** | PostgreSQL | ACID compliance, JSON support, reliable |
| **Cache/Sessions** | Redis | Fast, pub/sub for scaling, session store |
| **ORM** | Prisma | Type-safe, migrations, excellent DX |
| **Validation** | Zod | Runtime type validation, TypeScript integration |
| **Testing** | Jest + Supertest | Standard, good async support |

---

## 3. Data Models

### 3.1 Entity Relationship Diagram

```
┌─────────────┐       ┌─────────────┐       ┌─────────────┐
│    User     │       │    Room     │       │    Game     │
├─────────────┤       ├─────────────┤       ├─────────────┤
│ id (PK)     │       │ id (PK)     │       │ id (PK)     │
│ email       │       │ code        │◄──────│ room_id(FK) │
│ username    │       │ host_id(FK) │       │ seed        │
│ password    │       │ settings    │       │ words[]     │
│ created_at  │       │ status      │       │ types[]     │
└──────┬──────┘       │ created_at  │       │ revealed[]  │
       │              │ expires_at  │       │ current_turn│
       │              └──────┬──────┘       │ scores      │
       │                     │              │ game_over   │
       │              ┌──────┴──────┐       │ winner      │
       │              │             │       │ clues[]     │
       │         ┌────┴────┐  ┌─────┴─────┐ │ created_at  │
       │         │  Player │  │  Player   │ └─────────────┘
       │         │ (Redis) │  │  (Redis)  │
       │         └─────────┘  └───────────┘
       │
┌──────┴──────┐
│  WordList   │
├─────────────┤
│ id (PK)     │
│ name        │
│ words[]     │
│ owner_id(FK)│
│ is_public   │
└─────────────┘
```

### 3.2 PostgreSQL Schema

```sql
-- Users (optional, for accounts)
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE,
    username VARCHAR(30) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    last_login TIMESTAMP WITH TIME ZONE,
    games_played INT DEFAULT 0,
    games_won INT DEFAULT 0
);

-- Rooms
CREATE TABLE rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    code VARCHAR(6) UNIQUE NOT NULL,
    host_user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Settings stored as JSON
    settings JSONB DEFAULT '{
        "teamNames": {"red": "Red", "blue": "Blue"},
        "turnTimer": null,
        "allowSpectators": true,
        "wordListId": null
    }',

    status VARCHAR(20) DEFAULT 'waiting', -- waiting, playing, finished
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '24 hours'),

    -- Indexes
    CONSTRAINT valid_status CHECK (status IN ('waiting', 'playing', 'finished'))
);

CREATE INDEX idx_rooms_code ON rooms(code);
CREATE INDEX idx_rooms_expires ON rooms(expires_at);

-- Games (one per room, new row each game)
CREATE TABLE games (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    game_number INT NOT NULL DEFAULT 1, -- Which game in this room

    -- Board state
    seed VARCHAR(20) NOT NULL,
    words TEXT[25] NOT NULL,
    types TEXT[25] NOT NULL, -- red, blue, neutral, assassin
    revealed BOOLEAN[25] DEFAULT ARRAY_FILL(false, ARRAY[25]),

    -- Game state
    current_turn VARCHAR(4) DEFAULT 'red',
    red_score INT DEFAULT 0,
    blue_score INT DEFAULT 0,
    red_total INT DEFAULT 9,
    blue_total INT DEFAULT 8,

    -- Clue history
    clues JSONB DEFAULT '[]', -- [{team, word, number, timestamp}]

    -- End state
    game_over BOOLEAN DEFAULT false,
    winner VARCHAR(4),
    end_reason VARCHAR(20), -- completed, assassin, forfeit

    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    ended_at TIMESTAMP WITH TIME ZONE,

    CONSTRAINT valid_turn CHECK (current_turn IN ('red', 'blue')),
    CONSTRAINT valid_winner CHECK (winner IN ('red', 'blue', NULL))
);

CREATE INDEX idx_games_room ON games(room_id);

-- Custom Word Lists
CREATE TABLE word_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    words TEXT[] NOT NULL,
    word_count INT GENERATED ALWAYS AS (array_length(words, 1)) STORED,
    is_public BOOLEAN DEFAULT false,
    times_used INT DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    CONSTRAINT min_words CHECK (array_length(words, 1) >= 25)
);

CREATE INDEX idx_word_lists_public ON word_lists(is_public) WHERE is_public = true;

-- Game History (for stats)
CREATE TABLE game_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(64), -- For anonymous players
    nickname VARCHAR(30) NOT NULL,
    team VARCHAR(4),
    role VARCHAR(10), -- spymaster, guesser, spectator

    CONSTRAINT valid_team CHECK (team IN ('red', 'blue', NULL)),
    CONSTRAINT valid_role CHECK (role IN ('spymaster', 'guesser', 'spectator'))
);

CREATE INDEX idx_participants_game ON game_participants(game_id);
CREATE INDEX idx_participants_user ON game_participants(user_id);
```

### 3.3 Redis Schema (In-Memory State)

```javascript
// Active room state (fast access)
// Key: room:{code}
{
    "id": "uuid",
    "code": "ABC123",
    "hostSessionId": "session-uuid",
    "status": "playing",
    "settings": {
        "teamNames": { "red": "Red", "blue": "Blue" },
        "turnTimer": null
    }
}
// TTL: 24 hours, refreshed on activity

// Players in room (ordered set by join time)
// Key: room:{code}:players
// Value: Set of session IDs
["session-1", "session-2", "session-3"]

// Individual player state
// Key: player:{sessionId}
{
    "sessionId": "session-uuid",
    "roomCode": "ABC123",
    "roomId": "room-uuid",
    "nickname": "Alice",
    "team": "red",
    "role": "spymaster",
    "isHost": false,
    "connectedAt": 1234567890,
    "lastSeen": 1234567890
}
// TTL: 24 hours (same as room to prevent orphaned players), refreshed on activity

// Current game state (for fast access during play)
// Key: room:{code}:game
{
    "id": "game-uuid",
    "words": ["WORD1", "WORD2", ...],
    "types": ["red", "blue", ...],
    "revealed": [false, false, ...],
    "currentTurn": "red",
    "redScore": 0,
    "blueScore": 0,
    "redTotal": 9,
    "blueTotal": 8,
    "gameOver": false,
    "winner": null,
    "currentClue": { "word": "ANIMALS", "number": 3 }
}
// TTL: None (deleted when game ends)

// Session to socket mapping (for reconnection)
// Key: session:{sessionId}:socket
// Value: socket.id
"socket-id-string"
// TTL: 5 minutes
```

---

## 4. API Specification

### 4.1 REST Endpoints

#### Authentication (Optional)

```
POST /api/auth/register
    Body: { email, username, password }
    Response: { user, token }

POST /api/auth/login
    Body: { email, password }
    Response: { user, token }

POST /api/auth/logout
    Headers: Authorization: Bearer <token>
    Response: { success: true }

GET /api/auth/me
    Headers: Authorization: Bearer <token>
    Response: { user }
```

#### Rooms

```
POST /api/rooms
    Body: { settings? }
    Response: { room: { id, code, settings } }

GET /api/rooms/:code
    Response: { room, players, game? }

GET /api/rooms/:code/exists
    Response: { exists: boolean }

DELETE /api/rooms/:code
    Headers: Authorization (host only)
    Response: { success: true }
```

#### Word Lists

```
GET /api/wordlists
    Query: ?public=true&search=movies
    Response: { wordLists: [...] }

GET /api/wordlists/:id
    Response: { wordList }

POST /api/wordlists
    Headers: Authorization
    Body: { name, words[], isPublic }
    Response: { wordList }

DELETE /api/wordlists/:id
    Headers: Authorization (owner only)
    Response: { success: true }
```

### 4.2 WebSocket Events

#### Connection

```javascript
// Client connects with session info
io.connect(SERVER_URL, {
    auth: {
        sessionId: "uuid", // From localStorage or generated
        token: "jwt"       // Optional, for logged-in users
    }
});
```

#### Room Events

```javascript
// ===== CLIENT → SERVER =====

// Create a new room
socket.emit('room:create', {
    settings: {
        teamNames: { red: "Red", blue: "Blue" },
        turnTimer: null, // or seconds
        wordListId: null // or UUID
    }
});

// Join existing room
socket.emit('room:join', {
    code: "ABC123",
    nickname: "Alice"
});

// Leave room
socket.emit('room:leave');

// Update settings (host only)
socket.emit('room:settings', {
    teamNames: { red: "Cats", blue: "Dogs" }
});

// ===== SERVER → CLIENT =====

// Room created successfully
socket.on('room:created', {
    room: { id, code, settings },
    player: { sessionId, nickname, isHost: true }
});

// Joined room successfully
socket.on('room:joined', {
    room: { id, code, settings, status },
    players: [...],
    game: {...} || null,
    you: { sessionId, nickname, team, role }
});

// Another player joined
socket.on('room:playerJoined', {
    player: { sessionId, nickname, team, role }
});

// Player left
socket.on('room:playerLeft', {
    sessionId: "uuid",
    newHost: "uuid" || null // If host left
});

// Settings updated
socket.on('room:settingsUpdated', {
    settings: {...}
});

// Error occurred
socket.on('room:error', {
    code: "ROOM_NOT_FOUND",
    message: "Room does not exist"
});
```

#### Player Events

```javascript
// ===== CLIENT → SERVER =====

// Join a team
socket.emit('player:setTeam', {
    team: "red" // or "blue" or null
});

// Set role
socket.emit('player:setRole', {
    role: "spymaster" // or "guesser" or "spectator"
});

// Update nickname
socket.emit('player:setNickname', {
    nickname: "NewName"
});

// ===== SERVER → CLIENT =====

// Player updated (broadcast to room)
socket.on('player:updated', {
    sessionId: "uuid",
    changes: { team: "red", role: "spymaster" }
});
```

#### Game Events

```javascript
// ===== CLIENT → SERVER =====

// Start new game (host only)
socket.emit('game:start', {
    wordListId: null // Optional custom word list
});

// Reveal a card (host only)
socket.emit('game:reveal', {
    index: 5 // 0-24
});

// Give a clue (spymaster only)
socket.emit('game:clue', {
    word: "ANIMALS",
    number: 3 // or 0 for unlimited
});

// End turn (host only)
socket.emit('game:endTurn');

// Forfeit game
socket.emit('game:forfeit');

// ===== SERVER → CLIENT =====

// Game started
socket.on('game:started', {
    game: {
        id: "uuid",
        words: [...],
        types: [...], // Only for spymasters, null for others
        revealed: [...],
        currentTurn: "red",
        redTotal: 9,
        blueTotal: 8
    }
});

// Card revealed
socket.on('game:cardRevealed', {
    index: 5,
    type: "red", // The revealed card's type
    redScore: 1,
    blueScore: 0,
    currentTurn: "red", // May change if wrong guess
    gameOver: false,
    winner: null
});

// Clue given
socket.on('game:clueGiven', {
    team: "red",
    word: "ANIMALS",
    number: 3,
    spymaster: "Alice" // Nickname
});

// Turn ended
socket.on('game:turnEnded', {
    currentTurn: "blue"
});

// Game over
socket.on('game:over', {
    winner: "red",
    reason: "completed", // or "assassin" or "forfeit"
    types: [...] // Reveal all card types
});
```

#### Chat Events

```javascript
// ===== CLIENT → SERVER =====

socket.emit('chat:message', {
    text: "Hello team!",
    teamOnly: false // true = only your team sees it
});

// ===== SERVER → CLIENT =====

socket.on('chat:message', {
    from: { sessionId, nickname, team },
    text: "Hello team!",
    teamOnly: false,
    timestamp: 1234567890
});
```

---

## 5. Security Design

### 5.1 Spymaster Information Protection

**Critical**: Card types must NEVER be sent to non-spymaster clients.

```javascript
// server/services/gameService.js

function getGameStateForClient(game, player) {
    const baseState = {
        id: game.id,
        words: game.words,
        revealed: game.revealed,
        currentTurn: game.currentTurn,
        redScore: game.redScore,
        blueScore: game.blueScore,
        redTotal: game.redTotal,
        blueTotal: game.blueTotal,
        gameOver: game.gameOver,
        winner: game.winner,
        currentClue: game.currentClue
    };

    // SECURITY: Only spymasters see unrevealed card types
    if (player.role === 'spymaster') {
        baseState.types = game.types;
    } else {
        // Others only see types of revealed cards
        baseState.types = game.types.map((type, i) =>
            game.revealed[i] ? type : null
        );
    }

    // After game over, everyone can see all types
    if (game.gameOver) {
        baseState.types = game.types;
    }

    return baseState;
}
```

### 5.2 Action Authorization

```javascript
// server/middleware/gameAuth.js

const authorizeAction = (action) => (socket, data, next) => {
    const player = getPlayer(socket.sessionId);
    const room = getRoom(player.roomCode);

    switch (action) {
        case 'reveal':
        case 'endTurn':
            if (!player.isHost) {
                return next(new Error('Only host can perform this action'));
            }
            break;

        case 'clue':
            if (player.role !== 'spymaster') {
                return next(new Error('Only spymasters can give clues'));
            }
            if (player.team !== room.game.currentTurn) {
                return next(new Error('Not your team\'s turn'));
            }
            break;

        case 'start':
        case 'settings':
            if (!player.isHost) {
                return next(new Error('Only host can perform this action'));
            }
            break;
    }

    next();
};
```

### 5.3 Rate Limiting

```javascript
// server/middleware/rateLimit.js

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');

// HTTP endpoints
const apiLimiter = rateLimit({
    store: new RedisStore({ client: redisClient }),
    windowMs: 60 * 1000, // 1 minute
    max: 100, // 100 requests per minute
    message: { error: 'Too many requests' }
});

// WebSocket events (custom implementation)
const socketRateLimits = {
    'game:reveal': { window: 1000, max: 5 },   // 5 reveals per second
    'chat:message': { window: 5000, max: 10 }, // 10 messages per 5 seconds
    'game:clue': { window: 5000, max: 2 }      // 2 clues per 5 seconds
};
```

### 5.4 Input Validation

```javascript
// server/validators/schemas.js

const { z } = require('zod');

const schemas = {
    roomCreate: z.object({
        settings: z.object({
            teamNames: z.object({
                red: z.string().max(20).default('Red'),
                blue: z.string().max(20).default('Blue')
            }).optional(),
            turnTimer: z.number().min(30).max(300).nullable().optional(),
            wordListId: z.string().uuid().nullable().optional()
        }).optional()
    }),

    roomJoin: z.object({
        code: z.string().length(6).regex(/^[A-Z0-9]+$/),
        nickname: z.string().min(1).max(30).trim()
    }),

    gameReveal: z.object({
        index: z.number().int().min(0).max(24)
    }),

    gameClue: z.object({
        word: z.string().min(1).max(50).trim()
            .regex(/^[A-Za-z\s-]+$/, 'Clue must contain only letters'),
        number: z.number().int().min(0).max(25)
    }),

    chatMessage: z.object({
        text: z.string().min(1).max(500).trim(),
        teamOnly: z.boolean().default(false)
    })
};
```

---

## 6. Scaling Considerations

### 6.1 Horizontal Scaling with Redis Pub/Sub

```javascript
// server/socket/adapter.js

const { createAdapter } = require('@socket.io/redis-adapter');
const { createClient } = require('redis');

const pubClient = createClient({ url: REDIS_URL });
const subClient = pubClient.duplicate();

await Promise.all([pubClient.connect(), subClient.connect()]);

io.adapter(createAdapter(pubClient, subClient));
```

### 6.2 Sticky Sessions

For WebSocket connections to work across multiple servers:

```nginx
# nginx.conf
upstream api_servers {
    ip_hash;  # Sticky sessions based on client IP
    server api1:3000;
    server api2:3000;
    server api3:3000;
}
```

### 6.3 Estimated Capacity

| Metric | Single Server | 3-Server Cluster |
|--------|---------------|------------------|
| Concurrent rooms | ~1,000 | ~3,000 |
| Concurrent players | ~5,000 | ~15,000 |
| WebSocket connections | ~5,000 | ~15,000 |
| Requests/second | ~1,000 | ~3,000 |

---

## 7. Error Handling

### 7.1 Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `ROOM_NOT_FOUND` | 404 | Room code doesn't exist |
| `ROOM_FULL` | 403 | Room at max capacity |
| `ROOM_EXPIRED` | 410 | Room has expired |
| `GAME_IN_PROGRESS` | 409 | Can't join mid-game |
| `NOT_HOST` | 403 | Action requires host role |
| `NOT_SPYMASTER` | 403 | Action requires spymaster role |
| `NOT_YOUR_TURN` | 400 | Wrong team's turn |
| `CARD_ALREADY_REVEALED` | 400 | Card already flipped |
| `GAME_OVER` | 400 | Game has ended |
| `INVALID_INPUT` | 400 | Validation failed |
| `RATE_LIMITED` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Internal error |

### 7.2 Error Response Format

```javascript
{
    "error": {
        "code": "ROOM_NOT_FOUND",
        "message": "Room with code 'XYZ123' does not exist",
        "details": {} // Optional additional info
    }
}
```

---

## 8. Deployment

### 8.1 Docker Configuration

```dockerfile
# Dockerfile (multi-stage build with security)
# Build stage
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate

# Production stage
FROM node:20-alpine
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S codenames -u 1001

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force
COPY --from=builder /app/src ./src
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma

RUN chown -R codenames:nodejs /app
USER codenames

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "src/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - DATABASE_URL=postgresql://codenames:password@db:5432/codenames
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET:-change-this-in-production}
      - CORS_ORIGIN=${CORS_ORIGIN:-*}
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - codenames-network

  db:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data
    environment:
      - POSTGRES_USER=codenames
      - POSTGRES_PASSWORD=password
      - POSTGRES_DB=codenames
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U codenames -d codenames"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - codenames-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - codenames-network

volumes:
  postgres_data:
  redis_data:

networks:
  codenames-network:
    driver: bridge
```

### 8.2 Environment Variables

```bash
# .env.example
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/codenames

# Redis
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=7d

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Room Settings
ROOM_CODE_LENGTH=6
ROOM_MAX_PLAYERS=20
ROOM_EXPIRY_HOURS=24

# Feature Flags
ENABLE_ACCOUNTS=false
ENABLE_CHAT=true
ENABLE_SPECTATORS=true
```

---

## 9. Testing Strategy

### 9.1 Test Categories

| Category | Tools | Coverage Target |
|----------|-------|-----------------|
| Unit Tests | Jest | 70% |
| Integration Tests | Jest + Supertest | Key flows |
| WebSocket Tests | socket.io-client | All events |
| Load Tests | Artillery | 1000 concurrent |

### 9.2 Key Test Scenarios

1. **Room lifecycle**: Create → Join → Play → End
2. **Reconnection**: Disconnect → Reconnect → State restored
3. **Host transfer**: Host leaves → New host assigned
4. **Security**: Guesser cannot see card types
5. **Concurrency**: Multiple reveals don't corrupt state

---

## 10. Implementation Status

The server platform has been fully implemented with all core features:

### Completed Features

- **Room Management**: Room creation/joining with 6-character codes
- **Real-time Sync**: WebSocket-based game state synchronization
- **Security**: Spymaster card type protection, role-based authorization
- **Database**: PostgreSQL with Prisma ORM for persistence
- **Caching**: Redis for session management and fast state access
- **Chat**: Team-only and broadcast messaging
- **Turn Timers**: Configurable per-turn time limits
- **Spectator Mode**: Watch games without participating
- **Clue Validation**: Prevents using words on the board as clues
- **Game History**: Tracks all moves and clues for replay
- **Horizontal Scaling**: Redis Pub/Sub adapter for multi-server deployments

### Future Enhancements

- Tournament/ranked play mode
- Voice/video chat integration
- Mobile native applications
- Advanced analytics and statistics
