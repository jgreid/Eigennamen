# Eigennamen Online - Server Platform Technical Specification

## 1. Overview

This document describes the technical architecture of Eigennamen Online (Die Eigennamen), a real-time multiplayer web platform with standalone fallback mode.

### 1.1 Goals

- Real-time synchronization across all players (implemented)
- Secure spymaster view — card types hidden from guessers (implemented)
- Room-based multiplayer with join codes (implemented)
- Optional user accounts and game history (implemented)
- Scalable architecture with horizontal scaling support (implemented)
- Three game modes: Classic, Blitz, Duet (implemented)
- Internationalization — 4 languages (implemented)
- Accessibility — WCAG 2.1 AA (implemented)

### 1.2 Not Yet Implemented

- Voice/video chat (use external tools)
- Tournament/ranked play (in future backlog)
- Mobile native apps (PWA available)

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
│  │   Redis      │                                                │
│  │  (Sessions,  │                                                │
│  │   Pub/Sub,   │                                                │
│  │  Game State) │                                                │
│  └──────────────┘                                                │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Technology Stack

| Layer | Technology | Justification |
|-------|------------|---------------|
| **Runtime** | Node.js 18+ | JavaScript everywhere, excellent WebSocket support |
| **Framework** | Express.js | Simple, well-documented, middleware ecosystem |
| **WebSockets** | Socket.io | Automatic reconnection, rooms, fallback support |
| **State Store** | Redis | Fast, pub/sub for scaling, session store |
| **Validation** | Zod | Runtime type validation, TypeScript integration |
| **Testing** | Jest + Supertest | Standard, good async support |

---

## 3. Data Models

### 3.1 Redis Schema (In-Memory State)

All game state is stored in Redis (or in-memory fallback). There is no relational database.

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

#### Rooms

```
GET /api/rooms/:code
    Response: { room, players, game? }

GET /api/rooms/:code/exists
    Response: { exists: boolean }
```

> **Note:** Room creation and deletion are handled via WebSocket events (`room:create`, `room:leave`),
> not REST endpoints. Admin room deletion is available at `DELETE /admin/api/rooms/:code`.

#### Replays

```
GET /api/replays/:roomCode/:gameId
    Response: { replay data }
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
// server/src/middleware/rateLimit.ts

const rateLimit = require('express-rate-limit');

// HTTP endpoints (uses in-memory store by default)
const apiLimiter = rateLimit({
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
FROM node:22-alpine AS builder
WORKDIR /app
COPY server/package*.json ./
RUN npm ci
COPY server/tsconfig*.json server/esbuild.config.js ./
COPY server/src/ ./src/
COPY server/public/ ./public/
RUN npm run build:prod

# Production stage
FROM node:22-alpine
WORKDIR /app

# Install curl for healthcheck, redis for embedded memory-mode server
RUN apk add --no-cache curl redis && \
    addgroup -g 1001 -S nodejs && \
    adduser -S eigennamen -u 1001

COPY --chown=eigennamen:nodejs server/package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=eigennamen:nodejs --from=builder /app/dist ./dist
COPY --chown=eigennamen:nodejs --from=builder /app/public ./public

USER eigennamen
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:3000/health/ready || exit 1

CMD ["node", "dist/index.js"]
```

```yaml
# docker-compose.yml
version: '3.8'

services:
  api:
    build:
      context: .
      dockerfile: server/Dockerfile
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=development
      - PORT=3000
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - CORS_ORIGIN=${CORS_ORIGIN:-http://localhost:3000}
    depends_on:
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - eigennamen-network

  redis:
    image: redis:7-alpine
    command: redis-server --appendonly yes --requirepass ${REDIS_PASSWORD}
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - eigennamen-network

volumes:
  redis_data:

networks:
  eigennamen-network:
    driver: bridge
```

### 8.2 Environment Variables

```bash
# .env.example
NODE_ENV=development
PORT=3000

# Redis (or REDIS_URL=memory for in-memory mode)
REDIS_URL=redis://localhost:6379

# Authentication
JWT_SECRET=your-secret-key-min-32-chars
JWT_EXPIRES_IN=7d

# CORS
CORS_ORIGIN=*

# Admin Dashboard
# ADMIN_PASSWORD=your-secure-admin-password

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
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
- **State Store**: Redis for session management, game state, and fast access
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
