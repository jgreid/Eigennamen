# Codebase Review — Eigennamen Online v4.0.0

**Date:** 2026-02-27
**Scope:** Full codebase review — backend, frontend, infrastructure, tests

---

## Executive Summary

Eigennamen is a **mature, well-engineered** multiplayer game server. The codebase demonstrates strong fundamentals: strict TypeScript, atomic Redis operations via Lua, comprehensive CI/CD (9 quality gates), and 3,528 passing tests across 126 suites. ESLint and typecheck both pass cleanly with zero warnings.

This review identifies **improvement opportunities** organized into actionable sprints, ranked by impact and effort.

---

## Current Health

| Metric | Status |
|--------|--------|
| Test suites | 126 passed, 0 failed |
| Tests | 3,528 passed |
| ESLint | Clean (0 warnings, 0 errors) |
| TypeScript | Clean (backend + frontend) |
| Coverage (stmts) | 81.62% |
| Coverage (branches) | 69.77% |
| Coverage (functions) | 74.7% |
| Coverage (lines) | 82.64% |
| npm audit | 1 high (minimatch ReDoS — dev-only, not runtime) |
| TODO/FIXME debt | None found |
| Node versions | 22 (primary) + 24 (compat) |

---

## Sprint Proposals

### Sprint 1: Hardening & Resilience (High Impact, Moderate Effort)

#### 1.1 — Extract remaining inline Lua scripts to `.lua` files

The 6 core game scripts (`revealCard`, `endTurn`, `updatePlayer`, `safeTeamSwitch`, `setRole`, `hostTransfer`) are already properly extracted to `.lua` files. However, **12 additional scripts** remain as inline template literals in `scripts/index.ts` (lines 29–501):

- `ATOMIC_CREATE_ROOM_SCRIPT`
- `ATOMIC_JOIN_SCRIPT`
- `ATOMIC_REFRESH_TTL_SCRIPT`
- `ATOMIC_SET_ROOM_STATUS_SCRIPT`
- `ATOMIC_REMOVE_PLAYER_SCRIPT`
- `ATOMIC_CLEANUP_DISCONNECTED_PLAYER_SCRIPT`
- `ATOMIC_SET_SOCKET_MAPPING_SCRIPT`
- `ATOMIC_UPDATE_SETTINGS_SCRIPT`
- `ATOMIC_ADD_TIME_SCRIPT`
- `ATOMIC_TIMER_STATUS_SCRIPT`
- `INVALIDATE_TOKEN_SCRIPT`
- `CLEANUP_ORPHANED_TOKEN_SCRIPT`
- `ATOMIC_SAVE_GAME_HISTORY_SCRIPT`
- `RELEASE_LOCK_SCRIPT`
- `EXTEND_LOCK_SCRIPT`

**Why:** Inline Lua strings are harder to lint, format, and test. Extracting them follows the established pattern of the 6 already-extracted scripts and improves maintainability.

#### 1.2 — Standardize Lua script error signaling

Scripts use inconsistent error signaling: some return `{error = 'NOT_HOST'}`, others return special strings (`'EXPIRED'`, `'RECONNECTED'`), and others return `nil`. A unified error protocol would simplify the TypeScript-side error handling in `luaGameOps.ts` and across services.

**Recommendation:** Adopt a convention where all scripts return either a success JSON or an error JSON with an `error` field, allowing a single TypeScript helper to handle all script results.

#### 1.3 — Add retry/escalation for silent persistence failures

Several services catch persistence errors without retry or escalation:

- **`gameService.persistGameState`** (line ~158): Catches Lua script failures for room status update. If this fails, the game state persists but the room status is incorrect — silent data inconsistency.
- **`roomService` post-creation check** (lines ~106–124): Logs a warning if room creation verification fails, but doesn't throw.
- **`playerService` token cleanup** (lines ~279–283): Fire-and-forget with no retry.

**Recommendation:** Implement a `retryOnTransientFailure()` utility for these critical-path operations, distinct from the existing `withLock()` retry. For non-critical paths, add structured metrics so silent failures are at least observable.

#### 1.4 — Guard against unbounded in-memory growth

- **`roomService` debounce map:** Eviction logic removes entries older than 2x the debounce window, but on high-turnover rooms, this map can grow to thousands of entries between eviction sweeps.
- **`timerService` local timer map:** Relies on `sweepStaleTimers()` with a 2-minute buffer. If the server is under load, sweep latency allows accumulation.
- **`rateLimitHandler` LRU eviction:** Removes entire socket entries rather than individual rate-limit buckets.

**Recommendation:** Add explicit max-size caps with LRU eviction on all in-memory maps. Consider instrumenting map sizes as metrics for monitoring.

---

### Sprint 2: Security & Rate Limiting (High Impact, Low-Moderate Effort)

#### 2.1 — Add global server-wide rate limiting

The current rate limiting is per-socket, per-event. There is no global server-wide limit on total requests. A single IP opening many socket connections can bypass per-socket limits.

**Recommendation:** Add an IP-level rate limiter (using Redis sorted sets for multi-instance support) that limits total events per IP across all connections.

#### 2.2 — Enforce IP mismatch policy

`socketAuth.ts` (line 39–40) flags IP mismatches but does not block the connection. This allows potential session hijacking if a reconnection token is stolen.

**Recommendation:** Make `ALLOW_IP_MISMATCH` default to `false` in production. When `false`, reject connections with IP mismatch instead of just flagging them. The env var already exists for VPN/mobile users who need the leniency.

#### 2.3 — Express 5 query validation gap

`middleware/validation.ts` has a comment noting that `req.query` can't be reassigned in Express 5, so validated query output is discarded. This means query parameters pass through unvalidated to handlers.

**Recommendation:** Store validated query params in `req.validatedQuery` (or `res.locals`) and update handlers to read from there.

---

### Sprint 3: Frontend Resilience (Medium Impact, Moderate Effort)

#### 3.1 — Event listener cleanup on room transitions

Multiple event listeners are registered but never explicitly cleaned up when transitioning between rooms or modes:

- **`body` click listener** in `app.ts` setupEventListeners — registered once, never removed
- **Multiplayer socket listeners** in `multiplayerListeners.ts` — 15+ listeners that could accumulate on repeated join/leave
- **Resize listener** in `board.ts` — `attachResizeListener()` exists but `detachResizeListener()` is not called

**Recommendation:** Implement a `ListenerRegistry` pattern that tracks all registered listeners per "scope" (room join, game start, etc.) and provides a single `cleanup()` call per scope transition.

#### 3.2 — `revealingCards` Set accumulation

If the server never sends a `cardRevealed` confirmation, the `revealingCards` Set grows unbounded. Per-card timeouts clean up the visual state, but Set entries persist until the next full sync.

**Recommendation:** Add a max-size guard and/or periodic sweep that clears entries older than the reveal timeout.

#### 3.3 — Board render efficiency

`renderBoard()` creates 25 new card elements on every call, even for incremental updates (single card reveal, player join/leave). This is called on every `playerUpdated` event.

**Recommendation:** Implement differential rendering — only update changed cards. The reactive store already emits per-property change events; leverage these instead of full re-renders.

#### 3.4 — Validate cached DOM elements

`state.ts` `initCachedElements()` (lines 126–143) doesn't validate that critical elements exist. If the DOM is malformed, cached elements could be null, causing silent failures later.

**Recommendation:** Add assertions for critical elements (board container, role banner, game controls) during initialization, with clear error messages.

---

### Sprint 4: Test Coverage Improvements (Medium Impact, Low Effort)

#### 4.1 — Add Lua script unit tests

The Lua scripts are currently tested only indirectly through integration tests. Given they contain critical business logic (card reveals, player removal, timer management), they deserve direct unit tests.

**Recommendation:** Use a Redis test container or the existing in-memory Redis to execute each script with controlled inputs and verify outputs, especially edge cases (nil inputs, concurrent modification scenarios, expired timers).

#### 4.2 — Test error fallback paths

The `WATCH/MULTI` retry path in `playerService.updatePlayer` is not tested. Neither are the fallback paths when Lua scripts fail. These are exactly the paths most likely to cause silent data corruption.

**Recommendation:** Add tests that simulate Lua script failures (mock `redis.evalsha` to throw) and verify the WATCH/MULTI fallback activates correctly with proper retry behavior.

#### 4.3 — Concurrency scenario tests

No tests exist for race conditions between concurrent updates to the same player/room. The Lua scripts exist precisely to prevent these, but they're never tested under contention.

**Recommendation:** Write tests that issue concurrent `revealCard`, `endTurn`, or `updatePlayer` calls to verify atomicity guarantees hold.

---

### Sprint 5: Observability & Operational Maturity (Low-Medium Impact, Low Effort)

#### 5.1 — Unified metrics collection

Metrics are scattered across multiple modules:
- `safeEmit.ts` — emission metrics
- `rateLimitHandler.ts` — rate limit metrics
- `timerService.ts` — timer sweep metrics

**Recommendation:** Create a central `MetricsRegistry` that all modules register with, exposing a single `/metrics` endpoint (Prometheus-compatible or custom JSON). This enables monitoring dashboards and alerting.

#### 5.2 — Structured logging for operational visibility

Some important operations log at `debug` level, making them invisible in production:
- Distributed lock acquisition/release
- Redis pipeline failures
- Rate limit near-capacity warnings

**Recommendation:** Audit log levels to ensure operational events are at `info` or `warn` in production, while keeping verbose details at `debug`.

#### 5.3 — Health endpoint enrichment

The existing `/health/ready` endpoint could be enriched with:
- Redis connection pool status
- Active room/player counts
- Memory usage (in-memory maps size)
- Rate limit pressure

---

### Sprint 6: Code Quality & DX (Low Impact, Low Effort)

#### 6.1 — Reduce handler context rebuild overhead

Every socket event calls `getPlayerContext()` which fetches the full game state from Redis. For high-frequency events (timer ticks, chat messages), this is unnecessary overhead.

**Recommendation:** Add a short-lived LRU cache (e.g., 500ms TTL) for game state in `getPlayerContext`, keyed by roomCode. This avoids redundant Redis round-trips for bursts of events from the same room.

#### 6.2 — Consolidate duplicate Lua-first/fallback patterns

`removePlayer` and `setSocketMapping` both implement the same "try Lua script, fall back to WATCH/MULTI" pattern. This creates duplicated error handling and retry logic.

**Recommendation:** Extract a generic `executeWithFallback(luaScript, fallbackFn, retryConfig)` utility.

#### 6.3 — Type-safe event names

Socket event names are strings throughout the codebase. While `socketConfig.ts` centralizes the definitions, there's no compile-time guarantee that handlers reference valid events.

**Recommendation:** Generate a union type from `socketConfig.ts` event names and use it in handler registrations for compile-time safety.

---

## Non-Issues (Validated as Sound)

These areas were investigated and found to be well-implemented:

- **TypeScript configuration**: Strict mode enabled with all safety checks
- **CI/CD pipeline**: 9 quality gates including security scanning (Trivy, npm audit, CodeQL)
- **Zod validation**: Consistent at all entry points
- **Error hierarchy**: Well-designed `GameError` class tree with safe client emission
- **Distributed locking**: Proper SET NX + TTL with ownership verification
- **Multi-stage Docker build**: Non-root user, health checks, resource limits
- **Dependabot configuration**: Grouped updates with sensible major-version pinning
- **Frontend reactive store**: Minimal-overhead proxy with WeakMap caching and batch support
- **Socket authentication**: Multi-step validation (origin, IP, session, JWT)

---

## Dependency Notes

| Package | Version | Notes |
|---------|---------|-------|
| `minimatch` | ≤3.1.3 | ReDoS vulnerability — **dev-only** (eslint, test tooling). Not a runtime risk. Fix via `npm audit fix` when compatible versions are available. |
| `express` | 5.2.1 | Express 5 is relatively new. Monitor for breaking changes in middleware ecosystem. |
| `zod` | 4.3.6 | Zod 4 is new. Verify schema composition patterns remain stable. |

---

## Prioritization Summary

| Sprint | Focus | Impact | Effort | Recommendation |
|--------|-------|--------|--------|----------------|
| 1 | Hardening & Resilience | High | Moderate | Do first — prevents silent data loss |
| 2 | Security & Rate Limiting | High | Low-Moderate | Do second — security before scale |
| 3 | Frontend Resilience | Medium | Moderate | Memory leaks compound over long sessions |
| 4 | Test Coverage | Medium | Low | Quick wins that prevent regressions |
| 5 | Observability | Low-Medium | Low | Enables informed decision-making |
| 6 | Code Quality & DX | Low | Low | Nice-to-have, improves velocity |
