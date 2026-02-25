# Hardening & Optimization Review

**Date:** 2025-02-25
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

#### 1.2 Scheduled Cleanup Backpressure

**Problem:** `player/cleanup.ts` processes 50 entries per 60-second cycle from a Redis sorted set. Under sustained high disconnect rates (>50/min), the `scheduled:player:cleanup` ZSET grows unbounded.

**Fix:**
- Add a secondary cleanup sweep when ZSET size exceeds a threshold (e.g., 500 entries)
- Log a warning when cleanup falls behind so operators can investigate
- Add a metric for cleanup queue depth to `/health/metrics`

**Files:** `src/services/player/cleanup.ts`, `src/utils/metrics.ts`

---

#### 1.3 Game History Pipeline Atomicity

**Problem:** `gameHistoryService.ts:350-366` uses `redis.multi()` for 4 operations (set, zAdd, zRemRangeByRank, expire). This is a pipeline, **not** an atomic transaction — partial writes are possible if the server crashes mid-execution.

**Options (choose one):**
- **A.** Convert to a Lua script for true atomicity (preferred — consistent with the rest of the codebase)
- **B.** Add idempotency checks so partial writes can be retried safely
- **C.** Accept partial writes but add a reconciliation check on history read

**Files:** `src/services/gameHistoryService.ts`, potentially `src/scripts/`

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

#### 3.4 Per-Room Rate Limiting (Optional)

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
Week 1:  1.1 (tests for socket-client, sessionValidator, healthRoutes)
Week 2:  1.2 (cleanup backpressure) + 1.3 (history atomicity)
Week 3:  2.1-2.4 (emission metrics, timer observability, test stabilization, Redis timeout)
Week 4:  3.1-3.3 (reconnect button, token test, health metrics)
Backlog: 3.4 (per-room rate limiting — evaluate need based on production traffic)
```

Each item is independent and can be tackled in any order. Nothing here blocks anything else.
