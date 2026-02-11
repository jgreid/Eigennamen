# Architectural Review: Holistic Assessment

**Date:** 2026-02-11
**Scope:** Full codebase structural review after incremental growth

---

## Executive Summary

The codebase has a solid foundation — clean service/handler separation, no circular dependencies, comprehensive test coverage (94%+), and thoughtful production hardening. However, incremental growth has introduced several structural problems that compound maintainability risk:

1. **A stalled CommonJS-to-ESM migration** that touches every file
2. **`config/` directory overreach** — infrastructure services masquerading as configuration
3. **Duplicated health/metrics endpoints** across `app.ts` and `routes/healthRoutes.ts`
4. **A hand-maintained `socket-client.js`** outside the TypeScript build pipeline
5. **Type definitions that manually mirror config** instead of being derived from it
6. **A 1,880-line in-memory Redis reimplementation** living in `config/`

None of these are bugs. All of them are the natural result of fast iteration. What follows is a prioritized breakdown.

---

## Issue 1: Stalled Module System Migration

**Severity: Structural / High**
**Files affected: ~72 source files (100%)**

Every backend source file uses a hybrid of CommonJS and ES module syntax simultaneously:

```typescript
// Typical file pattern (e.g., app.ts, GameError.ts, timeout.ts)
import type { Request, Response } from 'express';  // ESM type import
const express = require('express');                  // CJS runtime import

export class GameError extends Error { ... }         // ESM export
module.exports = { GameError, RoomError, ... };      // CJS re-export
```

**By the numbers:**
- 226 `require()` statements across 51 files (71%)
- 54 files with `module.exports` (75%)
- 60 files with named `export` statements (83%)
- 0 files are pure ESM or pure CommonJS

The `tsconfig.json` compiles to CommonJS (`"module": "commonjs"`), and `esModuleInterop` bridges the gap at build time. This works, but:

- **Every file carries dual export boilerplate.** Files like `constants.ts` have *triple* exports: ESM wildcard re-export, ESM named imports, and a `module.exports` block re-listing all 30+ symbols.
- **Path aliases are configured but unused.** Nine aliases (`@config/*`, `@services/*`, etc.) exist in `tsconfig.json` but zero imports use them — everything is relative paths.
- **The migration has no clear direction.** There's no tracking of which files are "done" vs "pending."

**Recommendation:** Pick a target state (likely full ESM with `"module": "nodenext"`) and migrate systematically. Remove all `module.exports` blocks and `require()` calls. Enable path aliases or remove them from config.

---

## Issue 2: `config/` Contains Infrastructure Services

**Severity: Architectural / High**
**Key files:** `config/jwt.ts`, `config/redis.ts`, `config/database.ts`, `config/memoryStorage.ts`

The `config/` directory should contain constants, settings, and environment parsing. Several files have grown well beyond that:

### `config/jwt.ts` (303 lines)
Contains `JWT_CONFIG` and `JWT_ERROR_CODES` (configuration), but also `signToken()`, `verifyToken()`, `verifyTokenWithClaims()`, `decodeToken()`, and `generateSessionToken()` — these are service functions that depend on `jsonwebtoken` and `logger`. This is a JWT service with config mixed in.

### `config/redis.ts` (457 lines)
Contains connection URL parsing (configuration), but also connection lifecycle management (`connectRedis()`, `disconnectRedis()`), health checking (`isRedisHealthy()`), memory monitoring (`getRedisMemoryInfo()` — 90 lines of INFO command parsing), module-level mutable state for client singletons, and retry logic with exponential backoff. This is a Redis client manager.

### `config/database.ts`
Same pattern: mixes database URL config with `connectDatabase()`, `getDatabase()`, `disconnectDatabase()`, and connection retry logic.

### `config/memoryStorage.ts` (1,880 lines)
A full Redis-compatible API implementation including string/list/set/sorted-set/hash operations, Lua script evaluation (the eval implementation alone is ~1,000 lines), pub/sub, TTL management, and transaction simulation (WATCH/MULTI/EXEC). This is an infrastructure component, not configuration.

**Impact:** When a developer looks for "where is Redis connection handled?" or "where is JWT signing?", `config/` is not the intuitive location. The `config/` directory becomes a catch-all that obscures the actual configuration files (which are well-organized: `gameConfig.ts`, `rateLimits.ts`, `socketConfig.ts`, etc.).

**Recommendation:** Extract into an `infrastructure/` directory:
```
infrastructure/
  redisClient.ts       ← connection lifecycle, health, memory info
  memoryStorage.ts     ← in-memory Redis adapter
  database.ts          ← Prisma connection lifecycle
  jwtService.ts        ← sign/verify/decode operations

config/
  redis.ts             ← URL, TLS options, retry constants only
  database.ts          ← connection string, pool size only
  jwt.ts               ← JWT_CONFIG, JWT_ERROR_CODES only
```

---

## Issue 3: Duplicated Health and Metrics Endpoints

**Severity: Operational / Medium**
**Files:** `app.ts:199-408`, `routes/healthRoutes.ts:116-278`

Health endpoints are defined in two places with different implementations:

| Path | Defined in `app.ts` | Defined in `routes/healthRoutes.ts` | Reachable via |
|------|---------------------|-------------------------------------|---------------|
| `/health` | Yes (line 199) | Yes (line 116) | Root wins; route at `/api/health` |
| `/health/ready` | Yes (line 226) — checks DB, Redis, Socket.io | Yes (line 129) — checks Redis mode, pub/sub | Root wins; route at `/api/health/ready` |
| `/health/live` | Yes (line 306) | Yes (line 184) | Root wins |
| `/metrics` | Yes (line 341) | No | Root only |
| `/health/metrics` | No | Yes (line 195) | Route only |
| `/health/metrics/prometheus` | No | Yes (line 266) | Route only |

The `app.ts` versions and the `healthRoutes.ts` versions run different checks and return different response shapes. An operator using `/health/ready` gets the `app.ts` version (which checks DB + Redis + Socket.io), while `/api/health/ready` gets the routes version (which checks Redis mode + pub/sub health). Neither is clearly documented as canonical.

**Additionally, `app.ts` has grown to 425 lines** with responsibilities that don't belong in Express configuration:
- Socket count caching logic (40+ lines of cache + timeout + race handling)
- Full readiness probe implementation with DB/Redis/Socket.io checks
- Metrics aggregation across rate limiters, application counters, and socket stats
- Inline interface definitions for response shapes

**Recommendation:** Remove health/metrics endpoints from `app.ts`. Move socket count caching to a utility. Let `routes/healthRoutes.ts` be the single source of truth, mounted at `/health` directly (not under `/api`).

---

## Issue 4: `socket-client.js` Outside the Build Pipeline

**Severity: Consistency / Medium**
**File:** `server/public/js/socket-client.js` (1,019 lines)

The entire frontend TypeScript source (`server/src/frontend/`, 16 files) is compiled via `tsconfig.frontend.json` to `server/public/js/modules/`. This is a clean pipeline.

However, `socket-client.js` is a hand-maintained IIFE that lives directly in `public/js/` — outside the TypeScript build. It creates the `CodenamesClient` global object that all frontend modules depend on. The frontend modules reference it through `globals.d.ts` type declarations.

This creates an asymmetry:
- 15 frontend modules: TypeScript source → compiled JS (type-checked, linted)
- 1 critical module: Hand-written JS (no type checking, no linting, no source maps)

The file is 1,019 lines of non-trivial code handling connection management, reconnection with exponential backoff, session persistence, offline message queuing, and the complete game action API. At this size and complexity, it deserves the same tooling guarantees as the rest of the frontend.

**Recommendation:** Convert `socket-client.js` to TypeScript in `server/src/frontend/socket-client.ts` and include it in the frontend build pipeline. Export `CodenamesClient` as an ES module rather than a global.

---

## Issue 5: Type Definitions Manually Mirror Configuration

**Severity: Maintenance Burden / Medium**
**Files:** `types/config.ts` (399 lines) vs `config/*.ts`

`types/config.ts` contains hand-written interface definitions that manually reproduce the structure of every config file:

```typescript
// types/config.ts — manual mirror
export interface RateLimitConfig {
  window: number;
  max: number;
}

export interface SocketRateLimits {
  'room:create': RateLimitConfig;
  'room:join': RateLimitConfig;
  // ... 25 more entries
}
```

Meanwhile, the actual config files already use `as const`:

```typescript
// config/rateLimits.ts — source of truth
export const RATE_LIMITS = {
  'room:create': { window: 60000, max: 5 },
  'room:join': { window: 60000, max: 10 },
  // ...
} as const;
```

Every time a rate limit is added, a socket event is created, or a timer constant changes, both files must be updated manually. TypeScript can derive these types automatically:

```typescript
// Replace 399 lines with ~20
import { RATE_LIMITS } from '../config/rateLimits';
export type RateLimitConfig = typeof RATE_LIMITS[keyof typeof RATE_LIMITS];
export type SocketRateLimits = typeof RATE_LIMITS;
```

Similarly, the `SocketEventNames` interface (78 lines, all `string` properties) could be derived from the `SOCKET_EVENTS` const object.

**Recommendation:** Replace manual type mirrors with `typeof` inference from the config const objects. This eliminates the 399-line file and guarantees type/config synchronization.

---

## Issue 6: Frontend Game Logic Duplication

**Severity: Correctness Risk / Medium**
**Files:** `server/src/services/game/boardGenerator.ts` ↔ `server/src/frontend/utils.ts` ↔ `index.html`

The Mulberry32 PRNG algorithm and board setup logic exist in three places:
1. **Server** (`services/game/boardGenerator.ts`): Authoritative implementation
2. **Frontend modules** (`frontend/utils.ts`, `frontend/game.ts`): For multiplayer mode optimistic updates and standalone mode
3. **Root `index.html`**: Inline for standalone-only mode (no server)

The PRNG implementations must be byte-identical across all three — if they drift, the same seed produces different boards on client vs server, breaking standalone mode's URL sharing and multiplayer's deterministic shuffling.

This is documented in comments ("MUST stay in sync with server-side implementation"), but there's no automated verification. A test exists for server-side PRNG but nothing cross-validates client output against server output.

**Recommendation:** Extract shared game logic to a single source file that can be consumed by both build pipelines (e.g., a shared pure-function module compiled for both Node.js and browser). Add a cross-validation test that runs the same seeds through both implementations and asserts identical output.

---

## Issue 7: Validator Organization

**Severity: Scalability / Low**
**File:** `validators/schemas.ts` (369 lines)

All Zod validation schemas live in a single file — room schemas, player schemas, game schemas, chat schemas, timer schemas, and admin schemas mixed together. The file is organized with comments but has no structural separation.

As the application grows, this becomes harder to navigate. More importantly, the schemas are physically distant from the handlers that use them, making it harder to verify that a handler validates all its inputs.

**Recommendation:** Split into domain-specific files:
```
validators/
  index.ts          ← re-exports
  common.ts         ← shared helpers (createSanitizedString, etc.)
  roomSchemas.ts
  playerSchemas.ts
  gameSchemas.ts
  timerSchemas.ts
  chatSchemas.ts
```

---

## Issue 8: Two Package Roots, Two E2E Test Suites

**Severity: Confusion / Low**
**Files:** Root `package.json` + `playwright.config.ts` vs `server/package.json` + `server/playwright.config.js`

The repository has two `package.json` files with overlapping concerns:

| | Root | Server |
|---|---|---|
| Name | `risley-codenames` | `die-eigennamen-server` |
| Type | `"type": "module"` | (no type field — CommonJS) |
| E2E runner | Playwright 1.57 | Playwright 1.58 |
| E2E config | `playwright.config.ts` | `server/playwright.config.js` |
| E2E tests | `tests/e2e/` (appears unused) | `server/e2e/` (8 active specs) |
| Build tool | Vite | tsc |
| Dev server | Vite (port 5173, proxies to 3000) | ts-node-dev (port 3000) |

The root-level Vite setup appears to be for standalone-mode development, but `tests/e2e/` is apparently dormant while `server/e2e/` is the active test suite. Having two Playwright versions and two E2E directories is confusing.

The root `package.json` also declares `"type": "module"` while the server is CommonJS, creating a module system split at the repo boundary.

**Recommendation:** Clarify the root-level package's role. If it's only for Vite dev serving of standalone mode, document that. Remove or redirect the unused `tests/e2e/` directory. Align Playwright versions.

---

## What's Working Well

These are structural strengths to preserve during any refactoring:

- **Service/handler separation is clean.** Handlers are thin wrappers (context resolution → service call → broadcast). Zero business logic in handlers.
- **No circular dependencies.** The import graph flows one way: handlers → services → config/utils.
- **Atomic operations are well-designed.** 10+ Lua scripts with TypeScript fallbacks, distributed locks, WATCH/MULTI/EXEC transactions — concurrency control is thorough.
- **Error hierarchy is well-typed.** `GameError` subclasses with factory methods (`RoomError.notFound()`) and client sanitization.
- **Graceful degradation is genuine.** Database optional, Redis falls back to memory, standalone mode works without any server.
- **Test coverage is high.** 2,675 tests across 83 suites, 94%+ line coverage, with integration tests covering race conditions and full game flows.
- **Security posture is strong.** CSRF, rate limiting, Helmet CSP, input validation with Zod, NFKC normalization, audit logging.
- **Game sub-service decomposition.** Breaking `gameService` into `boardGenerator`, `clueValidator`, `revealEngine`, and `luaGameOps` keeps complexity manageable.

---

## Suggested Prioritization

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Extract infrastructure from `config/` (#2) | Medium | High — fixes most confusing structural issue |
| 2 | Remove duplicate health endpoints (#3) | Low | Medium — eliminates operational confusion |
| 3 | Complete ESM migration (#1) | High | High — removes pervasive boilerplate |
| 4 | Derive types from config (#5) | Low | Medium — eliminates 399-line maintenance burden |
| 5 | Convert socket-client.js to TS (#4) | Medium | Medium — brings critical code under tooling |
| 6 | Shared PRNG module (#6) | Medium | Medium — reduces correctness risk |
| 7 | Split validators (#7) | Low | Low — improves navigability |
| 8 | Clarify dual package roots (#8) | Low | Low — reduces confusion |
