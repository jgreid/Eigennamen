# CLAUDE.md - AI Assistant Guide for Eigennamen Online

This document provides essential context for AI assistants working on the Eigennamen Online codebase.

## Project Overview

Eigennamen Online is a web-based multiplayer implementation of the board game "Eigennamen". It supports two modes:
- **Standalone mode**: Works offline with all game state encoded in the URL
- **Multiplayer mode**: Real-time synchronization via Node.js/Socket.io server

**License**: GPL v3.0

## Quick Reference

```bash
# Start development server (with Docker)
cd server && docker compose up -d --build

# Start development server (without Docker)
cd server && npm install && npm run dev

# Run tests
cd server && npm test

# Run tests with coverage
cd server && npm run test:coverage

# Run frontend tests
cd server && npm run test:frontend

# Run E2E tests
cd server && npm run test:e2e

# Lint code
cd server && npm run lint

# Type check
cd server && npm run typecheck

# Database commands (if using PostgreSQL)
cd server && npm run db:migrate    # Run migrations
cd server && npm run db:generate   # Generate Prisma client
cd server && npm run db:studio     # Visual database editor
```

## Directory Structure

```
Eigennamen/
├── index.html              # Frontend entry point (loads modular JS)
├── wordlist.txt            # Default word list
├── docker-compose.yml      # Multi-service Docker setup
├── fly.toml                # Fly.io deployment config
├── scripts/                # Shell utilities (dev-setup, health-check, etc.)
├── docs/                   # Additional documentation
│   └── adr/                # Architecture Decision Records
└── server/                 # Node.js backend
    ├── public/
    │   ├── js/
    │   │   ├── modules/    # Compiled frontend JS (built from src/frontend/)
    │   │   └── socket-client.js
    │   ├── css/            # Modular stylesheets (8 files)
    │   ├── locales/        # i18n translations (en, de, es, fr)
    │   ├── admin.html      # Admin dashboard UI
    │   └── manifest.json   # PWA manifest
    ├── src/
    │   ├── index.ts        # Entry point - server initialization
    │   ├── app.ts          # Express configuration + Swagger setup
    │   ├── config/         # Configuration modules (12 files)
    │   ├── errors/         # Custom error classes (GameError hierarchy)
    │   ├── middleware/      # Express middleware (6 files)
    │   │   └── auth/       # Socket auth sub-modules (4 files)
    │   ├── routes/         # REST API routes (6 files)
    │   ├── services/       # Business logic (7 service files)
    │   │   └── game/       # Game sub-modules (3 files: board, reveal, lua)
    │   ├── socket/         # WebSocket setup and utilities (10 files)
    │   │   └── handlers/   # Event-specific handlers (6 files)
    │   ├── frontend/       # Frontend TypeScript source (31 modules + 6 handler modules)
    │   ├── types/          # TypeScript type definitions (11 files)
    │   ├── utils/          # Utility modules (9 files)
    │   ├── validators/     # Zod validation schemas (7 files)
    │   ├── scripts/        # Redis Lua scripts for atomic operations
    │   └── __tests__/      # Jest tests (93 suites, 2,671 tests)
    │       ├── helpers/    # Test utilities and mocks
    │       ├── integration/ # Integration tests
    │       └── frontend/   # Frontend unit tests
    ├── e2e/                # Playwright E2E tests
    └── prisma/
        └── schema.prisma   # Database schema (optional)
```

## Technology Stack

### Frontend
- TypeScript source in `server/src/frontend/` (37 modules, compiled to `server/public/js/modules/`)
- Socket.io client for real-time communication
- Glassmorphism UI design
- URL-based state encoding for standalone mode
- i18n support (English, German, Spanish, French)
- Accessibility features (colorblind mode, keyboard navigation, screen reader support)

### Backend
- **Runtime**: Node.js 18+
- **Language**: TypeScript 5.3+ (compiled to `dist/` via `npm run build`)
- **Framework**: Express.js 4.18
- **Real-time**: Socket.io 4.7 (with Redis adapter for multi-instance)
- **Database**: PostgreSQL 15+ via Prisma 5.6 (optional)
- **Cache**: Redis 7+ (optional, has in-memory fallback)
- **Validation**: Zod 3.22 schemas
- **Testing**: Jest 29 + Supertest + ts-jest + Playwright (E2E)
- **Logging**: Winston
- **API Docs**: Swagger (swagger-jsdoc + swagger-ui-express)
- **Auth**: JWT (jsonwebtoken) + session tokens
- **Security**: Helmet.js, CSRF protection, rate limiting (express-rate-limit)

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| `gameService` | `server/src/services/gameService.ts` | Core game logic, card shuffling, PRNG |
| `roomService` | `server/src/services/roomService.ts` | Room lifecycle management |
| `playerService` | `server/src/services/playerService.ts` | Player/team management, reconnection tokens |
| `timerService` | `server/src/services/timerService.ts` | Turn timers with Redis backing, pause/resume |
| `wordListService` | `server/src/services/wordListService.ts` | Custom word list CRUD with DB persistence |
| `gameHistoryService` | `server/src/services/gameHistoryService.ts` | Game history storage, replay data |
| `auditService` | `server/src/services/auditService.ts` | Security audit logging with severity levels |

## WebSocket Events

All event names are defined in `server/src/config/socketConfig.ts`.

### Room Events
- `room:create` / `room:created`
- `room:join` / `room:joined` / `room:playerJoined`
- `room:leave` / `room:left` / `room:playerLeft`
- `room:settings` / `room:settingsUpdated`
- `room:resync` / `room:resynced`
- `room:getReconnectionToken` / `room:reconnectionToken`
- `room:reconnect` / `room:reconnected` / `room:playerReconnected`
- `room:hostChanged` / `room:kicked` / `room:statsUpdated`
- `room:warning` / `room:error`

### Game Events
- `game:start` / `game:started`
- `game:reveal` / `game:cardRevealed`
- `game:endTurn` / `game:turnEnded`
- `game:forfeit` / `game:over`
- `game:spymasterView`
- `game:history` / `game:historyData` / `game:getHistory` / `game:historyResult`
- `game:getReplay` / `game:replayData`
- `game:error`

### Player Events
- `player:setTeam` / `player:updated`
- `player:setRole` / `player:updated`
- `player:setNickname` / `player:updated`
- `player:kick` / `player:kicked`
- `player:disconnected` / `player:error`

### Timer Events
- `timer:start` / `timer:started` / `timer:tick`
- `timer:pause` / `timer:paused`
- `timer:resume` / `timer:resumed`
- `timer:stop` / `timer:stopped`
- `timer:addTime` / `timer:timeAdded`
- `timer:expired` / `timer:status` / `timer:error`

### Chat Events
- `chat:send` / `chat:message`
- `chat:spectator` / `chat:spectatorMessage`
- `chat:error`

### Spectator Events
- `spectator:requestJoin` / `spectator:joinRequest`
- `spectator:approveJoin` / `spectator:joinApproved`
- `spectator:denyJoin` / `spectator:joinDenied`

## API Endpoints

### Health & Metrics

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Basic health check |
| GET | `/health/ready` | Full dependency check |
| GET | `/health/live` | Kubernetes liveness probe |
| GET | `/health/metrics` | Health metrics |
| GET | `/health/metrics/prometheus` | Prometheus-format metrics |
| GET | `/metrics` | Server metrics (uptime, memory, connections) |

### Room & Game

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/rooms/:code/exists` | Check if room exists |
| GET | `/api/rooms/:code` | Get room info |
| GET | `/api/replays/:roomCode/:gameId` | Get replay data (public, no room membership needed) |

### Word Lists

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/wordlists` | List word lists (with search) |
| GET | `/api/wordlists/:id` | Get specific word list |
| POST | `/api/wordlists` | Create word list |
| PUT | `/api/wordlists/:id` | Update word list |
| DELETE | `/api/wordlists/:id` | Delete word list |

### Admin Dashboard

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/admin` | Admin dashboard UI |
| GET | `/admin/api/stats` | Server statistics |
| GET | `/admin/api/rooms` | List active rooms |
| GET | `/admin/api/rooms/:code/details` | Room details with players |
| POST | `/admin/api/broadcast` | Send broadcast message |
| DELETE | `/admin/api/rooms/:code` | Force close room |
| DELETE | `/admin/api/rooms/:code/players/:playerId` | Kick player |
| GET | `/admin/api/audit` | Get audit logs |
| GET | `/admin/api/stats/stream` | SSE real-time metrics stream |

### Documentation

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api-docs` | Swagger interactive API docs |

## Code Conventions

### File Naming
- **Files**: camelCase (`gameService.ts`, `roomHandlers.ts`)
- **Classes/Objects**: PascalCase
- **Functions**: camelCase
- **Events**: colon-separated (`game:start`, `room:playerJoined`)
- **Error Codes**: SCREAMING_SNAKE_CASE (`ROOM_NOT_FOUND`, `RATE_LIMITED`)

### Architecture Patterns
1. **Service Layer**: All business logic goes in `/server/src/services/`
2. **Handler Pattern**: Socket/HTTP handlers delegate to services
3. **Context Handler**: `contextHandler.ts` provides consistent validation, rate limiting, and player context resolution
4. **Validation First**: Use Zod schemas at entry points (in `/validators/`)
5. **Typed Errors**: Use `GameError` hierarchy from `/errors/GameError.ts`
6. **Safe Emission**: `safeEmit.ts` wraps all Socket.io emissions with error handling
7. **Atomic Operations**: Redis Lua scripts in `/scripts/` for critical paths

### Data Flow
1. Client sends Socket.io event with data
2. Handler validates input with Zod schema
3. Rate limiter checks frequency
4. Context handler resolves player context
5. Service executes business logic
6. Results saved to Redis/PostgreSQL
7. Events broadcast to affected players via `safeEmit`

## Testing

```bash
npm test                  # Run all backend tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
npm run test:frontend    # Frontend unit tests (Jest + jsdom, via --selectProjects)
npm run test:backend     # Backend tests only (via --selectProjects)
npm run test:e2e         # E2E tests (Playwright)
npm run test:e2e:headed  # E2E in headed browser mode
```

**Test suite**: 93 suites (2,671 tests — backend + frontend), 9 E2E spec files (64+ tests). Total: ~2,735 tests.

**Code quality**: ESLint reports 0 errors, 0 warnings. TypeScript compiles with 0 errors.

**Coverage thresholds** (from `jest.config.ts.js`): 65% branches, 80% functions, 75% lines/statements. Note: `package.json` has a separate fallback config at 80% all metrics — `jest.config.ts.js` takes precedence when running `npm test`. Infrastructure modules (redis.ts, socket/index.ts) require real integration tests for meaningful coverage; business logic modules individually exceed 80%. Current actual coverage: 94%+ lines/statements.

**Test file locations**:
- `server/src/__tests__/` - Backend unit tests (services, handlers, middleware, routes, config, utils)
- `server/src/__tests__/helpers/` - Test utilities: `mocks.ts`, `socketTestHelper.ts`
- `server/src/__tests__/integration/` - Integration tests (full game flow, race conditions, timer ops)
- `server/src/__tests__/frontend/` - Frontend unit tests (board, state, utils, rendering)
- `server/e2e/` - Playwright E2E tests (game flow, multiplayer, accessibility, timer)

## Environment Variables

Key variables (see `server/.env.example` for full list):

```bash
NODE_ENV=development      # development | production
PORT=3000                 # Server port
LOG_LEVEL=info           # debug | info | warn | error

# Optional - database (works without)
DATABASE_URL=postgresql://user:pass@localhost:5432/eigennamen
DATABASE_DIRECT_URL=...  # Direct connection for migrations (Fly.io)

# Optional - Redis (uses memory mode if not set)
REDIS_URL=redis://localhost:6379
# or REDIS_URL=memory for in-memory mode

JWT_SECRET=your-secret-key
JWT_EXPIRES_IN=7d
CORS_ORIGIN=http://localhost:3000

# Admin dashboard
ADMIN_PASSWORD=your-secure-admin-password

# Session security
# ALLOW_IP_MISMATCH=true  # Allow reconnection from different IP (default: false)

# Rate limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# Timeout overrides (optional, in milliseconds)
# TIMEOUT_SOCKET_HANDLER=30000
# TIMEOUT_REDIS_OPERATION=10000
# TIMEOUT_GAME_ACTION=15000
# TIMEOUT_ROOM_ACTION=10000
# TIMEOUT_PLAYER_ACTION=10000
# TIMEOUT_TIMER_ACTION=5000
# TIMEOUT_ADMIN_ACTION=30000
```

## Deployment

### Docker Compose (Local)
```bash
docker compose up -d --build
```
Starts: API server, PostgreSQL, Redis with health checks.

### Fly.io (Production)
```bash
fly deploy
```
Configuration in `fly.toml`:
- Primary region: IAD
- WebSocket-only transport
- 512MB memory, shared CPU
- Auto-scaling enabled

### Single Instance Mode
Works without Docker, Redis, or PostgreSQL:
```bash
cd server
npm install
REDIS_URL=memory npm run dev
```

## Important Implementation Details

### Seeded PRNG
The game uses Mulberry32 algorithm for deterministic card shuffling, synced between client and server. See `gameService.ts`.

### Game Modes
Three game modes are supported (`server/src/config/gameConfig.ts`):
- **Classic**: Standard Eigennamen rules (9 vs 8 cards)
- **Blitz**: 30-second forced timer turns
- **Duet**: Cooperative 2-player mode with special board configuration

### Graceful Degradation
- Database is optional - game works fully without PostgreSQL
- Redis is optional - `REDIS_URL=memory` spawns an embedded redis-server process
- Standalone mode works without any server

### Security Features
- CSRF protection for REST endpoints (custom header + origin validation)
- Rate limiting per-event (Redis-backed with in-memory fallback)
- Input validation with Zod at all entry points (Unicode-aware)
- Socket authentication middleware (session, JWT, reconnection tokens)
- Helmet.js security headers (CSP, HSTS, X-Frame-Options)
- Non-root Docker user
- Admin dashboard with HTTP Basic Authentication
- Audit logging for security events
- Distributed locks for critical sections

### Scalability
- Redis Pub/Sub for multi-instance Socket.io (@socket.io/redis-adapter)
- Redis-backed timers work across instances
- Lua scripts for atomic operations (card reveal, team switch, etc.)
- Distributed lock system for concurrency control
- Correlation ID tracking across requests

## Common Tasks

### Adding a New Socket Event
1. Add event name to `server/src/config/socketConfig.ts`
2. Add Zod schema in appropriate `server/src/validators/*Schemas.ts` file (or `schemas.ts` barrel)
3. Create handler in appropriate `server/src/socket/handlers/*.ts` file
4. Register handler in `server/src/socket/index.ts`
5. Add client handling in `server/src/frontend/multiplayer.ts` (or appropriate handler in `server/src/frontend/handlers/`)

### Adding a New REST Endpoint
1. Add route in `server/src/routes/` (or create new route file)
2. Add validation middleware if needed
3. Implement service logic in `server/src/services/`
4. Register route in `server/src/routes/index.ts`
5. Update Swagger spec in `server/src/config/swagger.ts`

### Modifying Game Rules
1. Update constants in `server/src/config/gameConfig.ts`
2. Modify logic in `server/src/services/gameService.ts`
3. Update client logic in `server/src/frontend/game.ts` if needed
4. Add/update tests in `server/src/__tests__/`

### Adding Database Models
1. Update schema in `server/prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Run `npm run db:generate` to update Prisma client

## Files to Know

| File | Why It Matters |
|------|----------------|
| `index.html` | Frontend entry point (SPA) |
| `server/src/frontend/` | TypeScript frontend source (37 modules incl. handler sub-modules) |
| `server/src/config/constants.ts` | Re-exports all config (game, rate limits, errors, room, security, socket) |
| `server/src/config/gameConfig.ts` | Game modes, board layout, PRNG constants |
| `server/src/config/socketConfig.ts` | Socket.io settings and all event name constants |
| `server/src/services/gameService.ts` | Core game logic, PRNG; delegates to `game/` sub-modules |
| `server/src/services/game/` | Game sub-modules (boardGenerator, revealEngine, luaGameOps) |
| `server/src/services/playerService.ts` | Player management, reconnection tokens |
| `server/src/socket/index.ts` | Socket.io wiring layer (delegates to serverConfig + connectionHandler) |
| `server/src/socket/handlers/` | Event-specific handler files (game, room, player, timer, chat) |
| `server/src/middleware/socketAuth.ts` | Auth orchestrator (delegates to `auth/` sub-modules) |
| `server/src/middleware/auth/` | Auth sub-modules (clientIP, originValidator, sessionValidator, jwtHandler) |
| `server/src/validators/schemas.ts` | Barrel re-export for domain schema files (room, player, game, chat, timer) |
| `server/src/errors/GameError.ts` | Error class hierarchy (GameError, RoomError, ValidationError, etc.) |
| `server/src/utils/metrics.ts` | Metrics collection and tracking |
| `server/prisma/schema.prisma` | Database schema definition |
| `docker-compose.yml` | Local development infrastructure |
| `fly.toml` | Production deployment config |
| `server/public/admin.html` | Admin dashboard UI |

## Related Documentation

- [README.md](README.md) - Project overview and gameplay instructions
- [QUICKSTART.md](QUICKSTART.md) - Getting started guide
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contributor guidelines
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) - Technical specification
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) - Testing documentation
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide
- [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) - Windows setup guide
- [docs/adr/](docs/adr/) - Architecture Decision Records
- [server/README.md](server/README.md) - Server-specific documentation
- [server/public/js/ARCHITECTURE.md](server/public/js/ARCHITECTURE.md) - Frontend JS architecture
