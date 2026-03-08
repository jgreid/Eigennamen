# CLAUDE.md - AI Assistant Guide for Eigennamen Online

Comprehensive reference for Claude Code, Squirmy, and other AI assistants working on this codebase. This is the single source of truth for how the project is structured, how to work in it, and what conventions to follow.

## Project Overview

Web-based multiplayer implementation of the board game "Eigennamen" (GPL v3.0).

- **Standalone mode**: Offline single-page app. Game state encoded entirely in the URL — no server required. Open `index.html` directly or serve statically.
- **Multiplayer mode**: Real-time synchronized gameplay via Node.js + Express 5 + Socket.io + Redis. Supports multiple concurrent rooms, reconnection, spectators, game history/replays, and an admin dashboard.
- **Three game modes**: Classic (competitive), Duet (2-player cooperative), Match (multi-round competitive scoring)
- **Four languages**: English, German, Spanish, French — with localized word lists
- **PWA**: Installable as a Progressive Web App with service worker

## Quick Reference

All commands run from the `server/` directory:

```bash
# Setup
npm install                    # Install dependencies

# Development
npm run dev                    # Start dev server (uses REDIS_URL env, defaults to memory mode)
docker compose up -d --build   # Start with Docker (Redis + app)

# Quality gates (all four must pass before submitting a PR)
npm test                       # All tests (backend + frontend, 133 suites)
npm run lint                   # ESLint
npm run format:check           # Prettier check
npm run typecheck              # TypeScript check

# Other useful commands
npm run test:backend           # Backend tests only
npm run test:frontend          # Frontend tests only
npm run test:e2e               # Playwright E2E tests (13 specs)
npm run test:e2e:headed        # E2E with visible browser (debugging)
npm run test:watch             # TDD watch mode
npm run test:coverage          # Coverage report
npm run format                 # Auto-format all files with Prettier
npm run build                  # Full production build (tsc + esbuild + Lua copy)
npm run build:frontend         # Compile frontend TypeScript only
npm run build:frontend:watch   # Watch mode for frontend
npm run loadtest               # Stress test
npm run loadtest:memory        # Memory leak test
npm run redis:inspect          # Inspect Redis state
npm run health                 # Health check
```

## Directory Structure

```
Eigennamen/
├── index.html                  # Standalone SPA entry point (no server needed)
├── wordlist.txt                # Default word list
├── docker-compose.yml          # Docker orchestration (app + Redis)
├── fly.toml                    # Fly.io deployment config
├── CLAUDE.md                   # This file — AI assistant guide
├── CONTRIBUTING.md             # Full contributor guidelines
├── CONTRIBUTING_QUICK.md       # 1-page quick-start contributor guide
├── QUICKSTART.md               # Getting started + first game walkthrough
├── SECURITY.md                 # Security policy + threat model
├── README.md                   # Project overview + gameplay guide
├── scripts/                    # Shell scripts
│   ├── dev-setup.sh            # Development environment setup
│   ├── fly-launch.sh           # Fly.io deployment
│   ├── health-check.sh         # Health check
│   ├── pre-deploy-check.sh     # Pre-deployment validation
│   └── redis-inspect.sh        # Redis state inspection
├── docs/                       # Extended documentation
│   ├── ADDING_A_FEATURE.md     # Worked example: adding a socket event end-to-end
│   ├── ARCHITECTURE.md         # System architecture + data flow diagrams
│   ├── BACKUP_AND_DR.md        # Backup strategy + disaster recovery
│   ├── DEPLOYMENT.md           # Production deployment (Docker, Fly.io, Heroku, K8s)
│   ├── SERVER_SPEC.md          # Full API specification (REST + WebSocket events)
│   ├── SETUP_SCREEN_GUIDE.md   # User-facing setup screen walkthrough
│   ├── TESTING_GUIDE.md        # Testing patterns, mocking, coverage thresholds
│   └── WINDOWS_SETUP.md        # Windows development setup
├── .github/
│   ├── workflows/              # CI/CD pipelines
│   │   ├── ci.yml              # Lint, typecheck, test on every push/PR
│   │   ├── codeql.yml          # Code security scanning
│   │   ├── deploy.yml          # Production deployment to Fly.io
│   │   └── release.yml         # Release automation (version bump + GitHub release)
│   ├── dependabot.yml          # Automated dependency updates
│   └── pull_request_template.md
└── server/
    ├── public/                 # Static assets served by Express
    │   ├── js/                 # Compiled frontend JS (esbuild output)
    │   │   ├── modules/        # ES module bundles
    │   │   │   ├── frontend/   # 55 compiled frontend modules
    │   │   │   ├── shared/     # Shared constants (validation, game rules)
    │   │   │   └── chunks/     # Build chunks
    │   │   └── socket-client.js # WebSocket client wrapper
    │   ├── css/                # Modular stylesheets (10 files)
    │   │   ├── variables.css   # Design tokens (colors, spacing, breakpoints)
    │   │   ├── components.css  # UI components
    │   │   ├── board.css       # Game board
    │   │   ├── setup.css       # Setup screen
    │   │   ├── accessibility.css # a11y styles (445 lines)
    │   │   └── ...             # chat, history, multiplayer, responsive, admin
    │   ├── locales/            # i18n translations (en, de, es, fr) + wordlists
    │   ├── icons/              # App icons
    │   ├── manifest.json       # PWA manifest
    │   ├── service-worker.js   # Service worker (network-first with offline fallback)
    │   └── admin.html          # Admin dashboard UI
    ├── loadtest/               # Load/stress testing scripts
    ├── e2e/                    # Playwright E2E tests (13 spec files)
    └── src/
        ├── index.ts            # Server entry point (HTTP + WebSocket bootstrap)
        ├── app.ts              # Express 5 app setup (middleware, routes, Swagger)
        ├── config/             # Configuration modules (12 files)
        │   ├── constants.ts    # Barrel — re-exports version, gameConfig, errorCodes, roomConfig, socketConfig, securityConfig, rateLimits
        │   ├── version.ts     # APP_VERSION + APP_MAJOR_VERSION (reads from package.json — single source of truth)
        │   ├── socketConfig.ts # All WebSocket event name constants
        │   ├── gameConfig.ts   # Game modes, board layout, PRNG seed offsets, card distributions
        │   ├── roomConfig.ts   # Room capacity, TTLs, code generation
        │   ├── errorCodes.ts   # All error code constants (SCREAMING_SNAKE_CASE)
        │   ├── securityConfig.ts # Auth, session, rate limit defaults
        │   ├── rateLimits.ts   # Per-event rate limit configurations
        │   ├── redis.ts        # Redis client setup + embedded Redis management
        │   ├── memoryMode.ts   # Memory-mode detection and configuration
        │   ├── jwt.ts          # JWT signing/verification config
        │   ├── swagger.ts      # OpenAPI/Swagger spec
        │   └── timeouts.ts     # Timeout constants for all async operations
        ├── errors/             # Error class hierarchy
        │   └── GameError.ts    # GameError base + RoomError, PlayerError, GameStateError, ValidationError, RateLimitError, ServerError
        ├── middleware/          # Express + socket middleware
        │   ├── errorHandler.ts # Express error handler (detail allowlist, Zod scrubbing)
        │   ├── rateLimit.ts    # HTTP rate limiting (express-rate-limit)
        │   ├── socketAuth.ts   # Socket.io auth orchestrator
        │   └── auth/           # Auth sub-modules
        │       ├── jwtAuth.ts  # JWT token generation + validation
        │       ├── clientIp.ts # Client IP extraction (proxy-aware)
        │       ├── originCheck.ts # Origin/referer validation
        │       └── sessionValidator.ts # Session age + integrity checks
        ├── routes/             # REST API routes
        │   ├── index.ts        # Route registration barrel
        │   ├── healthRoutes.ts # /health, /health/ready, /health/live, /metrics
        │   ├── roomRoutes.ts   # Room CRUD API
        │   ├── replayRoutes.ts # /api/replays/:roomCode/:gameId
        │   ├── adminRoutes.ts  # Admin API (password-protected)
        │   └── admin/          # Admin sub-routes (audit, rooms, stats)
        ├── services/           # Business logic layer (all game state mutations)
        │   ├── gameService.ts  # Core game logic, Mulberry32 PRNG, delegates to game/
        │   ├── roomService.ts  # Room create/join/leave/settings lifecycle
        │   ├── playerService.ts # Player CRUD barrel — re-exports from player/ sub-modules
        │   ├── timerService.ts # Turn timers (Redis-backed, pause/resume/add-time)
        │   ├── gameHistoryService.ts # Game history storage + replay data
        │   ├── auditService.ts # Security audit logging (ring buffer)
        │   ├── game/           # Game sub-modules
        │   │   ├── boardGenerator.ts # Board generation + card distribution
        │   │   ├── revealEngine.ts   # Card reveal logic + win detection
        │   │   └── luaGameOps.ts     # Lua script wrappers for atomic game ops
        │   ├── player/         # Player sub-modules
        │   │   ├── cleanup.ts  # Disconnection handling + scheduled cleanup
        │   │   ├── mutations.ts # setTeam, setRole, setNickname
        │   │   ├── queries.ts  # getPlayersInRoom, getTeamMembers, role rotation
        │   │   ├── reconnection.ts # Token generation/validation/invalidation
        │   │   ├── schemas.ts  # Player data schemas for Redis
        │   │   └── stats.ts    # Room stats, spectator info
        │   └── room/
        │       └── membership.ts # Room join/leave/capacity logic
        ├── socket/             # WebSocket setup + utilities
        │   ├── index.ts        # Socket.io server setup + handler registration
        │   ├── contextHandler.ts # Handler factory: validation → rate limit → context → execute
        │   ├── connectionHandler.ts # Connection lifecycle (connect/disconnect)
        │   ├── connectionTracker.ts # Per-IP connection tracking + limits
        │   ├── playerContext.ts # Session state resolution
        │   ├── safeEmit.ts     # Wrapped Socket.io emissions with error handling + metrics
        │   ├── gameMutationNotifier.ts # Event emitter for game state changes
        │   ├── serverConfig.ts # Socket.io server configuration
        │   └── handlers/       # Event-specific handlers (9 files)
        │       ├── gameHandlers.ts    # game:start, game:reveal, game:endTurn, game:forfeit, etc.
        │       ├── roomHandlers.ts    # room:create, room:join, room:leave, room:settings, etc.
        │       ├── roomHandlerUtils.ts # Shared room handler utilities
        │       ├── playerHandlers.ts  # player:setTeam, player:setRole, player:kick, etc.
        │       ├── timerHandlers.ts   # timer:start, timer:pause, timer:resume, timer:addTime
        │       ├── chatHandlers.ts    # chat:message, chat:spectator
        │       ├── spectatorHandlers.ts # spectator:requestJoin, spectator:approveJoin
        │       ├── historyHandlers.ts # game:getHistory, game:getReplay, game:clearHistory
        │       └── reconnectionHandlers.ts # room:reconnect, room:getReconnectionToken
        ├── frontend/           # Frontend TypeScript source (55 modules, compiled via esbuild)
        │   ├── app.ts          # Frontend entry point + event delegation
        │   ├── setupScreen.ts  # Setup screen (Host/Join/Solo quickstart cards)
        │   ├── state.ts        # Reactive state proxy (wraps _rawState with Proxy)
        │   ├── board.ts        # Board rendering + card interaction
        │   ├── game.ts         # Game logic barrel (re-exports from game/ sub-modules)
        │   ├── roles.ts        # Role selection UI (spymaster, clicker, team)
        │   ├── ui.ts           # Toast, modal, screen reader announcements
        │   ├── settings.ts     # Settings panel logic
        │   ├── history.ts      # Game history + replay UI
        │   ├── chat.ts         # Chat UI
        │   ├── i18n.ts         # Internationalization
        │   ├── notifications.ts # Audio + tab notifications
        │   ├── url-state.ts    # URL encoding/decoding for standalone mode
        │   ├── utils.ts        # Clipboard, escapeHTML, DOM utilities
        │   ├── constants.ts    # Frontend constants (UI timing, selectors)
        │   ├── debug.ts        # Debug logging + state watchers
        │   ├── accessibility.ts # Keyboard navigation, ARIA, skip links
        │   ├── multiplayer.ts  # Multiplayer orchestration barrel
        │   ├── multiplayerListeners.ts # Event listener registration
        │   ├── multiplayerSync.ts # Server state synchronization
        │   ├── multiplayerUI.ts # Multiplayer-specific UI components
        │   ├── clientAccessor.ts # Socket client accessor
        │   ├── stateMutations.ts # Type-safe state mutation helpers
        │   ├── handlers/       # Client-side event handlers
        │   │   ├── gameEventHandlers.ts   # Server game event responses
        │   │   ├── playerEventHandlers.ts # Server player event responses
        │   │   ├── roomEventHandlers.ts   # Server room event responses
        │   │   ├── timerEventHandlers.ts  # Server timer event responses
        │   │   ├── chatEventHandlers.ts   # Server chat event responses
        │   │   └── errorMessages.ts       # User-facing error message mapping
        │   ├── store/          # Reactive state store
        │   │   ├── index.ts    # Store entry point
        │   │   ├── reactiveProxy.ts # Proxy-based reactivity
        │   │   ├── eventBus.ts # Pub/sub event bus (max 50 listeners/topic)
        │   │   ├── selectors.ts # Derived state selectors
        │   │   ├── batch.ts    # Batched state updates
        │   │   └── actions/    # Typed action creators (game, player, multiplayer, UI, settings, timer, replay)
        │   └── game/           # Game sub-modules
        │       ├── reveal.ts   # Card reveal logic + game over modal
        │       └── scoring.ts  # Score calculation + turn indicator
        ├── shared/             # Shared between frontend and backend
        │   └── gameRules.ts    # Game mode rules, board sizes, card counts
        ├── types/              # TypeScript type definitions (11 files)
        │   ├── index.ts        # Barrel export
        │   ├── player.ts       # Player, Team, Role types
        │   ├── game.ts         # GameState, Card, Board types
        │   ├── room.ts         # Room, RoomSettings, RoomStatus types
        │   ├── redis.ts        # Redis key prefixes + hash field constants
        │   ├── socket-events.ts # Socket event payload types
        │   ├── services.ts     # Service return type contracts
        │   ├── admin.ts        # Admin API types (audit, stats, rooms)
        │   ├── config.ts       # Configuration types
        │   ├── errors.ts       # ErrorCode + SafeErrorCode types
        │   └── vendor.d.ts     # Third-party declarations (qrcode, Socket.io globals)
        ├── utils/              # Utility modules (12 files)
        │   ├── distributedLock.ts # Redis-based distributed locking (NX + EX pattern)
        │   ├── logger.ts       # Structured logging (pino-style)
        │   ├── metrics.ts      # Application metrics collection
        │   ├── parseJSON.ts    # Safe JSON parsing for Redis data
        │   ├── retryAsync.ts   # Async retry with exponential backoff
        │   └── ...             # escapeHTML, sanitization, etc.
        ├── validators/         # Zod validation schemas (7 files)
        │   ├── schemas.ts      # Barrel export
        │   ├── schemaHelpers.ts # Base schemas, sanitization (removeControlChars)
        │   ├── roomSchemas.ts  # roomCreateSchema, roomJoinSchema, roomSettingsSchema, roomReconnectSchema
        │   ├── playerSchemas.ts # playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema
        │   ├── gameSchemas.ts  # gameStartSchema, gameRevealSchema (index 0-24), gameHistoryLimitSchema
        │   ├── chatSchemas.ts  # chatMessageSchema (1-500 chars), spectatorChatSchema
        │   └── timerSchemas.ts # timerAddTimeSchema (10-300 seconds)
        ├── scripts/            # Redis Lua scripts (26 atomic operations)
        │   └── index.ts        # Barrel export with documented KEYS/ARGV/Returns headers
        └── __tests__/          # Jest tests (133 suites)
            ├── helpers/        # Test utilities + mock factories (mocks.ts ~721 lines)
            ├── integration/    # Integration tests
            └── frontend/       # Frontend unit tests
```

## Architecture

### Data Flow

```
Client event → Socket.io → Zod validation → rate limiter → context handler → service → Redis (Lua) → broadcast via safeEmit
```

### Context Handler Pipeline

The `socket/contextHandler.ts` factory creates handler pipelines with these stages:

1. **Rate Limiting** — Per-event, per-IP Redis-backed counters
2. **Zod Validation** — Input schema validation with sanitization
3. **Player Context Resolution** — Resolves session → player → room from JWT/session store
4. **Handler Execution** — Wrapped with timeout protection
5. **Socket Room Sync** — Updates Socket.io room memberships if player state changed

Factory functions for different authorization levels:
- `createPreRoomHandler()` — No player context needed (room:create, room:join)
- `createRoomHandler()` — Requires valid room membership
- `createHostHandler()` — Requires host role
- `createGameHandler()` — Requires active game in progress
- `createContextHandler()` — Generic with custom options

### Error Class Hierarchy

```
GameError (base) — code, details, timestamp
├── RoomError — .notFound(), .full(), .gameInProgress()
├── PlayerError — .notHost(), .notSpymaster(), .notClicker(), .notYourTurn(), .notAuthorized(), .notFound()
├── GameStateError — .cardAlreadyRevealed(), .gameOver(), .noActiveGame(), .corrupted()
├── ValidationError — .invalidCardIndex(), .noGuessesRemaining()
├── RateLimitError
└── ServerError — .concurrentModification()
```

### SafeEmit

`socket/safeEmit.ts` wraps all Socket.io emissions:
- `safeEmitToRoom(io, roomCode, event, data)` — Emit to all players in room
- `safeEmitToPlayer(io, sessionId, event, data)` — Emit to specific player
- `safeEmitToPlayers(io, players[], event, dataFn)` — Batch with per-player data
- `safeEmitToGroup(io, target, event, data)` — Emit to arbitrary groups
- All catch errors, log failures, track metrics — never throw

### Redis Architecture

**Two tiers:**
- **External Redis** — Full features, multi-instance scaling via pub/sub, data persistence
- **Memory mode** (`REDIS_URL=memory`) — Spawns embedded redis-server, single instance, data lost on restart

**26 Lua scripts** for atomic operations (all in `scripts/`):

| Category | Scripts |
|----------|---------|
| Card/Turn | `REVEAL_CARD_SCRIPT`, `END_TURN_SCRIPT` |
| Player | `UPDATE_PLAYER_SCRIPT`, `SAFE_TEAM_SWITCH_SCRIPT`, `SET_ROLE_SCRIPT` |
| Room | `ATOMIC_CREATE_ROOM_SCRIPT`, `ATOMIC_JOIN_SCRIPT`, `ATOMIC_SET_ROOM_STATUS_SCRIPT`, `ATOMIC_REMOVE_PLAYER_SCRIPT`, `ATOMIC_UPDATE_SETTINGS_SCRIPT`, `HOST_TRANSFER_SCRIPT` |
| TTL | `ATOMIC_REFRESH_TTL_SCRIPT`, `ATOMIC_PERSIST_GAME_STATE_SCRIPT` |
| Player lifecycle | `ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT`, `ATOMIC_SET_SOCKET_MAPPING_SCRIPT`, `ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT`, `ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT`, `INVALIDATE_TOKEN_SCRIPT`, `CLEANUP_ORPHANED_TOKEN_SCRIPT` |
| Timer | `ATOMIC_ADD_TIME_SCRIPT`, `ATOMIC_TIMER_STATUS_SCRIPT`, `ATOMIC_PAUSE_TIMER_SCRIPT`, `ATOMIC_RESUME_TIMER_SCRIPT` |
| History | `ATOMIC_SAVE_GAME_HISTORY_SCRIPT` |
| Locking | `RELEASE_LOCK_SCRIPT`, `EXTEND_LOCK_SCRIPT` |

Each script has a documented `KEYS[]`, `ARGV[]`, and `Returns` header in the source.

### Distributed Locks

`utils/distributedLock.ts` — Redis NX + EX pattern for mutual exclusion:

| Lock | Key Pattern | TTL | Purpose |
|------|-------------|-----|---------|
| Card reveal | `lock:reveal:${roomCode}` | 5s | Prevent duplicate reveals |
| Spymaster role | `lock:spymaster:${roomCode}:${team}` | 5s | One spymaster per team |
| Clicker role | `lock:clicker:${roomCode}:${team}` | 5s | One clicker per team |
| Timer resume | `lock:timer:resume:${roomCode}` | 5s | Prevent duplicate timers |
| Host transfer | `lock:host:${roomCode}` | 3s | Atomic host changes |

### Game Modes

Configured in `config/gameConfig.ts`, rules shared via `shared/gameRules.ts`:

| Mode | Label | Type | Description |
|------|-------|------|-------------|
| `classic` | Vintage | Competitive | Standard two-team wordgame |
| `duet` | Duet | Cooperative | 2-player co-op with special board config (15 unique greens to find) |
| `match` | Eigennamen | Competitive | Multi-round scoring with bonus system (target score, win margin) |

### Frontend Architecture

- **No framework** — Vanilla TypeScript compiled via esbuild
- **Reactive state** — `store/reactiveProxy.ts` wraps state with `Proxy` for automatic change detection
- **Event bus** — `store/eventBus.ts` pub/sub with max 50 listeners per topic
- **Typed actions** — `store/actions/` for game, player, multiplayer, UI, settings, timer, replay
- **Selectors** — `store/selectors.ts` for derived state
- **Batch updates** — `store/batch.ts` to group multiple state changes
- **DOM manipulation** — Direct DOM via `document.getElementById()`, `el.hidden`, `el.textContent`
- **No innerHTML for user content** — Use `textContent`, `createElement()`, or `escapeHTML()` + innerHTML only for trusted templates

## Socket Events

All event names defined in `config/socketConfig.ts`. Format: `domain:action` (client→server) or `domain:pastTense` (server→client).

### Room Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `room:create` | `room:created` |
| `room:join` | `room:joined`, `room:playerJoined` |
| `room:leave` | `room:left`, `room:playerLeft` |
| `room:settings` | `room:settingsUpdated` |
| `room:resync` | `room:resynced` |
| `room:getReconnectionToken` | `room:reconnectionToken` |
| `room:reconnect` | `room:reconnected`, `room:playerReconnected` |
| | `room:kicked`, `room:statsUpdated`, `room:hostChanged`, `room:warning`, `room:error` |

### Game Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `game:start` | `game:started` |
| `game:reveal` | `game:cardRevealed` |
| `game:endTurn` | `game:turnEnded` |
| `game:forfeit` | `game:over` |
| `game:abandon` | `game:spymasterView` |
| `game:nextRound` | `game:roundEnded`, `game:matchOver` |
| `game:getHistory` | `game:historyResult` |
| `game:getReplay` | `game:replayData` |
| `game:clearHistory` | `game:historyCleared` |
| | `game:error` |

### Player Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `player:setTeam` | `player:updated` |
| `player:setRole` | `player:kicked` |
| `player:setNickname` | `player:disconnected` |
| `player:kick` | `player:error` |

### Timer Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `timer:start` | `timer:started` |
| `timer:pause` | `timer:paused` |
| `timer:resume` | `timer:resumed` |
| `timer:stop` | `timer:stopped` |
| `timer:addTime` | `timer:timeAdded` |
| | `timer:tick`, `timer:expired`, `timer:status`, `timer:error` |

### Chat & Spectator Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `chat:message` | `chat:error` |
| `chat:spectator` | `chat:spectatorMessage` |
| `spectator:requestJoin` | `spectator:joinRequest` |
| `spectator:approveJoin` | `spectator:joinApproved`, `spectator:joinDenied` |

## Code Conventions

### Naming
- **Files**: camelCase (`gameService.ts`)
- **Classes**: PascalCase (`GameError`)
- **Socket events**: colon-separated (`game:start`, `room:playerJoined`)
- **Error codes**: SCREAMING_SNAKE_CASE (`ROOM_NOT_FOUND`, `CARD_ALREADY_REVEALED`)
- **CSS classes**: kebab-case (`turn-indicator`, `replay-btn`)
- **Test files**: mirror source path with `.test.ts` suffix

### Formatting (Prettier)

Configured in `server/.prettierrc.json`:
- 4-space indentation
- Single quotes
- Semicolons required
- Trailing commas (ES5)
- 120-character line width
- Always parentheses around arrow function params
- Unix line endings (LF)

Run `npm run format` to auto-format, `npm run format:check` to verify.

### ESLint (Flat Config, eslint.config.js)

- **All TypeScript**: `@typescript-eslint/no-explicit-any` is `error`
- **All TypeScript**: `@typescript-eslint/no-unused-vars` is `warn` (ignores `_` prefixed)
- **Frontend**: `no-console` is `off` (browser debugging allowed)
- **Tests**: `@typescript-eslint/no-explicit-any` is `off` (mock flexibility)
- **Formatting rules**: Disabled via `eslint-config-prettier`

### Error Handling Convention

| Scenario | Pattern | Example |
|----------|---------|---------|
| Business logic violation | **Throw** `GameError` subclass | `throw RoomError.notFound(code)` |
| Data integrity failure | **Throw** (never swallow) | Pipeline partial failure, corrupted data |
| Resource not found | **Return null** | `getRoom()` returning `null` for missing key |
| Non-critical background task | **Log and continue** | Audit logging, metrics, TTL refresh |

**Rules:**
1. Never throw plain `Error` from services — always use `GameError` subclasses
2. Handlers catch service errors and translate to client-facing events (contextHandler does this automatically)
3. Return `null` only when the caller is expected to handle "not found" as a normal case
4. Never mix patterns in the same function
5. `errorHandler.ts` allowlists only these detail fields for clients: `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable`
6. Production Zod errors have field paths stripped to prevent schema disclosure

### Security Practices

- **Validation**: Zod schemas at every entry point with `removeControlChars()` sanitization
- **NFKC normalization**: Prevents Unicode homoglyph attacks
- **CSP**: Strict Content-Security-Policy with no `unsafe-inline` in script-src or style-src
- **No innerHTML for user content**: Use `textContent`, `createElement()`, or allowlisted `escapeHTML()` patterns
- **JWT**: Minimum 32-character secret enforced in production
- **Session limits**: 8-hour max lifetime, IP consistency checks
- **Rate limiting**: Per-event + per-IP, both HTTP (express-rate-limit) and WebSocket (Redis-backed)
- **Error detail stripping**: Internal fields never exposed to clients
- **GitHub Actions**: All pinned to immutable commit SHAs

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| `gameService` | `services/gameService.ts` | Core game logic, Mulberry32 PRNG, delegates to `game/` sub-modules |
| `roomService` | `services/roomService.ts` | Room create/join/leave/settings lifecycle |
| `playerService` | `services/playerService.ts` | Player CRUD barrel (delegates to `player/` sub-modules) |
| `timerService` | `services/timerService.ts` | Turn timers — Redis-backed with pause/resume/add-time |
| `gameHistoryService` | `services/gameHistoryService.ts` | Game history storage + replay data retrieval |
| `auditService` | `services/auditService.ts` | Security audit logging (in-memory ring buffer, MAX_LOGS_PER_CATEGORY=10000) |

All paths relative to `server/src/`.

## Common Tasks

### Adding a New Socket Event

1. Add event name constants to `config/socketConfig.ts`
2. Add Zod schema in `validators/*Schemas.ts` (with sanitization)
3. Create handler in `socket/handlers/*.ts`
4. Register handler in `socket/index.ts` using appropriate context factory
5. Add client handling in `frontend/handlers/*EventHandlers.ts`
6. Add rate limit config in `config/rateLimits.ts`
7. Add tests in `__tests__/`

See [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) for a full worked example tracing `chat:spectator` through all layers.

### Adding a New REST Endpoint

1. Add route in `routes/` (register in `routes/index.ts`)
2. Add validation middleware (Zod schema)
3. Implement service logic in `services/`
4. Update Swagger spec in `config/swagger.ts`

### Modifying Game Rules

1. Update constants in `shared/gameRules.ts` (shared) or `config/gameConfig.ts` (server-only)
2. Modify logic in `services/gameService.ts` (or `game/` sub-modules)
3. Update frontend in `frontend/game.ts` or `frontend/game/` if needed
4. Add/update tests

### Adding a Lua Script

1. Write script in `scripts/` with `KEYS[]`, `ARGV[]`, `Returns` header comment
2. Export from `scripts/index.ts`
3. Create TypeScript wrapper in the appropriate service
4. Add tests (Lua scripts require Redis — use integration tests or mock `evalsha`)

## Testing

### Structure

- **Backend unit/integration**: Jest, 133 suites in `server/src/__tests__/`
- **Frontend unit**: Jest with jsdom, in `server/src/__tests__/frontend/`
- **E2E**: Playwright, 13 specs in `server/e2e/`
- **Load testing**: Custom scripts in `server/loadtest/`

### Configuration (jest.config.ts.js)

Two separate Jest projects:

| Project | Environment | Coverage Thresholds |
|---------|-------------|-------------------|
| `backend` | Node | Statements 80%, Branches 75%, Functions 85%, Lines 80% |
| `frontend` | jsdom | Statements 70%, Branches 70%, Functions 70%, Lines 70% |

Module aliases: `@/`, `@config/`, `@services/`, `@errors/`, `@utils/`, `@middleware/`, `@routes/`, `@socket/`, `@validators/`, `@types/`, `@shared/`

### Test Patterns

- Shared mocks in `__tests__/helpers/mocks.ts` (~721 lines)
- `clearMocks: true`, `restoreMocks: true` — clean state between tests
- playerService re-exports use `export const` pattern for test mock overrides
- CommonJS `module.exports` at end of route files for `require()` compatibility in tests

### Running Tests

```bash
npm test                    # All tests
npm run test:backend        # Backend only
npm run test:frontend       # Frontend only
npm run test:watch          # TDD mode
npm run test:coverage       # With coverage report
npm run test:e2e            # Playwright
npm run test:e2e:headed     # Playwright with visible browser
npm run test:e2e:ui         # Playwright UI mode
```

## CI/CD

GitHub Actions in `.github/workflows/`:

| Workflow | Trigger | What It Does |
|----------|---------|-------------|
| `ci.yml` | Push/PR | Lint → typecheck → test (backend + frontend) → E2E |
| `codeql.yml` | Push/PR/schedule | Code security scanning |
| `deploy.yml` | Push to main | Production deployment to Fly.io |
| `release.yml` | Manual dispatch | Version bump + GitHub release with auto-generated notes |

All GitHub Actions are SHA-pinned to immutable commit hashes. Workflow permissions are scoped to minimum required.

## Environment Variables

Key env vars (see `server/.env.example` for full list):

| Variable | Purpose | Default |
|----------|---------|---------|
| `REDIS_URL` | Redis connection (`redis://...`) or `memory` for embedded | Required |
| `JWT_SECRET` | JWT signing key (min 32 chars in prod) | Required in production |
| `ADMIN_PASSWORD` | Admin dashboard authentication | Optional (warned if missing) |
| `NODE_ENV` | Environment (`development`/`production`) | `development` |
| `PORT` | Server port | `3000` |
| `LOG_LEVEL` | Logging verbosity | `info` |
| `CORS_ORIGIN` | Allowed CORS origins (wildcard blocked in prod) | `*` |
| `TRUST_PROXY` | Enable behind reverse proxy (auto on Fly.io) | `false` |
| `ALLOW_IP_MISMATCH` | Allow reconnection from different IP | `false` |
| `RATE_LIMIT_WINDOW_MS` | HTTP rate limit window | `60000` |
| `RATE_LIMIT_MAX_REQUESTS` | HTTP rate limit max requests | `100` |
| `INSTANCE_ID` | Custom instance ID for multi-instance deployments | Auto-generated |

## Health & Monitoring

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check (load balancer) |
| `/health/ready` | Full dependency check (Redis, etc.) |
| `/health/live` | Process alive (liveness probe) |
| `/metrics` | Application metrics, rate limits, connection counts |

## Documentation Index

| Document | Purpose |
|----------|---------|
| [QUICKSTART.md](QUICKSTART.md) | Getting started + first game walkthrough |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Full contributor guidelines, code standards, error handling |
| [CONTRIBUTING_QUICK.md](CONTRIBUTING_QUICK.md) | 1-page quick-start contributor guide |
| [SECURITY.md](SECURITY.md) | Security policy, threat model, incident response |
| [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md) | Worked example: adding `chat:spectator` end-to-end |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture + technology choices |
| [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md) | Full API specification (REST + WebSocket) |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md) | Testing patterns, mocking Redis, coverage |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment (Docker, Fly.io, Heroku, K8s) |
| [docs/BACKUP_AND_DR.md](docs/BACKUP_AND_DR.md) | Backup strategy + disaster recovery |
| [docs/SETUP_SCREEN_GUIDE.md](docs/SETUP_SCREEN_GUIDE.md) | User-facing setup screen walkthrough |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | Windows development setup |
