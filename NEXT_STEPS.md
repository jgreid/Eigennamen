# Next Steps — Recommended Improvements

**Date**: 2026-02-12 (updated with implementation status)
**Based on**: Full codebase review of v2.3.0+ (post Tier D partial)
**Scope**: Prioritized actionable improvements, organized by impact and effort

---

## Summary

The codebase is production-ready with 0 critical/high issues, **2,571 passing tests** (83 suites) at 94%+ coverage, 0 ESLint warnings, and 0 TypeScript errors. The recommendations below focus on **highest-impact next steps** rather than rehashing resolved items. They are grouped into three tiers:

1. **Tier A — High-Value, Moderate Effort** (ship the product further)
2. **Tier B — Code Quality Hardening** (reduce technical risk)
3. **Tier C — Low-Effort Quick Wins** (clean up remaining gaps)

---

## Tier A: High-Value, Moderate Effort

### ~~A-1. Implement Chat UI Frontend~~ ALREADY COMPLETE

Chat UI (`server/src/frontend/chat.ts`) is fully implemented with team/spectator tabs, glassmorphism styling, and i18n keys.

### ~~A-2. Atomicize Room Status Update in `createGame`~~ DONE

Replaced non-atomic GET-modify-SET with inline Lua script `ATOMIC_SET_ROOM_STATUS_SCRIPT` in `gameService.ts`.

### ~~A-3. Complete i18n Markup (D-2)~~ DONE

Replaced ~70 hardcoded English strings across 9 frontend TypeScript modules (`chat.ts`, `notifications.ts`, `settings.ts`, `accessibility.ts`, `game.ts`, `board.ts`, `roles.ts`, `multiplayerUI.ts`, `history.ts`) with `t()` calls. Added corresponding keys to all 4 locale files (en/de/es/fr).

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

### ~~B-6. Improve Health Check Staleness Handling~~ ALREADY COMPLETE

The `stale` flag is already surfaced in health/metrics JSON responses (`healthRoutes.ts`).

### ~~B-7. Add Chaos/Resilience Testing (D-6)~~ DONE

Added 25 chaos/resilience tests in `server/src/__tests__/integration/chaos.test.ts` covering: Redis operation failures, mid-operation failures, lock contention, transaction semantics, timer resilience, set operations under failure, pub/sub resilience, graceful degradation patterns, and memory pressure simulation.

---

## Tier C: Low-Effort Quick Wins

### ~~C-1. Add SRI Hashes for Vendored JS (D-7)~~ DONE

Added `integrity="sha384-..."` and `crossorigin="anonymous"` attributes to `qrcode.min.js` and `socket.io.min.js` script tags in `index.html`.

### ~~C-2. Align HTML Input Pattern with Server Validation~~ DONE

Removed restrictive ASCII-only `pattern` attributes from 3 nickname inputs. Server-side Zod validation is authoritative.

### ~~C-3. Gate Frontend Debug Logging (D-3)~~ ALREADY COMPLETE

Frontend debug logging is already gated behind a `DEBUG` flag via `server/src/frontend/debug.ts` and `logger.ts`.

### C-4. Add Dependabot Configuration (D-13)

**Why**: No automated dependency update mechanism exists. `npm audit` shows 0 vulnerabilities now, but that won't remain true indefinitely without monitoring.

**What**:
- Add `.github/dependabot.yml` with weekly npm checks for `server/` directory
- Configure auto-merge for patch updates, PR creation for minor/major

**Files to touch**: New `.github/dependabot.yml`

### ~~C-5. Add ReDoS Regression Tests (D-14)~~ DONE

Added 16 ReDoS regression tests in `server/src/__tests__/redos.test.ts` covering all user-facing regex patterns (teamName, roomId, nickname, clueWord, reconnectionToken) with adversarial inputs up to 10,000 characters, asserting completion within 50ms.

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
| NEW-7 | Health endpoints don't surface stale socket count flag | Low | **Already complete** |
| NEW-8 | Token validation appears duplicated | Low | Not needed (different key patterns) |

---

## Recommended Priority Order

All 8 new findings resolved. 15 of 17 items complete. Remaining:

1. ~~**C-2** — Fix HTML pattern~~ DONE
2. ~~**B-1** — Fix `LocalTimerData` type~~ DONE
3. ~~**B-3** — Use Zod for room JSON parse~~ DONE (superseded by A-2 Lua)
4. ~~**B-2** — Validate timer `remainingSeconds` range~~ DONE
5. ~~**A-2** — Atomicize room status update~~ DONE
6. ~~**C-6** — Add `.dockerignore`~~ Already existed
7. ~~**C-4** — Add Dependabot config~~ Already existed
8. ~~**C-1** — Add SRI hashes~~ DONE
9. ~~**B-4** — Bounds-check timeout env vars~~ DONE
10. ~~**B-5** — Consolidate token validation~~ Not needed
11. ~~**A-1** — Chat UI frontend~~ Already complete
12. ~~**A-3** — Complete i18n markup~~ DONE
13. ~~**C-3** — Gate debug logging~~ Already complete
14. **A-4** — Migrate WATCH/MULTI to Lua (performance under load)
15. ~~**B-6** — Improve health staleness handling~~ Already complete
16. ~~**B-7** — Chaos testing~~ DONE
17. ~~**C-5** — ReDoS regression tests~~ DONE

---

## What NOT to Do

These are common improvement suggestions that are **not recommended** for this codebase:

- **Don't split `gameService.ts` further** — It's 1,573 lines but already delegates to 4 sub-modules (`boardGenerator`, `clueValidator`, `revealEngine`, `luaGameOps`). The remaining code is orchestration that belongs together.
- **Don't add a frontend framework** — The vanilla TypeScript + ES6 module approach is working well with 22 focused modules. Adding React/Vue would be a rewrite, not an improvement.
- **Don't add an ORM for Redis** — The direct Redis commands + Lua scripts are the correct abstraction for this use case.
- **Don't add OpenTelemetry yet** — The metrics system (`utils/metrics.ts` + Prometheus endpoint) is sufficient for the current scale. OpenTelemetry adds significant complexity.
- **Don't refactor for microservices** — The monolith with Redis Pub/Sub is the right architecture for a game server at this scale.
