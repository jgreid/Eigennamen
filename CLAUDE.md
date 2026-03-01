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
└── server/
    ├── public/
    │   ├── js/                 # Compiled frontend JS (esbuild output)
    │   ├── css/                # Stylesheets (8 modules)
    │   ├── locales/            # i18n (en, de, es, fr)
    │   └── admin.html          # Admin dashboard
    ├── src/
    │   ├── index.ts            # Server entry point
    │   ├── app.ts              # Express 5 + Swagger setup
    │   ├── config/             # Configuration (constants.ts re-exports all)
    │   ├── errors/             # GameError hierarchy
    │   ├── middleware/          # Express + socket auth middleware
    │   ├── routes/             # REST API routes
    │   ├── services/           # Business logic layer
    │   │   ├── game/           # Game sub-modules (board, reveal, lua)
    │   │   ├── player/         # Player sub-modules (cleanup, reconnection, stats)
    │   │   └── room/           # Room sub-module (membership)
    │   ├── socket/             # WebSocket setup + handlers/
    │   ├── frontend/           # Frontend TypeScript source (52 modules)
    │   │   ├── handlers/       # Client-side event handlers (6 files)
    │   │   ├── store/          # Reactive state store + actions (13 files)
    │   │   └── game/           # Game sub-modules (reveal, scoring)
    │   ├── shared/             # Shared code between frontend and backend
    │   ├── types/              # TypeScript definitions
    │   ├── utils/              # Utilities
    │   ├── validators/         # Zod schemas
    │   ├── scripts/            # Redis Lua scripts (23 atomic ops)
    │   └── __tests__/          # Jest tests (133 suites)
    └── e2e/                    # Playwright E2E tests (9 specs)
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

### Error Handling Convention
- **Throw** for business logic violations and corrupted data (callers in contextHandler pipeline catch automatically)
- **Return null** only for "resource not found" (key doesn't exist in Redis)
- **Catch gracefully** in non-critical paths (history, cleanup, TTL refresh)
- Audit/history services use log-and-continue (never break game flow)

### Data Flow
Client event → Zod validation → rate limiter → context handler → service → Redis → broadcast via `safeEmit`

## Common Tasks

### Adding a New Socket Event
1. Add event name to `config/socketConfig.ts`
2. Add Zod schema in `validators/*Schemas.ts`
3. Create handler in `socket/handlers/*.ts`
4. Register in `socket/index.ts`
5. Add client handling in `frontend/handlers/`

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
| `shared/gameRules.ts` | Game mode rules shared between frontend and backend |
| `services/gameService.ts` | Core game logic, Mulberry32 PRNG |
| `services/playerService.ts` | Player CRUD, reconnection tokens |
| `socket/handlers/` | Event handlers (game, room, player, timer, chat) |
| `socket/contextHandler.ts` | Handler factory with validation, rate-limiting, player context |
| `socket/playerContext.ts` | Session state validation |
| `middleware/socketAuth.ts` | Auth orchestrator |
| `errors/GameError.ts` | Error class hierarchy |
| `validators/schemas.ts` | Barrel for all Zod schemas |
| `scripts/index.ts` | All Lua scripts (barrel export) |
| `frontend/app.ts` | Frontend entry point |
| `frontend/state.ts` | Frontend state management |
| `frontend/store/` | Reactive state store with actions and selectors |
| `frontend/multiplayer.ts` | Multiplayer orchestration |

All paths relative to `server/src/`.

## Environment

Key env vars (see `server/.env.example` for full list):
- `REDIS_URL` — `redis://...` or `memory` for embedded mode
- `JWT_SECRET` — required in production
- `ADMIN_PASSWORD` — admin dashboard auth
- `NODE_ENV`, `PORT`, `LOG_LEVEL`, `CORS_ORIGIN`

## Further Documentation

- [QUICKSTART.md](QUICKSTART.md) — Getting started
- [CONTRIBUTING.md](CONTRIBUTING.md) — Code standards, PR process
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — System architecture
- [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) — API specification (REST + WebSocket)
- [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) — Testing patterns and coverage
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — Production deployment
- [docs/adr/](docs/adr/) — Architecture Decision Records
