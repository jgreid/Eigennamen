# Next Steps — Recommended Improvements

**Date**: 2026-02-12 (updated with implementation status)
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

### ~~A-2. Atomicize Room Status Update in `createGame`~~ DONE

Replaced non-atomic GET-modify-SET with inline Lua script `ATOMIC_SET_ROOM_STATUS_SCRIPT` in `gameService.ts`.

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

### ~~B-1. Fix `LocalTimerData` Type to Include Pause Fields~~ DONE

Removed unnecessary type assertions — `TimerState` already declares `paused?` and `remainingWhenPaused?`.

### ~~B-2. Validate `remainingSeconds` Range in Timer Operations~~ DONE

Added `Number.isFinite()` and range checks in both `pauseTimer` and `resumeTimer` with warning logs.

### ~~B-3. Use Zod Validation for `JSON.parse` in `createGame`~~ DONE

Superseded by A-2 — the raw `JSON.parse` was replaced entirely by a Lua script that handles JSON atomically.

### ~~B-4. Add Bounds Validation to Environment Timeout Overrides~~ DONE

Added min/max bounds to `envInt()` with warning logs and clamping for each timeout.

### B-5. ~~Consolidate Reconnection Token Validation Logic~~ NOT NEEDED

Analysis revealed the two functions use fundamentally different Redis key patterns (`reconnect:session:` vs `reconnect:token:`), different lookup strategies, different return types, and different consumption behaviors. The apparent duplication is intentional — consolidating would add complexity for no benefit.

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

### ~~C-2. Align HTML Input Pattern with Server Validation~~ DONE

Removed restrictive ASCII-only `pattern` attributes from 3 nickname inputs. Server-side Zod validation is authoritative.

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

| ID | Finding | Severity | Status |
|----|---------|----------|--------|
| NEW-1 | Room status TOCTOU race in `createGame` | Medium | **FIXED** (Lua script) |
| NEW-2 | `LocalTimerData` type — unnecessary inline assertions | Low | **FIXED** |
| NEW-3 | `remainingSeconds` not range-validated | Low | **FIXED** |
| NEW-4 | Raw `JSON.parse` without Zod | Low | **FIXED** (superseded by Lua) |
| NEW-5 | Timeout env vars accept unbounded values | Low | **FIXED** (bounds + clamping) |
| NEW-6 | HTML nickname pattern rejects Unicode names | Low | **FIXED** |
| NEW-7 | Health endpoints don't surface stale socket count flag | Low | Open |
| NEW-8 | Token validation appears duplicated | Low | Not needed (different key patterns) |

---

## Recommended Priority Order

6 of 8 new findings have been fixed. Remaining recommended order:

1. ~~**C-2** — Fix HTML pattern~~ DONE
2. ~~**B-1** — Fix `LocalTimerData` type~~ DONE
3. ~~**B-3** — Use Zod for room JSON parse~~ DONE (superseded by A-2 Lua)
4. ~~**B-2** — Validate timer `remainingSeconds` range~~ DONE
5. ~~**A-2** — Atomicize room status update~~ DONE
6. ~~**C-6** — Add `.dockerignore`~~ Already existed
7. ~~**C-4** — Add Dependabot config~~ Already existed
8. **C-1** — Add SRI hashes (10 min, supply chain protection)
9. ~~**B-4** — Bounds-check timeout env vars~~ DONE
10. ~~**B-5** — Consolidate token validation~~ Not needed
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
