# Hardening & Optimization Review

**Date:** 2026-02-25
**Scope:** Existing functionality only — hardening, robustness, optimization. No new features.

---

## Executive Summary

The Eigennamen codebase is **well-architected and security-conscious**. It follows defense-in-depth principles with layered protections: Zod validation at all entry points, atomic Lua scripts for Redis operations, dual-layer rate limiting, CSRF protection, error sanitization, and strict TypeScript. No critical vulnerabilities were found.

This review identifies **concrete, prioritized improvements** to further harden what's already in place.

---

## Proposed Improvements — Prioritized

### Priority 1: High-Impact Hardening

#### 1.1 Test Coverage for Critical Untested Paths

Three high-criticality source files have zero dedicated unit tests:

| File | Lines | Risk |
|------|-------|------|
| `src/frontend/socket-client.ts` | 910 | Reconnection logic, offline queue, auth — all untested |
| `src/middleware/auth/sessionValidator.ts` | 408 | Memory rate-limit fallback, IP mismatch detection, session age enforcement |
| `src/routes/healthRoutes.ts` | 255 | Redis timeout handling, production info filtering, PubSub health |

**What to test:**
- **socket-client.ts**: Offline queue overflow (>20 items), reconnection race conditions, auth timeout, Socket.io library load failure, duplicate event deduplication
- **sessionValidator.ts**: Memory rate-limit cleanup effectiveness, max cap enforcement (10k entries), fallback when Redis is unavailable, concurrent access during cleanup
- **healthRoutes.ts**: Redis timeout (3s), memory alert thresholds (75%/90%), production vs dev info filtering, PubSub health check failures

**Why now:** These files sit on critical paths — socket authentication, connection resilience, and operational health. Bugs here are invisible until production incidents.

---

#### 1.2 Scheduled Cleanup Backpressure — RESOLVED

**Problem:** `player/cleanup.ts` processes 50 entries per 60-second cycle from a Redis sorted set. Under sustained high disconnect rates (>50/min), the `scheduled:player:cleanup` ZSET grows unbounded.

**Resolution:** Implemented dynamic backpressure scaling: when queue depth exceeds threshold (500), additional sweeps continue until queue drains below threshold or a hard cap (500 items/cycle) is reached. Final queue depth is logged and tracked via metrics gauge.

**Files:** `src/services/player/cleanup.ts`

---

#### 1.3 Game History Pipeline Atomicity — RESOLVED

**Problem:** `gameHistoryService.ts` previously used `redis.multi()` for 4 operations (set, zAdd, zRemRangeByRank, expire). This was a pipeline, not an atomic transaction.

**Resolution:** Converted to `ATOMIC_SAVE_GAME_HISTORY_SCRIPT` Lua script (option A). All 4 operations execute atomically in a single Redis eval call, preventing partial writes on crash.

**Files:** `src/services/gameHistoryService.ts`, `src/scripts/index.ts`

---

#### 1.4 Paused Timer TTL Expiration — RESOLVED

**Problem:** Active timers had a TTL of `duration + 60s buffer`. When paused, the TTL kept ticking, causing key expiration and game hangs.

**Resolution:** `pauseTimer()` now refreshes TTL to `REDIS_TTL.PAUSED_TIMER` (24h/4h) when pausing. `resumeTimer()` validates whether the timer would have expired during pause and calls onExpire callback if so. The `ATOMIC_TIMER_STATUS_SCRIPT` also detects and cleans up expired-while-paused timers atomically.

**Files:** `src/services/timerService.ts`, `src/scripts/index.ts`

---

#### 1.5 Token Batch Cleanup Efficiency — RESOLVED

**Problem:** Token cleanup used sequential individual operations instead of batched calls.

**Resolution:** Two fixes applied:
- `roomService.ts cleanupRoom()`: Uses `mGet()` for batch token lookup + single `redis.del(keysToDelete)` call for all keys.
- `player/reconnection.ts cleanupOrphanedReconnectionTokens()`: Refactored from sequential Lua script calls to parallel batch processing (batches of 20 via `Promise.all`), leveraging node-redis automatic pipelining.

**Files:** `src/services/roomService.ts`, `src/services/player/reconnection.ts`

---

### Priority 2: Moderate-Impact Hardening

#### 2.1 Emission Metrics Unbounded Growth

**Problem:** `safeEmit.ts:47-52` maintains `emissionMetrics` counters that never reset in production. After months of operation, the `total`/`successful`/`failed` counters grow indefinitely (though memory impact is minimal — single object, not arrays).

**Fix:** Add periodic metrics snapshot-and-reset (hourly), or switch to a sliding-window counter that naturally ages out.

**Files:** `src/socket/safeEmit.ts`

---

#### 2.2 Local Timer Orphaning Race

**Problem:** `timerService.ts:454-468` updates local timer state _after_ the Lua script succeeds. If the process crashes between Lua success and local update, an orphaned Redis timer entry persists until the cleanup sweep.

**Fix:**
- Add a metric tracking unowned timers discovered during `sweepStaleTimers()`
- Consider a startup reconciliation that scans for timers this instance should own
- The existing sweep (`timerService.ts:501-523`) already handles cleanup — making this observable is the key improvement

**Files:** `src/services/timerService.ts`, `src/utils/metrics.ts`

---

#### 2.3 Flaky Test Stabilization

**Identified patterns:**
- **Fixed timeouts**: `handlers.integration.test.ts` uses `setTimeout(resolve, 500)` — fails on slow CI
- **Fake timer races**: 3 timer test suites use `flushPromises()` chains suggesting fragile async timing
- **Rate limit sleep**: `rateLimitHandlerExtended.test.ts` has 14 `setTimeout(resolve, 10)` calls

**Fix:**
- Replace fixed `setTimeout` waits with event-driven assertions (wait-for-condition pattern)
- Consolidate `flushPromises()` into a helper that drains the microtask queue deterministically
- Add `jest.retryTimes(2)` as a safety net for known-flaky integration tests (with a comment explaining why, and a tracking issue to fix the root cause)

**Files:** `src/__tests__/integration/`, `src/__tests__/handlers/rateLimitHandlerExtended.test.ts`

---

#### 2.4 Embedded Redis Startup Timeout

**Problem:** `redis.ts:104` hardcodes a 5-second timeout for the embedded redis-server to start. On slow hardware or under load, this can cause false startup failures.

**Fix:** Make configurable via `EMBEDDED_REDIS_TIMEOUT_MS` env var (default 5000, max 15000). Log the actual startup time for operational visibility.

**Files:** `src/config/redis.ts`

---

#### 2.5 Memory Mode Detection Duplication

**Problem:** The `isMemoryMode()` check is independently implemented in three places: `redis.ts:58-61`, `roomConfig.ts:10`, and `env.ts:57`. Same logic, three copies. If one diverges, TTL configuration and memory-mode detection disagree.

**Fix:** Centralize into a single exported constant or function (e.g., in `constants.ts`) and import everywhere.

**Files:** `src/config/redis.ts`, `src/config/roomConfig.ts`, `src/config/env.ts`

---

#### 2.6 Game State Array Length Validation

**Problem:** The `gameStateSchema` Zod schema validates individual array types (`words`, `types`, `revealed`) but doesn't validate that they all have the same length. If Redis data is corrupted and arrays are mismatched, `revealCard.lua` reads `game.types[index]` which could be nil for a valid word index.

**Fix:** Add a Zod `.refine()` cross-field check asserting `words.length === types.length === revealed.length`. This catches corruption at deserialization time rather than during game operations.

**Files:** `src/services/game/luaGameOps.ts` (gameStateSchema)

---

### Priority 3: Polish & Defense-in-Depth

#### 3.1 Frontend: Manual Reconnect Button

**Current state:** Reconnection is fully automatic via Socket.io's exponential backoff. If all 5 attempts fail, the user sees a "Disconnected" overlay with no actionable option.

**Fix:** Add a "Reconnect Now" button to the disconnect overlay that manually triggers `socket.connect()`. Low effort, high UX value.

**Files:** `src/frontend/handlers/roomEventHandlers.ts`, frontend CSS

---

#### 3.2 Reconnection Token Invalidation Test

**Current state:** Token invalidation after successful reconnect is implemented (`INVALIDATE_TOKEN_SCRIPT`) but lacks a dedicated test verifying the token is actually unusable after reconnection.

**Fix:** Add a test that:
1. Generates a reconnection token
2. Successfully reconnects using it
3. Attempts to use the same token again → expects rejection

**Files:** `src/__tests__/services/reconnection.test.ts`

---

#### 3.3 Health Check Queue Depth Metric

**Current state:** `/health/metrics` reports socket connections, rate limit stats, and process info — but not Redis operation queue depth or cleanup backlog.

**Fix:** Add to metrics:
- `cleanup_queue_depth`: Current size of `scheduled:player:cleanup` ZSET
- `timer_sweep_orphans`: Count of timers found without local owners during last sweep
- `redis_command_queue_length`: Current Redis client command queue size

**Files:** `src/routes/healthRoutes.ts`, `src/utils/metrics.ts`

---

#### 3.4 Connection Cleanup Error Logging

**Current state:** `redis.ts:309-321` (`cleanupPartialConnections`) silently swallows errors when quitting Redis clients during connection retry. If `quit()` hangs or throws, the error is invisible.

**Fix:** Log at `warn` level instead of silencing, and add a timeout wrapper to prevent hanging cleanup.

**Files:** `src/config/redis.ts`

---

#### 3.5 Per-Room Rate Limiting (Optional)

**Current state:** Rate limiting is per-socket and per-IP. A coordinated attack from multiple IPs targeting a single room can spam events without hitting per-IP limits.

**Consideration:** Add an optional per-room rate limit layer. This is lower priority because:
- Rooms are private (require room code to join)
- Each participant is still individually rate-limited
- The attack surface is limited

If implemented, keep it configurable and disabled by default to avoid false positives in legitimate large rooms.

---

## What's Already Excellent

These areas need no changes — they represent strong engineering:

| Area | Why It's Strong |
|------|----------------|
| **Error sanitization** | `SAFE_ERROR_CODES` whitelist, `sanitizeErrorForClient()`, detail stripping in `errorHandler.ts` |
| **Lua script atomicity** | 10+ scripts covering all critical game operations, with defense-in-depth validation inside Lua |
| **TypeScript strictness** | All 15 strict flags enabled, `noUncheckedIndexedAccess`, `useUnknownInCatchVariables` |
| **CSRF protection** | Dual defense: `X-Requested-With` header requirement + Origin/Referer validation |
| **Graceful shutdown** | Multi-stage: timers → socket drain → HTTP close → Redis disconnect, with force-exit timeout |
| **Distributed locking** | Proper Lua-based release/extend, auto-extend for long operations, exponential backoff |
| **Session security** | 8h max age, 5min reconnect tokens, IP binding, timing-safe admin auth |
| **Docker hardening** | Multi-stage build, non-root user, resource limits, health checks |
| **Helmet/CSP** | Comprehensive CSP, HSTS with preload, referrer policy, frame ancestors |
| **Input validation** | Zod schemas at every entry point, control char removal, HTML escaping, reserved name checking |

---

## Suggested Implementation Order

```
Week 1:  1.1 (tests for critical untested paths)
         1.4 (paused timer TTL — small fix, high impact)
Week 2:  1.2 (cleanup backpressure) + 1.3 (history atomicity)
         1.5 (token batch cleanup)
Week 3:  2.1-2.6 (emission metrics, timer observability, test stabilization,
                   Redis timeout, memory mode dedup, array validation)
Week 4:  3.1-3.4 (reconnect button, token test, health metrics, cleanup logging)
Backlog: 3.5 (per-room rate limiting — evaluate need based on production traffic)
```

Each item is independent and can be tackled in any order. Nothing here blocks anything else.
