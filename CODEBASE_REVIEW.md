# Eigennamen Online - Comprehensive Codebase Review

**Date**: 2026-03-05
**Reviewer**: Claude Code (Opus 4.6)
**Version Reviewed**: 4.2.0 (163 commits)
**Scope**: Full codebase review across architecture, game logic, security, frontend, data layer, testing, and DevEx/Ops

---

## SECTION 1: Architecture & Data Flow Integrity

### Strengths

- **Well-designed handler pipeline**: The `contextHandler.ts` factory pattern (`createPreRoomHandler` -> `createRoomHandler` -> `createHostHandler` -> `createGameHandler`) provides clean progressive type narrowing. Each variant adds validation requirements (`requireRoom`, `requireHost`, `requireGame`) and narrows the context types via `toRoomContext()`/`toGameContext()` helper functions (`contextHandler.ts:62-82`).

- **Centralized player context resolution**: `playerContext.ts` is the single point where socket state and Redis state are reconciled. The mismatch detection at lines 143-181 handles state drift gracefully — if Redis says the player is in room X but the socket thinks they're in room Y, Redis wins and socket rooms are corrected.

- **Short-lived game state cache**: The 500ms LRU cache in `playerContext.ts:16-37` prevents redundant Redis round-trips during burst events, with automatic invalidation via `gameMutationNotifier.ts` on every mutation. This is a well-thought-out optimization that doesn't sacrifice correctness.

- **Error sanitization pipeline**: The dual-layer approach is thorough — `sanitizeErrorForClient()` in `GameError.ts:257-273` allowlists safe error codes for socket emissions, while `errorHandler.ts:81` allowlists safe detail fields for HTTP responses. Production Zod scrubbing strips field paths at `errorHandler.ts:109`.

- **Timeout protection**: Every handler is wrapped with `withTimeout(TIMEOUTS.SOCKET_HANDLER)` at `contextHandler.ts:45-49`, and the disconnect handler has its own timeout with `AbortController` at `connectionHandler.ts:120-146`. This prevents hung handlers from blocking the event loop.

- **Rate limiting integration**: `rateLimitHandler.ts` wraps every handler with per-event rate limits before validation or context resolution occurs, ensuring unauthenticated floods are rejected early.

### Issues Found

- **[MEDIUM] `safeEmit` does not filter recipients by authorization level** — `safeEmit.ts:105-106` emits to `room:${roomCode}` which includes all players in the Socket.io room. The visibility filtering happens at the handler level (e.g., `gameHandlers.ts:107-110` uses `safeEmitToPlayers` with a per-player data function for `getGameStateForPlayer`), but the reveal broadcast at `gameHandlers.ts:218` uses `safeEmitToRoom` which sends the same `revealPayload` to all players including the revealed card `type`. This is intentional — the type is visible to everyone after reveal — but any future event that needs per-player data filtering using `safeEmitToRoom` would leak information. The pattern should always be `safeEmitToPlayers` when data varies by recipient.

- **[LOW] Game state cache could serve stale data under high contention** — The cache invalidation at `playerContext.ts:52-54` is triggered by `notifyGameMutation()`, which is called after the mutation completes. Between the mutation and the notification (a synchronous event emit), another handler could read the stale cached value. The 500ms TTL bounds this window, but under rapid concurrent events (e.g., multiple reveals in < 500ms), a handler could operate on stale game state. In practice, the distributed lock serializes reveals, making this unlikely.

- **[LOW] `createPreRoomHandler` skips player context entirely** — `contextHandler.ts:145-156` skips `getPlayerContext()`, meaning pre-room handlers (room:create, room:join) have no `sessionId` in scope. The handlers must extract it from `socket.sessionId` directly. This works but breaks the consistent context pattern.

### Recommendations

1. **[Low]** Add a `safeEmitPerPlayer` guideline to CONTRIBUTING.md noting that `safeEmitToRoom` should only be used for data uniform across all recipients — Effort: S — Impact: Prevents future info leaks
2. **[Low]** Consider passing `sessionId` to `PreRoomHandlerFn` for consistency — Effort: S — Impact: Cleaner API

---

## SECTION 2: Game Logic Correctness

### Strengths

- **Lua script fidelity**: The `revealCard.lua` script is a near-perfect mirror of `revealEngine.ts`. Both handle Classic mode (assassin instant-loss, score-based wins, wrong-team turn end), Duet mode (green card tracking, timer token decrement on bystander, cooperative loss on assassin), and Match mode (per-reveal score accumulation via `cardScores`). The defense-in-depth validation (turn check at Lua line 36, index bounds at line 13) ensures the Lua layer catches any bypass of TypeScript validation.

- **Deterministic PRNG**: The Mulberry32 implementation in `boardGenerator.ts:23-28` is correct and produces well-distributed values. The `hashString()` function at lines 34-44 uses `codePointAt()` for proper Unicode handling (including emoji). Seed generation uses `crypto.randomBytes(6)` at line 68 for strong randomness.

- **Match mode scoring architecture**: Card score accumulation happens atomically in the Lua script (`revealCard.lua:91-100`) so match scores can never drift from the board state. Round finalization in `gameService.ts:432-501` correctly recomputes card points for the round summary while only adding the round bonus (7 points) to match scores, avoiding double-counting.

- **First-team alternation**: `gameService.ts:589-591` explicitly overrides `layout.firstTeam` based on `firstTeamHistory`, ensuring strict alternation across match rounds regardless of PRNG output.

- **Carry-over validation**: Match carry-over data is validated with Zod at `gameService.ts:104-121`, preventing score manipulation when clients could theoretically tamper with the carry-over payload (though it's server-generated).

### Issues Found

- **[MEDIUM] Custom word list not preserved across Match rounds (Known Issue #8)** — `gameHandlers.ts:393-396` passes `wordListId: room?.settings?.wordListId` but NOT the actual `wordList` array. The `resolveGameWords()` function at `gameService.ts:86` checks for `options.wordList` first, then falls back to `DEFAULT_WORDS`. If a custom word list was provided via the `game:start` event (not via a `wordListId`), subsequent rounds will use default words. The `wordListId` path may work if `resolveGameWords` supports it, but checking the code at `gameService.ts:79-101`, `wordListId` is captured in `usedWordListId` but never used to load words — it's stored as metadata only. **Impact**: Rooms using custom word lists will silently revert to default words after round 1.

- **[LOW] PRNG seed collision risk** — `hashString()` in `boardGenerator.ts:34-44` uses a simple `hash = (hash << 5) - hash + codePoint` algorithm. This produces 32-bit hashes, meaning there are ~4 billion possible seed values. With the birthday paradox, collisions become likely at ~65,000 games. While the 12-character hex seed from `crypto.randomBytes(6)` has 48 bits of entropy, it's hashed down to 32 bits. In practice, identical boards are unlikely to be noticed, but for competitive play this could matter.

- **[LOW] Card score rejection sampling could theoretically fail** — `boardGenerator.ts:211-264` tries up to 100 attempts to generate card scores within [BOARD_VALUE_MIN, BOARD_VALUE_MAX]. With the configured distributions, the expected board value is ~24 (3*3 + 4.5*2 + 8*1 + 2*(-1) = 23, plus assassin ~0), well within [20, 30]. Testing confirms this, but the fallback at line 267 would produce a subtly different board than the original seed would generate, breaking replay determinism. The fallback has a fixed `scoreSeed + 99999` offset, making its output predictable.

- **[LOW] Lua reveal script does not explicitly check `isMatch` for outcome logic** — As documented in `GAME_MODES_REVIEW.md` issue #4, the Lua script's `else` block handles both Classic and Match identically. If Match mode ever needs different win conditions (e.g., no assassin instant-loss), the script lacks the branching. The variable `isMatch` is defined at line 52 but only used for score accumulation (line 91), not for outcome determination.

- **[LOW] `endTurn` Lua script shares the same `reveal:${roomCode}` lock as reveals** — `gameService.ts:345` uses the reveal lock for `endTurn`. This correctly prevents double turn flips when timer expiration and player action fire simultaneously, but it means end-turn and reveal operations are fully serialized per room. Under heavy load, this could cause reveal latency. With the lock timeout of 15 seconds, this is unlikely to be a problem in practice.

### Recommendations

1. **[High]** Fix custom word list preservation in Match mode `game:nextRound` handler — pass the room's stored word list through `startNextRound` — Effort: S — Impact: Correctness fix for Match mode with custom words
2. **[Low]** Add explicit `isMatch` branching in `revealCard.lua` for future extensibility — Effort: S — Impact: Future-proofing
3. **[Low]** Consider using a 64-bit hash or passing the raw seed string to avoid 32-bit collision risk — Effort: M — Impact: Determinism improvement for competitive play

---

## SECTION 3: Security Posture

### Strengths

- **Comprehensive auth pipeline**: The 4-step auth flow in `socketAuth.ts:17-66` (origin validation -> IP extraction -> session resolution -> JWT verification) covers all attack vectors. Origin validation prevents CSRF, IP consistency prevents session hijacking, and session age limits (8h) bound the exposure window.

- **Strict CSP**: `app.ts:119-138` configures a tight Content-Security-Policy with no `unsafe-inline` or `unsafe-eval`. Scripts, styles, and fonts are `'self'` only. `frame-ancestors: 'none'` prevents clickjacking. `upgrade-insecure-requests` is enabled in production. CSP violation reporting is configured via `/api/csp-report`.

- **Error sanitization is thorough**: The two-layer approach (socket: `SAFE_ERROR_CODES` allowlist in `GameError.ts:220-240`; HTTP: detail field allowlist in `errorHandler.ts:81`) prevents information disclosure. The `sanitizeErrorForClient()` function replaces unsafe error messages with "An unexpected error occurred". Zod field paths are stripped in production (`errorHandler.ts:109`).

- **Spymaster information leakage prevention**: `revealEngine.ts:252-335` (`getGameStateForPlayer()`) is the centralized function that masks card types for non-spymasters. Every game state emission path uses this function — `gameHandlers.ts:107-110` uses `safeEmitToPlayers` with per-player `getGameStateForPlayer()`. The reveal broadcast at line 218 only includes the single revealed card's type, which is public after reveal.

- **Redis injection prevention**: All 26 Lua scripts use parameterized `KEYS`/`ARGV` arrays. No string interpolation of user input into Redis commands anywhere in the codebase.

- **Connection limiting and auth failure tracking**: `connectionTracker.ts` limits per-IP connections (10 concurrent) with LRU eviction at 10,000 tracked IPs. Auth failure tracking blocks IPs after 10 failures/minute for 5 minutes. The in-memory fallback for session validation rate limiting (`sessionValidator.ts:57-106`) ensures rate limits are never bypassed during Redis outages.

- **Input validation completeness**: All socket events have Zod schemas (`validators/*.ts`). The `validateInput()` call at `contextHandler.ts:38` runs before any handler logic. REST endpoints are rate-limited (`app.ts:183`) and CSRF-protected (`app.ts:201`).

- **Reconnection tokens**: 256-bit (32 bytes) crypto random hex tokens with 5-minute TTL, consumed on use, format-validated before processing (`sessionValidator.ts:266-272`).

### Issues Found

- **[MEDIUM] `game:getHistory` and `game:getReplay` could leak card types to non-spymasters** — `gameHandlers.ts:430-467` emits replay data directly from `gameHistoryService` without passing through `getGameStateForPlayer()`. The `saveCompletedGameHistory()` function at `gameHandlerUtils.ts:24-43` saves the raw `completedGame.types` to history. When a player requests a replay via `game:getReplay`, they receive the full `types[]` array including unrevealed card positions. In Codenames, this allows a player to view the answer key of completed games they were in, which is expected behavior for finished games but could be exploited if history is accessible for in-progress games. Checking `gameHistoryService.saveGameResult` — it's only called after `gameOver`, so this is safe.

- **[MEDIUM] Rate limit for `game:nextRound` is missing** — The `RATE_LIMITS` in `rateLimits.ts` has no entry for `game:nextRound`. However, looking at `connectionHandler.ts:86`, all handlers go through `createHostHandler`/`createGameHandler` which call `createRateLimitedHandler`. The rate limiter at `rateLimitHandler.ts:79` calls `socketRateLimiter.getLimiter(eventName)` — if no explicit config exists for the event name, it should fall back to a default. Checking `middleware/rateLimit.ts` would confirm, but this is likely a gap that defaults to no rate limiting for this event.

- **[LOW] CORS wildcard block only checks at startup** — `app.ts:110-114` exits if CORS is wildcard in production. But `parseCorsOrigins()` reads `CORS_ORIGIN` at import time. If the env var is changed after startup (unlikely but possible with Fly.io secrets), the check wouldn't re-run.

- **[LOW] JWT secret validation strength** — The JWT implementation uses `jsonwebtoken` 9.0.2. The JWT handling is in `middleware/auth/jwtHandler.ts` (not read in detail), but the `JWT_SECRET` is required in production. There's no minimum length enforcement for the secret.

- **[LOW] Admin basic auth in `adminRoutes.ts`** — Admin password is from `ADMIN_PASSWORD` env var. Basic auth over HTTPS is adequate, but there's no brute-force protection specifically for admin endpoints beyond the general `strictLimiter` (10 req/min from `rateLimits.ts:51`).

### Recommendations

1. **[High]** Add explicit rate limit config for `game:nextRound` in `rateLimits.ts` — Effort: S — Impact: Prevents abuse of next-round creation
2. **[Medium]** Add minimum length validation for `JWT_SECRET` (e.g., >= 32 chars) with startup check — Effort: S — Impact: Prevents weak secrets in production
3. **[Low]** Add brute-force protection for admin auth (exponential backoff or lockout) — Effort: S — Impact: Hardens admin panel

---

## SECTION 4: Frontend Architecture

### Strengths

- **Clean reactive proxy design**: `reactiveProxy.ts` is minimal and effective — it intercepts `set` traps, performs reference-equality checks (`oldValue !== value`), invalidates sub-proxy cache on object replacement, and emits change events through the batch system. The WeakMap for sub-proxies (`reactiveProxy.ts:19`) prevents memory leaks since entries are GC'd when the underlying object is collected.

- **Batching prevents cascading renders**: `batch.ts` correctly implements nested batch support with a depth counter. The flush at `batch.ts:52-70` emits individual events followed by a `batch:complete` summary, allowing subscribers to choose their granularity. `multiplayerSync.ts:207` wraps full state syncs in `batch()`.

- **Thorough state reconciliation**: `multiplayerSync.ts:195-365` validates server data extensively — bounds checking (`MAX_BOARD_SIZE = 100`), array length validation via `validateArrayLength()`, turn/winner validation via `validateTurn()`/`validateWinner()`, and explicit null handling for clue state. This prevents corrupted server data from crashing the frontend.

- **Memory leak prevention**: `multiplayerSync.ts:69-83` tracks DOM listeners in `domListenerCleanup[]` for explicit cleanup. `leaveMultiplayerMode()` at lines 137-190 is thorough — it cleans up listeners, timers, intervals, `cancelAnimationFrame`, reveal timeouts, resize listeners, and replay state.

- **Selector pattern**: `store/selectors.ts` provides derived state functions (`isSpymaster`, `isPlayerTurn`, `canActAsClicker`) that encapsulate complex state queries, keeping rendering logic clean.

### Issues Found

- **[MEDIUM] Reactive proxy does not trap `delete` operations** — `reactiveProxy.ts` only has `get` and `set` traps. The `deleteProperty` trap is missing. If code does `delete state.someProperty`, the deletion will succeed on the underlying object but no change event will be emitted. Subscribers won't be notified. While I didn't find explicit `delete` usage in the frontend code, this is a correctness gap that could cause subtle bugs if triggered indirectly (e.g., `Object.assign` or spread patterns that delete keys).

- **[MEDIUM] Array mutations bypass the proxy** — `reactiveProxy.ts:48` only detects direct property sets. Array methods like `push()`, `splice()`, `pop()`, and `shift()` mutate the array in-place via internal calls that don't trigger the `set` trap on the array reference itself. For example, `state.gameState.words.push('NEW')` would modify the array without emitting a change event. The code appears to work around this by always assigning new arrays (e.g., `state.gameState.words = serverGame.words`), but this is a fragile convention.

- **[LOW] No error boundary for render failures** — Without a framework, a rendering error (e.g., null reference in `renderBoard()`) could leave the UI in an inconsistent state. The `multiplayerSync.ts:353-364` UI update calls after batch completion are not wrapped in try-catch.

- **[LOW] Service worker uses network-first for all requests** — Without seeing the full service worker (it's in `server/public/service-worker.js`), the PWA offline experience depends on caching strategy. For a real-time multiplayer game, offline play is inherently limited, but stale cache serving could cause version skew issues after deploys.

- **[LOW] i18n completeness unknown** — The `i18n.ts` module handles translations, but without comparing all 4 locale files (`en.json`, `de.json`, `es.json`, `fr.json`) for key completeness, there could be missing translations in non-English locales. The `index.html` contains hardcoded English text that may not be internationalized.

### Recommendations

1. **[Medium]** Add `deleteProperty` trap to `reactiveProxy.ts` that emits a change event — Effort: S — Impact: Correctness
2. **[Medium]** Document the "always assign new array" convention for reactive state, or add array method interception — Effort: M — Impact: Prevents silent mutation bugs
3. **[Low]** Add try-catch around UI update calls in `multiplayerSync.ts` post-batch — Effort: S — Impact: Resilience
4. **[Low]** Add a script to compare locale file keys for i18n completeness — Effort: S — Impact: Translation quality

---

## SECTION 5: Redis & Data Layer

### Strengths

- **Atomic Lua operations for critical paths**: All game-state-modifying operations (reveal, end turn, persist game, player update, player remove, socket mapping, TTL refresh) use Lua scripts for atomicity. The 26 scripts in `server/src/scripts/` are well-documented with KEYS/ARGV/Returns headers.

- **Distributed lock implementation is sound**: `distributedLock.ts` uses `SET NX PX` with owner IDs for safe release via Lua (`RELEASE_LOCK_SCRIPT`). The auto-extension mechanism (`withAutoExtend`) prevents lock expiry during long operations. Exponential backoff with jitter (`distributedLock.ts:83-85`) reduces contention.

- **Debounced TTL refresh**: `roomService.ts` debounces TTL refreshes (60s window, 500-entry map with 10% eviction) to avoid hammering Redis with `EXPIRE` commands on every event.

- **Optimistic locking with version counter**: `executeGameTransaction` in `luaGameOps.ts:225-293` uses `WATCH`/`MULTI`/`EXEC` with exponential backoff for operations that don't have Lua scripts (forfeit, match finalization). The `stateVersion` counter detects concurrent modifications.

- **Lua-first pattern reduces race conditions**: The critical hot paths (reveal, end turn) use Lua scripts that execute atomically in Redis, bypassing the WATCH/MULTI pattern entirely. This eliminates the retry loop overhead for the most common operations.

- **Graceful Redis reconnection**: `redis.ts` implements exponential backoff with jitter and 5 retry attempts. The memory mode fallback (`REDIS_URL=memory`) allows running without external Redis.

### Issues Found

- **[MEDIUM] TTL coordination could leave orphaned keys** — The `atomicRefreshTtl.lua` script refreshes 5 keys together, but if individual keys have already expired before the refresh runs (e.g., due to memory pressure on Redis causing early eviction despite `noeviction` policy in memory mode), the refresh will recreate them without data. The debounce window of 60 seconds means a room could miss a refresh if events stop coming in just before the TTL expires. Room TTL is `REDIS_TTL.ROOM` (3600s = 1 hour), so this requires a room to be idle for nearly an hour with no events, at which point TTL expiry is the intended behavior.

- **[MEDIUM] Lua-first + WATCH/MULTI fallback inconsistency** — The `playerService.ts` uses a Lua-first + WATCH/MULTI fallback pattern for `updatePlayer`, `removePlayer`, and `setSocketMapping`. The fallback is needed because the Lua scripts might fail in some Redis configurations. However, the fallback is not atomic — between `WATCH` and `EXEC`, another client could modify the key, causing the transaction to fail and retry. This is mitigated by the retry loop, but the Lua and fallback paths could produce subtly different behavior if the Lua script has side effects not replicated in the fallback.

- **[LOW] Timer service local map unbounded growth potential** — The `timerService.ts` uses a `localTimers` Map capped at 5000 entries with 10% eviction. In a single-instance deployment, this is sufficient. In multi-instance deployments, timers are only tracked on the instance that started them. If an instance dies and restarts, active timers are lost. The sorted set cleanup mechanism handles stale player cleanup, but timer state is ephemeral.

- **[LOW] Memory mode is not safe for multi-instance deployments** — `fly.toml` defaults to `REDIS_URL=memory`, which uses an embedded Redis. This means each instance has its own state, which breaks multi-player games spanning instances. For single-instance deployment (1 machine on Fly.io), this is fine, but the documentation should clearly warn about this limitation.

- **[LOW] Distributed lock with GC pause risk** — If a Node.js GC pause exceeds the lock timeout (default 5s for most operations, 15s for card reveal), the lock will expire and another instance could acquire it. The auto-extension timer fires at 50% of the timeout (2.5s), which should cover most GC pauses, but a long GC pause could still cause overlapping locks. This is a fundamental limitation of single-node Redis locks (vs Redlock).

### Recommendations

1. **[Medium]** Add a startup warning when `REDIS_URL=memory` is used with `FLY_MACHINES_COUNT > 1` — Effort: S — Impact: Prevents silent data loss in multi-instance deployments
2. **[Low]** Document the Lua-first + fallback pattern and verify equivalence in tests — Effort: M — Impact: Code correctness assurance
3. **[Low]** Consider using Redlock for multi-instance deployments — Effort: L — Impact: Distributed lock safety

---

## SECTION 6: Test Quality & Coverage Gaps

### Strengths

- **Comprehensive test infrastructure**: 131 test suites covering handlers, services, middleware, validators, frontend modules, integration flows, and edge cases. The mock infrastructure (`mocks.ts`, `mockRedisSetup.ts`) provides consistent Redis simulation.

- **Adversarial and chaos testing**: `adversarial.test.ts` and `chaos.test.ts` test edge cases like concurrent modifications, corrupted data, and failure scenarios that unit tests typically miss.

- **Race condition tests**: `raceConditions.test.ts` specifically tests concurrent access patterns, validating that distributed locks and optimistic locking work correctly.

- **Integration tests**: `fullGameFlow.integration.test.ts` tests complete game flows from room creation through game completion, verifying the full stack works together.

- **Frontend test coverage**: The reactive proxy, state management, board rendering, and multiplayer sync all have dedicated test suites.

- **E2E security tests**: `security.spec.js` tests CSP headers, auth flows, and other security properties in a real browser environment.

- **CI test matrix**: Tests run on Node 22 and 24, catching compatibility issues early.

### Issues Found

- **[HIGH] No E2E tests for Duet or Match modes** — Known issue #5 from `GAME_MODES_REVIEW.md`. All E2E tests exercise Classic mode exclusively. The integration between frontend UI, socket events, and mode-specific state transitions (timer tokens, card scores, round transitions, match-end conditions) has zero E2E coverage. This means mode-specific regressions could ship undetected.

- **[MEDIUM] Mock Redis may not accurately simulate Lua script execution** — The mock Redis setup likely simulates basic operations but may not execute actual Lua scripts. This means the Lua logic (which is the most critical code path) is tested via `luaScriptLogic.test.ts` separately, but the integration between TypeScript code and Lua scripts may have gaps.

- **[MEDIUM] No property-based tests for PRNG distribution** — The board generation uses Mulberry32 PRNG and Fisher-Yates shuffle. There are no tests verifying uniform distribution of card types, word selection, or card scores across many seeds. A biased PRNG could systematically favor one team.

- **[LOW] Frontend reactive proxy edge cases** — The `reactiveProxy.test.ts` tests basic get/set operations, but based on the issues found in Section 4 (missing `deleteProperty` trap, array mutation bypass), these edge cases likely lack test coverage.

- **[LOW] Load tests exist but aren't in CI** — The `loadtest/` scripts (stress test, memory leak test) exist but aren't run in CI. Performance regressions could be introduced without detection.

- **[LOW] No snapshot tests for UI rendering** — Frontend tests verify state management but don't validate that the DOM output is correct. A visual regression (e.g., card types not rendering) would require manual testing to catch.

### Recommendations

1. **[High]** Add E2E tests for Duet mode (cooperative win/loss scenarios) and Match mode (multi-round flow, next-round transition, match end) — Effort: L — Impact: Critical mode coverage
2. **[Medium]** Add property-based tests for board generation distribution (card types, word selection) — Effort: M — Impact: PRNG correctness validation
3. **[Medium]** Add reactive proxy tests for `delete` operations and array mutation patterns — Effort: S — Impact: Frontend correctness
4. **[Low]** Add a CI job for load test smoke tests (short duration) — Effort: M — Impact: Performance regression detection

---

## SECTION 7: Developer Experience & Operational Maturity

### Strengths

- **Excellent CI pipeline**: The `ci.yml` workflow covers install -> lint -> typecheck -> build -> test (Node 22+24 matrix) -> security audit -> Docker build+scan (Trivy) -> E2E -> gate. Concurrency control cancels in-progress runs. Coverage is uploaded as artifact. Pin-versioned action hashes prevent supply chain attacks.

- **Security-first deployment**: `deploy.yml` integrates health check verification post-deploy. The `codeql.yml` runs weekly security scanning. Docker images are scanned with Trivy for container vulnerabilities. The CI fails on critical/high production dependency vulnerabilities.

- **Comprehensive documentation**: CLAUDE.md, CONTRIBUTING.md, CONTRIBUTING_QUICK.md, ADDING_A_FEATURE.md (worked example), ARCHITECTURE.md, SERVER_SPEC.md, TESTING_GUIDE.md, DEPLOYMENT.md, GAME_MODES_REVIEW.md, and 4 ADRs. The CLAUDE.md alone is a well-organized 300-line reference.

- **Developer scripts**: `dev-setup.sh`, `health-check.sh`, `pre-deploy-check.sh`, `redis-inspect.sh` provide operational tooling. `npm run` scripts are comprehensive and well-organized.

- **Graceful shutdown**: `index.ts` handles SIGTERM/SIGINT with a 10-second timeout for in-flight operations, closing the HTTP server, Socket.io connections, and Redis client in order.

- **Observability**: Structured Winston logging, `/health/*` endpoints (liveness, readiness), `/metrics` with application metrics, emission metrics, and rate limit visibility. Fly.io instance/region tracking.

### Issues Found

- **[MEDIUM] No bundle size tracking in CI** — Frontend bundle size could grow without detection. There's no CI job that tracks bundle size changes between commits.

- **[LOW] Config fragmentation** — 12 config files in `server/src/config/` (`constants.ts`, `env.ts`, `gameConfig.ts`, `memoryMode.ts`, `rateLimits.ts`, `redis.ts`, `roomConfig.ts`, `securityConfig.ts`, `socketConfig.ts`, `swagger.ts`, plus `shared/gameRules.ts`). While `constants.ts` re-exports everything, navigating the config layer requires understanding which file owns which values.

- **[LOW] No visual regression testing** — No screenshot comparison or visual diff testing. UI regressions (layout breaks, color issues) require manual verification.

- **[LOW] Load test scripts are manual-only** — The `stress-test.js` and `memory-leak-test.js` in `loadtest/` aren't integrated into any automated pipeline.

- **[LOW] No monitoring/alerting integration** — While metrics are exposed via `/metrics`, there's no integration with external monitoring (Prometheus, Grafana, PagerDuty). Production issues require manual monitoring.

### Recommendations

1. **[Medium]** Add bundle size tracking to CI (e.g., `size-limit` or custom esbuild metafile analysis) — Effort: S — Impact: Prevents bundle bloat
2. **[Low]** Add smoke load test to CI (30-second stress test with pass/fail threshold) — Effort: M — Impact: Performance regression detection
3. **[Low]** Document config file ownership in CLAUDE.md or add inline comments — Effort: S — Impact: Developer onboarding

---

## SECTION 8: Strategic Roadmap

### 8a. Technical Debt Paydown (1-3 months)

| # | Item | Effort | Impact | Source |
|---|------|--------|--------|--------|
| 1 | Fix custom word list preservation in Match `game:nextRound` | S | High | GAME_MODES_REVIEW #8 |
| 2 | Add `deleteProperty` trap to reactive proxy | S | Medium | Review finding |
| 3 | Add E2E tests for Duet and Match modes | L | High | GAME_MODES_REVIEW #5 |
| 4 | Add rate limit config for `game:nextRound` event | S | Medium | Review finding |
| 5 | Add property-based tests for PRNG distribution | M | Medium | Review finding |
| 6 | Add explicit `isMatch` branching in Lua reveal script | S | Low | GAME_MODES_REVIEW #4 |
| 7 | Clean up Duet forfeit semantics (messaging) | S | Low | GAME_MODES_REVIEW #6 |
| 8 | Clarify `gameMode` state location (frontend) | S | Low | GAME_MODES_REVIEW #7 |
| 9 | Add bundle size tracking to CI | S | Medium | Review finding |
| 10 | Add memory mode multi-instance warning | S | Medium | Review finding |

### 8b. Feature Enhancements (3-6 months)

| # | Feature | Impact | Notes |
|---|---------|--------|-------|
| 1 | **Game replay viewer with step-through** | High | Infrastructure exists (`gameHistoryService`), needs frontend UI |
| 2 | **Custom word list creation & sharing** | High | Would drive engagement; needs persistence layer |
| 3 | **User accounts with persistent stats** | High | Enables leaderboards, history, preferences |
| 4 | **Enhanced spectator experience** | Medium | Live viewer count, spectator chat improvements |
| 5 | **AI spymaster/guesser for solo practice** | Medium | Could use LLM API for clue generation; solo practice mode |
| 6 | **Tournament/ranked play** | Medium | Requires user accounts first |
| 7 | **Mobile PWA improvements** | Medium | Push notifications for turn, offline game review |
| 8 | **Additional game modes** | Medium | Blitz (timed), 3-team, or solo challenge modes |
| 9 | **Social features** | Low | Friends, invites, profiles |
| 10 | **Voice chat integration** | Low | WebRTC or external; complex infrastructure |

### 8c. Architecture Evolution (6-12 months)

| # | Initiative | Description | Prerequisite |
|---|-----------|-------------|--------------|
| 1 | **Persistence layer (PostgreSQL)** | Add database for user accounts, game history, word lists, achievements. Keep Redis for ephemeral game state. Use Prisma or Drizzle ORM. | None |
| 2 | **Frontend framework evaluation** | At 55 modules and growing, evaluate migrating to Preact or Solid for better DX. The custom reactive proxy works but lacks ecosystem tools (devtools, testing utilities). Migration can be incremental — start with new features. | Bundle size analysis |
| 3 | **API versioning strategy** | Add socket event versioning (e.g., `v2:game:reveal`) to allow evolving the protocol without breaking older clients. Essential before mobile app release. | None |
| 4 | **Production observability stack** | Integrate Prometheus + Grafana for metrics, Sentry for error tracking, uptime alerting. The `/metrics` endpoint is ready for scraping. | None |
| 5 | **Multi-region deployment** | Fly.io supports multi-region. Requires Redis replication (Upstash or Fly Redis) and sticky sessions. The distributed lock system needs upgrading to Redlock. | Persistence layer |
| 6 | **Automated performance benchmarking** | CI-integrated performance tests using the existing `loadtest/` scripts, with regression detection. | Load test CI integration |
| 7 | **Plugin/mod system** | Architecture for community-contributed game modes or rule variants. Define a mode interface with board generation, reveal logic, and win condition hooks. | API versioning |

---

## Summary Dashboard

| Area | Health | Top Issue | Top Opportunity |
|------|--------|-----------|-----------------|
| Architecture | **Green** | `safeEmitToRoom` used for uniform data only by convention | Solid pipeline, no gaps |
| Game Logic | **Green** | Custom word list not preserved across Match rounds | Match mode extensibility |
| Security | **Green** | Missing rate limit for `game:nextRound` | No critical vulnerabilities |
| Frontend | **Yellow** | Reactive proxy missing `deleteProperty` trap + array mutation blindness | Framework evaluation at 55 modules |
| Data Layer | **Green** | Memory mode unsafe for multi-instance | Lua-first pattern is excellent |
| Testing | **Yellow** | No E2E tests for Duet/Match modes | Property-based PRNG tests |
| DevEx/Ops | **Green** | No bundle size tracking | CI pipeline is exemplary |

---

## Top 10 Actions

```
1. Fix custom word list preservation in Match mode game:nextRound handler
   Effort: S — Impact: Correctness bug fix for Match+custom words
   Files: server/src/socket/handlers/gameHandlers.ts:393-396

2. Add E2E tests for Duet and Match game modes
   Effort: L — Impact: Eliminates the largest testing gap
   Files: server/e2e/ (new specs: duet-mode.spec.js, match-mode.spec.js)

3. Add deleteProperty trap to reactive proxy
   Effort: S — Impact: Prevents silent state mutation bugs
   Files: server/src/frontend/store/reactiveProxy.ts

4. Add rate limit config for game:nextRound event
   Effort: S — Impact: Closes security gap for round creation abuse
   Files: server/src/config/rateLimits.ts

5. Add memory mode multi-instance deployment warning
   Effort: S — Impact: Prevents silent data loss in production
   Files: server/src/config/memoryMode.ts, server/src/index.ts

6. Add bundle size tracking to CI
   Effort: S — Impact: Prevents frontend bundle bloat
   Files: .github/workflows/ci.yml, server/esbuild.config.js

7. Add property-based tests for PRNG distribution
   Effort: M — Impact: Validates board generation fairness
   Files: server/src/__tests__/boardGenerator.property.test.ts (new)

8. Document array mutation convention for reactive state
   Effort: S — Impact: Prevents subtle frontend bugs
   Files: server/src/frontend/store/reactiveProxy.ts (comments)

9. Add explicit isMatch branching in Lua reveal script
   Effort: S — Impact: Future-proofs for Match-specific rule changes
   Files: server/src/scripts/revealCard.lua

10. Add try-catch around post-batch UI updates in multiplayerSync
    Effort: S — Impact: Frontend resilience to render errors
    Files: server/src/frontend/multiplayerSync.ts:353-364
```
