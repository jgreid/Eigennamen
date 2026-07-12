# CLAUDE.md - AI Assistant Guide for Eigennamen Online

Comprehensive reference for Claude Code, Squirmy, and other AI assistants working on this codebase. This is the single source of truth for how the project is structured, how to work in it, and what conventions to follow.

## Project Overview

Web-based multiplayer implementation of the board game "Eigennamen" (GPL v3.0).

- **Standalone mode**: Offline single-page app. Game state is encoded entirely in the URL, so no _backend_ is required. The entry document is `server/public/index.html`; it loads its JS/CSS by absolute path (`/js/...`, `/css/...`), so serve the `server/public/` directory statically (e.g. `cd server/public && python -m http.server`) — opening `index.html` straight off the filesystem (`file://`) fails because those absolute paths don't resolve.
- **Multiplayer mode**: Real-time synchronized gameplay via Node.js + Express 5 + Socket.io + Redis. Supports multiple concurrent rooms, reconnection, spectators, game history/replays, AI bot opponents, and an admin dashboard.
- **Three game modes**: Classic (competitive), Duet (2-player cooperative), Match (multi-round competitive scoring)
- **AI bots**: Optional bot players (host-managed via `bot:add`/`bot:remove`) that occupy spymaster/clicker/advisor seats and play through the same game ops as humans; an **advisor** suggests ranked guesses to a human clicker without ever acting, and an **observer** role watches the unmasked board without participating. Difficulty is a five-rung ladder (novice → expert), with six playstyle **personae** (`bots/personas.ts`) usable as drop-in `skillPreset` ids. Clue semantics are tiered: the baked association table by default; word embeddings when a vectors file is present (**auto-detected** — a one-time `npm run bots:embeddings` upgrades every later `npm run dev`/`npm start`; `BOT_EMBEDDINGS_PATH=off` forces the table); and an optional **wide comprehension tier** (`BOT_EMBEDDINGS_WIDE`, enabled in `fly.toml` with the 2 GB VM it needs, paired with a raised `BOT_EMBEDDINGS_MAX_WORDS`) so bots UNDERSTAND rare word-nerd clues (SIDEREAL→MOON) without ever GIVING rare clues. Custom word lists degrade to lexical similarity unless a prepared **semantic map** restores full-strength play (`npm run bots:map`, `BOT_SEMANTIC_MAPS_DIR` — see [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md)). **LLM advice is opt-in** (`BOT_LLM_MODEL` + `ANTHROPIC_API_KEY`): Claude proposes, the deterministic safety machinery verifies, and every failure/timeout degrades to normal play (docs/BOT_LLM.md). The as-built gameplay contracts — persona-independent assassin-berth floor, plausible-set noise (weak bots misread, never blind-pick the assassin), provenance-aware guessing, the no-repeat/redundancy clue memory, turn economy, the late-game pressure override, guesser-competence margins, and the clue-capitalization house rule — are specified in [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md) §11.1–11.2, with tuning history in [docs/BOT_CLUE_LESSONS.md](docs/BOT_CLUE_LESSONS.md). Tune and audit with `npm run bots:analyze`; grade semantic backends against human association norms with `npm run bots:eval`. Code lives in `server/src/bots/`.
- **Four languages**: English, German, Spanish, French — with localized word lists
- **PWA**: Installable as a Progressive Web App with service worker

## Quick Reference

All commands run from the `server/` directory:

```bash
# Setup
npm install                    # Install dependencies

# Development
npm run dev                    # Start dev server (uses REDIS_URL env, defaults to redis://localhost:6379; set REDIS_URL=memory for embedded)
npm run dev:bots               # Dev server with embedding-backed bots; auto-ensures Redis, fetches model once
npm run redis:up               # Ensure a local Redis (reuse one, else start a managed Docker container)
npm run redis:down             # Stop the managed Redis container
docker compose up -d --build   # Start with Docker (Redis + app)

# Quality gates (all four must pass before submitting a PR)
npm test                       # All tests (backend + frontend, 191 suites)
npm run lint                   # ESLint
npm run format:check           # Prettier check
npm run typecheck              # TypeScript check

# Other useful commands
npm run test:backend           # Backend tests only
npm run test:frontend          # Frontend tests only
npm run test:e2e               # Playwright E2E tests (16 specs)
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
npm run bots:train             # Headless bot self-play harness (strategy tuning)
npm run bots:analyze           # Clue-giving diagnostics: per-persona gap report (--mode/--games/--seed)
npm run bots:eval              # Grade semantic backends against a human word-association dataset (--norms)
npm run bots:parity            # Verify bot engine vs Lua game-op parity
npm run bots:embeddings        # Download bot word-embedding model only (no server start)
npm run bots:embeddings:board  # Distil a big embedding model down to the board vocabulary (board-vectors asset)
npm run bots:associations      # Regenerate the offline bot association table (semantics fallback)
npm run bots:map               # Build an LLM-curated semantic map for a custom word list (--words <file>)
```

## Directory Structure

```
Eigennamen/
├── wordlist.txt                # Default word list
├── docker-compose.yml          # Docker orchestration (app + Redis)
├── fly.toml                    # Fly.io deployment config
├── CLAUDE.md                   # This file — AI assistant guide
├── CONTRIBUTING.md             # Full contributor guidelines
├── CONTRIBUTING_QUICK.md       # 1-page quick-start contributor guide
├── QUICKSTART.md               # Getting started + first game walkthrough
├── SECURITY.md                 # Security policy + threat model
├── README.md                   # Project overview + gameplay guide
├── scripts/                    # Setup and utility scripts
│   ├── dev-setup.sh            # Development environment setup
│   ├── dev-bots.mjs            # Cross-platform bot-embeddings setup (Win/macOS/Linux, pure Node)
│   ├── ensure-redis.mjs        # Ensure a local Redis (reuse, else managed Docker container)
│   ├── build-semantic-map.mjs  # LLM-built semantic map for a custom word list (npm run bots:map)
│   ├── build-board-vectors.mjs # Distil a big embedding model to the game vocabulary (npm run bots:embeddings:board)
│   ├── generate-associations.mjs # Regenerate the bot association table (concept→board-word map)
│   ├── fetch-bot-embeddings.sh # Manual word-embedding download (incl. ConceptNet Numberbatch)
│   ├── fly-launch.sh           # Fly.io deployment
│   ├── health-check.sh         # Health check
│   ├── pre-deploy-check.sh     # Pre-deployment validation
│   └── redis-inspect.sh        # Redis state inspection
├── docs/                       # Extended documentation
│   ├── ADDING_A_FEATURE.md     # Worked example: adding a socket event end-to-end
│   ├── ARCHITECTURE.md         # System architecture + data flow diagrams
│   ├── BACKUP_AND_DR.md        # Backup strategy + disaster recovery
│   ├── BOT_EMBEDDINGS.md       # Optional word-embedding backend for bots
│   ├── DEPLOYMENT.md           # Production deployment (Docker, Fly.io, Heroku, K8s)
│   ├── INTELLIGENT_BOTS_SPEC.md # AI bot design spec (engine, strategies, semantics)
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
    │   ├── index.html          # SPA entry point (source of truth; uses absolute asset paths)
    │   ├── js/                 # Compiled frontend JS (esbuild output)
    │   │   ├── modules/        # ES module bundles
    │   │   │   ├── app.js      # Main bundle (all frontend + shared code)
    │   │   │   └── chunks/     # Code-split chunks
    │   │   └── socket-client.js # WebSocket client wrapper
    │   ├── css/                # Modular stylesheets (10 files)
    │   │   ├── variables.css   # Design tokens (colors, spacing, breakpoints)
    │   │   ├── components.css  # UI components
    │   │   ├── layout.css      # Game board + page layout
    │   │   ├── setup.css       # Setup screen
    │   │   ├── accessibility.css # a11y styles (472 lines)
    │   │   └── ...             # modals, multiplayer, replay, responsive, admin
    │   ├── locales/            # i18n translations (en, de, es, fr) + wordlists
    │   ├── icons/              # App icons
    │   ├── manifest.json       # PWA manifest
    │   ├── service-worker.js   # Service worker (network-first with offline fallback)
    │   └── admin.html          # Admin dashboard UI
    ├── loadtest/               # Load/stress testing scripts
    ├── e2e/                    # Playwright E2E tests (16 spec files, .spec.js)
    └── src/
        ├── index.ts            # Server entry point (HTTP + WebSocket bootstrap)
        ├── app.ts              # Express 5 app setup (middleware, routes, Swagger)
        ├── bots/               # AI bot opponents (pure engine + live driver)
        │   ├── botController.ts # Live bot driver singleton — subscribes to onGameMutation, defers reactions (queueMicrotask), per-room in-flight guard
        │   ├── engine.ts       # Pure, deterministic bot game model (no Redis/socket deps)
        │   ├── playOneAction.ts # Shared move computation (builds bot view → strategy → action)
        │   ├── presets.ts      # Skill-preset resolution (5-rung novice→beginner→intermediate→advanced→expert → SkillParams); routes persona ids
        │   ├── personas.ts     # Persona registry (playstyle = difficulty + style knobs) → SkillParams
        │   ├── rng.ts          # Seeded RNG for reproducible bot decisions
        │   ├── botRoomCache.ts # Per-room has-bots cache so the controller skips bot-less rooms for free (E3)
        │   ├── llm/            # Opt-in LLM advice layer (llmAdvice.ts — Claude proposes, machinery verifies)
        │   ├── strategies/     # spymasters, clickers, advisor, clueFrame (sense enumeration/frame doubt), registry, types (SkillParams style knobs), clueSafety (board-safety filter)
        │   ├── semantics/      # Clue semantics: association table + optional embedding backends
        │   └── harness/        # Headless self-play (runMatches, analyze, parity, playGame, scoring)
        ├── config/             # Configuration modules (13 files)
        │   ├── constants.ts    # Barrel — re-exports version, gameConfig, errorCodes, roomConfig, socketConfig, securityConfig, rateLimits
        │   ├── version.ts     # APP_VERSION + APP_MAJOR_VERSION (reads from package.json — single source of truth)
        │   ├── env.ts          # Environment variable loading + validation
        │   ├── socketConfig.ts # All WebSocket event name constants
        │   ├── gameConfig.ts   # Game modes, board layout, PRNG seed offsets, card distributions
        │   ├── roomConfig.ts   # Room capacity, TTLs, code generation
        │   ├── errorCodes.ts   # All error code constants (SCREAMING_SNAKE_CASE)
        │   ├── securityConfig.ts # Auth, session, rate limit defaults
        │   ├── rateLimits.ts   # Per-event rate limit configurations
        │   ├── redis.ts        # Redis client setup + embedded Redis management
        │   ├── memoryMode.ts   # Memory-mode detection and configuration
        │   ├── jwt.ts          # JWT signing/verification config
        │   └── swagger.ts      # OpenAPI/Swagger spec
        ├── errors/             # Error class hierarchy
        │   └── GameError.ts    # GameError base + RoomError, PlayerError, GameStateError, ValidationError, RateLimitError, ServerError
        ├── middleware/          # Express + socket middleware
        │   ├── errorHandler.ts # Express error handler (detail allowlist, Zod scrubbing)
        │   ├── rateLimit.ts    # HTTP rate limiting (express-rate-limit)
        │   ├── socketAuth.ts   # Socket.io auth orchestrator
        │   ├── csrf.ts         # CSRF protection middleware
        │   ├── timing.ts       # Request timing middleware
        │   ├── validation.ts   # Request validation middleware
        │   └── auth/           # Auth sub-modules
        │       ├── jwtHandler.ts # JWT token generation + validation
        │       ├── clientIP.ts # Client IP extraction (proxy-aware)
        │       ├── originValidator.ts # Origin/referer validation
        │       └── sessionValidator.ts # Session age + integrity checks
        ├── routes/             # REST API routes
        │   ├── index.ts        # Route registration barrel
        │   ├── healthRoutes.ts # /health, /health/ready, /health/live, /health/metrics, /health/metrics/prometheus
        │   ├── roomRoutes.ts   # Room CRUD API
        │   ├── replayRoutes.ts # /api/replays/:roomCode/:gameId
        │   ├── adminRoutes.ts  # Admin API (password-protected)
        │   └── admin/          # Admin sub-routes (audit, rooms, stats)
        ├── services/           # Business logic layer (all game state mutations)
        │   ├── gameService.ts  # Core game logic, Mulberry32 PRNG, delegates to game/
        │   ├── roomService.ts  # Room create/join/leave/settings lifecycle
        │   ├── playerService.ts # Player CRUD barrel — re-exports from player/ sub-modules
        │   ├── timerService.ts # Turn timers (Redis-tracked state; expiry runs on an in-process timer — single-instance only, see docs/HARDENING_PLAN.md P2-2)
        │   ├── gameHistoryService.ts # Game history barrel — re-exports from gameHistory/
        │   ├── auditService.ts # Security audit logging (ring buffer)
        │   ├── botService.ts   # Bot lifecycle: addBot/removeBot/getBotConfig (bots are first-class room players)
        │   ├── game/           # Game sub-modules
        │   │   ├── boardGenerator.ts # Board generation + card distribution
        │   │   ├── revealEngine.ts   # Card reveal logic + win detection
        │   │   └── luaGameOps.ts     # Lua script wrappers for atomic game ops
        │   ├── gameHistory/    # Game history sub-modules
        │   │   ├── types.ts        # All type/interface definitions
        │   │   ├── validation.ts   # Data validation and clue counting
        │   │   ├── storage.ts      # Redis CRUD operations (save, get, cleanup)
        │   │   ├── replayEngine.ts # Replay event construction
        │   │   └── index.ts        # Barrel export
        │   ├── player/         # Player sub-modules
        │   │   ├── cleanup.ts  # Disconnection handling + scheduled cleanup
        │   │   ├── mutations.ts # setTeam, setRole, setNickname
        │   │   ├── queries.ts  # getPlayersInRoom, getTeamMembers, role rotation
        │   │   ├── reconnection.ts # Token generation/validation/invalidation
        │   │   ├── publicId.ts # Derived opaque playerId (sha256 prefix of sessionId) for peer-facing payloads (N1)
        │   │   ├── sessionAuth.ts # Per-session sessionToken secret for handshake session adoption (N1)
        │   │   ├── schemas.ts  # Player data schemas for Redis
        │   │   └── stats.ts    # Room stats, spectator info
        │   └── room/
        │       └── membership.ts # Room join/leave/capacity logic
        ├── socket/             # WebSocket setup + utilities
        │   ├── index.ts        # Socket.io server setup + handler registration
        │   ├── contextHandler.ts # Handler factory: validation → rate limit → context → execute
        │   ├── connectionHandler.ts # Connection lifecycle (connect)
        │   ├── disconnectHandler.ts # Disconnection handling
        │   ├── connectionTracker.ts # Per-IP connection tracking + limits
        │   ├── playerContext.ts # Session state resolution
        │   ├── safeEmit.ts     # Wrapped Socket.io emissions with error handling + metrics
        │   ├── gameMutationNotifier.ts # Event emitter for game state changes
        │   ├── rateLimitHandler.ts # Socket-level rate limiting
        │   ├── serverConfig.ts # Socket.io server configuration
        │   ├── socketFunctionProvider.ts # Socket function dependency injection
        │   └── handlers/       # Event-specific handlers (barrel files + sub-modules)
        │       ├── gameHandlers.ts    # game:start, game:reveal, game:clue, game:endTurn, game:forfeit, etc.
        │       ├── gameActions.ts     # Shared applyClue/applyReveal/applyEndTurn used by both socket handlers and the bot controller
        │       ├── gameHandlerUtils.ts # Shared game handler utilities (toHistoryEntry mapper, match finalization)
        │       ├── botHandlers.ts     # bot:add, bot:remove (host-only bot management)
        │       ├── roomHandlers.ts    # room: events barrel — delegates to roomHandlers/
        │       ├── roomHandlerUtils.ts # Shared room handler utilities
        │       ├── roomHandlers/      # Room handler sub-modules
        │       │   ├── roomMembershipHandlers.ts  # room:create, room:join, room:leave
        │       │   ├── roomReconnectionHandlers.ts # room:reconnect, room:getReconnectionToken
        │       │   ├── roomSettingsHandlers.ts     # room:settings
        │       │   └── roomSyncHandlers.ts         # room:resync
        │       ├── playerHandlers.ts  # player: events barrel — delegates to playerHandlers/
        │       ├── playerHandlers/    # Player handler sub-modules
        │       │   ├── playerAttributeHandlers.ts  # player:setNickname
        │       │   ├── playerModerationHandlers.ts # player:kick
        │       │   ├── playerRoleHandlers.ts       # player:setTeam, player:setRole, player:setTeamRole
        │       │   └── spectatorHandlers.ts        # spectator:requestJoin, spectator:approveJoin
        │       ├── playerRoomSync.ts  # Room sync after player state changes
        │       ├── timerHandlers.ts   # timer:pause, timer:resume, timer:stop, timer:addTime (timer start is server-initiated)
        │       ├── chatHandlers.ts    # chat:message, chat:spectator
        │       └── types.ts           # Handler type definitions
        ├── frontend/           # Frontend TypeScript source (65 modules, compiled via esbuild)
        │   ├── app.ts          # Frontend entry point + event delegation
        │   ├── setupScreen.ts  # Setup screen (Host/Join/Local quickstart cards)
        │   ├── botsUI.ts       # Host bot-management panel (add/remove bots)
        │   ├── state.ts        # Reactive state proxy (wraps _rawState with Proxy)
        │   ├── stateTypes.ts   # State type definitions
        │   ├── board.ts        # Board rendering + card interaction
        │   ├── game.ts         # Game logic barrel (re-exports from game/ sub-modules)
        │   ├── roles.ts        # Role selection UI (spymaster, clicker, team)
        │   ├── ui.ts           # Toast, modal, screen reader announcements
        │   ├── settings.ts     # Settings panel logic
        │   ├── history.ts      # Game history barrel — delegates to history-replay.ts
        │   ├── history-replay.ts # Replay UI (step controls, event rendering)
        │   ├── recap.ts        # Post-game recap modal (word-list provenance, per-team stats)
        │   ├── spectatorJoin.ts # Spectator join-request flow UI (request/approve/deny)
        │   ├── wordListLibrary.ts # localStorage library of named custom word lists (A1)
        │   ├── clueUI.ts       # Clue input/display UI
        │   ├── gameLog.ts      # In-game event log UI
        │   ├── chat.ts         # Chat UI
        │   ├── timer.ts        # Turn timer UI
        │   ├── i18n.ts         # Internationalization
        │   ├── notifications.ts # Audio + tab notifications
        │   ├── url-state.ts    # URL encoding/decoding for standalone mode
        │   ├── utils.ts        # Clipboard, seeded RNG, DOM utilities
        │   ├── constants.ts    # Frontend constants (UI timing, selectors)
        │   ├── debug.ts        # Debug logging + state watchers
        │   ├── logger.ts       # Frontend logging utility
        │   ├── globals.d.ts    # Frontend global type declarations
        │   ├── accessibility.ts # Keyboard navigation, ARIA, skip links
        │   ├── multiplayer.ts  # Multiplayer orchestration barrel
        │   ├── multiplayerListeners.ts # Event listener registration
        │   ├── multiplayerSync.ts # Server state synchronization
        │   ├── multiplayerUI.ts # Multiplayer UI barrel — delegates to multiplayerUI-* sub-modules
        │   ├── multiplayerUI-player.ts # Player list, nickname edit, kick UI
        │   ├── multiplayerUI-settings.ts # Room settings, forfeit, game mode sync
        │   ├── multiplayerUI-status.ts # Duet UI, spectator count, reconnection overlay
        │   ├── multiplayerTypes.ts # Multiplayer type definitions
        │   ├── clientAccessor.ts # Socket client accessor
        │   ├── stateMutations.ts # Type-safe state mutation helpers
        │   ├── socket-client.ts # WebSocket client wrapper
        │   ├── socket-client-connection.ts # Socket connection management
        │   ├── socket-client-events.ts # Socket event handling
        │   ├── socket-client-rooms.ts # Socket room operations
        │   ├── socket-client-storage.ts # Socket state persistence
        │   ├── socket-client-types.ts # Socket client type definitions
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
        │   ├── index.ts        # Barrel export
        │   ├── gameRules.ts    # Game mode rules, board sizes, card counts
        │   └── validation.ts   # Shared validation utilities
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
        ├── utils/              # Utility modules (14 files)
        │   ├── distributedLock.ts # Redis-based distributed locking (NX + EX pattern)
        │   ├── logger.ts       # Structured logging (Winston)
        │   ├── metrics.ts      # Application metrics collection
        │   ├── parseJSON.ts    # Safe JSON parsing for Redis data
        │   ├── retryAsync.ts   # Async retry with exponential backoff
        │   └── ...             # sanitize, timeout, correlationId, etc.
        ├── validators/         # Zod validation schemas (8 files)
        │   ├── schemas.ts      # Barrel export
        │   ├── schemaHelpers.ts # Base schemas, sanitization (removeControlChars)
        │   ├── roomSchemas.ts  # roomCreateSchema, roomJoinSchema, roomSettingsSchema, roomReconnectSchema
        │   ├── playerSchemas.ts # playerTeamSchema, playerRoleSchema, playerNicknameSchema, playerKickSchema
        │   ├── gameSchemas.ts  # gameStartSchema, gameRevealSchema (index 0-24), gameClueSchema, gameHistoryLimitSchema
        │   ├── chatSchemas.ts  # chatMessageSchema (1-500 chars), spectatorChatSchema
        │   ├── botSchemas.ts   # botAddSchema, botRemoveSchema, botConfigSchema
        │   └── timerSchemas.ts # timerAddTimeSchema (10-300 seconds)
        ├── scripts/            # Redis Lua scripts (30 atomic operations)
        │   ├── index.ts        # Barrel export with documented KEYS/ARGV/Returns headers
        │   └── atomicRateLimit.lua # Extracted rate-limit Lua script
        └── __tests__/          # Jest tests (129 backend + 62 frontend suites)
            ├── helpers/        # Test utilities + mock factories (mocks.ts ~792 lines)
            ├── integration/    # Integration tests
            └── frontend/       # Frontend unit tests
```

## Architecture

### Data Flow

```
Client event → Socket.io → rate limiter → Zod validation → context handler → service → Redis (Lua) → broadcast via safeEmit
```

### Context Handler Pipeline

The `socket/contextHandler.ts` factory creates handler pipelines with these stages:

1. **Rate Limiting** — Per-event, per-IP counters (in-memory per process today, except session validation which is Redis-backed — see docs/HARDENING_PLAN.md P2-1)
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
├── RoomError — .notFound(), .full(), .gameInProgress(), .spectatorsNotAllowed()
├── PlayerError — .notHost(), .notSpymaster(), .notClicker(), .notYourTurn(), .notAuthorized(), .notFound()
├── GameStateError — .cardAlreadyRevealed(), .gameOver(), .noActiveGame(), .corrupted(), .gamePaused(), .noClueGiven()
├── ValidationError — .invalidCardIndex(), .noGuessesRemaining()
├── RateLimitError
└── ServerError — .concurrentModification()
```

### SafeEmit

`socket/safeEmit.ts` wraps all Socket.io emissions:

- `safeEmitToRoom(io, roomCode, event, data, options?)` — Emit to all players in room
- `safeEmitToPlayer(io, sessionId, event, data, options?)` — Emit to specific player
- `safeEmitToPlayers(io, players[], event, dataFn, options?)` — Batch with per-player data
- `safeEmitToGroup(io, target, event, data, options?)` — Emit to arbitrary groups
- `getEmissionMetrics()` / `resetEmissionMetrics()` — Emission tracking utilities
- All catch errors, log failures, track metrics — never throw

### Redis Architecture

**Two tiers:**

- **External Redis** — Full features, multi-instance scaling via pub/sub, data persistence
- **Memory mode** (`REDIS_URL=memory`) — Spawns embedded redis-server, single instance, data lost on restart

**30 Lua scripts** for atomic operations (all in `scripts/`):

| Category         | Scripts                                                                                                                                                                                                                                                        |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Card/Turn        | `REVEAL_CARD_SCRIPT`, `END_TURN_SCRIPT`, `SUBMIT_CLUE_SCRIPT`                                                                                                                                                                                                  |
| Player           | `UPDATE_PLAYER_SCRIPT`, `SAFE_TEAM_SWITCH_SCRIPT`, `SET_ROLE_SCRIPT`                                                                                                                                                                                           |
| Room             | `ATOMIC_CREATE_ROOM_SCRIPT`, `ATOMIC_JOIN_SCRIPT`, `ATOMIC_SET_ROOM_STATUS_SCRIPT`, `ATOMIC_REMOVE_PLAYER_SCRIPT`, `ATOMIC_UPDATE_SETTINGS_SCRIPT`, `HOST_TRANSFER_SCRIPT`                                                                                     |
| TTL              | `ATOMIC_REFRESH_TTL_SCRIPT`, `ATOMIC_PERSIST_GAME_STATE_SCRIPT`                                                                                                                                                                                                |
| Player lifecycle | `ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT`, `ATOMIC_SET_SOCKET_MAPPING_SCRIPT`, `ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT`, `ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT`, `INVALIDATE_TOKEN_SCRIPT`, `CLEANUP_ORPHANED_TOKEN_SCRIPT`, `SAFE_CLEANUP_ORPHANS_SCRIPT` |
| Timer            | `ATOMIC_ADD_TIME_SCRIPT`, `ATOMIC_TIMER_STATUS_SCRIPT`, `ATOMIC_PAUSE_TIMER_SCRIPT`, `ATOMIC_RESUME_TIMER_SCRIPT`, `ATOMIC_EXPIRE_TIMER_SCRIPT`                                                                                                                |
| History          | `ATOMIC_SAVE_GAME_HISTORY_SCRIPT`                                                                                                                                                                                                                              |
| Rate Limiting    | `ATOMIC_RATE_LIMIT_SCRIPT`                                                                                                                                                                                                                                     |
| Locking          | `RELEASE_LOCK_SCRIPT`, `EXTEND_LOCK_SCRIPT`                                                                                                                                                                                                                    |

Each script has a documented `KEYS[]`, `ARGV[]`, and `Returns` header in the source.

### Distributed Locks

`utils/distributedLock.ts` — Redis NX + EX pattern for mutual exclusion:

| Lock               | Key Pattern                         | TTL | Purpose                                       |
| ------------------ | ----------------------------------- | --- | --------------------------------------------- |
| Game creation      | `lock:game-create:${roomCode}`      | 5s  | Prevent duplicate game creation               |
| Card reveal / turn | `lock:reveal:${roomCode}`           | 5s  | Serialize reveals, end turn, forfeit, abandon |
| Timer start        | `lock:timer:${roomCode}`            | 5s  | Prevent duplicate timer starts                |
| Player mutation    | `lock:player-mutation:${sessionId}` | 5s  | Serialize team/role changes per player        |
| Timer expiry       | `lock:timer-expire:${roomCode}`     | 5s  | Prevent duplicate timer expiry handling       |
| Timer restart      | `lock:timer-restart:${roomCode}`    | 5s  | Prevent duplicate timer restarts on reconnect |
| Host transfer      | `lock:host-transfer:${roomCode}`    | 5s  | Atomic host changes on disconnect             |

### Game Modes

Configured in `config/gameConfig.ts`, rules shared via `shared/gameRules.ts`:

| Mode      | Label      | Type        | Description                                                         |
| --------- | ---------- | ----------- | ------------------------------------------------------------------- |
| `classic` | Vintage    | Competitive | Standard two-team wordgame                                          |
| `duet`    | Duet       | Cooperative | 2-player co-op with special board config (15 unique greens to find) |
| `match`   | Eigennamen | Competitive | Multi-round scoring with bonus system (target score, win margin)    |

### Frontend Architecture

- **No framework** — Vanilla TypeScript compiled via esbuild
- **Reactive state** — `store/reactiveProxy.ts` wraps state with `Proxy` for automatic change detection
- **Event bus** — `store/eventBus.ts` pub/sub with max 50 listeners per topic
- **Typed actions** — `store/actions/` for game, player, multiplayer, UI, settings, timer, replay
- **Selectors** — `store/selectors.ts` for derived state
- **Batch updates** — `store/batch.ts` to group multiple state changes
- **DOM manipulation** — Direct DOM via `document.getElementById()`, `el.hidden`, `el.textContent`
- **No innerHTML for user content** — Use `textContent` or `createElement()`

## Socket Events

All event names defined in `config/socketConfig.ts`. Format: `domain:action` (client→server) or `domain:pastTense` (server→client).

### Room Events

| Client → Server             | Server → Client                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `room:create`               | `room:created`                                                                       |
| `room:join`                 | `room:joined`, `room:playerJoined`                                                   |
| `room:leave`                | `room:left`, `room:playerLeft`                                                       |
| `room:settings`             | `room:settingsUpdated`                                                               |
| `room:resync`               | `room:resynced`                                                                      |
| `room:getReconnectionToken` | `room:reconnectionToken`                                                             |
| `room:reconnect`            | `room:reconnected`, `room:playerReconnected`                                         |
|                             | `room:kicked`, `room:statsUpdated`, `room:hostChanged`, `room:warning`, `room:error` |

### Game Events

| Client → Server          | Server → Client                                        |
| ------------------------ | ------------------------------------------------------ |
| `game:start`             | `game:started`                                         |
| `game:reveal`            | `game:cardRevealed`                                    |
| `game:clue`              | `game:clueGiven`                                       |
| `game:endTurn`           | `game:turnEnded`                                       |
| `game:forfeit`           | `game:over`                                            |
| `game:abandon`           | `game:spymasterView`                                   |
| `game:nextRound`         | `game:roundEnded`, `game:matchOver`                    |
| `game:getHistory`        | `game:historyResult`                                   |
| `game:getReplay`         | `game:replayData`                                      |
| `game:clearHistory`      | `game:historyCleared`                                  |
| `game:readyCheck` (host) | `game:readyStatus`                                     |
| `game:ready`             | `game:readyStatus`                                     |
| `game:pause`             | `game:paused`                                          |
| `game:resume`            | `game:resumed`                                         |
|                          | `game:readyStatus`, `game:botSuggestion`, `game:error` |

`game:botSuggestion` is emitted by an advisor bot: ranked guess suggestions
(`{index, confidence, reason}`) for the current clue that the human clicker may
act on. Advisory only — it never reveals.

### Bot Events

| Client → Server                                    | Server → Client                                  |
| -------------------------------------------------- | ------------------------------------------------ |
| `bot:add` (host; seat = spymaster/clicker/advisor) | (room/player broadcasts; `bot:error` on failure) |
| `bot:remove` (host)                                | (room/player broadcasts; `bot:error` on failure) |

### Player Events

| Client → Server      | Server → Client       |
| -------------------- | --------------------- |
| `player:setTeam`     | `player:updated`      |
| `player:setRole`     | `player:kicked`       |
| `player:setTeamRole` | `player:disconnected` |
| `player:setNickname` | `player:error`        |
| `player:kick`        |                       |

### Timer Events

The turn timer is **server-initiated**: the server starts it internally (on game
start / turn change) and announces it via `timer:started` — there is no client
`timer:start` event. The client counts down locally, so there is no per-second
`timer:tick` broadcast either; `timer:expired` fires once when the turn's time is up.

| Client → Server | Server → Client                                                 |
| --------------- | --------------------------------------------------------------- |
| `timer:pause`   | `timer:paused`                                                  |
| `timer:resume`  | `timer:resumed`                                                 |
| `timer:stop`    | `timer:stopped`                                                 |
| `timer:addTime` | `timer:timeAdded`                                               |
|                 | `timer:started`, `timer:expired`, `timer:status`, `timer:error` |

### Chat & Spectator Events

| Client → Server         | Server → Client                                  |
| ----------------------- | ------------------------------------------------ |
| `chat:message`          | `chat:error`                                     |
| `chat:spectator`        | `chat:spectatorMessage`                          |
| `spectator:requestJoin` | `spectator:joinRequest`                          |
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

| Scenario                     | Pattern                        | Example                                         |
| ---------------------------- | ------------------------------ | ----------------------------------------------- |
| Business logic violation     | **Throw** `GameError` subclass | `throw RoomError.notFound(code)`                |
| Invalid input                | **Throw** `ValidationError`    | `throw ValidationError.invalidCardIndex(index)` |
| Data integrity failure       | **Throw** (never swallow)      | Pipeline partial failure, corrupted data        |
| Optional resource not found  | **Return null**                | `getRoom()` returning `null` for missing key    |
| Non-critical background task | **Log and continue**           | Audit logging, metrics, TTL refresh             |

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
- **No innerHTML for user content**: Use `textContent` or `createElement()`
- **JWT**: Minimum 32-character secret enforced in production
- **Session limits**: 8-hour max lifetime, IP consistency checks
- **Rate limiting**: Per-event + per-IP; HTTP via express-rate-limit, WebSocket via in-memory per-process counters today (session validation alone is Redis-backed) — making the WebSocket path Redis-backed across instances is tracked in docs/HARDENING_PLAN.md P2-1
- **Error detail stripping**: Internal fields never exposed to clients
- **GitHub Actions**: All pinned to immutable commit SHAs

### Robustness Practices

Invariants the code maintains — keep them true when touching the listed areas.

**Locks & concurrency**

- `withLock()` enforces an operation timeout 500ms shorter than the lock TTL; size every new `lockTimeout` to exceed the slowest realistic inner operation (HARDENING P0-3)
- Disconnect and reconnect serialize through the `player-mutation:<sessionId>` lock, and `handleDisconnect` no-ops when a newer socket already owns the session — a zombie socket's late disconnect can't mark a reconnected player disconnected or transfer host away from them
- `addBot` runs its seat-occupancy check and join under a per-room `bot-manage:` lock so simultaneous `bot:add` calls can't double-seat the same team+role
- The deferred room-sync path (`playerRoomSync` / `playerContext.updateSocketRooms`) guards `socket.join()`/`socket.leave()` on `socket.connected`, so a socket that disconnected mid-handler is not re-added to rooms
- `notifyGameMutation` runs each listener in its own try/catch — it fires synchronously inside game write paths, so a throwing listener must not abort the others or poison the committed mutation

**Redis / Lua contracts**

- Nullable fields in a Lua script's JSON _result_ are OMITTED, never encoded as JSON null: Upstash's Lua emulation (Fly.io managed Redis) drops null-valued object fields where real Redis's cjson emits null, which once made `revealResultSchema` reject every committed mid-game reveal. The TS schema maps absence back to null (`luaGameOps.ts`). Follow this contract for any new nullable Lua result field
- All `tonumber(ARGV[])` calls carry fallback defaults; `hostTransfer.lua` falls back to 24h TTL when a room key has no expiry
- `revealCard.lua`, `endTurn.lua`, and `submitClue.lua` reject mutations on a paused game atomically (`GAME_PAUSED`), independent of the handler's cached-state check; `pauseGame`/`resumeGame` emit `notifyGameMutation` so bots and clients react
- Game-state array mismatches (types vs revealed) throw `GameStateError.corrupted()` — never silently propagate truncated data
- The Redis-read `playerSchema` role enum MUST stay in sync with `setRole.lua`, `validators/playerSchemas.ts`, and the `Role` type (all five roles) — a missing role makes `getPlayer()` delete those records as corrupted; `safeTeamSwitch.lua` demotes all team-bound roles on a team switch
- `buildGameState` stamps `gameMode` for every mode (including `'classic'`) and `getGameStateForPlayer` always emits it, so the client never infers the mode
- Match mode: the resolved word pool persists on the game as `wordPool` and `startNextRound` draws each round's board from it (no 25-word reshuffle); the alternated starting team is forced into `generateBoardLayout` (`forceFirstTeam`) so the 9/8 counts stay consistent with `firstTeam`

**Timers**

- The expiry callback passes the observed `currentTurn` as the expected-team guard to `endTurn`, so a stale expiry that races a reveal/endTurn no-ops instead of double-flipping
- Expiry is compare-and-delete (Redis-authoritative): each armed timeout is stamped with its `endTime`, and `atomicExpireTimer.lua` signals `EXPIRED` only when the stored timer still matches and isn't paused — a stale timeout that fires after `addTime`/pause/restart can't delete a freshly-extended timer (A11)

**Identity & roles**

- Peer identity is opaque (N1): peers see only the derived 16-hex `playerId` (`player/publicId.ts`); `toPublicPlayer` strips `sessionId`/`lastIP`/`userId` from every peer-facing payload; adopting a session at the socket handshake additionally requires the per-session `sessionToken` secret (`player/sessionAuth.ts`) delivered only to that client; peer-targeting payloads (`player:kick`, `bot:remove`, `spectator:approveJoin`) carry `playerId`, resolved via `findPlayerByPublicId`
- Anyone who has seen the unmasked board is locked out of role changes while a game is live: spymasters out of every change (P0-1), observers out of every change including stepping down to spectator (that reopened an observer → spectator → clicker laundering path). Free again at game over (`canChangeTeamOrRole`)
- `game:reveal` requires an active clue — enforced in both `revealCard.lua` and the handler, distinct from the `guessesAllowed=0`-means-unlimited sentinel (P0-2)
- Host transfer prefers humans; a bot may hold host only as a placeholder so the room survives the last human's reconnect window, and `ensureRoomHasHost` (run on reconnect, resync, and join) displaces it as soon as any human is connected again — clearing the stale `isHost` flag and broadcasting `room:hostChanged` (reason `hostRepaired`)

**Bot driver** (gameplay contracts live in [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md) §11.2)

- `botController` coalesces mutations that arrive mid-tick (`pending` → re-tick) so a notification landing between a tick's final state read and its exit isn't dropped (a dropped one stalls the bot); it re-verifies the seat after the "thinking" pause so a removed/kicked bot can't land one last move
- A lost/corrupt bot config degrades to a default `intermediate` config with a warning instead of freezing the game behind a never-advancing turn indicator (B4); unknown presets and strategies resolve to working fallbacks
- `leaveRoom` tears the room down when no humans remain — bots never disconnect, so a bots-only room would otherwise linger until TTL

**Frontend & I/O hygiene**

- Connection counts decrement on ALL disconnect paths (auth failure, registration failure, shutdown rejection) to prevent IP counter leaks
- Chat DOM is capped at 500 messages; keyboard shortcuts are suppressed in `contenteditable` (plus INPUT/TEXTAREA/SELECT); listener setup functions use guard flags so repeated calls don't accumulate listeners; a `renderBoard()` call during an in-progress render queues a forced full rebuild instead of silently skipping
- Rate-limit errors carry `recoverable`/`retryable` like every other error path; all user input is NFKC-normalized via `removeControlChars()`; logs truncate sessionIds to 8 chars and fully mask tokens, JWTs, secrets, and passwords

**Word lists**

- Multiplayer custom lists: `buildStartGameOptions()` forwards the host's active Settings-menu list on every `game:start` whenever `state.wordSource !== 'default'`; the client parser cap and the `game:start` Zod max both read `MAX_CUSTOM_WORD_LIST_SIZE` so the bounds can't drift apart
- Word-list library (A1): a client-side localStorage library (`frontend/wordListLibrary.ts`) — the app has no accounts and standalone mode is first-class, so it lives in the browser. A saved list's `wordListId`/`wordListName` travel as PROVENANCE (recorded on game/history, shown in the recap) — NOT a server-side selector; the words still travel in `wordList`. Per-list semantic-map selection by id is a documented future enhancement (`npm run bots:map --list-id`)

## Known Issues (Tracked)

Three codebase-wide review passes (all July 2026) produced three additive, non-overlapping remediation ledgers. **Each item's status marker in its ledger is the source of truth** — check it before assuming anything is open or fixed, and update it in the same PR that closes the item.

- **[docs/HARDENING_PLAN.md](docs/HARDENING_PLAN.md)** — first review: game-integrity exploits, concurrency races, scaling-readiness gaps. Phases 0 and 1 (18 items) have shipped with regression tests; Phase 2 (multi-instance readiness) is planning-only.
- **[docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md)** — second review (70 items): broken user-facing flows, deploy/ops correctness, a11y/i18n, test/CI signal, half-built features. Most items have shipped (headers marked **FIXED** with resolution notes); still open: B8, B15, C7, C9, D5, D7, E1, plus the partially-done B5/E2/E4.
- **[docs/CODEBASE_REVIEW_PLAN.md](docs/CODEBASE_REVIEW_PLAN.md)** — third pass (N1–N37): session-identity/authz weaknesses, a match-round finalization race, host-transfer lockout, history/replay data integrity, bot-driver races, CI/type-check signal gaps, plus a ledger reconciliation (applied). All tranches have shipped except N27 (type-checking the test suites), which is **PARTIAL** — the `typecheck:test` mechanism exists but a ~3000-error pre-existing backlog must clear before it can gate.

Known scaling-readiness gap (HARDENING Phase 2, not started): several pieces of per-room/per-IP coordination state (socket-level rate limiting, the bot controller's in-flight guard, turn-timer pause/resume/stop) live in a plain in-process `Map`, not Redis — correct only for a single instance. Fine for the current deployment (`fly.toml` deliberately keeps exactly one machine), but it must be closed before running more than one instance behind a load balancer.

## Key Services

| Service              | File                             | Purpose                                                                                                              |
| -------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `gameService`        | `services/gameService.ts`        | Core game logic, Mulberry32 PRNG, delegates to `game/` sub-modules                                                   |
| `roomService`        | `services/roomService.ts`        | Room create/join/leave/settings lifecycle                                                                            |
| `playerService`      | `services/playerService.ts`      | Player CRUD barrel (delegates to `player/` sub-modules)                                                              |
| `timerService`       | `services/timerService.ts`       | Turn timers — Redis-tracked state, in-process expiry timer (single-instance only, see docs/HARDENING_PLAN.md P2-2)   |
| `gameHistoryService` | `services/gameHistoryService.ts` | Game history barrel — delegates to `gameHistory/` sub-modules (types, validation, storage, replayEngine)             |
| `auditService`       | `services/auditService.ts`       | Security audit logging (in-memory ring buffer, MAX_LOGS_PER_CATEGORY=10000)                                          |
| `botService`         | `services/botService.ts`         | Bot lifecycle — addBot/removeBot/getBotConfig (bots are first-class Redis players driven by `bots/botController.ts`) |

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

- **Backend unit/integration**: Jest, 129 suites in `server/src/__tests__/`
- **Frontend unit**: Jest with jsdom, 62 suites in `server/src/__tests__/frontend/`
- **E2E**: Playwright, 16 specs in `server/e2e/`
- **Load testing**: Custom scripts in `server/loadtest/`

### Configuration (jest.config.ts.js)

Two separate Jest projects:

| Project    | Environment | Coverage Thresholds                                    |
| ---------- | ----------- | ------------------------------------------------------ |
| `backend`  | Node        | Statements 80%, Branches 75%, Functions 85%, Lines 80% |
| `frontend` | jsdom       | Statements 70%, Branches 70%, Functions 70%, Lines 70% |

Module aliases: `@/`, `@config/`, `@services/`, `@errors/`, `@utils/`, `@middleware/`, `@routes/`, `@socket/`, `@validators/`, `@types/`, `@shared/`

### Test Patterns

- Shared mocks in `__tests__/helpers/mocks.ts` (~792 lines)
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

| Workflow      | Trigger          | What It Does                                            |
| ------------- | ---------------- | ------------------------------------------------------- |
| `ci.yml`      | Push/PR          | Lint → typecheck → test (backend + frontend) → E2E      |
| `codeql.yml`  | Push/PR/schedule | Code security scanning                                  |
| `deploy.yml`  | Push to main     | Production deployment to Fly.io                         |
| `release.yml` | Manual dispatch  | Version bump + GitHub release with auto-generated notes |

All GitHub Actions are SHA-pinned to immutable commit hashes. Workflow permissions are scoped to minimum required.

## Environment Variables

Key env vars (see `server/.env.example` for full list):

| Variable                        | Purpose                                                   | Default                                                         |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------- |
| `REDIS_URL`                     | Redis connection (`redis://...`) or `memory` for embedded | `redis://localhost:6379` (must be set explicitly in production) |
| `JWT_SECRET`                    | JWT signing key (min 32 chars in prod)                    | Required in production (warn-only placeholder in dev)           |
| `ADMIN_PASSWORD`                | Admin dashboard authentication                            | Optional (warned if missing)                                    |
| `NODE_ENV`                      | Environment (`development`/`production`)                  | `development`                                                   |
| `PORT`                          | Server port                                               | `3000`                                                          |
| `LOG_LEVEL`                     | Logging verbosity                                         | `info`                                                          |
| `CORS_ORIGIN`                   | Allowed CORS origins (wildcard blocked in prod)           | `*`                                                             |
| `TRUST_PROXY`                   | Enable behind reverse proxy (auto on Fly.io)              | `false`                                                         |
| `ALLOW_IP_MISMATCH`             | Allow reconnection from different IP                      | `false`                                                         |
| `RATE_LIMIT_WINDOW_MS`          | HTTP rate limit window                                    | `60000`                                                         |
| `RATE_LIMIT_MAX_REQUESTS`       | HTTP rate limit max requests                              | `100`                                                           |
| `RATE_LIMIT_MAX_ENTRIES`        | Max rate limit tracking entries                           | `10000`                                                         |
| `INSTANCE_ID`                   | Custom instance ID for multi-instance deployments         | Auto-generated                                                  |
| `EMBEDDED_REDIS_TIMEOUT_MS`     | Timeout for embedded Redis startup (min 1000)             | `5000`                                                          |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | Reject unauthorized TLS connections to Redis              | `true`                                                          |

## Health & Monitoring

| Endpoint                     | Purpose                                             |
| ---------------------------- | --------------------------------------------------- |
| `/health`                    | Basic health check (load balancer)                  |
| `/health/ready`              | Full dependency check (Redis, etc.)                 |
| `/health/live`               | Process alive (liveness probe)                      |
| `/health/metrics`            | Application metrics, rate limits, connection counts |
| `/health/metrics/prometheus` | Prometheus-format metrics                           |

## Documentation Index

| Document                                                       | Purpose                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [QUICKSTART.md](QUICKSTART.md)                                 | Getting started + first game walkthrough                                                                                                                                                                                                                     |
| [CONTRIBUTING.md](CONTRIBUTING.md)                             | Full contributor guidelines, code standards, error handling                                                                                                                                                                                                  |
| [CONTRIBUTING_QUICK.md](CONTRIBUTING_QUICK.md)                 | 1-page quick-start contributor guide                                                                                                                                                                                                                         |
| [SECURITY.md](SECURITY.md)                                     | Security policy, threat model, incident response                                                                                                                                                                                                             |
| [docs/ADDING_A_FEATURE.md](docs/ADDING_A_FEATURE.md)           | Worked example: adding `chat:spectator` end-to-end                                                                                                                                                                                                           |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)                   | System architecture + technology choices                                                                                                                                                                                                                     |
| [docs/SERVER_SPEC.md](docs/SERVER_SPEC.md)                     | Full API specification (REST + WebSocket)                                                                                                                                                                                                                    |
| [docs/TESTING_GUIDE.md](docs/TESTING_GUIDE.md)                 | Testing patterns, mocking Redis, coverage                                                                                                                                                                                                                    |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)                       | Production deployment (Docker, Fly.io, Heroku, K8s)                                                                                                                                                                                                          |
| [docs/BACKUP_AND_DR.md](docs/BACKUP_AND_DR.md)                 | Backup strategy + disaster recovery                                                                                                                                                                                                                          |
| [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md) | AI bot design spec (engine, strategies, semantics, harness)                                                                                                                                                                                                  |
| [docs/BOT_EMBEDDINGS.md](docs/BOT_EMBEDDINGS.md)               | Optional word-embedding backend for the semantic bot spymaster                                                                                                                                                                                               |
| [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md)         | Prepared custom word lists: LLM-built semantic maps (`npm run bots:map`) for full-strength bots                                                                                                                                                              |
| [docs/BOT_LLM.md](docs/BOT_LLM.md)                             | Opt-in LLM-backed bots: Claude proposes, the deterministic safety machinery verifies                                                                                                                                                                         |
| [docs/BOT_CLUE_LESSONS.md](docs/BOT_CLUE_LESSONS.md)           | Human-play lessons → prioritized plan for improving bot clue-giving and guessing                                                                                                                                                                             |
| [docs/BOT_NUANCE_PLAN.md](docs/BOT_NUANCE_PLAN.md)             | Build sheet for the lessons ledger: plan items 2.8–2.19 mapped to exact code hooks, phased with metric gates                                                                                                                                                 |
| [docs/SETUP_SCREEN_GUIDE.md](docs/SETUP_SCREEN_GUIDE.md)       | User-facing setup screen walkthrough                                                                                                                                                                                                                         |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md)                 | Windows development setup                                                                                                                                                                                                                                    |
| [docs/HARDENING_PLAN.md](docs/HARDENING_PLAN.md)               | Tracked remediation plan from the July 2026 hardening review — root cause, fix, tests, and sequencing for every open finding                                                                                                                                 |
| [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md)           | Follow-up review plan (70 items) — broken flows, deploy/ops, a11y/i18n, test signal, half-built features; additive to HARDENING_PLAN.md                                                                                                                      |
| [docs/CODEBASE_REVIEW_PLAN.md](docs/CODEBASE_REVIEW_PLAN.md)   | Third review pass (37 items, N1–N37) — session-identity/authz, match-round finalization race, host-transfer lockout, history/replay data-integrity, bot-driver races, CI/type-check signal gaps, plus ledger reconciliation; additive to the two plans above |
| [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md)             | Forward-looking feature proposals (word-list library, post-game recap, Redis-backed bot coordination, multilingual semantic maps) + recorded finish-or-delete disposition for the half-built features (IMPROVEMENT_PLAN Phase F)                             |
