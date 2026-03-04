# CLAUDE.md - AI Assistant Guide for Eigennamen Online

Condensed reference for AI assistants. For full details see the docs listed at the bottom.

## Project Overview

Web-based multiplayer implementation of the board game "Eigennamen" (GPL v3.0).
- **Standalone mode**: Offline, game state encoded in URL
- **Multiplayer mode**: Real-time via Node.js/Socket.io/Redis

## Quick Reference

```bash
cd server && npm install            # Install dependencies
cd server && npm run dev            # Start dev server (no Docker)
cd server && docker compose up -d --build  # Start with Docker

cd server && npm test               # All tests (backend + frontend)
cd server && npm run test:backend   # Backend tests only
cd server && npm run test:frontend  # Frontend tests only
cd server && npm run test:e2e       # Playwright E2E tests
cd server && npm run lint           # ESLint
cd server && npm run format:check   # Prettier check
cd server && npm run typecheck      # TypeScript check
cd server && npm run test:coverage  # Coverage report
```

## Directory Structure

```
Eigennamen/
├── index.html                  # Frontend SPA entry point
├── wordlist.txt                # Default word list
├── docker-compose.yml          # Docker orchestration
├── fly.toml                    # Fly.io deployment config
├── scripts/                    # Shell scripts (dev-setup, deploy, health-check)
├── docs/                       # Extended documentation (8 files + adr/)
├── .github/
│   ├── workflows/              # CI/CD (ci, codeql, deploy, release)
│   ├── dependabot.yml          # Dependency updates
│   └── pull_request_template.md
└── server/
    ├── public/
    │   ├── js/                 # Compiled frontend JS (esbuild output)
    │   ├── css/                # Stylesheets (9 modules)
    │   ├── locales/            # i18n (en, de, es, fr) + wordlists
    │   ├── icons/              # App icons
    │   ├── manifest.json       # PWA manifest
    │   ├── service-worker.js   # Service worker
    │   └── admin.html          # Admin dashboard
    ├── loadtest/               # Load/stress testing scripts
    ├── e2e/                    # Playwright E2E tests (11 specs)
    └── src/
        ├── index.ts            # Server entry point
        ├── app.ts              # Express 5 + Swagger setup
        ├── config/             # Configuration (12 files, constants.ts re-exports all)
        ├── errors/             # GameError hierarchy
        ├── middleware/          # Express + socket middleware
        │   └── auth/           # Auth sub-modules (JWT, IP, origin, session)
        ├── routes/             # REST API routes
        │   └── admin/          # Admin routes (audit, rooms, stats)
        ├── services/           # Business logic layer
        │   ├── game/           # Game sub-modules (board, reveal, lua)
        │   ├── player/         # Player sub-modules (cleanup, mutations, queries, reconnection, schemas, stats)
        │   └── room/           # Room sub-module (membership)
        ├── socket/             # WebSocket setup (11 files + handlers/)
        │   └── handlers/       # Event handlers (9 files)
        ├── frontend/           # Frontend TypeScript source (54 modules)
        │   ├── handlers/       # Client-side event handlers (6 files)
        │   ├── store/          # Reactive state store + actions (13 files)
        │   └── game/           # Game sub-modules (reveal, scoring)
        ├── shared/             # Shared code between frontend and backend
        ├── types/              # TypeScript definitions (11 files)
        ├── utils/              # Utilities (12 files)
        ├── validators/         # Zod schemas (7 files)
        ├── scripts/            # Redis Lua scripts (26 atomic ops)
        └── __tests__/          # Jest tests (127 suites)
```

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| `gameService` | `services/gameService.ts` | Game logic, PRNG, delegates to `game/` |
| `roomService` | `services/roomService.ts` | Room lifecycle |
| `playerService` | `services/playerService.ts` | Players, teams, reconnection |
| `timerService` | `services/timerService.ts` | Turn timers (Redis-backed) |
| `gameHistoryService` | `services/gameHistoryService.ts` | Game history, replays |
| `auditService` | `services/auditService.ts` | Security audit logging |

All paths relative to `server/src/`.

## Code Conventions

### Naming
- **Files**: camelCase — **Classes**: PascalCase — **Events**: colon-separated (`game:start`)
- **Error Codes**: SCREAMING_SNAKE_CASE (`ROOM_NOT_FOUND`)

### Formatting
- **Prettier** enforces formatting (4-space indent, single quotes, semicolons, 120 char width)
- **ESLint** enforces code quality (`@typescript-eslint/no-explicit-any` is `warn` for all code including frontend)
- Run `npm run format` to auto-format, `npm run format:check` to verify

### Architecture Patterns
1. **Service Layer**: Business logic in `services/`, handlers delegate to services
2. **Context Handler**: `socket/contextHandler.ts` validates, rate-limits, resolves player context
3. **Validation First**: Zod schemas at all entry points (`validators/`)
4. **Typed Errors**: `GameError` hierarchy — throw on invalid state, never return null for corrupted data
5. **Safe Emission**: `socket/safeEmit.ts` wraps all Socket.io emissions
6. **Atomic Operations**: Lua scripts in `scripts/` for Redis race conditions
7. **Distributed Locks**: `utils/distributedLock.ts` for concurrency control across instances

### Error Handling Convention
- **Throw** for business logic violations and corrupted data (callers in contextHandler pipeline catch automatically)
- **Return null** only for "resource not found" (key doesn't exist in Redis)
- **Catch gracefully** in non-critical paths (history, cleanup, TTL refresh)
- Audit/history services use log-and-continue (never break game flow)
- **Error detail allowlist**: `errorHandler.ts` only exposes `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable` to clients — all other detail fields are stripped
- **Production Zod scrubbing**: Validation error field paths are stripped in production to prevent schema disclosure

### Data Flow
Client event → Zod validation → rate limiter → context handler → service → Redis → broadcast via `safeEmit`

## Common Tasks

### Adding a New Socket Event
1. Add event name to `config/socketConfig.ts`
2. Add Zod schema in `validators/*Schemas.ts`
3. Create handler in `socket/handlers/*.ts`
4. Register in `socket/index.ts`
5. Add client handling in `frontend/handlers/`

See [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) for a full worked example.

### Adding a New REST Endpoint
1. Add route in `routes/` (register in `routes/index.ts`)
2. Add validation middleware
3. Implement service logic in `services/`
4. Update Swagger spec in `config/swagger.ts`

### Modifying Game Rules
1. Update constants in `shared/gameRules.ts` or `config/gameConfig.ts`
2. Modify logic in `services/gameService.ts`
3. Update client in `frontend/game.ts` if needed
4. Add/update tests

## Key Files

| File | Why It Matters |
|------|----------------|
| `config/constants.ts` | Re-exports all config (game, errors, room, socket, security) |
| `config/socketConfig.ts` | All WebSocket event names |
| `config/gameConfig.ts` | Game modes (Classic, Duet, Match), board layout, PRNG |
| `config/memoryMode.ts` | In-memory Redis fallback configuration |
| `shared/gameRules.ts` | Game mode rules shared between frontend and backend |
| `services/gameService.ts` | Core game logic, Mulberry32 PRNG |
| `services/playerService.ts` | Player CRUD, reconnection tokens |
| `socket/handlers/` | Event handlers (game, room, player, timer, chat) |
| `socket/contextHandler.ts` | Handler factory with validation, rate-limiting, player context |
| `socket/connectionHandler.ts` | WebSocket connection lifecycle |
| `socket/connectionTracker.ts` | Active connection tracking |
| `socket/playerContext.ts` | Session state validation |
| `middleware/socketAuth.ts` | Auth orchestrator |
| `middleware/auth/` | Auth sub-modules (JWT, client IP, origin, session validation) |
| `middleware/errorHandler.ts` | Express error handler with detail allowlist |
| `errors/GameError.ts` | Error class hierarchy |
| `validators/schemas.ts` | Barrel for all Zod schemas |
| `scripts/index.ts` | All Lua scripts (barrel export, each script has documented KEYS/ARGV/Returns header) |
| `frontend/app.ts` | Frontend entry point |
| `frontend/state.ts` | Frontend state management |
| `frontend/store/` | Reactive state store with actions and selectors |
| `frontend/multiplayer.ts` | Multiplayer orchestration |
| `utils/distributedLock.ts` | Distributed locking for multi-instance deployments |
| `utils/logger.ts` | Structured logging utility |

All paths relative to `server/src/`.

## Testing

- **Unit/Integration**: Jest with 127 test suites in `server/src/__tests__/`
- **E2E**: Playwright with 11 spec files in `server/e2e/`
- **Load testing**: Scripts in `server/loadtest/` (stress test, memory leak, room flow, WebSocket game)
- Run `npm run test:watch` for TDD workflow
- Run `npm run test:e2e:headed` to debug E2E tests visually

## CI/CD

GitHub Actions workflows in `.github/workflows/`:
- `ci.yml` — Lint, typecheck, test on every push/PR
- `codeql.yml` — Code security scanning
- `deploy.yml` — Production deployment to Fly.io
- `release.yml` — Release automation

## Environment

Key env vars (see `server/.env.example` for full list):
- `REDIS_URL` — `redis://...` or `memory` for embedded mode
- `JWT_SECRET` — required in production
- `ADMIN_PASSWORD` — admin dashboard auth
- `NODE_ENV`, `PORT`, `LOG_LEVEL`, `CORS_ORIGIN`
- `TRUST_PROXY` — enable behind reverse proxy (auto on Fly.io)
- `ALLOW_IP_MISMATCH` — allow reconnection from different IP
- `RATE_LIMIT_WINDOW_MS`, `RATE_LIMIT_MAX_REQUESTS` — rate limiting
- `INSTANCE_ID` — custom instance ID for multi-instance deployments

## Further Documentation

- [QUICKSTART.md](QUICKSTART.md) — Getting started
- [CONTRIBUTING.md](CONTRIBUTING.md) — Code standards, PR process
- [CONTRIBUTING_QUICK.md](CONTRIBUTING_QUICK.md) — 1-page quick-start contributor guide
- [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) — Worked example of adding a socket event
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture
- [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) — API specification (REST + WebSocket)
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) — Testing patterns and coverage
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment
- [docs/BACKUP_AND_DR.md](docs/BACKUP_AND_DR.md) — Backup and disaster recovery
- [docs/GAME_MODES_REVIEW.md](docs/GAME_MODES_REVIEW.md) — Game modes documentation
- [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) — Windows development setup
- [docs/adr/](docs/adr/) — Architecture Decision Records (4 ADRs)
