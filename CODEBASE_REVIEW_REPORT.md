# Eigennamen Online - Comprehensive Codebase Review Report

**Date**: 2026-02-24
**Scope**: Full 9-phase review covering architecture, code quality, performance, security, testing, infrastructure, frontend UX, observability, and documentation.

## Executive Summary

This review covers all 9 phases defined in `CODEBASE_REVIEW_PROMPT.md`. The codebase is **remarkably well-engineered** — clean architecture, comprehensive testing (2,735+ tests, 94%+ coverage), strong security posture, and thoughtful documentation. Findings are predominantly cleanup opportunities rather than bugs or vulnerabilities.

**Totals**: 0 Critical, 2 High, 20 Medium, 11 Low, 9 Info/Positive findings.

---

## Findings

### [Code Quality] GameHistoryEntry Type Name Collision
- **Location**: `server/src/services/gameHistoryService.ts` and `server/src/types/game.ts`
- **Severity**: High
- **Type**: Bug / Cleanup
- **Description**: Both files define a type called `GameHistoryEntry` with different shapes. The service file defines its own local interface while `types/game.ts` exports a different one. This creates confusion about which type is the canonical one and risks silent mismatches when imports come from different sources.
- **Recommendation**: Consolidate into a single authoritative definition in `types/gameHistory.ts`. Re-export from the types barrel. Delete the duplicate.
- **Effort**: Small (< 1 hour)

### [Code Quality] Redis Key Strings Scattered Across 15+ Files
- **Location**: `server/src/services/roomService.ts`, `playerService.ts`, `timerService.ts`, `gameHistoryService.ts`, Lua scripts, handlers
- **Severity**: High
- **Type**: Cleanup / DX
- **Description**: Redis key patterns like `room:${code}`, `player:${sessionId}`, `timer:${code}`, `game:${code}:history` are constructed inline in 15+ files with no central registry. This makes key format changes risky and makes it hard to audit all keys the system uses.
- **Recommendation**: Create `server/src/config/redisKeys.ts` with functions like `redisKeys.room(code)`, `redisKeys.player(sessionId)`, `redisKeys.timer(code)`. Use throughout. For Lua scripts, pass the full key as `KEYS[]` (which most already do).
- **Effort**: Medium (1-4 hours)

### [Architecture] gameHistoryService.ts Needs Decomposition
- **Location**: `server/src/services/gameHistoryService.ts` (~793 LOC)
- **Severity**: Medium
- **Type**: Cleanup / DX
- **Description**: This is the largest service file by a significant margin. It mixes type definitions, validation logic, replay building, and storage operations. Other services are well-decomposed (e.g., `gameService` delegates to `game/boardGenerator`, `game/revealEngine`, `game/luaGameOps`).
- **Recommendation**: Extract types to `types/gameHistory.ts`, validation to `validators/gameHistorySchemas.ts`, replay builder to `services/game/replayBuilder.ts`. Keep the service as a thin orchestration layer.
- **Effort**: Medium (1-4 hours)

### [Code Quality] Dead Exported Functions in gameHistoryService
- **Location**: `server/src/services/gameHistoryService.ts` — `cleanupOldHistory()`, `getHistoryStats()`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: These two exported functions are never called anywhere in the production codebase. They appear to be remnants of planned features that were never wired up.
- **Recommendation**: Delete both functions and their associated tests. If needed later, they can be restored from git history.
- **Effort**: Small (< 1 hour)

### [Code Quality] Dead Socket Event Constants
- **Location**: `server/src/config/socketConfig.ts`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: Several exported constants are never referenced in production code: `ROOM_LEFT`, `TIMER_START`, `CHAT_ERROR`, `SPECTATOR_DENY_JOIN`. These create noise and false signals about the event system's actual surface area.
- **Recommendation**: Remove unused constants. Add a comment noting which events are client-only vs server-only to prevent future dead constants.
- **Effort**: Small (< 1 hour)

### [Code Quality] TeamNames Type Defined 3 Times
- **Location**: `server/src/types/game.ts`, `server/src/services/gameService.ts`, `server/src/frontend/stateTypes.ts`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: The `'red' | 'blue'` team type is defined independently in three locations. If a new team color were added (e.g., for a 3-team mode), all three would need updating.
- **Recommendation**: Define once in `types/game.ts` and import everywhere. For the frontend (which doesn't share server types), create a `shared/` types module or ensure the canonical definition is imported.
- **Effort**: Small (< 1 hour)

### [Code Quality] Lua Turn-Switching Logic Duplicated
- **Location**: `server/src/scripts/revealCard.lua` (4 instances), `server/src/scripts/endTurn.lua` (1 instance)
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: The `if currentTurn == 'red' then 'blue' else 'red'` pattern and the clue-state-reset pattern (`currentClue = null, guessesUsed = 0, guessesAllowed = 0`) appear 5 times across these two Lua scripts. Redis Lua scripts don't support `require`, but these could use a helper function within each script.
- **Recommendation**: Extract a local `switchTurn(game)` helper function at the top of `revealCard.lua` (where 4 of 5 instances live). Consider also extracting `resetClueState(game)`.
- **Effort**: Small (< 1 hour)

### [Architecture] State Mutation Bypasses in Frontend
- **Location**: `server/src/frontend/app.ts`, `server/src/frontend/game.ts` (3 locations)
- **Severity**: Medium
- **Type**: Bug / Cleanup
- **Description**: Three locations write `state.spymasterTeam = null; state.clickerTeam = null` directly instead of using the `clearPlayerRole()` function from `stateMutations.ts`. The state management pattern defines `stateMutations.ts` as the single point for state changes, and these bypasses undermine that pattern.
- **Recommendation**: Replace all direct mutations with `clearPlayerRole()` calls. Consider making the state object's properties readonly and enforcing mutations through the mutation functions only.
- **Effort**: Small (< 1 hour)

### [Architecture] PRNG (Mulberry32) Duplicated Between Frontend and Backend
- **Location**: `server/src/frontend/utils.ts`, `server/src/services/game/boardGenerator.ts`
- **Severity**: Medium
- **Type**: Cleanup / DX
- **Description**: The Mulberry32 seeded PRNG algorithm is implemented identically in both frontend and backend code. This is a correctness-critical algorithm (both must produce identical sequences for deterministic board generation).
- **Recommendation**: Create a `shared/` directory with the PRNG implementation. Import in both frontend (via bundler) and backend. This ensures they can never drift apart.
- **Effort**: Medium (1-4 hours)

### [Architecture] DEFAULT_WORDS List Fully Duplicated
- **Location**: `server/src/frontend/constants.ts`, `server/src/config/gameConfig.ts`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: The ~400-word default word list is duplicated between frontend and backend constants. Any word addition or fix must be applied in two places.
- **Recommendation**: Define once in a shared location. The backend already serves as source of truth when in multiplayer mode; for standalone mode, the frontend could load from `wordlist.txt` or a shared JSON file.
- **Effort**: Small (< 1 hour)

### [Frontend] Hardcoded Accent Colors Without CSS Variables
- **Location**: `server/public/css/*.css` — `#667eea` (~25 occurrences), `#764ba2` (~15 occurrences)
- **Severity**: Medium
- **Type**: Cleanup / DX
- **Description**: The primary accent gradient colors are hardcoded 40+ times across 8 CSS files. There's no CSS custom property (variable) for theming. This makes any color scheme adjustment extremely tedious and error-prone.
- **Recommendation**: Define `--color-accent-primary: #667eea` and `--color-accent-secondary: #764ba2` in `:root`. Replace all hardcoded instances. This also enables future dark mode or custom theme support.
- **Effort**: Medium (1-4 hours)

### [Frontend] Hardcoded English Strings Missing i18n Attributes
- **Location**: `index.html` — ~20 strings including "Edit Nickname", "Save", "Cancel", "Send", "Copy", "Loading game..."
- **Severity**: Medium
- **Type**: Bug / DX
- **Description**: While the i18n system is comprehensive (4 locales, 200+ keys), approximately 20 user-visible strings in `index.html` lack `data-i18n` attributes. Users in non-English locales see a mix of translated and untranslated text.
- **Recommendation**: Audit all text content in `index.html` for missing `data-i18n` attributes. Add translation keys to all 4 locale files (`en.json`, `de.json`, `es.json`, `fr.json`).
- **Effort**: Medium (1-4 hours)

### [Frontend] socket-client.ts Duplicated Promise+Timeout Pattern
- **Location**: `server/src/frontend/socket-client.ts` — `createRoom()`, `joinRoom()`, `requestResync()`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: Three methods share an identical pattern: create Promise, set timeout, register success/error listeners, cleanup on resolve/reject. This is ~30 lines repeated 3 times.
- **Recommendation**: Extract a `socketRequest(emitEvent, successEvent, errorEvent, data, timeoutMs)` helper that encapsulates the pattern.
- **Effort**: Small (< 1 hour)

### [Testing] Lua Scripts Never Executed in Tests
- **Location**: `server/src/scripts/*.lua` (6 files), `server/src/__tests__/`
- **Severity**: Medium
- **Type**: Testing
- **Description**: All 6 Lua scripts are mocked via `redis.eval` in tests — the actual Lua code never executes. This means logic bugs in Lua (like the duplicated turn-switching) wouldn't be caught by tests. These scripts handle critical atomic operations (card reveal, team switch, role assignment).
- **Recommendation**: Add integration tests using a real Redis instance (via testcontainers or the embedded redis-server from memory mode) that execute the actual Lua scripts. Focus on `revealCard.lua` and `safeTeamSwitch.lua` as the most complex.
- **Effort**: Large (4+ hours)

### [Testing] E2E Missing Critical Scenarios
- **Location**: `server/e2e/`
- **Severity**: Medium
- **Type**: Testing
- **Description**: E2E tests cover the happy path well but miss several important scenarios: player disconnect/reconnect during active game, timer expiration triggering turn end, host migration when host disconnects, and concurrent actions from multiple players.
- **Recommendation**: Add E2E specs for: (1) disconnect + reconnect mid-game, (2) timer expiry forcing turn change, (3) host disconnect triggering transfer, (4) race conditions with simultaneous reveals.
- **Effort**: Large (4+ hours)

### [Testing] E2E Uses waitForTimeout (Flaky)
- **Location**: `server/e2e/*.spec.ts`
- **Severity**: Medium
- **Type**: Testing / DX
- **Description**: Several E2E tests use `page.waitForTimeout(ms)` which is inherently flaky — too short causes failures on slow CI, too long wastes time. Playwright's best practice is to wait for specific conditions.
- **Recommendation**: Replace `waitForTimeout` calls with `waitForSelector`, `expect(locator).toBeVisible()`, or custom `waitForFunction` calls that check for the actual expected state.
- **Effort**: Medium (1-4 hours)

### [Testing] Frontend Coverage Thresholds Low
- **Location**: `server/jest.config.ts.js` — frontend project config
- **Severity**: Medium
- **Type**: Testing
- **Description**: Frontend test coverage thresholds are set at 50% (branches, functions, lines, statements), while backend thresholds are 65-80%. Given the frontend has 40 modules with significant game logic, this gap is notable.
- **Recommendation**: Incrementally raise frontend thresholds to match backend levels. Start by increasing to 60% and adding tests for the most critical untested modules.
- **Effort**: Large (4+ hours)

### [Infrastructure] Production Deploys Kill Active Games
- **Location**: `fly.toml` — `strategy = "immediate"`, `REDIS_URL=memory`
- **Severity**: Medium
- **Type**: DX / Infrastructure
- **Description**: Production uses in-memory Redis (embedded redis-server process). With `strategy = "immediate"`, every deploy terminates the running instance and all game data is lost instantly. There is graceful shutdown code for WebSocket drain, but the Redis data cannot survive.
- **Recommendation**: Either: (1) switch to `strategy = "rolling"` with a managed Redis instance for data persistence, or (2) add a pre-deploy notification system that warns active players, or (3) implement game state export/import for zero-downtime deploys.
- **Effort**: Large (4+ hours)

### [Observability] Two Overlapping Audit Systems
- **Location**: `server/src/services/auditService.ts`, `server/src/utils/audit.ts`
- **Severity**: Medium
- **Type**: Cleanup
- **Description**: Two separate audit modules exist with different event naming conventions and slightly different capabilities. `auditService.ts` is the formal service with severity levels and structured data. `utils/audit.ts` provides simpler helper functions. Having both creates confusion about which to use.
- **Recommendation**: Consolidate into the `auditService` as the single audit entry point. Convert `utils/audit.ts` into thin wrappers that delegate to `auditService`, or merge its functionality directly.
- **Effort**: Medium (1-4 hours)

### [Infrastructure] Compiled Frontend Tracked in Git
- **Location**: `server/public/js/modules/` (compiled output), `.gitignore`
- **Severity**: Medium
- **Type**: DX / Cleanup
- **Description**: The compiled frontend JavaScript in `server/public/js/modules/` is tracked in git despite being generated from TypeScript sources in `server/src/frontend/`. This creates noisy diffs on every frontend change and potential merge conflicts.
- **Recommendation**: Add `server/public/js/modules/` to `.gitignore`. Ensure the CI/CD pipeline and Docker build run the frontend compilation step. Update `CONTRIBUTING.md` to note the build step.
- **Effort**: Small (< 1 hour)

### [Architecture] Blitz Mode timer:stop Lacks Mode Guard
- **Location**: `server/src/socket/handlers/timerHandlers.ts`
- **Severity**: Low
- **Type**: Bug
- **Description**: In Blitz mode, timers are mandatory and should not be stoppable by players. The `timer:stop` handler doesn't check the current game mode before allowing a stop, potentially allowing players to circumvent the forced-timer Blitz rules.
- **Recommendation**: Add a game mode check in the `timer:stop` handler that rejects stop requests when the game is in Blitz mode.
- **Effort**: Small (< 1 hour)

### [Architecture] Duet Mode History Validation Gap
- **Location**: `server/src/services/gameHistoryService.ts`
- **Severity**: Low
- **Type**: Bug
- **Description**: Duet mode has cooperative mechanics with a different board layout and scoring rules. The history/replay system doesn't validate that Duet-specific events (like cooperative reveals) are properly structured, potentially allowing malformed history entries.
- **Recommendation**: Add Duet-mode-specific validation in the history entry creation path.
- **Effort**: Small (< 1 hour)

### [Code Quality] `any` Type in Production Code
- **Location**: `server/src/services/roomService.ts` (1 instance)
- **Severity**: Low
- **Type**: Cleanup
- **Description**: One `any` type exists in production code. The codebase otherwise has excellent type discipline with strict mode enabled.
- **Recommendation**: Replace with proper type annotation.
- **Effort**: Small (< 1 hour)

### [Testing] ts-jest 29 / Jest 30 Version Mismatch
- **Location**: `server/package.json`
- **Severity**: Low
- **Type**: DX
- **Description**: The project uses Jest 30 but ts-jest 29. While this works, it's an unsupported combination that may cause subtle issues with newer Jest features.
- **Recommendation**: Upgrade to ts-jest 30 when available, or pin Jest to 29 for full compatibility.
- **Effort**: Small (< 1 hour)

### [Testing] forceExit Masks Resource Leaks
- **Location**: `server/jest.config.ts.js` — `forceExit: true`
- **Severity**: Low
- **Type**: Testing / DX
- **Description**: Jest is configured with `forceExit: true`, which forces the process to exit even if there are pending async operations. This masks potential resource leaks (unclosed connections, running timers) that could indicate bugs.
- **Recommendation**: Remove `forceExit: true` and fix any resulting "Jest did not exit" warnings by properly closing connections in `afterAll` hooks.
- **Effort**: Medium (1-4 hours)

### [Infrastructure] uuid Package Replaceable by Built-in
- **Location**: `server/package.json` — `uuid` dependency
- **Severity**: Low
- **Type**: Cleanup
- **Description**: Node.js 18+ provides `crypto.randomUUID()` natively. The `uuid` package is an unnecessary dependency.
- **Recommendation**: Replace `uuid.v4()` calls with `crypto.randomUUID()`. Remove the `uuid` dependency.
- **Effort**: Small (< 1 hour)

### [Infrastructure] E2E Tests Only Run in Chromium
- **Location**: `server/e2e/playwright.config.ts`
- **Severity**: Low
- **Type**: Testing
- **Description**: E2E tests only run against Chromium. Cross-browser issues (especially Firefox WebSocket handling and Safari CSS differences) are not caught.
- **Recommendation**: Add Firefox and WebKit projects to the Playwright config, at least for CI runs.
- **Effort**: Small (< 1 hour)

### [Frontend] PWA Manifest Without Service Worker
- **Location**: `index.html` (references manifest), no `sw.js` file exists
- **Severity**: Low
- **Type**: Cleanup
- **Description**: The PWA manifest is referenced in the HTML head, but no service worker exists. This means the app won't be installable as a PWA and the manifest reference is misleading.
- **Recommendation**: Either implement a basic service worker for offline standalone mode support, or remove the manifest reference to avoid confusion.
- **Effort**: Medium (1-4 hours) for service worker, Small for removal

### [Security] In-Memory Redis in Production
- **Location**: `fly.toml` — `REDIS_URL=memory`
- **Severity**: Low
- **Type**: Security / Infrastructure
- **Description**: Production uses in-memory Redis, meaning all session tokens, game state, and audit logs are ephemeral. While acceptable for the current scale, it means security audit trails are lost on every deploy.
- **Recommendation**: For production deployments that need audit persistence, use an external Redis instance with AOF persistence or redirect audit logs to a file/external service.
- **Effort**: Medium (1-4 hours)

### [Performance] Lua JSON Read-Modify-Write Pattern
- **Location**: All 6 Lua scripts in `server/src/scripts/`
- **Severity**: Low
- **Type**: Performance
- **Description**: All Lua scripts deserialize the full game JSON, modify a field or two, and re-serialize the entire object. For large game states, this is more work than necessary. However, game state objects are relatively small (typically <10KB), so the practical impact is negligible.
- **Recommendation**: No action needed at current scale. If game state grows significantly, consider using Redis hashes or separate keys for frequently-modified fields.
- **Effort**: N/A (informational)

### [Performance] Rate Limiter Memory is Well-Bounded
- **Location**: `server/src/middleware/rateLimiter.ts`
- **Severity**: Info (Positive)
- **Type**: Performance
- **Description**: The rate limiter uses a Map with proper TTL-based cleanup. Memory is bounded by the number of unique IPs within the window, and entries are cleaned up when expired.
- **Recommendation**: None needed. Well-implemented.
- **Effort**: N/A

### [Security] Strong Defense-in-Depth in Lua Scripts
- **Location**: `server/src/scripts/safeTeamSwitch.lua`, `setRole.lua`
- **Severity**: Info (Positive)
- **Type**: Security
- **Description**: Lua scripts validate inputs (allowed teams, allowed roles) even though JavaScript already validates via Zod. This defense-in-depth pattern protects against bypasses and is a security best practice.
- **Recommendation**: None needed. Excellent pattern.
- **Effort**: N/A

### [Security] Spymaster View Filtering Correct
- **Location**: `server/src/services/gameService.ts`
- **Severity**: Info (Positive)
- **Type**: Security
- **Description**: The spymaster view correctly filters card types before sending to clients. Non-spymaster players cannot see hidden card types. The filtering is applied consistently across all code paths that emit game state.
- **Recommendation**: None needed.
- **Effort**: N/A

### [Security] Timing-Safe Admin Authentication
- **Location**: `server/src/middleware/adminAuth.ts`
- **Severity**: Info (Positive)
- **Type**: Security
- **Description**: Admin password comparison uses `crypto.timingSafeEqual`, preventing timing attacks on the admin password.
- **Recommendation**: None needed. Excellent practice.
- **Effort**: N/A

### [Observability] Structured Logging with Correlation IDs
- **Location**: `server/src/config/logger.ts`, middleware
- **Severity**: Info (Positive)
- **Type**: Observability
- **Description**: Winston logging is properly configured with structured JSON output, correlation IDs for request tracing, and appropriate log levels.
- **Recommendation**: None needed.
- **Effort**: N/A

### [Documentation] Excellent ADR Coverage
- **Location**: `docs/adr/` (4 ADRs)
- **Severity**: Info (Positive)
- **Type**: Documentation
- **Description**: Architecture Decision Records cover key decisions (socket.io, Zod validation, Lua atomicity, graceful degradation). They include context, alternatives considered, and consequences.
- **Recommendation**: Consider adding ADRs for: the vanilla TypeScript (no-framework) frontend choice, the IIFE pattern for socket-client, and the embedded redis-server approach.
- **Effort**: Small per ADR

### [Documentation] Comprehensive CLAUDE.md
- **Location**: `CLAUDE.md`
- **Severity**: Info (Positive)
- **Type**: Documentation
- **Description**: The AI assistant guide is thorough, accurate, and well-organized. File counts, test counts, and directory descriptions match reality. Event listings are comprehensive.
- **Recommendation**: None needed.
- **Effort**: N/A

### [Testing] Excellent Test Coverage and Discipline
- **Location**: `server/src/__tests__/` — 93 suites, 2,671+ tests
- **Severity**: Info (Positive)
- **Type**: Testing
- **Description**: 94%+ line coverage, 0 lint errors, 0 TypeScript errors. Test organization mirrors source structure. Integration tests cover race conditions and full game flows. Mutation testing is configured via Stryker.
- **Recommendation**: None needed. Exemplary test discipline.
- **Effort**: N/A

---

## Top 10 Priority Actions

Ordered by impact-to-effort ratio:

| # | Action | Severity | Effort | Why |
|---|--------|----------|--------|-----|
| 1 | Centralize Redis key patterns into `redisKeys.ts` | High | Medium | Eliminates key format drift risk across 15+ files |
| 2 | Fix GameHistoryEntry type collision | High | Small | Prevents type confusion bugs; 30-minute fix |
| 3 | Remove dead code (functions + constants) | Medium | Small | Eliminates noise; reduces cognitive overhead |
| 4 | Fix state mutation bypasses in frontend | Medium | Small | Restores state management integrity |
| 5 | Extract CSS variables for accent colors | Medium | Medium | Enables theming; eliminates 40+ hardcoded values |
| 6 | Add i18n attributes to remaining strings | Medium | Medium | Fixes broken non-English UX for ~20 strings |
| 7 | Add Lua script integration tests | Medium | Large | Only way to validate critical atomic operations |
| 8 | Decompose gameHistoryService | Medium | Medium | Aligns with established architecture patterns |
| 9 | Consolidate duplicate audit systems | Medium | Medium | Eliminates confusion about which module to use |
| 10 | Add compiled frontend to .gitignore | Medium | Small | Eliminates noisy diffs and merge conflicts |

## Quick Wins (Under 1 Hour Each)

1. Fix GameHistoryEntry type collision — rename one, consolidate, re-export
2. Delete dead functions — `cleanupOldHistory()`, `getHistoryStats()`
3. Delete dead socket constants — `ROOM_LEFT`, `TIMER_START`, `CHAT_ERROR`, `SPECTATOR_DENY_JOIN`
4. Fix state mutation bypasses — replace 3 direct mutations with `clearPlayerRole()`
5. Replace `uuid` with `crypto.randomUUID()` — remove dependency
6. Extract Lua helper functions — `switchTurn()` and `resetClueState()` within scripts
7. Fix `any` type in `roomService.ts`
8. Add Blitz mode guard to `timer:stop` handler
9. Add `.gitignore` entry for `server/public/js/modules/`
10. Deduplicate TeamNames type — define once, import everywhere

## Technical Debt Roadmap

### Next Sprint (1-2 Weeks)
- Centralize Redis key patterns into `redisKeys.ts`
- Complete all quick wins listed above
- Fix frontend i18n gaps
- Extract CSS custom properties for colors
- Consolidate audit systems

### Next Month
- Decompose `gameHistoryService.ts`
- Add Lua script integration tests with real Redis
- Create shared module for PRNG and word list
- Replace `waitForTimeout` in E2E with proper waits
- Add E2E scenarios for disconnect/reconnect, timer expiry, host migration
- Raise frontend coverage thresholds incrementally

### Next Quarter
- Evaluate external Redis for production (data persistence, audit retention)
- Add Firefox/WebKit to E2E test matrix
- Implement service worker for offline standalone mode (or remove PWA manifest)
- Consider rolling deploy strategy with game state migration
- Remove `forceExit` from Jest and fix underlying resource leaks
- Add ADRs for undocumented architectural decisions

## Metrics Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 2 |
| Medium | 20 |
| Low | 11 |
| Info/Positive | 9 |
| **Total** | **42** |

| Type | Count |
|------|-------|
| Cleanup/DX | 18 |
| Bug | 5 |
| Testing | 6 |
| Performance | 2 |
| Security | 2 |
| Positive | 9 |

**Overall Assessment**: This is a high-quality, well-architected codebase. The 0 Critical findings and only 2 High findings (both cleanup, not bugs) reflect strong engineering discipline. The security posture is excellent with defense-in-depth throughout. The primary improvement areas are code deduplication, test coverage for Lua scripts, and frontend polish (i18n, CSS variables).
