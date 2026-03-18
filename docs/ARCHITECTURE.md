# Architecture Overview - Eigennamen Online

This document describes the high-level architecture of Eigennamen Online, a real-time multiplayer implementation of the board game Eigennamen.

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
| Express.js | v5.2 | HTTP server, static files, REST API |
| Socket.io | v4.7 | WebSocket server, real-time events |
| Helmet | v7+ | Security headers (CSP, etc.) |
| Winston | v3+ | Structured logging |

**Key Services (7 total):**
- `gameService.ts` - Core game logic, PRNG, board generation
- `roomService.ts` - Room lifecycle, settings
- `playerService.ts` - Player management, team assignment, reconnection
- `timerService.ts` - Turn timers with Redis backing
- `gameHistoryService.ts` - Game history barrel (delegates to `gameHistory/` sub-modules: types, validation, storage, replayEngine)
- `auditService.ts` - Security audit logging with severity levels

### Data Layer

| Store | Purpose | Fallback |
|-------|---------|----------|
| Redis | Game state, sessions, pub/sub, game history | In-memory (single instance) |

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
└── redis (Redis 7, port 6379)
```

## Directory Structure

```
Eigennamen/
├── index.html              # Frontend entry point (standalone SPA)
├── wordlist.txt            # Default word list
├── docker-compose.yml      # Multi-service Docker setup
├── fly.toml                # Fly.io deployment config
├── scripts/                # Shell utilities (dev-setup, health-check, etc.)
├── docs/                   # Documentation
└── server/                 # Node.js backend
    ├── public/
    │   ├── js/
    │   │   ├── modules/    # Compiled frontend (built from src/frontend/)
    │   │   │   ├── app.js             # Main bundle (all frontend + shared code)
    │   │   │   └── chunks/            # Code-split chunks
    │   │   └── socket-client.js       # WebSocket client wrapper
    │   ├── css/            # Modular stylesheets (10 files)
    │   ├── locales/        # i18n translations (en, de, es, fr)
    │   ├── admin.html      # Admin dashboard UI
    │   └── manifest.json   # PWA manifest
    ├── src/
    │   ├── index.ts        # Server entry point
    │   ├── app.ts          # Express configuration + Swagger
    │   ├── config/         # Configuration modules (13 files)
    │   ├── errors/         # Custom error classes (GameError hierarchy)
    │   ├── middleware/      # Express middleware (10 files)
    │   │   └── auth/       # Socket auth sub-modules (4 files)
    │   ├── routes/         # REST API routes (8 files)
    │   ├── services/       # Business logic (21 service files)
    │   │   ├── game/       # Game sub-modules (board, reveal, lua)
    │   │   ├── gameHistory/ # Game history sub-modules (types, validation, storage, replayEngine)
    │   │   ├── player/     # Player sub-modules (cleanup, mutations, queries, reconnection, schemas, stats)
    │   │   └── room/       # Room sub-module (membership)
    │   ├── socket/         # WebSocket setup and utilities (11 files)
    │   │   └── handlers/   # Event-specific handlers (9 barrel files + sub-modules)
    │   │       ├── playerHandlers/ # Player handler sub-modules (4 files)
    │   │       └── roomHandlers/   # Room handler sub-modules (4 files)
    │   ├── frontend/       # Frontend TypeScript source
    │   │   ├── handlers/   # Client-side event handlers (6 files)
    │   │   ├── store/      # Reactive state store + actions
    │   │   └── game/       # Game sub-modules (reveal, scoring)
    │   ├── types/          # TypeScript type definitions (11 files)
    │   ├── utils/          # Utility modules (11 files)
    │   ├── validators/     # Zod validation schemas (7 files)
    │   ├── scripts/        # Redis Lua scripts (28 atomic operations)
    │   └── __tests__/      # Jest tests (136 suites)
    │       ├── helpers/    # Test utilities and mocks
    │       ├── integration/ # Integration tests
    │       └── frontend/   # Frontend unit tests
    └── e2e/                # Playwright E2E tests (13 spec files)
```

## Technology Choices

| Area | Choice | Rationale |
|------|--------|-----------|
| Frontend | Vanilla JS | No build step, instant deployment |
| Backend | Node.js + Express | JavaScript ecosystem, Socket.io support |
| Real-time | Socket.io | Robust WebSocket abstraction, fallbacks |
| Validation | Zod | TypeScript-first, runtime validation |
| State Store | Redis | Fast, pub/sub support, atomic operations |
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
| `/health/metrics` | Application metrics, rate limits |
| `/health/metrics/prometheus` | Prometheus-format metrics |

## Related Documentation

- [Server Specification](SERVER_SPEC.md)
- [Deployment Guide](DEPLOYMENT.md)
- [Testing Guide](TESTING_GUIDE.md)
