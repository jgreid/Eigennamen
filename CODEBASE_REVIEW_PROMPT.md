# Comprehensive Codebase Review Prompt

> **Usage**: Copy everything below the line into a new Claude Code session opened in this repo.

---

You are performing a comprehensive, deep codebase review of Eigennamen Online — a real-time multiplayer web implementation of the board game Codenames (GPL v3.0). Your review must be exhaustive, specific, and actionable. Read every file you reference before making claims about it. Do not speculate — verify.

## Codebase Facts (verified)

- **Production code**: ~31,000 lines TypeScript across ~120 files in `server/src/`
- **Test code**: ~52,000 lines across 131 test suites (Jest) + 11 Playwright E2E specs
- **Lua scripts**: 26 atomic Redis operations (~1,346 lines) in `server/src/scripts/`
- **Frontend**: 55 TypeScript modules in `server/src/frontend/` — vanilla TS, no framework, custom reactive proxy state management, built with esbuild
- **Backend**: Express 5 + Socket.io 4.7 + Redis 5.11, Node 22+, Zod 4.3 validation
- **Game modes**: Classic (competitive, 2-team), Duet (cooperative, 2-player), Match (multi-round competitive with card scoring)
- **i18n**: 4 languages (en, de, es, fr) with language-specific word lists in `server/public/locales/`
- **Deployment**: Fly.io (production), Docker Compose (dev), supports memory-mode (embedded Redis) or external Redis
- **163 commits**, version 4.2.0, GPL v3.0
- **Key architectural patterns**: Service layer, context handler pipeline, Lua scripts for atomicity, distributed locks, optimistic locking with stateVersion, reactive proxy state on frontend

## Review Structure

For each section below, read the actual source files, then provide:
1. **What's working well** — specific patterns, files, and techniques that are strong
2. **What needs attention** — concrete issues with `file:line` references where possible
3. **Recommended changes** — prioritized (critical/high/medium/low), with enough detail to implement

---

### SECTION 1: Architecture & Data Flow Integrity

Read and analyze the full request/event lifecycle:

- `server/src/socket/contextHandler.ts` — the handler factory pipeline (createPreRoomHandler, createRoomHandler, createHostHandler, createGameHandler)
- `server/src/socket/rateLimitHandler.ts` — per-event rate limiting integration
- `server/src/socket/playerContext.ts` — session/player resolution from Redis
- `server/src/socket/connectionHandler.ts` — connection lifecycle, handler registration
- `server/src/socket/safeEmit.ts` — emission wrapper for all Socket.io broadcasts
- `server/src/socket/connectionTracker.ts` — active connection tracking per IP
- `server/src/socket/gameMutationNotifier.ts` — game state change notifications
- `server/src/middleware/socketAuth.ts` and `server/src/middleware/auth/` — 4-part auth pipeline (JWT, IP validation, origin, session)
- `server/src/middleware/errorHandler.ts` — error sanitization with detail allowlist

Evaluate:
- Is the pipeline order correct and complete? Are there gaps where unauthenticated or unvalidated data could reach handlers?
- Does the context handler correctly narrow types for each handler variant (PreRoom → Room → Host → Game)?
- Are there timeout/hang risks in the handler pipeline? The handler timeout is 30s (`TIMEOUTS.SOCKET_HANDLER`) — is this appropriate for all operations?
- Is the error sanitization thorough? The allowlist in `GameError.ts` exposes only `roomCode`, `team`, `index`, `max`, `recoverable`, `suggestion`, `retryable` — could internal details leak through other paths?
- How does the rate limiter interact with reconnection flows — could a legitimately reconnecting user get rate-limited out? (The reconnection token endpoint is limited to 2/10s due to crypto ops)
- Does `safeEmit` correctly prevent emissions to disconnected sockets? Are there edge cases where a broadcast reaches an unauthorized client?

### SECTION 2: Game Logic Correctness

Read and verify game logic across all three modes:

- `server/src/services/gameService.ts` — core game logic (~600 lines): createGame, revealCard, endTurn, forfeitGame, startNextRound, finalizeMatchRound
- `server/src/services/game/boardGenerator.ts` — Mulberry32 PRNG, Fisher-Yates shuffle, board layout generation, card score distribution (gold/silver/trap/standard/blank)
- `server/src/services/game/revealEngine.ts` — card reveal outcome logic per mode, player visibility rules (spymaster vs non-spymaster)
- `server/src/services/game/luaGameOps.ts` — Lua script execution, result parsing, empty-array-to-object JSON quirk handling, optimistic locking via executeGameTransaction
- `server/src/scripts/revealCard.lua` — atomic card reveal with score updates
- `server/src/scripts/endTurn.lua` — atomic turn end
- `server/src/shared/gameRules.ts` — shared constants (BOARD_SIZE=25, MATCH_TARGET=42, MATCH_WIN_MARGIN=3, ROUND_WIN_BONUS=7, card score distributions)

Verify:
- **Classic mode**: Does assassin correctly end the game? Does revealing all team cards correctly trigger a win? Is the first-team advantage (9 vs 8 cards) properly handled?
- **Duet mode**: Are timer tokens correctly decremented on bystander hits? Is the green card tracking accurate across both perspectives (types[] for Red, duetTypes[] for Blue)? Can a Duet game be won and lost correctly?
- **Match mode**: Is round scoring correct (card scores + round bonus of 7)? Does the match-end condition (≥42 points with ≥3 point lead) work? Is first-team alternation enforced across rounds via `firstTeamHistory`? Are custom word lists preserved across rounds? (Known issue: `gameHandlers.ts` passes `{ gameMode: 'match' }` to `startNextRound` but does NOT forward the room's custom word list — see `docs/GAME_MODES_REVIEW.md` issue #8)
- **PRNG**: Is the Mulberry32 seeded correctly for reproducible boards? The `hashString()` function uses a simple loop — could seed collisions cause identical boards in different rooms?
- **Card score generation**: The rejection sampling loop runs up to 100 attempts to get board value within [20, 30] — could this fail or cause latency spikes?
- **Race conditions**: The reveal flow uses a distributed lock `reveal:${roomCode}` — this serializes ALL reveals for a room. Is this necessary or could optimistic locking (stateVersion) suffice? Could concurrent reveals corrupt game state if the lock fails?
- **Lua JSON quirk**: `luaGameOps.ts` has `emptyObjToArray()` to fix empty arrays becoming `{}` in Lua JSON roundtrips. Is this applied to all affected fields? Could it miss one?

### SECTION 3: Security Posture

Read and audit:

- `server/src/middleware/auth/` — all 4 auth sub-modules (jwtAuth.ts, ipValidation.ts, originValidation.ts, sessionValidation.ts)
- `server/src/config/securityConfig.ts` — session security (8h max age, 5min reconnection token TTL, session rotation on reconnect)
- `server/src/config/rateLimits.ts` — per-event rate limits (e.g., `game:reveal` 5/sec, `room:join:failed` 5/min for enumeration protection)
- `server/src/errors/GameError.ts` — SAFE_ERROR_CODES (19 codes), error detail allowlisting, production Zod scrubbing
- `server/src/validators/` — all 7 schema files (room, player, game, chat, timer, clue, schema helpers)
- `server/src/utils/sanitize.ts` — input sanitization, `removeControlChars()`, `toEnglishUpperCase()`
- `server/src/app.ts` — Helmet with CSP, HSTS, Permissions-Policy; CSRF protection; static asset cache control; body size limits (1MB)
- `server/src/socket/connectionTracker.ts` — per-IP connection limits (10 concurrent), auth failure tracking (10 failures/min = 5min block)

Evaluate:
- **Spymaster information leakage**: Could card types ever leak to non-spymaster clients through any code path — game state emissions, error messages, history entries, replay data, WebSocket broadcasts, debug logging? The visibility rules in `revealEngine.ts:getGameStateForPlayer()` gate `types[]` — but are ALL emission paths using this function?
- **Input validation completeness**: Are all 9+ socket event handlers validated with Zod? Are the REST endpoints in `server/src/routes/` validated? Are there any code paths that accept raw user input without sanitization?
- **Session security**: Is the JWT implementation sound? Could session fixation or hijacking occur? Is the reconnection token flow secure? (Tokens are 256-bit random hex, consumed on use, TTL 5 minutes)
- **Rate limiting gaps**: Are there any events or endpoints without rate limiting that could be abused? Could the auth-failure IP blocking be bypassed via distributed IPs or IPv6 rotation?
- **Redis injection**: Could any user input reach Redis commands unsafely? (Lua scripts use KEYS/ARGV parameterization — verify this is consistent across all 26 scripts)
- **CSP effectiveness**: Is the Content-Security-Policy header strict enough? Are there `unsafe-inline` or `unsafe-eval` allowances? Check the CSP config in `app.ts`.
- **Dependency audit**: Check `server/package.json` — Express 5.2, Socket.io 4.7, jsonwebtoken 9.0, helmet 8.1, zod 4.3. Any known vulnerabilities?

### SECTION 4: Frontend Architecture

Read and analyze:

- `server/src/frontend/store/reactiveProxy.ts` — custom Proxy-based reactive state (intercepts property sets, reference-equality checks, lazy sub-object wrapping, WeakMap cache)
- `server/src/frontend/store/batch.ts` — update batching to coalesce rapid state changes
- `server/src/frontend/store/eventBus.ts` — pub/sub for state change events
- `server/src/frontend/store/selectors.ts` — derived state (isSpymaster, isPlayerTurn, isDuetMode, isMatchMode, canActAsClicker, etc.)
- `server/src/frontend/state.ts` and `stateTypes.ts` — state shape definition
- `server/src/frontend/stateMutations.ts` — state modification functions
- `server/src/frontend/multiplayerSync.ts` — server state reconciliation (merging server state into local reactive state)
- `server/src/frontend/socket-client.ts` and the 4 related socket-client-*.ts modules (connection, events, rooms, storage)
- `server/src/frontend/board.ts` — board rendering
- `server/src/frontend/game.ts` — game orchestration
- `server/src/frontend/game/reveal.ts` and `game/scoring.ts` — reveal animation and score display
- `server/src/frontend/ui.ts` — UI updates
- `server/src/frontend/i18n.ts` — internationalization
- `server/src/frontend/accessibility.ts` — WCAG compliance
- `server/src/frontend/chat.ts` — chat UI
- `server/src/frontend/timer.ts` — timer display
- `index.html` — the SPA entry point (note: uses SRI hashes on scripts)

Evaluate:
- **Reactive proxy reliability**: The proxy wraps sub-objects lazily via WeakMap and skips Set, Map, Node, AudioContext. Are there edge cases with arrays (e.g., `push`, `splice` don't trigger `set` trap)? Could `delete` operations go undetected? Does the batching in `batch.ts` correctly coalesce without losing events?
- **State reconciliation**: When the server sends a full state update via `multiplayerSync.ts`, does it correctly merge without losing local state (e.g., UI-only state like selected card, chat draft) or creating stale data?
- **DOM manipulation efficiency**: With no framework, is DOM manipulation efficient? Are there memory leaks from event listeners not being cleaned up, detached DOM nodes, or intervals/timeouts not cleared?
- **Offline/PWA**: Does the service worker (`server/public/service-worker.js`) handle caching correctly? What happens when a user goes offline mid-game?
- **Accessibility**: Is WCAG 2.1 AA compliance genuine? Check `accessibility.ts` for keyboard navigation, screen reader support, focus management, and ARIA attributes. Check `css/accessibility.css` for focus styles and reduced-motion support. Check color contrast in `css/variables.css`.
- **Mobile experience**: Is the responsive design in `css/responsive.css` complete? Are touch interactions handled? Is the board usable on small screens?
- **Bundle size**: Check `server/esbuild.config.js` — is tree-shaking effective? Are there unnecessary dependencies bundled into the frontend? Is code splitting being used?
- **i18n completeness**: Are all user-facing strings in `index.html` and the 55 frontend modules internationalized? Are the 4 locale files (`server/public/locales/{en,de,es,fr}.json`) complete and consistent with each other?

### SECTION 5: Redis & Data Layer

Read and analyze:

- `server/src/config/redis.ts` — Redis client setup, exponential backoff reconnection with jitter, TLS support, Lua scripting verification, pub/sub health monitoring
- `server/src/config/memoryMode.ts` — in-memory Redis fallback configuration (256MB maxmemory, noeviction policy)
- `server/src/utils/distributedLock.ts` — distributed locking (SET NX PX, exponential backoff with jitter, owner ID for safe release, auto-extension)
- All 26 Lua scripts in `server/src/scripts/` — read each header for KEYS/ARGV/Returns documentation
- `server/src/services/roomService.ts` — room lifecycle, debounced TTL refresh (60s debounce, 500-entry map with 10% eviction)
- `server/src/services/playerService.ts` — player CRUD, Lua-first with WATCH/MULTI fallback pattern, reconnection tokens
- `server/src/services/player/cleanup.ts` — disconnection handling, scheduled cleanup via sorted set, TOCTOU prevention via atomic Lua check
- `server/src/services/player/reconnection.ts` — 256-bit tokens, atomic generation/validation/consumption

Evaluate:
- **Memory leaks**: Could rooms, players, or sessions accumulate without cleanup? The debounce map in `roomService.ts` caps at 500 entries but evicts 10% — could this still grow unbounded? The `localTimers` map in `timerService.ts` caps at 5000 but evicts 10% — is this sufficient?
- **TTL consistency**: Room key, player keys, game key, team sets, and session mappings all need coordinated TTLs. The `atomicRefreshTtl.lua` script refreshes 5 keys together — but could individual keys expire if the refresh fails partway?
- **Lua script correctness**: Do all 26 scripts handle edge cases (nil values, missing keys, concurrent access)? Are return values consistently parsed? The `emptyObjToArray()` workaround in `luaGameOps.ts` handles Lua's `[]` → `{}` JSON issue — is it applied everywhere needed?
- **Lua-first + fallback pattern**: This pattern (try Lua, fall back to WATCH/MULTI) appears in `updatePlayer`, `removePlayer`, and `setSocketMapping`. Is the fallback truly equivalent? Could the non-atomic fallback cause data inconsistency?
- **Memory mode limitations**: What breaks when using embedded Redis (REDIS_URL=memory) vs external? The fly.toml defaults to memory mode — is this safe for production single-instance?
- **Connection resilience**: What happens during a Redis reconnection? The client uses exponential backoff with jitter and 5 retry attempts. Do in-flight operations fail gracefully or could they corrupt state?
- **Pub/Sub reliability**: Could messages be lost during reconnection? The pub/sub health monitor pings periodically — but is there message ordering or delivery guarantee?
- **Distributed lock safety**: The lock uses SET NX PX with owner IDs. Could clock skew between instances cause overlapping locks? Could a GC pause cause a lock to expire mid-operation? The auto-extension interval helps, but is it reliable?

### SECTION 6: Test Quality & Coverage Gaps

Read and assess representative tests:

- `server/src/__tests__/handlers/gameHandlers.test.ts` and `gameHandlersExtended.test.ts` — handler tests
- `server/src/__tests__/integration/fullGameFlow.integration.test.ts` and `handlers.integration.test.ts` — integration tests
- `server/src/__tests__/frontend/` — sample frontend tests (multiplayer.test.ts, multiplayerSync.test.ts, state.test.ts, reactiveProxy.test.ts, board.test.ts)
- `server/src/__tests__/helpers/mocks.ts` and `mockRedisSetup.ts` — mock infrastructure
- `server/src/__tests__/luaScriptLogic.test.ts` and `luaScriptValidation.test.ts` — Lua script tests
- `server/src/__tests__/raceConditions.test.ts` — concurrency tests
- `server/src/__tests__/adversarial.test.ts` and `chaos.test.ts` — adversarial/chaos tests
- `server/e2e/multiplayer.spec.js` and `multiplayer-extended.spec.js` — multiplayer E2E
- `server/e2e/security.spec.js` — security E2E
- `server/e2e/accessibility.spec.js` — a11y E2E

Evaluate:
- **Coverage gaps**: What critical paths lack tests? (Known: no E2E tests for Duet or Match modes — see `docs/GAME_MODES_REVIEW.md` issue #5)
- **Mock fidelity**: Does `mocks.ts` and `mockRedisSetup.ts` accurately simulate Redis behavior (transactions, Lua script execution, pub/sub, TTL expiry)? Could tests pass with mocks but fail in production?
- **Flaky test risks**: Are there timing-dependent tests, shared mutable state between test suites, or port conflicts? Check for `setTimeout` usage in tests, global state mutation, and parallel test isolation.
- **Frontend test depth**: With 55 frontend modules and a custom reactive proxy, is the frontend test coverage adequate? Are the store, selectors, and state mutations well-tested?
- **Missing test categories**: Are there property-based tests (e.g., for PRNG distribution)? Fuzzing for validators? Snapshot tests for UI rendering? Contract tests for the socket event API? Performance regression tests?
- **Test organization**: 131 test files in `__tests__/` — are they well-organized? Are there naming conventions? Are integration tests clearly separated from unit tests?

### SECTION 7: Developer Experience & Operational Maturity

Read and assess:

- `.github/workflows/ci.yml` — CI pipeline (install → lint → typecheck → build → test on Node 22+24 → security audit → Docker build+scan → E2E → gate)
- `.github/workflows/deploy.yml` — auto-deploy on CI success, manual trigger, rollback, health check verification
- `.github/workflows/codeql.yml` — weekly security scanning
- `.github/workflows/release.yml` — manual version bump, changelog, GitHub release
- `server/esbuild.config.js` — frontend build configuration
- `docs/ADDING_A_FEATURE.md` — developer guide (worked example of adding a socket event)
- `CONTRIBUTING.md` — contribution guidelines
- `scripts/` — shell scripts (dev-setup.sh, health-check.sh, pre-deploy-check.sh, redis-inspect.sh)
- `server/loadtest/` — load testing scripts (stress-test.js, memory-leak-test.js)

Evaluate:
- **CI pipeline completeness**: Is the pipeline catching all issues before merge? Node 22+24 matrix testing is good — but are there gaps (no visual regression tests, no performance benchmarks, no bundle size tracking)?
- **Developer onboarding**: How long would it take a new developer to set up and understand the codebase? Is the documentation sufficient? Are the 12+ config files in `server/src/config/` well-organized or fragmented?
- **Observability**: Is logging via Winston structured and useful? Are the `/metrics` and `/health/*` endpoints comprehensive? Could you debug a production issue with current tooling?
- **Error recovery**: What happens when the server crashes? Is game state preserved in Redis? Can it recover gracefully on restart? Does the graceful shutdown in `index.ts` (10s timeout, signal handling) work correctly?
- **Load testing maturity**: Are the load test scripts in `server/loadtest/` representative of real traffic? Do they cover WebSocket connections, not just HTTP?

---

## SECTION 8: Strategic Roadmap

Based on everything you've found, propose:

### 8a. Technical Debt Paydown (next 1-3 months)
Prioritized list of code quality improvements, refactors, and fixes that reduce risk and improve maintainability. For each item, estimate effort (S/M/L) and impact (low/medium/high). Consider:
- The known issues in `docs/GAME_MODES_REVIEW.md` (5 open items)
- Race conditions and concurrency issues discovered in the services layer
- The Lua + WATCH/MULTI fallback duplication across 3 services
- Frontend reactive proxy edge cases
- Test coverage gaps (especially Duet/Match E2E)

### 8b. Feature Enhancements (next 3-6 months)
Features that would significantly improve the player experience or expand the user base. Consider:
- Tournament/ranked play (mentioned in `SERVER_SPEC.md` as future backlog)
- User accounts with persistent stats and game history
- Custom word list creation, sharing, and community word lists
- Game replay viewer with step-through controls
- Enhanced spectator experience (live viewer count, spectator chat improvements)
- Additional game modes or rule variants (e.g., timed Blitz mode, 3-team mode, solo practice)
- Social features (friends lists, invite links, player profiles, achievement badges)
- Mobile app wrapper (Capacitor/TWA) or improved PWA experience
- Voice chat integration (WebRTC or external service integration)
- AI spymaster/guesser for solo play or practice

### 8c. Architecture Evolution (6-12 months)
Larger architectural changes that would enable the next level of scale, reliability, or developer velocity. Consider:
- **Persistence layer**: Adding a database (PostgreSQL/SQLite) for persistent data (user accounts, game history, word lists, achievements) alongside Redis for ephemeral game state
- **Frontend framework decision**: Validate whether vanilla TS remains the right choice at 55 modules and growing, or if migrating to a lightweight framework (Preact, Solid, Svelte) would improve developer velocity and reduce bugs
- **API versioning**: Strategy for evolving the socket event API without breaking older clients
- **Monitoring and alerting**: Production observability stack (error tracking, performance monitoring, uptime alerting)
- **Multi-region deployment**: Fly.io supports multi-region — what would be needed for Redis replication and latency-optimized routing?
- **Automated performance benchmarking**: CI-integrated performance tests to catch regressions
- **Plugin/mod system**: Architecture for community-contributed game modes or rule variants

---

## Output Format

For each section (1-7), use this structure:

```
### [Section Title]

**Strengths**
- Bullet points with specific file references

**Issues Found**
- [CRITICAL/HIGH/MEDIUM/LOW] Description — `file:line` — explanation of impact and root cause

**Recommendations**
1. [Priority] Action item — estimated effort (S/M/L) — expected impact
```

For Section 8, use the sub-section structure above (8a, 8b, 8c).

End with a **Summary Dashboard**:

| Area | Health | Top Issue | Top Opportunity |
|------|--------|-----------|-----------------|
| Architecture | green/yellow/red | ... | ... |
| Game Logic | green/yellow/red | ... | ... |
| Security | green/yellow/red | ... | ... |
| Frontend | green/yellow/red | ... | ... |
| Data Layer | green/yellow/red | ... | ... |
| Testing | green/yellow/red | ... | ... |
| DevEx/Ops | green/yellow/red | ... | ... |

And a **Top 10 Actions** list ordered by impact-to-effort ratio, formatted as:

```
1. [Action] — Effort: S/M/L — Impact: description — Files: list of files to modify
2. ...
```
