# Architecture Overview - Codenames Online

This document describes the high-level architecture of Codenames Online, a real-time multiplayer implementation of the board game Codenames.

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT LAYER                                    │
├─────────────────────────────────────────────────────────────────────────────┤
│  ┌──────────────────┐    ┌──────────────────┐                              │
│  │   Web Browser    │    │   Mobile Browser  │                              │
│  │   (Desktop)      │    │   (Responsive)    │                              │
│  └────────┬─────────┘    └────────┬─────────┘                              │
│           │                       │                                         │
│           └───────────────────────┘                                         │
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
| Web Browser | Vanilla JS (ES modules), HTML5, CSS3 | Main game interface |
| Socket.io Client | socket.io-client 4.7 | Real-time communication |

**Operating Mode:** Real-time multiplayer via WebSocket. A server is required.

### Server Layer

| Component | Technology | Purpose |
|-----------|------------|---------|
| Express.js | v4.18 | HTTP server, static files, REST API |
| Socket.io | v4.7 | WebSocket server, real-time events |
| Helmet | v7+ | Security headers (CSP, etc.) |
| Winston | v3+ | Structured logging |

**Key Services:**
- `gameService.js` - Core game logic, PRNG, board generation
- `roomService.js` - Room lifecycle, settings, passwords
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
**Consequence**: Game works without PostgreSQL or Redis (uses in-memory fallback)

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
├── docker-compose.yml      # Multi-service Docker setup
├── fly.toml                # Fly.io deployment config
├── server/
│   ├── src/
│   │   ├── index.js        # Server entry point
│   │   ├── app.js          # Express configuration
│   │   ├── config/         # Configuration modules
│   │   ├── services/       # Business logic
│   │   ├── socket/         # WebSocket handlers
│   │   │   └── handlers/   # Event-specific handlers
│   │   ├── middleware/     # Express middleware
│   │   ├── routes/         # REST API routes
│   │   ├── validators/     # Zod schemas
│   │   └── __tests__/      # Jest tests
│   ├── prisma/
│   │   └── schema.prisma   # Database schema
│   └── public/             # Static frontend
│       ├── index.html      # HTML shell
│       ├── css/            # 8 modular CSS files
│       └── js/modules/     # 12 ES module JS files
├── docs/                   # Documentation
│   ├── adr/               # Architecture Decision Records
│   └── archive/           # Historical documents
└── tests/                  # E2E tests (Playwright)
```

## Technology Choices

| Area | Choice | Rationale |
|------|--------|-----------|
| Frontend | Vanilla JS (ES modules) | No build step, instant deployment |
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
