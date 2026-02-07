# Architecture Overview - Codenames Online

This document describes the high-level architecture of Codenames Online, a real-time multiplayer implementation of the board game Codenames.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐      │
│  │   Web Browser    │    │   Mobile Browser  │    │   PWA Install    │      │
│  │   (Desktop)      │    │   (Responsive)    │    │   (Offline OK)   │      │
│  └────────┬─────────┘    └────────┬─────────┘    └────────┬─────────┘      │
│           │                       │                       │                 │
│           └───────────────────────┼───────────────────────┘                 │
│                                   │                                         │
│                    ┌──────────────┴──────────────┐                         │
│                    │      Socket.io Client       │                         │
│                    │   (Real-time Multiplayer)   │                         │
│                    └──────────────┬──────────────┘                         │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ WebSocket (wss://)
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SERVER LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│                    ┌──────────────────────────────┐                         │
│                    │       Load Balancer          │                         │
│                    │       (Fly.io Proxy)         │                         │
│                    └──────────────┬───────────────┘                         │
│                                   │                                         │
│     ┌─────────────────────────────┼─────────────────────────────┐          │
│     │                             │                             │          │
│     ▼                             ▼                             ▼          │
│  ┌──────────┐              ┌──────────┐              ┌──────────┐         │
│  │ Instance │              │ Instance │              │ Instance │         │
│  │    #1    │◄────────────►│    #2    │◄────────────►│    #n    │         │
│  └────┬─────┘   Pub/Sub    └────┬─────┘   Pub/Sub    └────┬─────┘         │
│       │                         │                         │               │
│       └─────────────────────────┼─────────────────────────┘               │
│                                 │                                          │
└─────────────────────────────────┼──────────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼──────────────────────────────────────────┐
│                          DATA LAYER                                         │
├─────────────────────────────────┼──────────────────────────────────────────┤
│                                 │                                          │
│  ┌──────────────────────────────┴────────────────────────────────┐        │
│  │                           Redis 7+                             │        │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │        │
│  │  │ Game State  │  │  Sessions   │  │  Pub/Sub    │           │        │
│  │  │   (Rooms)   │  │  (Players)  │  │  (Events)   │           │        │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │        │
│  └───────────────────────────────────────────────────────────────┘        │
│                                 │                                          │
│  ┌──────────────────────────────┴────────────────────────────────┐        │
│  │                      PostgreSQL 15+ (Optional)                 │        │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐           │        │
│  │  │   Users     │  │  Word Lists │  │   Games     │           │        │
│  │  │ (Accounts)  │  │  (Custom)   │  │  (History)  │           │        │
│  │  └─────────────┘  └─────────────┘  └─────────────┘           │        │
│  └───────────────────────────────────────────────────────────────┘        │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Component Descriptions

### Client Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| Web Browser | Vanilla JS, HTML5, CSS3 | Main game interface |
| Socket.io Client | socket.io-client 4.7 | Real-time communication |
| Service Worker | Web Workers API | Offline support (PWA) |

**Two Operating Modes:**
1. **Standalone Mode**: All game state encoded in URL, no server required
2. **Multiplayer Mode**: Real-time sync via WebSocket

### Server Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| Express.js | v4.18 | HTTP server, static files, REST API |
| Socket.io | v4.7 | WebSocket server, real-time events |
| Helmet | v7+ | Security headers (CSP, etc.) |
| Winston | v3+ | Structured logging |

**Key Services:**
- `gameService.js` - Core game logic, PRNG, board generation
- `roomService.js` - Room lifecycle, settings
- `playerService.js` - Player management, team assignment
- `timerService.js` - Turn timers with Redis backing

### Data Layer

| Store | Purpose | Fallback |
|-------|---------|----------|
| Redis | Ephemeral game state, sessions, pub/sub | In-memory (single instance) |
| PostgreSQL | Persistent data (users, word lists, history) | Works without (graceful degradation) |

## Data Flow

### Game State Updates

```
┌────────┐         ┌────────┐         ┌─────────┐         ┌───────┐
│ Client │ ──1──► │ Socket │ ──2──► │ Service │ ──3──► │ Redis │
│        │ ◄──6── │ Handler│ ◄──5── │  Layer  │ ◄──4── │       │
└────────┘         └────────┘         └─────────┘         └───────┘
                        │
                        │ 7 (broadcast)
                        ▼
                   ┌────────┐
                   │ Other  │
                   │Clients │
                   └────────┘
```

1. Client emits socket event (e.g., `game:reveal`)
2. Handler validates input with Zod schema
3. Service executes business logic
4. State saved to Redis
5. Result returned to service
6. Response sent to originating client
7. Updates broadcast to room

### Authentication Flow

```
┌────────┐         ┌──────────┐         ┌─────────────┐
│ Client │ ──1──► │  Socket  │ ──2──► │   Socket    │
│Connect │        │Middleware│        │    Auth     │
└────────┘         └──────────┘         └──────┬──────┘
                        │                      │
                        │ 3 (sessionId)        │ 4 (validate)
                        ▼                      ▼
                   ┌────────┐         ┌─────────────┐
                   │ Room   │ ◄────── │   Player    │
                   │Handler │         │   Service   │
                   └────────┘         └─────────────┘
```

## Key Architectural Decisions

### ADR-001: Lua Scripts for Atomic Operations
**Context**: Redis operations need atomicity for concurrent access
**Decision**: Use Lua scripts for multi-step Redis operations
**Consequence**: Thread-safe state updates, prevents race conditions

### ADR-002: Session Storage over Local Storage
**Context**: Need to persist session across tabs
**Decision**: Use sessionStorage with fallback to localStorage
**Consequence**: Better security, consistent behavior

### ADR-003: Distributed Locks for Concurrency
**Context**: Multi-instance deployment needs coordination
**Decision**: Redis-based distributed locks with TTL
**Consequence**: Safe concurrent operations across instances

### ADR-004: Graceful Degradation
**Context**: Dependencies (DB, Redis) may be unavailable
**Decision**: Design for optional dependencies
**Consequence**: Game works in standalone mode without any server

## Security Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    SECURITY LAYERS                           │
├─────────────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Transport Security (TLS)                  │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           HTTP Security Headers (Helmet)               │  │
│  │   • CSP  • X-Frame-Options  • HSTS  • Referrer-Policy │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │              Rate Limiting (Dual Layer)                │  │
│  │         • Socket events  • HTTP API per IP            │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │            Input Validation (Zod Schemas)              │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │         Session Management (JWT + Tokens)              │  │
│  │   • Reconnection tokens  • Session rotation            │  │
│  └───────────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────────┐  │
│  │           Inactivity Timeout (30 minutes)              │  │
│  └───────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Deployment Architecture

### Production (Fly.io)

```
┌─────────────────────────────────────────────────────────────┐
│                        FLY.IO                                │
├─────────────────────────────────────────────────────────────┤
│  Region: IAD (Primary)                                       │
│  ┌─────────────────────────────────────────────────────┐    │
│  │                   Edge Proxy                         │    │
│  │            (TLS Termination, Load Balancing)        │    │
│  └─────────────────────┬───────────────────────────────┘    │
│                        │                                     │
│  ┌─────────────────────┼───────────────────────────────┐    │
│  │    ┌────────┐  ┌────────┐  ┌────────┐              │    │
│  │    │ App #1 │  │ App #2 │  │ App #n │              │    │
│  │    │ 512MB  │  │ 512MB  │  │ 512MB  │              │    │
│  │    └───┬────┘  └───┬────┘  └───┬────┘              │    │
│  │        └───────────┼───────────┘                   │    │
│  │                    │ Redis Pub/Sub                 │    │
│  │                    ▼                               │    │
│  │         ┌──────────────────┐                       │    │
│  │         │   Upstash Redis  │                       │    │
│  │         │   (Managed)      │                       │    │
│  │         └──────────────────┘                       │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### Local Development (Docker Compose)

```
docker-compose.yml
├── api (Node.js server, port 3000)
├── redis (Redis 7, port 6379)
└── postgres (PostgreSQL 15, port 5432)
```

## Directory Structure

```
Risley-Codenames/
├── index.html              # Frontend entry point (modular)
├── server/
│   ├── public/
│   │   ├── js/
│   │   │   ├── modules/    # ES6 modules (modular frontend)
│   │   │   │   ├── app.js          # Entry point
│   │   │   │   ├── state.js        # State management
│   │   │   │   ├── ui.js           # UI utilities
│   │   │   │   ├── board.js        # Board rendering
│   │   │   │   ├── game.js         # Game logic
│   │   │   │   ├── roles.js        # Role management
│   │   │   │   ├── multiplayer.js  # Multiplayer logic
│   │   │   │   └── ...
│   │   │   └── socket-client.js    # WebSocket client wrapper
│   │   └── css/            # Modular stylesheets
│   │       ├── variables.css
│   │       ├── layout.css
│   │       ├── components.css
│   │       └── ...
│   ├── src/
│   │   ├── index.ts        # Server entry point
│   │   ├── app.ts          # Express configuration
│   │   ├── config/         # Configuration modules
│   │   │   ├── constants.ts
│   │   │   ├── redis.ts
│   │   │   └── database.ts
│   │   ├── services/       # Business logic
│   │   │   ├── gameService.ts
│   │   │   ├── roomService.ts
│   │   │   ├── playerService.ts
│   │   │   └── timerService.ts
│   │   ├── socket/         # WebSocket handlers
│   │   │   ├── index.ts
│   │   │   └── handlers/
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # REST API routes
│   │   ├── validators/     # Zod schemas
│   │   └── __tests__/      # Jest tests
│   └── prisma/
│       └── schema.prisma   # Database schema
├── docs/                   # Documentation
│   ├── adr/               # Architecture Decision Records
│   └── archive/           # Historical documents
└── tests/                  # E2E tests (Playwright)
```

## Technology Choices

| Area | Choice | Rationale |
|------|--------|-----------|
| Frontend | Vanilla JS | No build step, instant deployment |
| Backend | Node.js + Express | JavaScript ecosystem, Socket.io support |
| Real-time | Socket.io | Robust WebSocket abstraction, fallbacks |
| Validation | Zod | TypeScript-first, runtime validation |
| State Store | Redis | Fast, pub/sub support, atomic operations |
| Database | PostgreSQL + Prisma | Type-safe ORM, migrations |
| Testing | Jest + Playwright | Unit + E2E coverage |

## Scaling Considerations

1. **Horizontal Scaling**: Redis pub/sub enables multi-instance Socket.io
2. **Stateless Servers**: All state in Redis, any instance can serve any request
3. **Connection Affinity**: Fly.io maintains WebSocket connections to same instance
4. **Graceful Degradation**: Works as single instance without Redis

## Monitoring & Observability

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check (load balancer) |
| `/health/ready` | Full dependency check (readiness probe) |
| `/health/live` | Process alive check (liveness probe) |
| `/metrics` | Application metrics, rate limits |

## Related Documentation

- [Server Specification](SERVER_SPEC.md)
- [Deployment Guide](DEPLOYMENT.md)
- [ADR Index](adr/README.md)
- [Testing Guide](TESTING_GUIDE.md)
