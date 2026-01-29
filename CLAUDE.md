# CLAUDE.md - AI Assistant Guide for Codenames Online

This document provides essential context for AI assistants working on the Codenames Online codebase.

## Project Overview

Codenames Online is a web-based multiplayer implementation of the board game "Codenames". It supports two modes:
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

# Lint code
cd server && npm run lint

# Database commands (if using PostgreSQL)
cd server && npm run db:migrate    # Run migrations
cd server && npm run db:generate   # Generate Prisma client
cd server && npm run db:studio     # Visual database editor
```

## Directory Structure

```
Risley-Codenames/
├── index.html              # Frontend SPA (2,200+ lines, vanilla JS)
├── wordlist.txt            # Default word list
├── docker-compose.yml      # Multi-service Docker setup
├── fly.toml                # Fly.io deployment config
├── docs/                   # Additional documentation
└── server/                 # Node.js backend
    ├── src/
    │   ├── index.js        # Entry point - server initialization
    │   ├── app.js          # Express configuration
    │   ├── config/         # Configuration modules
    │   ├── middleware/     # Express middleware
    │   ├── routes/         # REST API routes
    │   ├── services/       # Business logic (core game logic here)
    │   ├── socket/         # WebSocket handlers
    │   │   └── handlers/   # Event-specific handlers
    │   ├── validators/     # Zod validation schemas
    │   └── __tests__/      # Jest unit tests
    ├── prisma/
    │   └── schema.prisma   # Database schema (optional)
    └── public/             # Static files served by Express
```

## Technology Stack

### Frontend
- Vanilla HTML/CSS/JavaScript (single-file SPA)
- Socket.io client for real-time communication
- Glassmorphism UI design
- URL-based state encoding for standalone mode

### Backend
- **Runtime**: Node.js 18+
- **Framework**: Express.js 4.18
- **Real-time**: Socket.io 4.7
- **Database**: PostgreSQL 15+ via Prisma (optional)
- **Cache**: Redis 7+ (optional, has in-memory fallback)
- **Validation**: Zod schemas
- **Testing**: Jest 29 + Supertest
- **Logging**: Winston

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| `gameService` | `server/src/services/gameService.js` | Core game logic, card shuffling, PRNG |
| `roomService` | `server/src/services/roomService.js` | Room lifecycle management |
| `playerService` | `server/src/services/playerService.js` | Player/team management |
| `timerService` | `server/src/services/timerService.js` | Turn timers with Redis backing |
| `wordListService` | `server/src/services/wordListService.js` | Custom word list management |
| `eventLogService` | `server/src/services/eventLogService.js` | Event logging for reconnection recovery |

## WebSocket Events

### Room Events
- `room:create` / `room:created`
- `room:join` / `room:joined` / `room:playerJoined`
- `room:leave` / `room:playerLeft`
- `room:settings` / `room:settingsUpdated`

### Game Events
- `game:start` / `game:started`
- `game:reveal` / `game:cardRevealed` / `game:turnEnded`
- `game:clue` / `game:clueGiven`
- `game:endTurn` / `game:turnEnded`
- `game:forfeit` / `game:gameEnded`

### Player Events
- `player:setTeam` / `player:teamChanged`
- `player:setRole` / `player:roleChanged`
- `player:setNickname` / `player:nicknameChanged`

## API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Basic health check |
| GET | `/health/ready` | Full dependency check |
| GET | `/health/live` | Kubernetes liveness probe |
| GET | `/metrics` | Server metrics |
| GET | `/api/rooms/:code/exists` | Check if room exists |
| GET | `/api/rooms/:code` | Get room info |
| GET | `/api/wordlists` | List word lists |
| POST | `/api/wordlists` | Create word list |

## Code Conventions

### File Naming
- **Files**: camelCase (`gameService.js`, `roomHandlers.js`)
- **Classes/Objects**: PascalCase
- **Functions**: camelCase
- **Events**: colon-separated (`game:start`, `room:playerJoined`)
- **Error Codes**: SCREAMING_SNAKE_CASE (`ROOM_NOT_FOUND`, `RATE_LIMITED`)

### Architecture Patterns
1. **Service Layer**: All business logic goes in `/server/src/services/`
2. **Handler Pattern**: Socket/HTTP handlers delegate to services
3. **Validation First**: Use Zod schemas at entry points (in `/validators/`)
4. **Typed Errors**: Use error codes from `/config/constants.js`

### Data Flow
1. Client sends Socket.io event with data
2. Handler validates input with Zod schema
3. Rate limiter checks frequency
4. Service executes business logic
5. Results saved to Redis/PostgreSQL
6. Events broadcast to affected players

## Testing

```bash
npm test                  # Run all tests
npm run test:watch       # Watch mode
npm run test:coverage    # With coverage report
```

**Coverage requirements**: 70% minimum for branches, functions, lines, and statements

**Test files location**: `server/src/__tests__/`
- `gameService.test.js` - PRNG, board generation
- `timerService.test.js` - Redis-backed timers
- `validators.test.js` - Input validation schemas

## Environment Variables

Key variables (see `server/.env.example` for full list):

```bash
NODE_ENV=development      # development | production
PORT=3000                 # Server port
LOG_LEVEL=info           # debug | info | warn | error

# Optional - database (works without)
DATABASE_URL=postgresql://user:pass@localhost:5432/codenames

# Optional - Redis (uses memory mode if not set)
REDIS_URL=redis://localhost:6379
# or REDIS_URL=memory for in-memory mode

JWT_SECRET=your-secret-key
CORS_ORIGIN=http://localhost:3000
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
The game uses Mulberry32 algorithm for deterministic card shuffling, synced between client and server. See `gameService.js`.

### Graceful Degradation
- Database is optional - game works fully without PostgreSQL
- Redis is optional - falls back to in-memory storage
- Standalone mode works without any server

### Security Features
- CSRF protection for REST endpoints
- Rate limiting (Redis-backed)
- Input validation with Zod
- Socket authentication middleware
- Helmet.js security headers
- Non-root Docker user

### Scalability
- Redis Pub/Sub for multi-instance Socket.io
- Redis-backed timers work across instances
- Lua scripts for atomic operations

## Common Tasks

### Adding a New Socket Event
1. Add Zod schema in `server/src/validators/schemas.js`
2. Create handler in appropriate `server/src/socket/handlers/*.js` file
3. Register handler in `server/src/socket/index.js`
4. Add corresponding client handling in `index.html`

### Adding a New REST Endpoint
1. Add route in `server/src/routes/` (or create new route file)
2. Add validation middleware if needed
3. Implement service logic in `server/src/services/`
4. Register route in `server/src/routes/index.js`

### Modifying Game Rules
1. Update constants in `server/src/config/constants.js`
2. Modify logic in `server/src/services/gameService.js`
3. Update client logic in `index.html` if needed
4. Add/update tests in `server/src/__tests__/`

### Adding Database Models
1. Update schema in `server/prisma/schema.prisma`
2. Run `npm run db:migrate` to create migration
3. Run `npm run db:generate` to update Prisma client

## Files to Know

| File | Why It Matters |
|------|----------------|
| `index.html` | Entire frontend in one file |
| `server/src/config/constants.js` | Game rules, rate limits, error codes |
| `server/src/services/gameService.js` | Core game logic and PRNG |
| `server/src/socket/index.js` | Socket.io setup and event registration |
| `server/prisma/schema.prisma` | Database schema definition |
| `docker-compose.yml` | Local development infrastructure |
| `fly.toml` | Production deployment config |

## Related Documentation

- [README.md](README.md) - Project overview and gameplay instructions
- [QUICKSTART.md](QUICKSTART.md) - Getting started guide
- [ROADMAP.md](ROADMAP.md) - Development roadmap and remaining work
- [CONTRIBUTING.md](CONTRIBUTING.md) - Contributor guidelines
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - System architecture
- [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) - Technical specification
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) - Testing documentation
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) - Deployment guide
- [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) - Windows setup guide
- [server/README.md](server/README.md) - Server-specific documentation
