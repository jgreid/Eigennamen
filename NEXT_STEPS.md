# Next Steps — Recommended Improvements

**Date**: 2026-02-12
**Based on**: Full codebase review of v2.3.0+ (post Tier D partial)
**Scope**: Prioritized actionable improvements, organized by impact and effort

---

## Summary

The codebase is production-ready with 0 critical/high issues, 2,527 passing tests at 94%+ coverage, 0 ESLint warnings, and 0 TypeScript errors. The recommendations below focus on **highest-impact next steps** rather than rehashing resolved items. They are grouped into three tiers:

1. **Tier A — High-Value, Moderate Effort** (ship the product further)
2. **Tier B — Code Quality Hardening** (reduce technical risk)
3. **Tier C — Low-Effort Quick Wins** (clean up remaining gaps)

---

## Tier A: High-Value, Moderate Effort

### A-1. Implement Chat UI Frontend

**Why**: The chat backend (events, validation, rate limiting, team filtering) is fully complete. The feature is invisible to users without a frontend panel.

**What**:
- Add a collapsible chat panel to `index.html` with team/spectator/all tabs
- Create `server/src/frontend/chatUI.ts` to wire up `chat:send` / `chat:message` / `chat:spectatorMessage` events
- Style with glassmorphism to match existing UI
- Add i18n keys for chat labels

**Files to touch**: `index.html`, `server/src/frontend/chat.ts`, `server/public/css/` (new `chat.css`), `server/public/locales/*.json`

**Risk**: Low — backend is tested; this is purely additive frontend work.

### A-2. Atomicize Room Status Update in `createGame`

**Why**: `gameService.ts:268-277` performs a non-atomic GET-modify-SET on `room:{roomCode}`. If another operation (join, leave, settings change) writes to the same key between the GET and SET, that write is silently lost.

**What**:
- Write a small Lua script (`updateRoomStatus.lua`) that does `GET → JSON.parse → set status → SET` atomically, or
- Use a `WATCH/MULTI` block with retry on abort, or
- Merge the status update into an existing Lua script that already runs during game creation

**Files to touch**: `server/src/services/gameService.ts:268-277`, optionally `server/src/scripts/` for a new Lua script

**Risk**: Medium — this is a real race condition in a multi-instance deployment. Single-instance deployments are unaffected due to Node.js single-threading.

### A-3. Complete i18n Markup (D-2)

**Why**: Approximately 10% of user-facing strings in `index.html` and frontend modules are still hardcoded in English. Users selecting German/Spanish/French see mixed-language UI.

**What**:
- Audit all hardcoded English strings in `index.html` and `server/src/frontend/*.ts`
- Add corresponding keys to all four locale files (`en.json`, `de.json`, `es.json`, `fr.json`)
- Replace hardcoded text with `t('key')` calls or `data-i18n` attributes

**Files to touch**: `index.html`, `server/src/frontend/*.ts`, `server/public/locales/*.json`

### A-4. Migrate Remaining WATCH/MULTI Transactions to Lua (D-5)

**Why**: Several service methods still use Redis WATCH/MULTI/EXEC patterns, which are retry-prone and slower than Lua scripts. The codebase already has 6 Lua scripts with a `withLuaFallback` pattern. Migrating the remaining transactions reduces latency and eliminates retry loops.

**What**:
- Identify remaining `WATCH`/`MULTI` usage across services
- Write Lua equivalents with JS fallbacks following the existing pattern in `luaGameOps.ts`
- Remove WATCH/MULTI paths once Lua versions are confirmed working

**Effort**: Medium — pattern is well-established; this is mechanical conversion.

---

## Tier B: Code Quality Hardening

### B-1. Fix `LocalTimerData` Type to Include Pause Fields

**Why**: `timerService.ts:334-335` uses verbose inline type assertions `(localTimer as TimerState & { paused?: boolean; remainingWhenPaused?: number })` because `LocalTimerData` (line 55) doesn't declare these fields. This is a type system workaround that bypasses compile-time safety.

**What**:
- Add `paused?: boolean` and `remainingWhenPaused?: number` to the `LocalTimerData` interface
- Remove the inline type assertions in `pauseTimer`

**Files to touch**: `server/src/services/timerService.ts:55-58, 334-335`

### B-2. Validate `remainingSeconds` Range in Timer Operations

**Why**: `resumeTimer` (line 395) checks for `undefined` but not for 0, negative, or NaN values. `pauseTimer` stores whatever `remainingSeconds` it computes without clamping to `[0, duration]`.

**What**:
- Add `Math.max(0, Math.min(duration, remainingSeconds))` clamping in both `pauseTimer` and `resumeTimer`
- Log a warning if the raw value was out of range

**Files to touch**: `server/src/services/timerService.ts`

### B-3. Use Zod Validation for `JSON.parse` in `createGame`

**Why**: `gameService.ts:271` does raw `JSON.parse(roomData)` without Zod validation, unlike other critical paths that use `tryParseJSON`. If the stored JSON is malformed or missing fields, the error is caught but not handled — game creation proceeds with `status` never set to `playing`.

**What**:
- Replace `JSON.parse(roomData)` with `tryParseJSON(roomData, roomStateSchema, ...)`
- Handle the `null` return case explicitly (log error, optionally abort game creation)

**Files to touch**: `server/src/services/gameService.ts:271`

### B-4. Add Bounds Validation to Environment Timeout Overrides

**Why**: `server/src/utils/timeout.ts` uses `envInt()` to parse `TIMEOUT_*` environment variables but accepts any positive integer. Setting `TIMEOUT_SOCKET_HANDLER=999999999` would cause 11.5-day timeouts; setting it to `1` would cause premature failures.

**What**:
- Add min/max bounds to each timeout (e.g., `SOCKET_HANDLER: min 1000, max 120000`)
- Log a warning and clamp to bounds when the configured value is outside the range

**Files to touch**: `server/src/utils/timeout.ts`

### B-5. Consolidate Reconnection Token Validation Logic

**Why**: `playerService.ts` has two functions with near-identical logic: `validateSocketAuthToken` (lines 706-754) and `validateRoomReconnectToken` (lines 963-1006). Both fetch a token from Redis, validate sessionId match, and perform cleanup. The duplication increases maintenance burden.

**What**:
- Extract shared validation into a private `validateReconnectionTokenCore(tokenKey, sessionId, consume)` function
- Have both public functions delegate to it with their specific consume/preserve behavior

**Files to touch**: `server/src/services/playerService.ts`

### B-6. Improve Health Check Staleness Handling

**Why**: `app.ts:65-94` — `getCachedSocketCount()` returns `{ count, stale }` using `Promise.race()`. When `io.fetchSockets()` times out, it returns stale cache. However, the `/health/ready` and `/metrics` endpoints don't consistently surface the `stale` flag to consumers.

**What**:
- Include a `"stale": true` field in health/metrics JSON responses when the count is from cache
- Consider adding a Prometheus label `codenames_socket_count{source="cache|live"}`

**Files to touch**: `server/src/app.ts`, `server/src/routes/healthRoutes.ts`

### B-7. Add Chaos/Resilience Testing (D-6)

**Why**: The codebase has excellent unit and integration tests but no tests that simulate infrastructure failures (Redis disconnects, slow responses, connection pool exhaustion). The graceful degradation design (ADR 004) deserves automated verification.

**What**:
- Add a test suite that starts with Redis, performs operations, kills Redis mid-operation, and verifies fallback behavior
- Test reconnection after Redis comes back
- Test timer behavior when Redis is temporarily unavailable

**Files to touch**: New test file in `server/src/__tests__/integration/`

---

## Tier C: Low-Effort Quick Wins

### C-1. Add SRI Hashes for Vendored JS (D-7)

**Why**: `index.html` loads `qrcode.min.js` and `socket.io.min.js` from local paths without Subresource Integrity hashes. If the files are tampered with (e.g., via supply chain attack on the build), the browser won't detect it.

**What**:
- Generate SRI hashes: `shasum -b -a 384 file.js | base64`
- Add `integrity="sha384-..."` and `crossorigin="anonymous"` attributes to script tags

**Files to touch**: `index.html`

### C-2. Align HTML Input Pattern with Server Validation

**Why**: `index.html:74` uses `pattern="[a-zA-Z0-9\s\-_]+"` for nickname inputs but the server accepts Unicode via `/^[\p{L}\p{N}\s\-_]+$/u`. Users with non-ASCII names (e.g., `José`, `Müller`) get blocked by client-side HTML5 validation even though the server would accept them.

**What**:
- Remove the `pattern` attribute from nickname inputs (server validation is authoritative), or
- Update to a Unicode-compatible pattern

**Files to touch**: `index.html:74, 560, 575, 580`

### C-3. Gate Frontend Debug Logging (D-3)

**Why**: `console.log` / `console.debug` calls in frontend modules run unconditionally. In production, this clutters the browser console and can leak game state information.

**What**:
- Add a `DEBUG` flag (from URL param `?debug=true` or localStorage)
- Wrap all debug logging behind the flag in `server/src/frontend/logger.ts`
- Strip or no-op the logger in production builds

**Files to touch**: `server/src/frontend/logger.ts`, `server/src/frontend/debug.ts`

### C-4. Add Dependabot Configuration (D-13)

**Why**: No automated dependency update mechanism exists. `npm audit` shows 0 vulnerabilities now, but that won't remain true indefinitely without monitoring.

**What**:
- Add `.github/dependabot.yml` with weekly npm checks for `server/` directory
- Configure auto-merge for patch updates, PR creation for minor/major

**Files to touch**: New `.github/dependabot.yml`

### C-5. Add ReDoS Regression Tests (D-14)

**Why**: Clue validation uses Unicode regex patterns. While current patterns are bounded (`{0,9}`), regression tests ensure future changes don't introduce catastrophic backtracking.

**What**:
- Add test cases with adversarial inputs (long strings of matching characters, alternating match/non-match)
- Assert validation completes within a timeout (e.g., 100ms)

**Files to touch**: New or existing test file in `server/src/__tests__/`

### C-6. Add `.dockerignore` (D-11)

**Why**: Without `.dockerignore`, Docker COPY includes `node_modules/`, `.git/`, test files, and documentation in the build context, increasing build times and image size.

**What**:
- Create `.dockerignore` with: `node_modules`, `.git`, `coverage`, `dist`, `*.md`, `docs/`, `e2e/`, `loadtest/`

**Files to touch**: `server/.dockerignore`

---

## New Findings (Not in Existing Roadmap)

These items emerged from this review and are not tracked in the current `ROADMAP.md` or `CODEBASE_REVIEW.md`:

| ID | Finding | Severity | Location |
|----|---------|----------|----------|
| NEW-1 | Room status TOCTOU race in `createGame` | Medium | `gameService.ts:268-277` |
| NEW-2 | `LocalTimerData` type missing pause fields — uses inline assertions | Low | `timerService.ts:55-58, 334-335` |
| NEW-3 | `remainingSeconds` not range-validated (could be NaN/negative) | Low | `timerService.ts` (pause/resume) |
| NEW-4 | Raw `JSON.parse` without Zod in `createGame` room status update | Low | `gameService.ts:271` |
| NEW-5 | Timeout env vars accept unbounded values | Low | `utils/timeout.ts:72-79` |
| NEW-6 | HTML nickname pattern rejects valid Unicode names | Low | `index.html:74` |
| NEW-7 | Health endpoints don't surface stale socket count flag | Low | `app.ts`, `healthRoutes.ts` |
| NEW-8 | Duplicate reconnection token validation logic | Low | `playerService.ts` (two functions) |

---

## Recommended Priority Order

For maximum impact with available effort, the recommended execution order is:

1. **C-2** — Fix HTML pattern (5 min, removes user-facing bug for non-ASCII names)
2. **B-1** — Fix `LocalTimerData` type (10 min, removes unsafe type assertions)
3. **B-3** — Use Zod for room JSON parse (15 min, closes validation gap)
4. **B-2** — Validate timer `remainingSeconds` range (15 min, prevents edge case bugs)
5. **A-2** — Atomicize room status update (30 min, fixes real race condition)
6. **C-6** — Add `.dockerignore` (5 min, faster Docker builds)
7. **C-4** — Add Dependabot config (10 min, automated security monitoring)
8. **C-1** — Add SRI hashes (10 min, supply chain protection)
9. **B-4** — Bounds-check timeout env vars (20 min, operational safety)
10. **B-5** — Consolidate token validation (30 min, reduced duplication)
11. **A-1** — Chat UI frontend (feature completion — largest remaining gap)
12. **A-3** — Complete i18n markup (user experience for non-English users)
13. **C-3** — Gate debug logging (production hygiene)
14. **A-4** — Migrate WATCH/MULTI to Lua (performance under load)
15. **B-6** — Improve health staleness handling (operational visibility)
16. **B-7** — Chaos testing (resilience verification)
17. **C-5** — ReDoS regression tests (defensive testing)

---

## What NOT to Do

These are common improvement suggestions that are **not recommended** for this codebase:

- **Don't split `gameService.ts` further** — It's 1,573 lines but already delegates to 4 sub-modules (`boardGenerator`, `clueValidator`, `revealEngine`, `luaGameOps`). The remaining code is orchestration that belongs together.
- **Don't add a frontend framework** — The vanilla TypeScript + ES6 module approach is working well with 22 focused modules. Adding React/Vue would be a rewrite, not an improvement.
- **Don't add an ORM for Redis** — The direct Redis commands + Lua scripts are the correct abstraction for this use case.
- **Don't add OpenTelemetry yet** — The metrics system (`utils/metrics.ts` + Prometheus endpoint) is sufficient for the current scale. OpenTelemetry adds significant complexity.
- **Don't refactor for microservices** — The monolith with Redis Pub/Sub is the right architecture for a game server at this scale.
