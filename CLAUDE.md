# CLAUDE.md - AI Assistant Guide for Eigennamen Online

Comprehensive reference for Claude Code, Squirmy, and other AI assistants working on this codebase. This is the single source of truth for how the project is structured, how to work in it, and what conventions to follow.

## Project Overview

Web-based multiplayer implementation of the board game "Eigennamen" (GPL v3.0).

- **Standalone mode**: Offline single-page app. Game state is encoded entirely in the URL, so no *backend* is required. The entry document is `server/public/index.html`; it loads its JS/CSS by absolute path (`/js/...`, `/css/...`), so serve the `server/public/` directory statically (e.g. `cd server/public && python -m http.server`) — opening `index.html` straight off the filesystem (`file://`) fails because those absolute paths don't resolve.
- **Multiplayer mode**: Real-time synchronized gameplay via Node.js + Express 5 + Socket.io + Redis. Supports multiple concurrent rooms, reconnection, spectators, game history/replays, AI bot opponents, and an admin dashboard.
- **Three game modes**: Classic (competitive), Duet (2-player cooperative), Match (multi-round competitive scoring)
- **AI bots**: Optional bot players (host-managed via `bot:add`/`bot:remove`) that occupy spymaster/clicker/advisor seats and play through the same game ops as humans. The semantic spymaster *generates* board-specific clues (offline association table, or optional word embeddings for nearest-neighbour candidate generation), plays defensively (avoids arming the opponent), keeps a graded assassin berth, is match-value-aware, and spans a real five-rung difficulty ladder (novice → beginner → intermediate → advanced → expert) via `temperature`/`blunderRate`/`riskAversion` — tuned monotonic against the embeddings tournament. The greedy clicker's noise (temperature/blunder) only ever draws from the *plausible* set (cards scoring ≥ half the best card's clue-fit), so a weak bot loses by MISREADING real candidates, never by a blind pick onto the clue-unrelated assassin — easy bots feel gently beatable, not swingy. That temperature softmax is **scale-invariant and confidence-scaled** (`selectIndexByTemperature`): weights read RELATIVE scores (score/best) and the effective temperature shrinks when the whole field is weak (best below `TEMPERATURE_CONFIDENCE_REF`), because the raw absolute-difference form went near-uniform on the compressed Numberbatch cosine scale — live-play bots picked the assassin ranked BELOW the argmax (gear→HAND) and misfired their own good clues — while a weak field is exactly where a human falls back on their best hunch rather than randomizing harder. On the curated table scale both changes are near-no-ops, preserving the preset tuning. **Guessing is provenance-aware**: every backend reports whether a pair's score is real semantic knowledge or just the lexical bigram floor (`SemanticBackend.hasSignal`), and the clicker/advisor rank with `guessRetrieval` — a lexical-floor score is damped (`LEXICAL_GUESS_DAMP`) so a spelling coincidence (SUNDIAL→INDIA at raw Dice 0.60) never outranks a genuine semantic read; a clue with NO semantic signal against any live card gets one least-bad guess and then banks the turn (and the advisor labels its suggestions spelling-only) instead of confidently chasing lookalikes. The spymaster's danger halos stay on raw retrieval — orthographic confusion is a real hazard for a human guesser, so the damp never weakens the safety margins. The association table also folds English inflections (ANIMALS→ANIMAL, SWIMMING→SWIM) at lookup, so inflected human clues still hit the concepts it knows. When `BOT_EMBEDDINGS_PATH` is unset, a previously downloaded or image-baked vectors file is **auto-detected** at the well-known locations (`src/bots/data/board-vectors.vec`, the Docker bake's `embeddings/vectors.vec`, raw GloVe/fastText downloads) — a one-time `npm run bots:embeddings` upgrades every later `npm run dev`/`npm start`; `BOT_EMBEDDINGS_PATH=off` forces the table. The board bake's optional **wide comprehension tier** (`--wide` / `BOT_WIDE` / Docker `BOT_EMBEDDINGS_WIDE`; enabled in `fly.toml` with the 2 GB VM it needs) appends ~100k rarer-but-attested words after the frequency-graded head so bots UNDERSTAND word-nerd human clues (SIDEREAL→MOON, FUMAROLE→VOLCANO, NECROMANCER→WIZARD) — comprehension-only by construction: the runtime (`vectorBackend.ts` `priorRef`/`COMMONNESS_PRIOR_REF`) excludes beyond-region words from `nearest()` clue candidates and zeroes their commonness credit, so the spymaster's clue vocabulary stays exactly as recognizable as the narrow build's; pair a wide artifact with a raised `BOT_EMBEDDINGS_MAX_WORDS` or the loader truncates the tail at its 50k default. **Personae** (`server/src/bots/personas.ts`) layer *playstyle* on top of difficulty via the style knobs `defenseBias`/`aggression`/`assassinCaution`/`commonnessBias` — e.g. The Strategist (scary-good all-rounder), The Sharpshooter (precise, low-variance), The Guardian (defensive wall), The Daredevil (big numbers, thin margins), The Maverick (creative/off-kilter), The Apprentice (beginner). A persona id is a drop-in for a `skillPreset`. The assassin berth has a hard, persona-independent floor (`ASSASSIN_BERTH_FLOOR`) — style knobs tune the clue number, never the assassin gate — and the scorer penalizes idiosyncratic clues (hot halos, rare words via the backend's optional `commonness()` frequency prior). A clue word whose earlier frame FAILED (bounced or undershot) is never repeated (`burnedClueKeys` filters the candidate pool via the seat memory): re-giving a word the guesser demonstrably couldn't read carries zero new information — the designed recovery is a DIFFERENT word, composing with the clicker's clue-debt boost, which skips same-word frames; a fully-delivered clue may repeat for fresh cards (the classic "more of the same" tactic). Beyond the word itself, the scorer also DISCOUNTS targets an owed (undelivered, unbounced) frame still points at (`REDUNDANCY_WEIGHT`, graded by `guessRetrieval` fit against `INDICATED_FIT_REF` — the same scale the debt boost reads): the clicker keeps previous clues in mind and converts owed cards with later turns’ bonus guesses, so each new clue prefers transmitting NEW information (fresh targets). A preference, not a ban — a decisively better covered-only clue still wins, bounced frames are void, delivered frames leave nothing owed. The spymaster is also turn-economy aware: a clue that safely covers every remaining own card wins the board and may exceed the normal number cap of 4 (up to the server's 9); when the opponent is one card from winning, margins relax (never the assassin gate); and partial clues that strand leftover own cards away from any related partner pay for the future single-card turns they create. The number is a *promise*, so a tail card the guesser won't chase is trimmed off it — but that promise floor is **backend-relative** (`PROMISE_FLOOR` scaled by the board's strongest own pull, clamped so it only ever relaxes and never below a noise guard): a dense vector backend's cosine scale is compressed (under Numberbatch a genuinely-related own pair sits ~0.22, the strongest own card only ~0.33), so a flat absolute floor was trimming ~84% of safe 2-card clues to 1s purely on scale — the Step-4 red-team finding — while the curated table's higher scale keeps the floor pinned at its original value. The spymaster's **guesser-safety margin is sized to its own team clicker's competence**, not to its own caution: the margin is the buffer that keeps an own card ahead of the field so the *guesser* takes it, so a known low-temperature (argmax) bot clicker earns a tight margin (much more coverage — strong self-play ceiling utilization jumps ~0.5→~0.83, expert ladder win-rate 83%→90%) while a noisy bot clicker, or an unknown/human guesser (`guesserTemperature` absent), keeps the full misread-tolerant width. It only ever RELAXES for a known-competent guesser and never tightens for a human, so a bot spymaster's clues stay human-safe (`BotContext.guesserTemperature`, `guesserMarginScale`; the team clicker's temperature is plumbed in by `botController`/the harness). The greedy clicker models "core + stretch" discipline: a relative-cliff stop (bank the turn when the next card is steep-below the last take, absolutely weak, AND blurred into its alternatives) plus an aggression-gated `number+1` bonus guess taken only when the top leftover is tighter than the core. Every caution gate yields to the **late-game pressure override** (`PRESSURE_OPP_REMAINING_MAX`): when the clue's remaining grant covers ALL our unrevealed cards (win in reach — "clue for 2 with 2 words left") or the opponent sits at match point (≤1 card left, so a banked turn's option value is ~zero), the clicker takes the deterministic argmax instead of banking — including the bonus guess with no aggression requirement — because in those states NOT guessing is the play that loses the game (live-play finding). Pressed picks are argmax, never temperature samples (pressure means "take your best read", not "gamble louder"); duet is exempt (no opponent). Bots also speak the **clue-capitalization house rule** (`semantics/properAssociations.ts`): a mixed-case clue ("Alien", "Cinderella", "McDonald's") denotes the specific pop-culture reference (curated proper-noun table, fame-rated so `commonnessBias` gates obscure references), lowercase the common sense, and case matters per letter — an ALL-CAPS clue matching a canonical acronym key ("NASA", "CIA") carries the reference signal while other ALL-CAPS stays legacy-neutral; clue case is preserved end-to-end (the display CSS no longer uppercases clues). **LLM-backed bots (opt-in)**: set `BOT_LLM_MODEL` (+ `ANTHROPIC_API_KEY`) and the controller asks Claude for advice before each decision — the LLM PROPOSES (clue candidates / a guess ranking via `BotContext.llm`), the deterministic machinery VERIFIES (proposals enter `generateClueCandidates`' legality/board-safety choke point and must win the same assassin-berth/margin scoring; guess scores only reorder the fixed board and the discipline layer still applies); every failure/timeout degrades to normal play, so tests and the harness stay deterministic — see docs/BOT_LLM.md. The offline human-association eval (`npm run bots:eval`, ledger 2.7) grades every backend tier against a SWOW/USF-format dataset by rank agreement + board-shaped retrieval. **Custom word lists**: bots degrade to lexical similarity on unprepared lists, but a per-list **semantic map** built offline with `npm run bots:map` (LLM-curated concepts + references, `semantics/mapBackend.ts`, loaded from `BOT_SEMANTIC_MAPS_DIR`) restores full table-quality play — see [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md); v2 maps carry per-edge channels (`weight`/`kind`/`penetration`/`collocation`), and bots rank retrieval by `max(relatedness, collocation)` on both sides of the clue channel, so a compound completion ("engine box") intercepts a promised slot in the spymaster's margins exactly as it does in a human guesser's head. Tune and audit with the clue diagnostics harness (`npm run bots:analyze`), which reports per-persona clue-number distribution, delivery, leak/misfire/assassin rates, lethal-spillover (`dangerNext`), clue-word robustness, guessing over-reach, and flagged strategy gaps. An **advisor** bot suggests ranked guesses to a human clicker without ever acting; an **observer** role watches the unmasked board without participating. See `server/src/bots/` and [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md).
- **Four languages**: English, German, Spanish, French — with localized word lists
- **PWA**: Installable as a Progressive Web App with service worker

## Quick Reference

All commands run from the `server/` directory:

```bash
# Setup
npm install                    # Install dependencies

# Development
npm run dev                    # Start dev server (uses REDIS_URL env, defaults to memory mode)
npm run dev:bots               # Dev server with embedding-backed bots; auto-ensures Redis, fetches model once
npm run redis:up               # Ensure a local Redis (reuse one, else start a managed Docker container)
npm run redis:down             # Stop the managed Redis container
docker compose up -d --build   # Start with Docker (Redis + app)

# Quality gates (all four must pass before submitting a PR)
npm test                       # All tests (backend + frontend, 179 suites)
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
        │   ├── strategies/     # spymasters, clickers, registry, types (SkillParams style knobs), clueSafety (board-safety filter)
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
        ├── frontend/           # Frontend TypeScript source (62 modules, compiled via esbuild)
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
        ├── utils/              # Utility modules (13 files)
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
        └── __tests__/          # Jest tests (122 backend + 57 frontend suites)
            ├── helpers/        # Test utilities + mock factories (mocks.ts ~782 lines)
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
├── RoomError — .notFound(), .full(), .gameInProgress()
├── PlayerError — .notHost(), .notSpymaster(), .notClicker(), .notYourTurn(), .notAuthorized(), .notFound()
├── GameStateError — .cardAlreadyRevealed(), .gameOver(), .noActiveGame(), .corrupted()
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

| Category | Scripts |
|----------|---------|
| Card/Turn | `REVEAL_CARD_SCRIPT`, `END_TURN_SCRIPT`, `SUBMIT_CLUE_SCRIPT` |
| Player | `UPDATE_PLAYER_SCRIPT`, `SAFE_TEAM_SWITCH_SCRIPT`, `SET_ROLE_SCRIPT` |
| Room | `ATOMIC_CREATE_ROOM_SCRIPT`, `ATOMIC_JOIN_SCRIPT`, `ATOMIC_SET_ROOM_STATUS_SCRIPT`, `ATOMIC_REMOVE_PLAYER_SCRIPT`, `ATOMIC_UPDATE_SETTINGS_SCRIPT`, `HOST_TRANSFER_SCRIPT` |
| TTL | `ATOMIC_REFRESH_TTL_SCRIPT`, `ATOMIC_PERSIST_GAME_STATE_SCRIPT` |
| Player lifecycle | `ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT`, `ATOMIC_SET_SOCKET_MAPPING_SCRIPT`, `ATOMIC_VALIDATE_RECONNECT_TOKEN_SCRIPT`, `ATOMIC_GENERATE_RECONNECT_TOKEN_SCRIPT`, `INVALIDATE_TOKEN_SCRIPT`, `CLEANUP_ORPHANED_TOKEN_SCRIPT`, `SAFE_CLEANUP_ORPHANS_SCRIPT` |
| Timer | `ATOMIC_ADD_TIME_SCRIPT`, `ATOMIC_TIMER_STATUS_SCRIPT`, `ATOMIC_PAUSE_TIMER_SCRIPT`, `ATOMIC_RESUME_TIMER_SCRIPT`, `ATOMIC_EXPIRE_TIMER_SCRIPT` |
| History | `ATOMIC_SAVE_GAME_HISTORY_SCRIPT` |
| Rate Limiting | `ATOMIC_RATE_LIMIT_SCRIPT` |
| Locking | `RELEASE_LOCK_SCRIPT`, `EXTEND_LOCK_SCRIPT` |

Each script has a documented `KEYS[]`, `ARGV[]`, and `Returns` header in the source.

### Distributed Locks

`utils/distributedLock.ts` — Redis NX + EX pattern for mutual exclusion:

| Lock | Key Pattern | TTL | Purpose |
|------|-------------|-----|---------|
| Game creation | `lock:game-create:${roomCode}` | 5s | Prevent duplicate game creation |
| Card reveal / turn | `lock:reveal:${roomCode}` | 5s | Serialize reveals, end turn, forfeit, abandon |
| Timer start | `lock:timer:${roomCode}` | 5s | Prevent duplicate timer starts |
| Player mutation | `lock:player-mutation:${sessionId}` | 5s | Serialize team/role changes per player |
| Timer expiry | `lock:timer-expire:${roomCode}` | 5s | Prevent duplicate timer expiry handling |
| Timer restart | `lock:timer-restart:${roomCode}` | 5s | Prevent duplicate timer restarts on reconnect |
| Host transfer | `lock:host-transfer:${roomCode}` | 5s | Atomic host changes on disconnect |

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
- **No innerHTML for user content** — Use `textContent` or `createElement()`

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
| `game:clue` | `game:clueGiven` |
| `game:endTurn` | `game:turnEnded` |
| `game:forfeit` | `game:over` |
| `game:abandon` | `game:spymasterView` |
| `game:nextRound` | `game:roundEnded`, `game:matchOver` |
| `game:getHistory` | `game:historyResult` |
| `game:getReplay` | `game:replayData` |
| `game:clearHistory` | `game:historyCleared` |
| `game:readyCheck` (host) | `game:readyStatus` |
| `game:ready` | `game:readyStatus` |
| `game:pause` | `game:paused` |
| `game:resume` | `game:resumed` |
| | `game:readyStatus`, `game:botSuggestion`, `game:error` |

`game:botSuggestion` is emitted by an advisor bot: ranked guess suggestions
(`{index, confidence, reason}`) for the current clue that the human clicker may
act on. Advisory only — it never reveals.

### Bot Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `bot:add` (host; seat = spymaster/clicker/advisor) | (room/player broadcasts; `bot:error` on failure) |
| `bot:remove` (host) | (room/player broadcasts; `bot:error` on failure) |

### Player Events
| Client → Server | Server → Client |
|-----------------|-----------------|
| `player:setTeam` | `player:updated` |
| `player:setRole` | `player:kicked` |
| `player:setTeamRole` | `player:disconnected` |
| `player:setNickname` | `player:error` |
| `player:kick` | |


### Timer Events

The turn timer is **server-initiated**: the server starts it internally (on game
start / turn change) and announces it via `timer:started` — there is no client
`timer:start` event. The client counts down locally, so there is no per-second
`timer:tick` broadcast either; `timer:expired` fires once when the turn's time is up.

| Client → Server | Server → Client |
|-----------------|-----------------|
| `timer:pause` | `timer:paused` |
| `timer:resume` | `timer:resumed` |
| `timer:stop` | `timer:stopped` |
| `timer:addTime` | `timer:timeAdded` |
| | `timer:started`, `timer:expired`, `timer:status`, `timer:error` |

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
| Invalid input | **Throw** `ValidationError` | `throw ValidationError.invalidCardIndex(index)` |
| Data integrity failure | **Throw** (never swallow) | Pipeline partial failure, corrupted data |
| Optional resource not found | **Return null** | `getRoom()` returning `null` for missing key |
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
- **No innerHTML for user content**: Use `textContent` or `createElement()`
- **JWT**: Minimum 32-character secret enforced in production
- **Session limits**: 8-hour max lifetime, IP consistency checks
- **Rate limiting**: Per-event + per-IP; HTTP via express-rate-limit, WebSocket via in-memory per-process counters today (session validation alone is Redis-backed) — making the WebSocket path Redis-backed across instances is tracked in docs/HARDENING_PLAN.md P2-1
- **Error detail stripping**: Internal fields never exposed to clients
- **GitHub Actions**: All pinned to immutable commit SHAs

### Robustness Practices

- **Distributed lock safety margin**: `withLock()` enforces an operation timeout 500ms shorter than the lock TTL, ensuring the lock holder can release cleanly before another process acquires it
- **Connection tracking consistency**: Connection counts are decremented on all disconnect paths — including auth failure, registration failure, and shutdown rejection — to prevent IP counter leaks
- **Fail-fast on data corruption**: Game state array mismatches (types vs revealed) throw `GameStateError.corrupted()` instead of silently propagating truncated data to clients
- **Socket room membership safety**: The deferred room-sync path (`playerRoomSync` / `playerContext.updateSocketRooms`) guards `socket.join()`/`socket.leave()` on `socket.connected`, so a socket that disconnected mid-handler is not re-added to rooms. (The `room:create`/`room:join` handlers themselves run on a freshly-connected socket inside the connection handler.)
- **Chat DOM cap**: Frontend chat messages are capped at 500 in the DOM; oldest messages are pruned to prevent unbounded growth from message floods
- **Keyboard shortcut guards**: Shortcuts are suppressed in `contenteditable` elements (in addition to INPUT/TEXTAREA/SELECT)
- **Idempotent listener initialization**: Frontend event listener setup functions use guard flags to prevent listener accumulation on repeated calls
- **Consistent error formats**: Rate limit errors include `recoverable` and `retryable` fields matching the format used by all other error paths
- **NFKC normalization**: All user input (nicknames, chat, room codes) is NFKC-normalized via `removeControlChars()` to prevent Unicode homoglyph attacks
- **Logger sensitive data redaction**: SessionIds are truncated to 8 chars; tokens, JWTs, secrets, and passwords are fully masked in all log output
- **Lua script nil guards**: All `tonumber(ARGV[])` calls in Lua scripts include fallback defaults to prevent runtime errors on malformed input
- **Lua TTL safety**: `hostTransfer.lua` falls back to 24h TTL when a room key has no expiry, preventing indefinite Redis persistence
- **Lua result nullable fields are omitted, not null (Upstash compat)**: a nullable field in a Lua script's JSON *result* (`winner`/`endReason` in `revealCard.lua`) is OMITTED when it has no value instead of being encoded as JSON null — real Redis's cjson emits null for `cjson.null`, but Upstash's Lua emulation (Fly.io managed Redis) drops null-valued object fields, which made `revealResultSchema` reject EVERY mid-game reveal *after* the script had committed the mutation (cards flipped in Redis with no broadcast; bot clickers burned retries and force-ended their turns). `revealResultSchema` (`luaGameOps.ts`) maps an absent/empty value back to null, so both encodings validate. Follow this contract for any new Lua script result field that can be null.
- **Board render queueing**: When `renderBoard()` is called during an in-progress render, a pending flag ensures the next call forces a full rebuild instead of silently skipping
- **Role enum single source**: The Redis-read `playerSchema` (`services/player/schemas.ts`) role enum MUST stay in sync with `setRole.lua`, `validators/playerSchemas.ts`, and the `Role` type — it lists all five roles (spymaster, clicker, advisor, observer, spectator). A missing role would make `getPlayer()` treat those records as corrupted and delete them. `safeTeamSwitch.lua` likewise demotes all team-bound roles (spymaster/clicker/advisor) on a team switch.
- **gameMode always populated**: `buildGameState` stamps `gameMode` for every mode (including `'classic'`) and `getGameStateForPlayer` always emits it (defaulting legacy games to `'classic'`), so the client never has to infer the mode.
- **Match word-pool reuse**: The full resolved word pool is persisted on the game as `wordPool`; `startNextRound` draws each new round's board from that pool (falling back to the board words for pre-`wordPool` games) so rounds don't reshuffle the same 25 words. The alternated starting team is forced into `generateBoardLayout` (via `forceFirstTeam`) so the 9/8 card counts stay consistent with `firstTeam`.
- **Paused-state Lua guards**: `revealCard.lua`, `endTurn.lua`, and `submitClue.lua` all reject mutations on a paused game atomically (returning `GAME_PAUSED`), independent of the handler's cached-state check. `pauseGame`/`resumeGame` emit `notifyGameMutation` so bots and clients react to pause/resume.
- **Timer-expiry turn guard**: The timer-expiry callback passes the observed `currentTurn` as the expected-team guard to `endTurn`, so a stale expiry that races a reveal/endTurn no-ops (NOT_YOUR_TURN) instead of double-flipping and skipping a turn.
- **Timer-expiry compare-and-delete (Redis-authoritative)**: each armed `setTimeout` is stamped with the `endTime` it was scheduled for; the expiry callback runs `atomicExpireTimer.lua` (`ATOMIC_EXPIRE_TIMER_SCRIPT`), which deletes the key and signals `EXPIRED` only when the stored timer still matches that `endTime` and is not paused — otherwise it returns `SUPERSEDED`/`PAUSED`/`GONE` and the callback no-ops. So a stale timeout that fires after an `addTime`/pause/restart can no longer delete a freshly-extended timer or end a turn that was just granted more time. This is the concrete, Redis-authoritative slice of HARDENING_PLAN P2-2. (A11)
- **Host transfer prefers humans, and a bot host is only a placeholder**: Disconnect-driven host transfer excludes bots when a human candidate remains connected — a bot cannot run host-only functions, so handing it host would lock the room. When the LAST human drops, a bot may hold host so the room survives the reconnect grace window — but `ensureRoomHasHost` (run on reconnect, resync, and join) displaces a bot host as soon as any human is connected again, clears the bot's stale `isHost` flag, and broadcasts `room:hostChanged` (reason `hostRepaired`); without this the returning host could not start the next game (live-play finding).
- **Observer role is locked during an active game**: `canChangeTeamOrRole` blocks an observer from changing into ANY other role (including plain spectator) while a game is live — an observer has seen the whole board, and allowing the step-down opened an `observer → spectator → clicker` laundering path. Role changes are free again once the game is over.
- **Peer identity is opaque (N1)**: clients identify other players ONLY by a derived `playerId` (`services/player/publicId.ts` — sha256 prefix of the sessionId); `toPublicPlayer` strips `sessionId` (plus `lastIP`/`userId`) from every peer-facing payload, and `toSelfPlayer` re-adds the recipient's own `sessionId` only in direct-to-self responses. Adopting an existing session at the socket handshake additionally requires the per-session `sessionToken` secret (`services/player/sessionAuth.ts`) minted at room create/join and delivered only to that client — a harvested sessionId alone no longer resolves another player's seat. Client→server payloads that target a peer (`player:kick`, `bot:remove`, `spectator:approveJoin`) carry the 16-hex `playerId`, resolved server-side via `findPlayerByPublicId`.
- **Zombie-socket disconnect guard**: `handleDisconnect` no-ops when a newer socket already owns the session (`getSocketId(sessionId) !== socket.id`), so a lingering old socket's late disconnect can't mark an actively-reconnected player disconnected, transfer host away from them, or schedule their removal.
- **Mutation-notifier listener isolation**: `notifyGameMutation` runs each `onGameMutation` listener in its own try/catch — it fires synchronously inside game write paths, so a throwing listener must not abort the others or poison the committed mutation's result.
- **Bot notification coalescing**: `botController` records mutations that arrive while a tick is in flight (`pending`) and re-ticks once it finishes, so a notification landing between a tick's final state read and its exit isn't dropped (which would stall the bot). It also re-verifies the seat after its "thinking" pause so a removed/kicked bot can't land one last move.
- **Bot config-loss degradation**: if a seated bot's config key is lost or corrupt (`getBotConfig` returns null), `tickRoom` falls back to a default `intermediate` config (with a warning) instead of breaking the tick cleanly — the old clean break left it the bot's turn with no move computed and no re-arm, freezing the game behind a never-advancing turn indicator. `resolveSkill` defaults an unknown preset to `intermediate` and `resolveClicker`/`resolveSpymaster` fall back to a random strategy, so the bot still acts and the turn advances. (B4)
- **Bot-only room cleanup**: `leaveRoom` tears the room down when no humans remain (bots are first-class players that never disconnect, so a bots-only room would otherwise linger until TTL).
- **addBot seat serialization**: `addBot` runs its seat-occupancy check and join under a per-room `bot-manage:` lock so two simultaneous `bot:add` calls can't both seat the same team+role.
- **Multiplayer custom word lists**: `game.ts`'s `buildStartGameOptions()` forwards the host's active Settings-menu word list (`state.activeWords`) on every multiplayer `game:start`/auto-start call whenever `state.wordSource !== 'default'`, so a prepared custom/combined list (see `docs/BOT_SEMANTIC_MAPS.md`) reaches hosted rooms the same way it already worked in standalone mode. The client parser cap and the `game:start` Zod schema's max both read `MAX_CUSTOM_WORD_LIST_SIZE` (`shared/gameRules.ts`) so the two bounds can't drift apart.
- **Word-list library (A1, Hybrid)**: a client-side `localStorage` library of named word lists (`frontend/wordListLibrary.ts`, managed in Settings → Game → Saved lists). The app has no accounts and a first-class offline standalone mode, so the library lives in the browser, not the server. Loading a saved list repopulates the custom-words editor and rides the existing `wordList` array path. When a game is started from a saved list, its stable `wordListId` + `wordListName` are forwarded as **provenance** (`buildStartGameOptions`), recorded on `GameState`/history (the field F4 left always-null now carries a real value — but it is NOT a server-side selector; the words still travel in `wordList`), and shown in the recap as "Played with <name>". Provenance is recorded only when a custom list is actually used and is cleared on any manual edit/mode-switch/reset. Prepared bot semantic maps can be stamped with the same id (`npm run bots:map --list-id`, `docs/BOT_SEMANTIC_MAPS.md`); the runtime still merges all maps by content overlap, so per-list map *selection* by `wordListId` is a documented future enhancement.
- **Embeddings clue hygiene**: with a `nearest()`-capable vector backend the spymaster GENERATES candidates from the whole model, which surfaces junk that passes `isClueLegalForBoard` (a substring/stem test). `isClueBoardSafe` (`bots/strategies/clueSafety.ts`, re-exported from `spymasters.ts`), wired into `generateClueCandidates`' legality choke point, additionally rejects cross-language cognates / orthographic near-duplicates of a board word (diacritic-folded shared-prefix + bounded edit distance — the `REVOLUCIÓN`/`REVOLUTION` self-leak) and tokens using a non-ASCII letter absent from the board (board-derived, so a Spanish board keeps its accents while an English board rejects them). Separately, `build-board-vectors.mjs --freq <freq-ordered.vec>` restores a **commonness prior** for alphabetical sources (Numberbatch): it restricts the breadth sample to a frequency reference's common region and writes the file most-common-first so `vectorBackend.ts` re-enables its rank→commonness rarity tax (docs/BOT_CLUE_LESSONS.md Round 6). This prior is decisive for clue *recognizability*: measured over 400 opening clues, an alphabetical Numberbatch board (prior off) put 85% of clue words outside the top-50k English words (`ADELING`, `SEASPIDER`…) versus ~19% with the prior on — so the `--board` bake (`dev-bots.mjs`, the Docker/Fly path) now auto-fetches a small frequency reference (hermitdave/FrequencyWords `en_50k.txt`, CC-BY-SA-4.0, reachable where the GloVe/fastText references are blocked) and distils with `--freq`, best-effort (a fetch failure degrades to a prior-off build with a warning rather than aborting).

## Known Issues (Tracked)

A July 2026 codebase-wide hardening review found a small number of real defects. The full remediation plan — root cause, concrete fix, files touched, tests, sequencing — lives in **[docs/HARDENING_PLAN.md](docs/HARDENING_PLAN.md)**. Phases 0 and 1 have both shipped; check that document for current status on everything else before assuming it's resolved.

A second, deeper review (also July 2026, post-PR #497) produced a follow-up plan of 70 additional items — broken user-facing flows, deploy/ops correctness, accessibility, test/CI signal, and half-built features — in **[docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md)**. It is additive and non-overlapping with HARDENING_PLAN.md. Roughly half have since shipped (each fixed item's header is marked **FIXED** with a resolution note, e.g. A1–A11, B1/B3/B4/B6/B9–B13, C1/C3/C4, D1–D4/D8, E3, G1–G5, H1–H7); the remainder are still `Planned`. Always check an item's header in the ledger for its current status before assuming it's open.

A third review pass (July 2026) produced **[docs/CODEBASE_REVIEW_PLAN.md](docs/CODEBASE_REVIEW_PLAN.md)** — 37 new items (N1–N37) plus a ledger-reconciliation section. It is additive to and non-overlapping with the two plans above. Headline findings: a session-identity weakness that let one room peer act as another and read the spymaster board (N1/N2 — both now FIXED: peers see only an opaque derived `playerId`, and adopting a session at the socket handshake requires a per-session `sessionToken` secret delivered privately at room join), a match-round finalization race that silently drops the round bonus (N2b, re-opening A7 — FIXED), a `leaveRoom` host-transfer that can hand host to a bot and brick the room (N3 — FIXED), and a regression where the production Dockerfile is back on EOL Node 25 (N26 — FIXED). The data-integrity tranche has also shipped: N6 (guess-ordinal recorded as 0), N7 (history/replay dropping all mode data), N8 (rejected `game:start` killing the live timer), N9 (Lua desync on a truncated mode array), N10 (reconnect token burned on a benign mismatch), and N37 (fail-open socket rate-limiter) are all **FIXED**. The Phase-3 frontend-correctness/accessibility tranche has shipped too: N12 (drift-proof listener cleanup), N13 (keyboard shortcuts no longer disabled after every deploy), N14 (paused-timer display + stale-countdown clear on reconnect/resync), N15 (disconnected team/role guard), N16 (host auto-start deferred until settings confirmed), N17 (pause-overlay double SR announce), N18 (i18n-bypass strings routed through `t()`), and N19 (`game:typing` dead wiring deleted) are all **FIXED**. The Phase-4 bot-subsystem tranche has shipped as well: N20 (embeddings vectors now warm off the event loop via an async chunked loader + `warmSemanticBackend`, so the first bot decision after a restart never blocks on the parse), N21 (a bot action computed before the "thinking" pause is dropped if a new game/round replaced the old one — `botMayStillAct` game-identity CAS), N22 (`giveUpAndForceEndTurn` re-verifies a bot still holds the stuck seat before force-ending, so a human who took the seat mid-streak keeps their turn), N23 (the pure engine mirrors `submitClue.lua`'s clue-number clamp and every op's history cap, and parity now seeds 0–9 and diffs `history`), N24 (the advisor path stores its de-dupe key + refreshes `lastSeen` before the empty-result return, so a room with nothing to say stops re-scoring on every mutation), and N25 (removing the acting bot mid-turn now broadcasts a `SEAT_VACATED` room warning and nudges the controller) are all **FIXED**. The Phase-5/6 test-CI-signal and middleware/config tranche has shipped too: N28 (E2E smoke gate now runs `standalone-game.spec.js` and drops the dead grep-invert), N29 (`chaos.test.ts` renamed to `mockHarness.test.ts` and honestly reframed as validating the mock harness; a vacuous `socketAuth` no-op deleted), N30 (`json-summary` coverage reporter so the PR coverage table renders), N31 (bundle-size check now `exit 1`s past 200KB instead of only warning), N32 (missing env knobs documented in `.env.example`), N33 (Prettier/ESLint scope extended to build/config JS + a `node --check` syntax floor for the repo-root `.mjs` scripts and loadtest), N34 (WS `validateOrigin` now reuses the HTTP CSRF `isOriginAllowed` predicate — full scheme+host+port match), N35 (a shared scrypt `verifyAdminPassword` backs both the admin router and `/health/metrics`, ending the metrics guard's plaintext length-short-circuit compare), and N36 (production CSP `connect-src` scoped to `'self'`, dropping the any-host `ws:`/`wss:`) are all **FIXED**; N27 (type-checking the test suites) remains **PARTIAL** — the `typecheck:test` mechanism is shipped but the ~3000-error pre-existing backlog (noImplicitAny cascade across `require()`-based fixtures) is a tracked follow-up before it can gate. Its §9 ledger reconciliation has been applied — the four IMPROVEMENT_PLAN items it flagged (E3/G2/G3/G4) are now marked FIXED, and the A7/A10/B13/G1 notes corrected. Check each N-item's header for current status.

Fixed (Phase 0 — see HARDENING_PLAN.md for what changed and why):

- ~~A spymaster could switch to `clicker` mid-game and act on the board they'd already seen~~ — `canChangeTeamOrRole` (`socket/playerContext.ts`) now locks a spymaster out of every role change while a game is active, the same way the observer case already was. (P0-1)
- ~~`game:reveal` didn't require an active clue~~ — both `revealCard.lua` and the socket handler now reject a reveal with no `currentClue` set, distinct from the `guessesAllowed=0`-means-unlimited sentinel. (P0-2)
- ~~`withLock`'s internal timeout could be shorter than the operation it guards~~ — `timerService.startTimer`'s lock budget is now derived from `TIMEOUTS.TIMER_OPERATION`; `withLock` also logs a diagnostic if this class of race ever fires again. Still size every `lockTimeout` to exceed the slowest realistic inner operation when adding a new `withLock` call site. (P0-3)
- ~~Disconnect and reconnect could race on a player's `connected` flag~~ — both now serialize through the `player-mutation:<sessionId>` lock, with socket ownership re-checked inside it right before the write. (P0-4)
- ~~Advisor-bot suggestions broadcast to the whole room~~ — now scoped to the acting team's own members via `safeEmitToPlayers`. (P0-5)

Fixed (Phase 1 — see HARDENING_PLAN.md for what changed and why, including a few documented deviations from the original plan text):

- ~~`trust proxy` was gated on `NODE_ENV` alone, letting a self-hosted deployment with no real proxy trust a spoofed `X-Forwarded-For`~~ — `shouldTrustProxy()` (`config/env.ts`) is now the single source of truth for both Express and the Socket.io IP resolver. (P1-1)
- ~~Redis reconnection gave up permanently after 20 attempts with no self-heal~~ — `reconnectStrategy` now exits the process on exhaustion so the platform restarts it with a fresh connection. (P1-2)
- ~~Embedded Redis's child process could be orphaned if `disconnectRedis()`'s `quit()` calls hung~~ — every `quit()` now races a timeout, and `stopEmbeddedRedis()` always runs in a `finally` block. (P1-3)
- ~~`game:abandon` in match mode never rolled back the round's banked score~~ — `redMatchScore`/`blueMatchScore` are snapshotted per round and rolled back on abandon. (P1-4)
- ~~`game:abandon`/`game:clearHistory` had no rate limit, and the failed-join limiter never actually blocked~~ — both are now rate-limited, and `trackFailedJoinAttempt` throws once its ceiling is exceeded. (P1-5)
- ~~A bot that exhausted its retry ceiling froze the game indefinitely~~ — `botController` now force-ends the stuck turn and broadcasts a `BOT_STALLED` warning. (P1-6)
- ~~A bot could keep occupying a seat a reconnecting human still owned, racing their actions~~ — reconnect now evicts a connected bot from the player's own seat (`BOT_SEAT_RECLAIMED`). (P1-7)
- ~~Bot-originated clues skipped the length/format/number-range bounds humans get from Zod~~ — `shared/gameRules.ts`'s `isValidClueWordShape`/`isValidClueNumberShape` are now enforced in `gameService.submitClue` and `submitClue.lua` too. (P1-8)
- ~~The 29 Redis Lua scripts were never executed against a real Redis in any blocking test~~ — `__tests__/integration/luaScripts.test.ts` now does, and a new `e2e-smoke` job is part of the blocking `ci-passed` gate. (P1-9)
- ~~`errorHandler`'s known-error-code branch skipped production redaction that its fallback branch already had~~ — now gated the same way via the existing `SAFE_ERROR_CODES` allowlist. (P1-10)
- ~~Two dead i18n keys (`board.neutralCard`, `game.dangerZone`/`game.forfeitGame`) and a Duet blue-side advisor bug (`ownRemaining` always 0)~~ — all fixed; a new locale-key regression test now scans every `data-i18n*` attribute against all four locale files. (P1-11)
- ~~The unused `escapeHTML()` helper wasn't attribute-injection-safe~~ — deleted (zero call sites). (P1-12)
- ~~No E2E coverage existed for spectator approval, bot lifecycle, or match-round transitions~~ — three new specs added; `spectator-approval.spec.js` drives the raw Socket.IO protocol directly since no frontend UI wires those events yet (a separate, undone feature gap, not a defect this item covers). (P1-13)

Known scaling-readiness gap (Phase 2, not yet started): several pieces of per-room/per-IP coordination state (socket-level rate limiting, the bot controller's in-flight guard, turn-timer pause/resume/stop) live in a plain in-process `Map`, not Redis — correct only for a single instance. This is fine for the current deployment (`fly.toml` deliberately keeps exactly one machine) but must be closed before running more than one instance behind a load balancer. See HARDENING_PLAN.md Phase 2.

## Key Services

| Service | File | Purpose |
|---------|------|---------|
| `gameService` | `services/gameService.ts` | Core game logic, Mulberry32 PRNG, delegates to `game/` sub-modules |
| `roomService` | `services/roomService.ts` | Room create/join/leave/settings lifecycle |
| `playerService` | `services/playerService.ts` | Player CRUD barrel (delegates to `player/` sub-modules) |
| `timerService` | `services/timerService.ts` | Turn timers — Redis-tracked state, in-process expiry timer (single-instance only, see docs/HARDENING_PLAN.md P2-2) |
| `gameHistoryService` | `services/gameHistoryService.ts` | Game history barrel — delegates to `gameHistory/` sub-modules (types, validation, storage, replayEngine) |
| `auditService` | `services/auditService.ts` | Security audit logging (in-memory ring buffer, MAX_LOGS_PER_CATEGORY=10000) |
| `botService` | `services/botService.ts` | Bot lifecycle — addBot/removeBot/getBotConfig (bots are first-class Redis players driven by `bots/botController.ts`) |

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

- **Backend unit/integration**: Jest, 122 suites in `server/src/__tests__/`
- **Frontend unit**: Jest with jsdom, 57 suites in `server/src/__tests__/frontend/`
- **E2E**: Playwright, 16 specs in `server/e2e/`
- **Load testing**: Custom scripts in `server/loadtest/`

### Configuration (jest.config.ts.js)

Two separate Jest projects:

| Project | Environment | Coverage Thresholds |
|---------|-------------|-------------------|
| `backend` | Node | Statements 80%, Branches 75%, Functions 85%, Lines 80% |
| `frontend` | jsdom | Statements 70%, Branches 70%, Functions 70%, Lines 70% |

Module aliases: `@/`, `@config/`, `@services/`, `@errors/`, `@utils/`, `@middleware/`, `@routes/`, `@socket/`, `@validators/`, `@types/`, `@shared/`

### Test Patterns

- Shared mocks in `__tests__/helpers/mocks.ts` (~782 lines)
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
| `RATE_LIMIT_MAX_ENTRIES` | Max rate limit tracking entries | `10000` |
| `INSTANCE_ID` | Custom instance ID for multi-instance deployments | Auto-generated |
| `EMBEDDED_REDIS_TIMEOUT_MS` | Timeout for embedded Redis startup (min 1000) | `5000` |
| `REDIS_TLS_REJECT_UNAUTHORIZED` | Reject unauthorized TLS connections to Redis | `true` |

## Health & Monitoring

| Endpoint | Purpose |
|----------|---------|
| `/health` | Basic health check (load balancer) |
| `/health/ready` | Full dependency check (Redis, etc.) |
| `/health/live` | Process alive (liveness probe) |
| `/health/metrics` | Application metrics, rate limits, connection counts |
| `/health/metrics/prometheus` | Prometheus-format metrics |

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
| [docs/INTELLIGENT_BOTS_SPEC.md](docs/INTELLIGENT_BOTS_SPEC.md) | AI bot design spec (engine, strategies, semantics, harness) |
| [docs/BOT_EMBEDDINGS.md](docs/BOT_EMBEDDINGS.md) | Optional word-embedding backend for the semantic bot spymaster |
| [docs/BOT_SEMANTIC_MAPS.md](docs/BOT_SEMANTIC_MAPS.md) | Prepared custom word lists: LLM-built semantic maps (`npm run bots:map`) for full-strength bots |
| [docs/BOT_LLM.md](docs/BOT_LLM.md) | Opt-in LLM-backed bots: Claude proposes, the deterministic safety machinery verifies |
| [docs/BOT_CLUE_LESSONS.md](docs/BOT_CLUE_LESSONS.md) | Human-play lessons → prioritized plan for improving bot clue-giving and guessing |
| [docs/BOT_NUANCE_PLAN.md](docs/BOT_NUANCE_PLAN.md) | Build sheet for the lessons ledger: plan items 2.8–2.19 mapped to exact code hooks, phased with metric gates |
| [docs/SETUP_SCREEN_GUIDE.md](docs/SETUP_SCREEN_GUIDE.md) | User-facing setup screen walkthrough |
| [docs/WINDOWS_SETUP.md](docs/WINDOWS_SETUP.md) | Windows development setup |
| [docs/HARDENING_PLAN.md](docs/HARDENING_PLAN.md) | Tracked remediation plan from the July 2026 hardening review — root cause, fix, tests, and sequencing for every open finding |
| [docs/IMPROVEMENT_PLAN.md](docs/IMPROVEMENT_PLAN.md) | Follow-up review plan (70 items) — broken flows, deploy/ops, a11y/i18n, test signal, half-built features; additive to HARDENING_PLAN.md |
| [docs/CODEBASE_REVIEW_PLAN.md](docs/CODEBASE_REVIEW_PLAN.md) | Third review pass (37 items, N1–N37) — session-identity/authz, match-round finalization race, host-transfer lockout, history/replay data-integrity, bot-driver races, CI/type-check signal gaps, plus ledger reconciliation; additive to the two plans above |
| [docs/FEATURE_ROADMAP.md](docs/FEATURE_ROADMAP.md) | Forward-looking feature proposals (word-list library, post-game recap, Redis-backed bot coordination, multilingual semantic maps) + recorded finish-or-delete disposition for the half-built features (IMPROVEMENT_PLAN Phase F) |
