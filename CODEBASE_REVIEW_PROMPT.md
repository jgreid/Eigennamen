# Comprehensive Codebase Review Prompt

> **Usage**: Copy this prompt into a new Claude Code session (or any AI assistant with codebase access) to get a thorough, actionable review. The prompt is structured in phases — each phase can be run independently or sequentially. For best results, run it against the full codebase with tools that can read files, search code, and execute commands.

---

## Preamble

You are conducting a comprehensive code review of the Eigennamen Online codebase — a real-time multiplayer web game built with Node.js, TypeScript, Express, Socket.io, and Redis. The project has ~71,500 lines of TypeScript across 246 files, with 2,735+ tests, and deploys to Fly.io.

Before you begin: read `CLAUDE.md` at the project root for full architectural context, then explore the directory structure. Your review should be **specific** — reference exact file paths, line numbers, function names, and code patterns. Avoid vague observations. Every finding should include a concrete recommendation with estimated effort (small/medium/large).

Structure your review as a prioritized report with these phases:

---

## Phase 1: Architecture & Structural Analysis

### 1.1 Service Layer Cohesion
Examine every file in `server/src/services/` and its sub-modules (`game/`, `player/`, `room/`):
- Are service boundaries clean? Does any service reach into another service's domain (e.g., `gameService` directly manipulating player data that should go through `playerService`)?
- Are there circular dependencies between services? Run `grep -r "import.*from.*services/" server/src/services/` and map the dependency graph.
- Is the decomposition into sub-modules (e.g., `player/mutations.ts`, `player/queries.ts`, `player/reconnection.ts`) consistent across all services, or are some services monolithic while others are heavily decomposed?
- `gameHistoryService.ts` is ~793 LOC — analyze whether it has multiple responsibilities that should be split.

### 1.2 Handler Architecture
Review `server/src/socket/handlers/` and the `contextHandler.ts` pattern:
- Is the context handler pattern (`createRoomHandler`, `createHostHandler`, `createGameHandler`, `createPreRoomHandler`) applied consistently across ALL socket handlers?
- Are there any handlers that bypass the context handler and do their own validation/player-resolution?
- Check handler files for business logic that should be in the service layer. Handlers should be thin delegation layers — flag any that contain logic beyond orchestration.
- Map the handler registration in `server/src/socket/index.ts` (or `connectionHandler.ts`) and verify every event in `socketConfig.ts` has a corresponding handler.

### 1.3 Frontend Module Organization
Analyze `server/src/frontend/` (39 modules):
- `socket-client.ts` is ~886 LOC and is built as an IIFE bundle (separate from the ES module system), exposing a global `EigennamenClient`. Is this separation justified? Could it be an ES module like everything else?
- The frontend has a sophisticated state management pattern: `state.ts` (singleton), `stateTypes.ts` (discriminated unions), `stateMutations.ts` (updates), with a `setState()` function that logs to a debug history. Is this pattern consistently used, or do some modules bypass it and mutate state directly?
- The multiplayer system has its own module decomposition (`multiplayer.ts`, `multiplayerUI.ts`, `multiplayerSync.ts`, `multiplayerListeners.ts`, `multiplayerTypes.ts`). Is this decomposition clean? Are the responsibilities between `Sync` and `Listeners` clearly separated?
- Is there dead code in the frontend? Are all 40 modules actually imported and used? Is there an `app.ts` entry point that wires everything, or are there orphaned modules?
- The frontend uses event delegation via `data-action` attributes on a central click listener. Is this pattern applied consistently, or do some modules add their own click handlers directly?

### 1.4 Build Pipeline Analysis
Review the build process:
- The frontend uses `tsc -p tsconfig.frontend.json` to compile TypeScript to `public/js/modules/`. Is there tree-shaking? Does dead code get shipped to clients?
- There's also `esbuild.config.js` and a `build:frontend:bundle` script. The esbuild config produces code-split chunks (`chunks/[name]-[hash].js`). When is esbuild used vs. plain tsc? Is there a dual build path that could diverge? Is the `build` script (tsc-only) missing esbuild optimizations that `build:prod` includes?
- Compare `build` vs `build:prod` scripts in `package.json`. Are there production optimizations (minification, source maps, tree-shaking) that are missing from the default build?
- Is the compiled frontend output (`server/public/js/modules/`) checked into git? Should it be?

### 1.5 Middleware Layer
Review `server/src/middleware/` (10 files including `auth/` sub-modules):
- Is middleware composition order correct and documented? (e.g., does CSRF check run before body parsing? Does rate limiting run before auth?)
- The auth chain has 4 sub-modules (`clientIP.ts`, `originValidator.ts`, `sessionValidator.ts`, `jwtHandler.ts`). Is this decomposition well-factored or is there unnecessary indirection for what could be simpler?
- Check `contextHandler.ts` — does it handle all edge cases (player disconnected between validation and handler execution, room deleted mid-request)?
- Are Express middleware and Socket.io middleware consistent in their error handling approach?

### 1.6 Standalone vs Multiplayer Mode
The project supports two modes — standalone (URL-encoded state) and multiplayer (Socket.io):
- How much game logic is shared between the two modes? Is there duplication in `index.html` / frontend modules vs the server-side game service?
- If the PRNG (Mulberry32) runs on both client and server, are the implementations identical? Could they diverge?
- Does the standalone mode have the same validation rigor as multiplayer, or is it trusted client-side?

### 1.7 Game Mode Parity
Three modes exist: Classic, Blitz, and Duet:
- Are all three modes equally well-tested? Check test coverage per mode.
- Is Duet mode's cooperative logic (timer tokens, team-colored cards counting as green) cleanly separated from the competitive Classic/Blitz logic, or is it interleaved with `if (isDuet)` conditionals throughout?
- Are game mode rules configured declaratively in `gameConfig.ts` or spread across service code?

---

## Phase 2: Code Quality & Cleanup

### 2.1 Type Safety Audit
- Search for `any` usage across the codebase: `grep -r ": any" server/src/`. Categorize findings:
  - **Production code**: Any `any` types in `server/src/` (excluding `__tests__/`) are high-priority fixes.
  - **Test code**: `any` in tests is lower priority but can mask bugs. Are test mocks properly typed?
  - Check `catch (e: any)` patterns — can these use `unknown` with type guards instead?
- Search for `as` type assertions: `grep -r " as " server/src/`. Are there unsafe casts that could be eliminated with proper generics or type narrowing?
- Check `server/src/types/` — are interfaces well-organized or is there duplication? Are there types defined in service files that should be centralized?
- Verify the `noUncheckedIndexedAccess` tsconfig flag is effective. Are there array/object accesses that bypass it with `!` (non-null assertions)?

### 2.2 Large File Analysis
Identify files over 300 LOC and assess whether they should be split:
- `server/src/services/gameHistoryService.ts` (~793 LOC)
- `server/src/config/redis.ts` (~531 LOC)
- `server/src/config/swagger.ts` (~373 LOC)
- `server/src/config/jwt.ts` (~288 LOC)
- `server/src/config/env.ts` (~220 LOC)
- `server/src/frontend/socket-client.ts` (~886 LOC)
For each: does the file have a single cohesive responsibility, or are there natural split points?

### 2.3 Code Duplication
Look for repeated patterns:
- **Turn-switching logic**: The "if red then blue, if blue then red" pattern appears in multiple Lua scripts (`revealCard.lua`, `endTurn.lua`) and possibly in TypeScript. Can this be abstracted?
- **Error emission patterns**: Check if `socket.emit('X:error', ...)` is done consistently across all handlers or if some use different patterns.
- **Redis key construction**: Are Redis key patterns (e.g., `room:{code}`, `game:{code}`, `player:{id}`) defined as centralized constants or scattered as string literals?
- **Timeout wrapping**: Is `withTimeout()` applied consistently to all async service calls, or are some missing it?
- **Stats computation**: Check if room stats computation (`getRoomStats`, `computeFallbackStats`) is duplicated across handlers.

### 2.4 Dead Code
- Are all exports from `server/src/config/constants.ts` (the barrel re-export) actually used? Run import analysis.
- Check for exported functions in services that have no callers.
- Are there event constants in `socketConfig.ts` that are defined but never emitted or listened to?
- Look for commented-out code blocks (not just single-line comments) that should be removed.
- Check if all frontend handler modules in `server/src/frontend/handlers/` are imported and registered.

### 2.5 Naming & Convention Consistency
- Are error codes in `errorCodes.ts` consistently SCREAMING_SNAKE_CASE?
- Do socket events in `socketConfig.ts` consistently follow the `namespace:action` / `namespace:actionResult` naming?
- Are service methods consistently named (e.g., `createX`, `getX`, `updateX`, `deleteX`)?
- Check for inconsistent import styles — are some files using `import * as X` while others use named imports for the same module?

---

## Phase 3: Performance & Optimization

### 3.1 Redis Operations
- **N+1 query patterns**: Check if any code paths fetch a list of IDs and then make individual Redis calls for each. Look for patterns like `Promise.all(ids.map(id => redis.get(...)))` that could be replaced with `MGET`.
- **Lua script efficiency**: Review the 6 Lua scripts in `server/src/scripts/`. Are there scripts that read the full game state JSON, modify one field, and write it all back? Could incremental updates via Redis hashes be more efficient for frequently-changed fields?
- **Serialization overhead**: The game state appears to be stored as a single JSON blob in Redis. For a 25-card board with history, what's the typical payload size? Could hot fields (scores, turn, revealed) be stored separately as hash fields?
- **TTL management**: Check if TTL refresh operations are debounced (the code mentions `debouncedRefreshRoomTTL`). Is the debounce interval appropriate? Are there paths that refresh TTL unnecessarily?
- **Pub/Sub overhead**: Review `@socket.io/redis-adapter` usage. For single-instance deployment on Fly.io, is the Redis adapter adding unnecessary overhead? Is it conditionally disabled when not needed?

### 3.2 Socket.io Performance
- **Event payload sizes**: Check what data is sent with each event. Are entire room/game state objects broadcast when only diffs are needed? (e.g., does `game:cardRevealed` send the full board or just the revealed card?)
- **Room-level broadcasts**: When `safeEmitToRoom` is used, does it send different data to spymasters vs. guessers, or does it send everything and rely on the client to filter?
- **Connection handling**: Review disconnect/reconnect flow. Is there connection debouncing to handle flaky mobile connections? What happens during rapid disconnect/reconnect cycles?
- **Rate limiting memory**: The `rateLimitHandler.ts` maintains per-socket, per-event tracking. What's the memory footprint with 100+ concurrent users? Is LRU eviction working correctly?

### 3.3 Frontend Performance
- **Module loading**: How are the 39 frontend modules loaded? Is there lazy loading or are all modules loaded upfront?
- **DOM manipulation patterns**: Review `board.ts` and `game.ts` for DOM operations. Are there patterns that cause layout thrashing (reading then writing DOM repeatedly)?
- **Event listener cleanup**: When switching between game states or rooms, are event listeners properly cleaned up to prevent memory leaks?
- **i18n payload**: Are all 4 locale files loaded upfront or only the active one? What's the combined payload size?

### 3.4 Load Testing
The project includes load testing scripts (`server/loadtest/`):
- Review `stress-test.js` and `memory-leak-test.js`. Are they comprehensive? Do they simulate realistic game scenarios (multiple rooms, card reveals, reconnections)?
- Have the load tests been run recently? Are there documented results or benchmarks?
- What's the expected concurrent user capacity for the current Fly.io deployment (512MB, shared CPU)?
- Is there a performance regression testing step in CI, or is load testing purely manual?

### 3.5 Memory Management
- **Game history growth**: `gameHistoryService.ts` stores game history with a cap. What's the cap? Is there a maximum game history entry size? Could a very long game with many reveals create a large Redis value?
- **In-memory metrics**: `utils/metrics.ts` stores histogram values as arrays. Are these bounded? What happens if histograms grow indefinitely during a long-running server?
- **Rate limiter cleanup**: Verify that rate limiting state for disconnected sockets is cleaned up promptly.
- **Timer service**: Review `timerService.ts` — are `setInterval`/`setTimeout` handles properly tracked and cleared? Could timer leaks occur during edge cases (server restart during active game)?

---

## Phase 4: Security Review

### 4.1 Authentication & Authorization
- Review the 4-step auth chain in `server/src/middleware/auth/`. Is there any way to bypass the chain?
- Check JWT handling in `config/jwt.ts`: What algorithm is used? Is `HS256` with a symmetric secret, and is the secret required to be strong (minimum length, entropy)?
- Review reconnection token handling: What's the token entropy? Are tokens single-use? What prevents replay attacks?
- Check `ALLOW_IP_MISMATCH` — when enabled, what's the actual risk surface? Is this documented clearly enough for operators?

### 4.2 Input Validation
- Are ALL socket event handlers wrapped with Zod validation via the context handler? Check for any handler that accepts raw `data` without validation.
- Review Zod schemas in `server/src/validators/` for completeness:
  - Are string lengths bounded everywhere?
  - Are numeric inputs bounded (e.g., timer values, player counts)?
  - Is there Unicode normalization to prevent homograph attacks on nicknames?
  - Are word lists validated for size and content?
- Check for any raw `JSON.parse()` calls that could throw and aren't wrapped in try/catch. Is `tryParseJSON` used consistently?

### 4.3 Rate Limiting
- Is rate limiting applied to ALL socket events, or are some events exempt? Are exempt events documented with justification?
- Review rate limit values in `config/rateLimits.ts`. Are they tuned for real-world usage or are the defaults too permissive?
- Is there connection-level rate limiting (max connections per IP) in addition to event-level rate limiting?
- Can a malicious client exhaust server resources by opening many Socket.io connections before rate limiting kicks in?

### 4.4 Client-Side Security
- `index.html` uses Subresource Integrity (SRI) hashes on external scripts. Are all external resources covered? Are the hashes up-to-date with the actual file contents?
- The `socket-client.ts` IIFE exposes a global `EigennamenClient` object. Could a malicious page script tamper with this object before the ES module code runs?
- Is Content Security Policy (CSP via Helmet) strict enough? Does it allow `unsafe-inline` for styles (and if so, can it be tightened with nonces)?
- The `app-fallback.js` script handles module load failures. Could this fallback path be exploited?

### 4.5 Data Exposure
- When game state is sent to clients, is the spymaster key (card types) properly filtered for non-spymaster players? Check `game:started`, `room:resynced`, and `game:cardRevealed` events.
- Review admin routes authentication. Is the admin API protected against CSRF? Is the admin password hashed or compared in constant time?
- Check for any PII in logs (session IDs, IP addresses, nicknames). Is log rotation configured?
- Are Redis keys prefixed or namespaced to prevent collision if multiple instances share a Redis server?

---

## Phase 5: Testing Quality

### 5.1 Test Coverage Gaps
- Run `npm run test:coverage` and identify modules below the 80% threshold. For each:
  - Is the coverage gap in error paths, edge cases, or core logic?
  - Are there integration-level paths that unit tests miss?
- Check coverage of Lua scripts. Are the Lua scripts tested through integration tests, or is there a gap between unit tests (which mock Redis) and the actual Lua execution?
- Review E2E tests in `server/e2e/`. Do they cover the complete game lifecycle including edge cases (disconnection mid-game, timer expiry, host migration)?

### 5.2 Test Quality
- Sample 5 test files across different domains. For each, check:
  - Are tests isolated (no shared mutable state between tests)?
  - Are mocks properly reset in `beforeEach`/`afterEach`?
  - Do test names describe behavior ("should reject duplicate nickname") rather than implementation ("calls validateNickname")?
  - Are there flaky test indicators (timeouts, `waitFor` with hardcoded delays, order-dependent tests)?
- Review `__tests__/helpers/mocks.ts` (644 LOC): Is the mock Redis a faithful simulation? What Redis behaviors does it NOT mock (Lua scripting, transactions, pub/sub)?
- Are test files over 1000 LOC (e.g., `playerService.test.ts` at 1369 LOC) well-organized with `describe` blocks, or are they flat lists of `it` statements?

### 5.3 Test Infrastructure
- Is `jest.config.ts.js` properly configured for both backend (node) and frontend (jsdom) projects?
- The config has `forceExit: true` and `detectOpenHandles: true` — does this indicate resource cleanup issues? Can `forceExit` be removed?
- Are test timeouts (15s default) appropriate, or are they hiding slow tests?
- Check if the mutation testing configuration (Stryker) covers critical modules. What's the mutation score?

---

## Phase 6: Dependency & Infrastructure

### 6.1 Dependency Health
- Check for known vulnerabilities: `npm audit --production`
- Review dependency versions in `package.json`:
  - `express` at ^5.2.1 (Express 5 is relatively new). Are there any Express 5 migration issues or deprecated patterns from Express 4?
  - `zod` at ^4.3.6 (Zod 4). Is the upgrade from Zod 3 complete? Any lingering Zod 3 patterns?
  - `jest` at ^30.2.0 and `ts-jest` at ^29.4.0. Is there a version mismatch that could cause issues?
  - Are all `@types/` packages aligned with their runtime counterparts?
- Are there dependencies that could be replaced with built-in Node.js APIs? (e.g., `uuid` — Node 20+ has `crypto.randomUUID()`)

### 6.2 Docker & Deployment
- Review the Dockerfile in `server/`. Is it using multi-stage builds? Is the image size optimized?
- Check `fly.toml`: Is the `512mb` memory appropriate for the workload? What's the memory usage profile?
- Review health check endpoints — is `/health/ready` comprehensive enough? Does it check Redis connectivity?
- Is graceful shutdown in `server/src/index.ts` properly implemented? Does it drain WebSocket connections before exiting?

### 6.3 CI/CD Pipeline
- Review `.github/workflows/ci.yml`:
  - Is the job parallelization optimal? Can any sequential jobs be parallelized?
  - Are artifacts properly cached between jobs?
  - Is there a security scanning step (CodeQL, npm audit)?
  - Does the E2E test job test against the production build or the development server?
- Check if there's a staging environment or if deployments go directly to production.
- Review Dependabot configuration (`.github/dependabot.yml`) — are critical dependencies on auto-merge?

---

## Phase 7: Frontend Quality & UX

### 7.1 CSS Architecture
Review `server/public/css/` (8 stylesheets, ~3,940 lines, ~612 selectors):
- `variables.css` defines design tokens as CSS custom properties. Are all variables actually used? Are there orphaned variables?
- `modals.css` is 983 lines with 152 selectors — the largest CSS file. Should it be split by modal type (settings, game-over, multiplayer)?
- `components.css` (886 lines, 136 selectors) — is there selector duplication or overly specific selectors that could be simplified?
- The project uses glassmorphism (`backdrop-filter: blur()`, semi-transparent backgrounds). Is this consistent across all views? Are there fallbacks for browsers that don't support `backdrop-filter`?
- Responsive breakpoints exist in `responsive.css` at 500px, 768px, 1024px. Is the mobile experience functional or just shrunk desktop?
- Check for accessibility: sufficient color contrast ratios, visible focus indicators, `prefers-reduced-motion` support, `prefers-color-scheme` support (the app appears dark-mode only — is that intentional?).

### 7.2 i18n Completeness
Review `server/public/locales/` (en, de, es, fr — ~294 lines each, 100+ keys):
- Are all user-facing strings in the locale files, or are some hardcoded in JS/HTML? Check `index.html` for strings not wrapped with `data-i18n` attributes.
- Are all 4 locale files in sync (same keys, no missing translations)? Diff the key sets.
- The system uses `{{param}}` interpolation. Are all interpolation parameters supplied correctly in all languages?
- Locale-specific word lists exist (`wordlist-de.txt`, `wordlist-es.txt`, `wordlist-fr.txt`). Are these loaded dynamically when the language changes?
- Are error messages from the server also translated, or only client-side UI strings?
- Is there a mechanism to detect missing translations at build time or in CI?

### 7.3 Accessibility
The project claims colorblind mode, keyboard navigation, and screen reader support:
- Is colorblind mode a CSS-only toggle or does it require JS changes?
- Are all interactive elements keyboard-accessible? Check tab order on the game board.
- Are ARIA labels present on dynamic content (card reveals, score updates, timer changes)?
- Do the E2E accessibility tests (`e2e/accessibility.spec.js`) actually test screen reader interactions, or just DOM attributes?

### 7.4 PWA & Offline
Check `server/public/manifest.json`:
- Is there a service worker for offline support?
- Does the standalone mode actually work offline, or does it require the server for assets?
- Are PWA best practices followed (icons, theme colors, display mode)?

### 7.5 Admin Dashboard
Review `server/public/admin.html`:
- Is the admin dashboard a separate SPA or a simple HTML page? Does it share any code with the main game frontend?
- Is real-time data (SSE stream at `/admin/api/stats/stream`) properly handled with reconnection on disconnect?
- Is the admin UI accessible without JavaScript (graceful degradation)?

---

## Phase 8: Observability & Operations

### 8.1 Logging Quality
Review Winston logging configuration and usage:
- Is the log level hierarchy (error > warn > info > debug) used correctly? Are there `info` logs that should be `debug`?
- Are correlation IDs (`correlationId`) attached to all log entries consistently? Check for log statements that miss context.
- Is structured logging used everywhere, or are some logs plain strings (`logger.info("something happened")` vs `logger.info("event", { data })`)?
- Are sensitive fields (tokens, passwords, full game state) excluded from logs?
- What's the log volume at `info` level for a typical game session? Could it be excessive?

### 8.2 Metrics & Monitoring
Review `server/src/utils/metrics.ts` and health endpoints:
- Are the custom metrics (counters, gauges, histograms) comprehensive enough for production debugging?
- Is the Prometheus endpoint (`/health/metrics/prometheus`) correctly formatted? Are metric names following Prometheus naming conventions?
- Are there metrics for Redis operation latency, Socket.io event processing time, and room lifecycle events?
- Is the SSE metrics stream (`/admin/api/stats/stream`) properly bounded (backpressure if client is slow)?

### 8.3 Distributed Systems Concerns
- Review the distributed lock system mentioned in CLAUDE.md. Where is it implemented? Is it used for all critical sections?
- What happens if a server instance crashes without releasing its locks? Is there a TTL on locks?
- Review the `@socket.io/redis-adapter` configuration. Are sticky sessions required? Is there a load balancer configuration guide?
- How does the timer service handle multi-instance scenarios? Can two instances both tick the same timer?

### 8.4 Audit Trail
Review `server/src/services/auditService.ts`:
- What security events are audited? Are all authentication failures, authorization failures, and rate limit violations logged?
- Is the audit log stored in Redis or a separate persistence layer? What's the retention policy?
- Is the audit log queryable through the admin API? What filters are available?

---

## Phase 9: Documentation & Developer Experience

### 9.1 Code Documentation
- Are complex algorithms documented? Specifically check:
  - Mulberry32 PRNG in `gameService.ts` or `boardGenerator.ts`
  - The Lua scripts (which are inherently harder to understand without context)
  - The auth chain in `middleware/auth/`
  - The reconnection flow across `playerService` and `roomHandlers`
  - The frontend state management pattern (`state.ts` / `stateMutations.ts` / `stateTypes.ts`)
- Are JSDoc comments present on public service methods? Are they accurate and up-to-date?
- Is `CLAUDE.md` accurate? Do file counts, test counts, and directory descriptions match reality?
- Review the 4 Architecture Decision Records in `docs/adr/`. Are they still current? Are there significant architectural decisions that lack an ADR (e.g., the choice to use vanilla TypeScript with no framework, the IIFE pattern for socket-client)?

### 9.2 Error Messages
- Are user-facing error messages (sent via socket events) helpful and non-leaky? Do they avoid exposing internals?
- Is there consistent error response structure across all error events?
- Are error codes in `errorCodes.ts` comprehensive? Are there error paths that use raw strings instead of defined codes?

### 9.3 Developer Onboarding
- Can a new developer run the project with just `docker compose up -d --build`? Are there any undocumented prerequisites?
- Are environment variables documented with valid examples? Is `.env.example` complete?
- Is the test suite reliably green on a fresh clone? Are there tests that depend on external services or specific system state?

---

## Output Format

For each finding, provide:

```
### [Category] Finding Title
- **Location**: file path(s) and line numbers
- **Severity**: Critical / High / Medium / Low / Info
- **Type**: Bug / Performance / Security / Cleanup / DX
- **Description**: What the issue is, with specific code references
- **Recommendation**: Concrete fix with code sketch if applicable
- **Effort**: Small (< 1 hour) / Medium (1-4 hours) / Large (4+ hours)
```

At the end, provide:
1. **Top 10 Priority Actions**: Ordered by impact/effort ratio
2. **Quick Wins**: Changes under 1 hour that meaningfully improve the codebase
3. **Technical Debt Roadmap**: Larger improvements organized into phases (next sprint, next month, next quarter)
4. **Metrics Summary**: Total findings by severity and type
