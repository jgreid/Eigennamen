# Changelog

All notable changes to Eigennamen Online are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [5.0.0-beta.1] - 2026-03-06

### Changed
- **Release preparation**: Version bump to v5.0.0-beta.1
- Service worker cache version bumped to `eigennamen-v5` (forces fresh asset download for all users)
- Updated `SECURITY.md` supported versions table (5.x active, 4.x security-only)
- Updated `ARCHITECTURE.md` directory structure with accurate file counts (54 frontend modules, 26 Lua scripts, 129 test suites, 12 E2E specs, 9 socket handlers, 12 utils, 4 ADRs)
- Updated `SERVER_SPEC.md` technology stack (Node.js 22+, Express 5)

### Removed
- `CODEBASE_REVIEW.md` and `CODEBASE_REVIEW_PROMPT.md` — development sprint artifacts; all findings resolved
- Development phase annotations (`PHASE 4.7`, `PHASE 2 FIX`, `CRITICAL FIX`, `BUG FIX`) from source, CSS, tests, and admin dashboard — replaced with descriptive comments where still useful

## [4.3.0] - 2026-03-04

### Added
- E2E security test suite (`e2e/security.spec.js`) — 27 Playwright tests across 8 categories: CSP, security headers, rate limiting, CORS, admin auth, input validation, Socket.io, static files
- `server/public/css/admin.css` — extracted from inline `<style>` block in admin.html
- CSS utility classes: `.noscript-message`, `.board-loading-placeholder`, `.full-width`
- `[hidden] { display: none !important; }` CSS rule for reliable hidden attribute behavior
- `CORRUPTED_DATA` error codes in 5 Lua scripts (`updatePlayer`, `atomicAddTime`, `atomicTimerStatus`, `atomicSetSocketMapping`, `atomicSetRoomStatus`)
- Corruption detection and logging in `playerService.ts` and `timerService.ts`

### Changed
- **SECURITY**: Removed `'unsafe-inline'` from CSP `style-src` — all inline styles migrated to CSS classes and HTML `hidden` attribute
- **SECURITY**: All GitHub Actions across 4 workflows pinned to immutable commit SHAs (was: mutable version tags)
- **SECURITY**: Added top-level `permissions` blocks to CI and deploy workflows
- Frontend visibility toggling migrated from `el.style.display` to `el.hidden` property (8 frontend modules, 5 test files)
- Admin dashboard styles moved from inline `<style>` block to external `admin.css`
- All inline `style=` attributes removed from `index.html` and `admin.html`

### Fixed
- ESLint `no-non-null-assertion` warnings in `config/jwt.ts` — replaced `!` with null-coalescing

## [4.2.0] - 2026-03-01

### Added
- `CONTRIBUTING_QUICK.md` — 1-page quick-start contributor guide (clone → PR in 10 minutes)
- `docs/ADDING_A_FEATURE.md` — worked example tracing `chat:spectator` through all codebase layers
- Documentation headers on all 18 Lua scripts (`KEYS[]`, `ARGV[]`, `Returns` contracts)
- CSRF dev-mode info log when `CORS_ORIGIN` is not configured (previously only warned in production)
- Allowlist-based error detail filtering in `errorHandler.ts` — only `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable` are exposed to clients
- Production Zod path scrubbing — validation errors strip field paths in production, keeping only messages

### Changed
- Error handler switched from blacklist (destructure-and-spread) to explicit allowlist pattern for detail fields — prevents accidental disclosure when new internal fields are added
- Updated CLAUDE.md with new documentation links and error handling security patterns

## [4.1.0] - 2026-03-01

### Added
- Prettier code formatter with `.prettierrc.json` config (4-space indent, single quotes, 120 char width)
- `npm run format` and `npm run format:check` scripts
- Prettier check step in CI pipeline (lint job)
- `eslint-config-prettier` to disable formatting rules that conflict with Prettier
- `ServerRevealData` interface to replace `Record<string, any>` in frontend reveal logic
- `TranslationValue` type for i18n translation data

### Changed
- Re-enabled `@typescript-eslint/no-explicit-any` as `warn` for frontend code (was `off`)
- Replaced all 4 `any` type annotations in frontend with proper types (`unknown`, typed interfaces)
- Removed `forceExit: true` from Jest config (CI still uses `--forceExit` flag as safety net; local runs now surface unclosed handle warnings)
- Removed ESLint formatting rules (`semi`, `quotes`, `indent`, `no-trailing-spaces`, etc.) — Prettier handles formatting
- Updated all documentation to reflect accurate test suite counts (133), game modes, CI pipeline stages, and coverage thresholds

### Removed
- `CODEBASE_REVIEW.md`, `CODEBASE_REVIEW_2.md`, `CODE_REVIEW_REPORT.md` — stale point-in-time review artifacts

## [4.0.0] - 2026-02-27

### Added
- Reactive state store with actions, selectors, and event bus (`frontend/store/`)
- Frontend game sub-modules for reveal and scoring logic (`frontend/game/`)
- Frontend handler modules split into 6 dedicated event handler files
- Multiplayer sub-modules: listeners, sync, types, UI (from monolithic multiplayer.ts)
- Socket client split into dedicated modules: events, storage, types
- Player service sub-modules: cleanup, mutations, queries, reconnection, schemas, stats
- Room service sub-module: membership
- 126 test suites (up from 93) across backend and frontend
- 9 Playwright E2E spec files
- Comprehensive hardening: backpressure scaling, atomic game history, paused timer TTL, batch token cleanup

### Changed
- Frontend expanded from 37 to 52 TypeScript modules with improved separation of concerns
- State management refactored to reactive store pattern with batched updates
- Coverage thresholds split per-project: backend (80/75/85/80) and frontend (70/70/70/70)
- Node.js minimum version bumped to 22+ (from 18+)
- Updated all dependencies to latest stable versions

### Removed
- `HARDENING_REVIEW.md` — completed one-time review, all items resolved
- `FRONTEND_AUDIT.md` — completed one-time audit, findings tracked as issues
- Broken reference to non-existent `server/public/js/ARCHITECTURE.md`

## [2.3.0] - 2026-02-11

### Added
- Replay board keyboard navigation with ARIA `role="grid"`, `role="gridcell"`, tabindex, and arrow-key grid navigation (C-6)
- Word uniqueness validation via Zod `.refine()` — enforces case-insensitive uniqueness (C-5)
- Shared Unicode-aware `NICKNAME_REGEX` in frontend `constants.js` matching server-side validation (C-8)
- `TIMEOUT_*` environment variable overrides for all timeout values (C-12)
- Docker Compose resource limits: api 512M/1cpu, db 256M/0.5cpu, redis 128M/0.5cpu (C-13)

### Fixed
- **SECURITY**: Session age validation no longer falls back to `connectedAt` — always uses `createdAt` to prevent bypassing 8h limit (C-3)
- **SECURITY**: JWT secret < 32 characters now throws error in production instead of just warning (C-4)
- **BUG**: Replay playback rapid toggle could create duplicate intervals — now clears before creating (C-10)
- **PERFORMANCE**: `fitCardText` layout thrashing replaced with batch-read then batch-write DOM pattern (C-9)
- **PERFORMANCE**: `resetRolesForNewGame` now uses `Promise.all()` instead of sequential updates (C-7)

### Changed
- Chat handlers now use `safeEmitToRoom`/`safeEmitToPlayer` for consistent error handling (C-1)
- `game:clue` handler wrapped with `withTimeout(TIMEOUTS.GAME_ACTION)` for resilience (C-2)
- ESLint: reduced from 125 issues (8 errors + 117 warnings) to 0 errors, 0 warnings
- Updated all documentation to reflect Tier C completion and ESLint cleanup

### Verified (already implemented)
- C-11: Memory audit log expiration via ring buffer (MAX_LOGS_PER_CATEGORY=10000)
- C-14: Settings value validation handled by Zod `roomSettingsSchema`
- C-15: Token rotation on reconnection via `ROTATE_SESSION_ON_RECONNECT`

## [2.2.0] - 2026-02-11

### Added
- Deep line-by-line codebase review identifying 2 critical + 8 high + 35 medium issues
- Multiplayer E2E lifecycle tests (11 tests in `multiplayer-lifecycle.spec.js`)
- Timeout wrappers for all Redis Lua eval calls
- `MAX_WORD_LIST_SIZE` (10,000) validation in Zod schema and frontend
- `MAX_TRACKED_IPS` (10,000) cap for connectionsPerIP map
- Reconnection token invalidation on player kick
- Localized default words wired into game word selection
- Event delegation for accessibility listeners (prevents leak)
- try-catch wrapper around `refreshRoomTTL` calls
- Tier A hardening: Zod `.passthrough()` removal, deprecated file cleanup

### Fixed
- **CRITICAL**: Spectator handler signatures corrected to 4-param pattern
- **CRITICAL**: Max word count validation added to prevent DoS via large word lists
- **HIGH**: Reconnection token not invalidated when player kicked
- **HIGH**: History cleanup index direction verified correct
- **HIGH**: `escapeHTML` misused in className context replaced with whitelist check
- **HIGH**: Replay event listener accumulation via delegation
- **HIGH**: Accessibility keyboard listener leak via shared closeOverlay()

### Changed
- Updated all documentation files with consistent test counts (2,675 total)
- Coverage thresholds clarified between `jest.config.ts.js` and `package.json`

## [2.1.0] - 2026-02-10

### Added
- Rendering error boundary for frontend resilience
- Toast cleanup mechanism
- Centralized timing constants
- Lua result schemas for type-safe script responses
- Extended `tryParseJSON` to all major services
- `data-testid` attributes for E2E test stability
- Distributed lock TTL centralization

### Changed
- Improved type safety across frontend and type system
- Domain-aligned naming conventions

## [2.0.0] - 2026-02-09

### Added
- Replay sharing API endpoint (`/api/replays/:roomCode/:gameId`)
- Spectator join request flow (request/approve/deny)
- Admin SSE real-time metrics streaming
- k6 load testing scripts (HTTP and WebSocket)
- CodeQL security scanning CI workflow
- Board game UI improvement roadmap
- Fly.io memory-mode guard (blocks `REDIS_URL=memory` on Fly.io)

### Changed
- Updated all documentation to reflect current codebase state
- Sprint plan with verified status tracking
- Module cleanup and comment cleanup

## [1.9.0] - 2026-02-08

### Added
- Tests for security-critical and under-covered modules
- Tests for game rules, chat fallback, reconnect token auth
- Hardening: validation, security, UX, and stability improvements
- Room ID matching: consistent normalization, reserved name validation
- CI typecheck fixes and timer validation improvements

### Removed
- Dead code, duplicate tests, unused exports
- Never-run database integration tests
- 58 redundant coverage-padding test files

### Changed
- Realistic coverage thresholds (65/80/75/75 in jest.config.ts.js)

## [1.8.0] - 2026-02-07

### Added
- Comprehensive E2E test suite (8 Playwright spec files, 64+ tests)
  - `game-flow.spec.js` - Standalone game flow
  - `multiplayer.spec.js` - Basic multiplayer
  - `multiplayer-extended.spec.js` - Extended multiplayer scenarios
  - `multiplayer-lifecycle.spec.js` - Room lifecycle tests
  - `accessibility.spec.js` - Accessibility testing
  - `timer.spec.js` - Timer functionality
  - `home.spec.js` - Home page
  - `standalone-game.spec.js` - Standalone mode
- GitHub Actions CI pipeline with 6 quality gates
- Extended tests for metrics, admin routes, socket auth, and memory storage

### Changed
- Branch coverage improved from 71% to 87%+
- ESLint: zero lint warnings enforced

## [1.7.0] - 2026-02-06

### Added
- Phase 1: Critical hardening (NFKC normalization, atomic Lua scripts, room rollback, timer validation)
- Phase 2: Frontend improvements (modal stack, AbortController, shared constants, ARIA, colorblind SVG)
- Phase 3: Testing improvements (test helpers, middleware tests, error scenarios)
- Phase 4.1: Spectator mode enhancements
- Phase 4.3: Game replay system with speed control (0.5x, 1x, 2x, 4x)
- Phase 4.7: Admin dashboard (room management, audit logs, metrics, broadcast)
- Phase 5: Infrastructure (CI/CD, Docker multi-stage, Prometheus metrics, request timing)
- Comprehensive future development plan

### Fixed
- Card reveal not showing colors for non-spymasters
- Game over not revealing all card types

## [1.6.0] - 2026-02-05

### Fixed
- 10 game crash bugs and turn confusion issues
- Socket error handling and ACK responses
- Revert function for compound operations
- Race conditions in concurrent card reveals
- Defense-in-depth validation in Lua scripts

### Added
- Performance optimizations for scalability
- ESLint error fixes for CI compliance

## [1.5.0] - 2026-02-04

### Added
- Internationalization (English, German, Spanish, French) with localized word lists
- Audio notifications (Web Audio API)
- Game modes: Classic, Blitz (30s turns), Duet (cooperative 2-player)
- QR code room sharing

### Changed
- Frontend extracted from inline to 15 ES6 modules (4,363 lines)
- CSS extracted from inline to 8 modular stylesheets (3,288 lines)
- Redis Lua scripts extracted to 6 separate files (492 lines)

### Removed
- Legacy frontend code and `index-modular.html`
- Room password dead code

## [1.4.0] - 2026-02-03

### Fixed
- Role sync race condition when changing teams during active turn
- TTL leaks in room lifecycle
- Host/room lifecycle bugs (TTL preservation, stats broadcast)
- Unicode handling and locale-safe normalization

### Added
- Role switching between clicker/spymaster on same team during turn
- Coverage tests for gameHandlers, metrics, socketAuth, memoryStorage

## [1.3.0] - 2026-02-02

### Fixed
- 17 security, correctness, and quality issues from codebase review
- 10 security and correctness issues (Issues 3-8, 10-11, 14-15)
- Critical memory-mode bugs in memoryStorage (Issues 1, 2, 9, 12)
- 6 codebase weaknesses (backoff, eviction, handlers, parallelism, timeouts)

## [1.2.0] - 2026-02-01

### Added
- Socket.io ACK mechanism fixes (v4.8 compatibility)
- Service worker: network-first strategy with offline fallback

### Fixed
- Optimistic update killing team-change path
- endTurn fallback UI enabled
- Stale currentClue after reveal-caused turn change
- Misleading error when clicker clicks before clue given

## [1.0.0] - 2026-01-31

### Added
- Initial multiplayer server (Node.js + Express + Socket.io)
- Redis-backed game state with in-memory fallback
- PostgreSQL with Prisma ORM (optional)
- JWT authentication with session tokens
- Rate limiting (per-event, per-IP)
- CSRF protection and Helmet security headers
- Swagger/OpenAPI documentation
- Docker Compose setup
- Fly.io deployment configuration
- Custom word lists with database persistence
- Turn timer with pause/resume/add-time
- Team chat (backend)
- Admin dashboard
- Reconnection with token-based authentication
- Standalone URL-based mode (no server required)
