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

**Key Services (7 total):**
- `gameService.ts` - Core game logic, PRNG, board generation
- `roomService.ts` - Room lifecycle, settings
- `playerService.ts` - Player management, team assignment, reconnection
- `timerService.ts` - Turn timers with Redis backing
- `wordListService.ts` - Custom word list CRUD with DB persistence
- `gameHistoryService.ts` - Game history storage, replay data
- `auditService.ts` - Security audit logging with severity levels

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
Eigennamen/
├── index.html              # Frontend entry point (standalone SPA)
├── wordlist.txt            # Default word list
├── docker-compose.yml      # Multi-service Docker setup
├── fly.toml                # Fly.io deployment config
├── scripts/                # Shell utilities (dev-setup, health-check, etc.)
├── docs/                   # Documentation
│   └── adr/               # Architecture Decision Records (5 ADRs)
└── server/                 # Node.js backend
    ├── public/
    │   ├── js/
    │   │   ├── modules/    # Compiled frontend (built from src/frontend/)
    │   │   │   ├── frontend/          # 31 compiled frontend modules
    │   │   │   │   ├── handlers/      # 6 domain-specific event handler modules
    │   │   │   │   ├── multiplayer.js # Multiplayer core (barrel re-export)
    │   │   │   │   ├── multiplayerListeners.js  # Thin orchestrator (~30 lines)
    │   │   │   │   ├── multiplayerSync.js       # State synchronization
    │   │   │   │   ├── multiplayerUI.js         # Multiplayer UI components
    │   │   │   │   └── ...            # app, board, game, state, ui, etc.
    │   │   │   ├── shared/            # Shared constants (validation, game rules)
    │   │   │   └── chunks/            # Build chunks
    │   │   └── socket-client.js       # WebSocket client wrapper
    │   ├── css/            # Modular stylesheets (8 files)
    │   ├── locales/        # i18n translations (en, de, es, fr)
    │   ├── admin.html      # Admin dashboard UI
    │   └── manifest.json   # PWA manifest
    ├── src/
    │   ├── index.ts        # Server entry point
    │   ├── app.ts          # Express configuration + Swagger
    │   ├── config/         # Configuration modules (12 files)
    │   ├── errors/         # Custom error classes (GameError hierarchy)
    │   ├── middleware/      # Express middleware (6 files)
    │   │   └── auth/       # Socket auth sub-modules (4 files)
    │   ├── routes/         # REST API routes (6 files)
    │   ├── services/       # Business logic (7 service files)
    │   │   └── game/       # Game sub-modules (3 files)
    │   ├── socket/         # WebSocket setup and utilities (10 files)
    │   │   └── handlers/   # Event-specific handlers (6 files)
    │   ├── frontend/       # Frontend TypeScript source (37 modules)
    │   ├── types/          # TypeScript type definitions (11 files)
    │   ├── utils/          # Utility modules (9 files)
    │   ├── validators/     # Zod validation schemas (7 files)
    │   ├── scripts/        # Redis Lua scripts (6 atomic operations)
    │   └── __tests__/      # Jest tests (93 suites, 2,671 tests)
    │       ├── helpers/    # Test utilities and mocks
    │       ├── integration/ # Integration tests
    │       └── frontend/   # Frontend unit tests
    ├── e2e/                # Playwright E2E tests (9 spec files)
    └── prisma/
        └── schema.prisma   # Database schema
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
