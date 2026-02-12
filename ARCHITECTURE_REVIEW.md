# Architectural Review: Codenames Online

An honest, holistic assessment of the codebase after many incremental updates, with actionable recommendations for making it more cohesive.

---

## Executive Summary

The codebase is functional, well-tested (2,635 tests, 94%+ coverage), and feature-rich. The architecture shows clear intent — service layers, typed errors, validation schemas, context handlers — but the incremental evolution has left several systemic issues that increase cognitive load and make changes harder than they need to be:

1. **A half-migrated TypeScript codebase** — every backend file uses `require()` AND `export`, doubling every module's export surface
2. **A 1,915-line in-memory Redis simulator** that's a maintenance trap
3. **Duplicated logic between Lua scripts, TypeScript fallbacks, and the memory storage adapter** — every game operation exists in 3 places
4. **Frontend multiplayer code split across 5+ files** with unclear boundaries
5. **Documentation sprawl** — 17+ markdown files, many overlapping
6. **Over-engineered infrastructure** relative to the application's actual scale

---

## Issue 1: The Dual Export System (Every File)

**Severity: High (pervasive friction)**

Every single backend `.ts` file (57 files) uses both `module.exports = { ... }` and `export { ... }`. This is the most visible sign of incremental migration — the codebase is TypeScript but was never actually migrated to ES modules.

```typescript
// socket/index.ts — representative of ALL 57 files
module.exports = {
    initializeSocket, getIO, emitToRoom, ...
};
export {
    initializeSocket, getIO, emitToRoom, ...
};
```

Meanwhile, all `import` statements at the top of files use `require()`:
```typescript
const logger = require('../utils/logger');
const { getRedis } = require('../config/redis');
```

**The problem**: You get the worst of both worlds — the verbosity of maintaining two export blocks, while actually using neither TypeScript's import system nor CommonJS idiomatically. Types are imported with `import type` (good) but values are imported with `require()` (negating TypeScript's module resolution benefits).

**Recommendation**: Pick one module system and commit to it. Since the project uses `ts-jest` and compiles to CommonJS, the path of least resistance is to switch everything to `import`/`export` syntax and let TypeScript compile to CommonJS. This is a mechanical transformation that could be done file-by-file. Every `require()` becomes an `import`, and the `module.exports` blocks are deleted.

---

## Issue 2: The MemoryStorage Mega-Class (1,915 lines)

**Severity: High (maintenance trap)**

`config/memoryStorage.ts` is the largest file in the codebase — a hand-written Redis simulator that reimplements strings, sets, lists, sorted sets, pub/sub, transactions with optimistic locking, SCAN iterators, key eviction, and Lua script simulation.

The Lua script simulation is particularly concerning — it dispatches based on heuristic pattern matching of key prefixes and argument counts:

```typescript
// Room CREATE script: 2 keys, 2 args, firstKey starts with 'room:', not ':players'
if (numKeys === 2 && numArgs === 2 && firstKey.startsWith('room:') && !firstKey.includes(':players')) {
```

Every time a new Lua script is added to the application, the developer must also write a parallel TypeScript implementation in `memoryStorage.ts` that mimics the exact behavior by matching the number of keys and arguments. This is fragile, error-prone, and has already accumulated comments like `"CRITICAL FIX"`, `"HIGH FIX"`, and `"SPRINT-15 FIX"`.

**The problem**: The application's logic now exists in three places for every atomic operation: (1) the Lua script, (2) the TypeScript fallback, and (3) the memory storage simulator. This triplication is a significant source of subtle bugs.

**Recommendation**: Replace `MemoryStorage` with an embedded Redis instance (e.g., `ioredis` against a bundled `redis-server`, or use `ioredis-mock` which is maintained and actually parses Redis commands). Alternatively, accept that "memory mode" means "for local dev only" and just require Redis for all environments — it's a single Docker container. The 1,900 lines of hand-rolled Redis simulation is not providing value proportional to its maintenance cost.

---

## Issue 3: Triple-Implementation of Game Operations

**Severity: High (correctness risk)**

The game service pattern for `revealCard`, `giveClue`, `endTurn` follows this flow:

1. Try optimized **Lua script** (e.g., `OPTIMIZED_REVEAL_SCRIPT`)
2. If Lua fails, fall back to **TypeScript transactional logic** (e.g., `revealCardFallback`)
3. If running in memory mode, the Lua script is "simulated" by **MemoryStorage.eval()** pattern matching

The `withLuaFallback` helper in `luaGameOps.ts` orchestrates this, but the net effect is that every game mutation's business logic exists in three distinct implementations that must stay perfectly synchronized.

**The problem**: When someone changes the reveal logic, they must update the Lua script, the TypeScript fallback, and potentially the memory storage's eval dispatcher. If any of these drift, you get bugs that only manifest in specific deployment modes. The comments in the code already evidence this: `"Lua script now handles Duet mode natively"`, `"kept for backward compatibility"`.

**Recommendation**: Choose one path:
- **Option A**: Lean into Lua for all Redis deployments and drop the TS fallback entirely. Fail fast if Lua isn't available rather than maintaining parallel implementations.
- **Option B**: Drop the Lua scripts and use the TypeScript transactional path (watch/multi/exec) everywhere. The performance benefit of Lua is minimal for a board game with <20 concurrent players.

Either way, reduce from 3 implementations to 1.

---

## Issue 4: Frontend Module Boundaries (Multiplayer Split)

**Severity: Medium (cognitive load)**

The multiplayer functionality is split across 5 files:
- `multiplayer.ts` (422 lines) — connection management + barrel re-exports
- `multiplayerListeners.ts` (609 lines) — socket event handlers
- `multiplayerSync.ts` (336 lines) — state synchronization
- `multiplayerUI.ts` (541 lines) — UI updates
- `multiplayerTypes.ts` — type definitions

`multiplayer.ts` is largely a barrel file that re-exports from the other three:
```typescript
export { copyRoomCode, updateRoomInfoDisplay, ... } from './multiplayerUI.js';
export { leaveMultiplayerMode, syncGameStateFromServer, ... } from './multiplayerSync.js';
export { setupMultiplayerListeners } from './multiplayerListeners.js';
```

This exists so that `app.ts` can `import { ... } from './multiplayer.js'` without knowing about the sub-modules. But it means `multiplayer.ts` is a pass-through layer that adds no logic, just indirection.

**The problem**: The split was done by technical concern (UI / Sync / Listeners) rather than by feature. But `multiplayerListeners.ts` imports from both `multiplayerUI.ts` and `multiplayerSync.ts`, so the "separation" is really just spreading tightly coupled code across files.

**Recommendation**: Either:
- **Merge back** into a single `multiplayer.ts` (the total is ~1,900 lines — large but manageable for a single cohesive module)
- **Split by feature** instead: connection lifecycle, game events, player events, chat — each self-contained with its own UI updates and state sync

---

## Issue 5: The Mutable Global State Singleton (Frontend)

**Severity: Medium**

The frontend state is a single mutable object (`_rawState` in `state.ts`) with 40+ properties, shared across all modules via `import { state } from './state.js'`. There's a debug proxy that can log mutations, but no encapsulation — any module can mutate any property at any time.

```typescript
// Any module can do this
state.spymasterTeam = 'red';
state.gameState.currentTurn = 'blue';
state.multiplayerPlayers = [];
```

**The problem**: This makes data flow invisible. When debugging why `currentTurn` changed, you'd have to search every file for `state.gameState.currentTurn =`. The debug proxy helps but is opt-in and off by default.

**Recommendation**: This is acceptable for the project's scale, but if the frontend continues to grow, consider accessor functions (e.g., `setCurrentTurn(team)`) that provide a single mutation point per property and could emit events for reactive updates.

---

## Issue 6: Config/Constants Sprawl

**Severity: Medium (disorienting)**

Configuration is spread across 13 files in `server/src/config/`:

| File | Lines | Content |
|------|-------|---------|
| memoryStorage.ts | 1,915 | Redis simulator (shouldn't be "config") |
| swagger.ts | 712 | API documentation (shouldn't be "config") |
| redis.ts | 457 | Redis client setup (reasonable) |
| jwt.ts | 297 | JWT token handling (is this config or a service?) |
| env.ts | 200 | Environment variable parsing |
| gameConfig.ts | 141 | Game constants |
| database.ts | 131 | Prisma client setup |
| socketConfig.ts | 108 | Socket.io settings |
| securityConfig.ts | 71 | Security constants |
| rateLimits.ts | 62 | Rate limit definitions |
| roomConfig.ts | 47 | Room constants |
| errorCodes.ts | 35 | Error code enum |
| constants.ts | 35 | Barrel re-export of above |

**The problem**: `memoryStorage.ts` and `swagger.ts` together are 2,627 lines — making `config/` the largest directory in the project, but most of it isn't configuration. `jwt.ts` at 297 lines contains meaningful business logic (token creation, validation, refresh) — it's a service wearing a config hat.

**Recommendation**:
- Move `memoryStorage.ts` to `services/` or `infrastructure/` (or delete it per Issue 2)
- Move `swagger.ts` to `routes/` or a `docs/` source directory
- Move `jwt.ts` to `services/` or `middleware/auth/`
- What remains in `config/` would be pure constants and environment parsing (a clean ~500 lines)

---

## Issue 7: Dual Audit Systems

**Severity: Low-Medium (confusing overlap)**

There are two separate audit implementations:
- `utils/audit.ts` (114 lines) — logs audit events via Winston with correlation IDs
- `services/auditService.ts` (485 lines) — stores audit events in Redis with sorted sets, in-memory fallback, retention policies, and query APIs

Both are used in the codebase. Handlers import `audit` from `utils/audit.ts`:
```typescript
const { audit, AUDIT_EVENTS } = require('../../utils/audit');
```

While admin routes use `auditService.ts`:
```typescript
const auditService = require('../services/auditService');
```

**The problem**: Two audit systems with different event taxonomies, storage backends, and querying capabilities. Which is the source of truth?

**Recommendation**: Consolidate into one. The `auditService.ts` is the more capable implementation. Have it handle both the structured storage and the Winston logging internally. Delete `utils/audit.ts` and migrate its callers to use the service.

---

## Issue 8: The socketFunctionProvider Pattern

**Severity: Low-Medium (accidental complexity)**

`socketFunctionProvider.ts` exists to solve a circular dependency: `socket/index.ts` defines `emitToRoom`, `startTurnTimer`, etc., and handlers need these functions, but `index.ts` imports the handlers. The solution is a runtime registry:

```
socket/index.ts → registers functions in socketFunctionProvider
                → imports handlers
handlers → call getSocketFunctions() at runtime
```

This works but adds a layer of indirection, a `registerSocketFunctions()` call that must happen before any handler runs, and duplicated interface definitions (`SocketFunctions` is defined in both `socketFunctionProvider.ts` and `connectionHandler.ts`).

**Recommendation**: Restructure so that `socket/index.ts` passes the functions directly to handlers via arguments (dependency injection at construction time), which `connectionHandler.ts` already does:
```typescript
roomHandlers(socketServer, gameSocket); // already receives socketServer
```
Just extend this to pass the utility functions too, and the provider becomes unnecessary.

---

## Issue 9: Documentation Sprawl

**Severity: Low (but distracting)**

The project has 17+ markdown documentation files totaling over 200KB:

| File | Size | Purpose |
|------|------|---------|
| CLAUDE.md | 18KB | AI assistant guide |
| CODEBASE_REVIEW.md | 32KB | Code review findings |
| README.md | 9KB | Project overview |
| QUICKSTART.md | 9KB | Getting started |
| CONTRIBUTING.md | 8KB | Contributor guidelines |
| ROADMAP.md | 12KB | Development roadmap |
| NEXT_STEPS.md | 8KB | Actionable improvements |
| FUTURE_PLAN.md | 10KB | Future development |
| docs/ARCHITECTURE.md | 25KB | System architecture |
| docs/SERVER_SPEC.md | 28KB | Technical specification |
| docs/TESTING_GUIDE.md | 16KB | Testing documentation |
| docs/DEPLOYMENT.md | 14KB | Deployment guide |
| docs/BOARD_GAME_UI_RESEARCH.md | 25KB | UI research |
| CHANGELOG.md | 9KB | Change log |
| SECURITY.md | 1KB | Security policy |
| server/README.md | 10KB | Server docs |
| + 5 ADRs | ~5KB | Architecture decisions |

**The problem**: `CODEBASE_REVIEW.md`, `NEXT_STEPS.md`, `FUTURE_PLAN.md`, and `ROADMAP.md` all overlap significantly — they're different attempts at capturing "what to do next." `docs/ARCHITECTURE.md` and `docs/SERVER_SPEC.md` overlap with `CLAUDE.md`. Much of this content goes stale quickly.

**Recommendation**: Consolidate to:
- `README.md` — project overview + quickstart (merge QUICKSTART.md into it)
- `CONTRIBUTING.md` — how to contribute
- `docs/ARCHITECTURE.md` — the one canonical architecture document
- `docs/DEPLOYMENT.md` — deployment guide
- `CLAUDE.md` — AI assistant context (keep as-is, it's useful)
- `docs/adr/` — architecture decisions (keep as-is)
- Delete or archive: `CODEBASE_REVIEW.md`, `NEXT_STEPS.md`, `FUTURE_PLAN.md`, `ROADMAP.md`, `QUICKSTART.md`, `docs/SERVER_SPEC.md`, `docs/BOARD_GAME_UI_RESEARCH.md`

---

## Issue 10: Validators Barrel File Uses require() in .ts

**Severity: Low (but exemplifies the inconsistency)**

`validators/schemas.ts` is a barrel re-export file that uses `require()` for values and `export type` for types — a Frankenstein of module systems:

```typescript
const { roomCreateSchema, ... } = require('./roomSchemas');
export type { RoomCreateInput, ... } from './roomSchemas';
export { roomCreateSchema, ... };
```

This file should be a simple `export * from './roomSchemas'` but can't be because the underlying files use `module.exports`.

---

## Structural Positives Worth Preserving

Not everything needs fixing. These patterns are working well:

1. **The contextHandler pattern** (`contextHandler.ts`) — `createRoomHandler`, `createHostHandler`, `createGameHandler` are a clean, composable way to declare handler requirements. This is good architecture.

2. **The GameError hierarchy** — well-typed, with static factory methods and client-safe sanitization. Clean and practical.

3. **The game service decomposition** — splitting board generation, clue validation, and reveal engine into sub-modules under `services/game/` was a good call.

4. **Zod validation at boundaries** — schemas are well-organized by domain (room, player, game, chat, timer).

5. **The connection/disconnect lifecycle** — timeout-protected disconnect handling with AbortController, connection counting per IP, rate limiting per socket. This is thoughtful and production-ready.

6. **Test infrastructure** — 83 suites, 2,571 tests, good coverage. The test helpers (`mocks.ts`, `socketTestHelper.ts`) enable clean test setup.

---

## Prioritized Action Plan

| Priority | Issue | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Eliminate triple-implementation (Issue 3) | Medium | High — reduces correctness risk |
| 2 | Migrate to proper ES module imports (Issue 1) | Medium | High — reduces every file's noise |
| 3 | Replace MemoryStorage (Issue 2) | Low-Medium | High — removes 1,915 lines of liability |
| 4 | Relocate misplaced config files (Issue 6) | Low | Medium — clearer project structure |
| 5 | Consolidate audit systems (Issue 7) | Low | Medium — single source of truth |
| 6 | Consolidate documentation (Issue 9) | Low | Low-Medium — less confusion |
| 7 | Rethink multiplayer module split (Issue 4) | Medium | Medium — clearer frontend architecture |
| 8 | Remove socketFunctionProvider (Issue 8) | Low | Low — less indirection |

---

*Generated 2026-02-12 from holistic review of the Eigennamen codebase.*
