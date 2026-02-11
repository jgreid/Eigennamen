# Changelog

All notable changes to Die Eigennamen (Codenames Online) are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
