# Architectural Review — Eigennamen Online

**Date**: 2026-02-16
**Scope**: Full codebase (backend, frontend, infrastructure, testing)
**Codebase size**: ~90 backend source files, ~30 frontend modules, ~90 test files (2,472+ tests)

---

## Executive Summary

Eigennamen Online is a well-architected, production-grade real-time multiplayer game. The codebase demonstrates strong engineering discipline: clean service boundaries, comprehensive type safety, defense-in-depth security, and excellent test coverage (94%+ lines). The architecture successfully supports three operational modes (standalone, single-instance, multi-instance) with graceful degradation.

This review identifies **no critical architectural flaws**. The proposals below are structural improvements that would reduce complexity, improve maintainability, and position the codebase for continued growth. They are ordered by impact-to-effort ratio.

---

## Table of Contents

1. [Overall Architecture Assessment](#1-overall-architecture-assessment)
2. [Backend: What Works Well](#2-backend-what-works-well)
3. [Backend: Proposed Structural Changes](#3-backend-proposed-structural-changes)
4. [Frontend: What Works Well](#4-frontend-what-works-well)
5. [Frontend: Proposed Structural Changes](#5-frontend-proposed-structural-changes)
6. [Cross-Cutting Concerns](#6-cross-cutting-concerns)
7. [Configuration & Types](#7-configuration--types)
8. [Testing & Quality](#8-testing--quality)
9. [Infrastructure & Deployment](#9-infrastructure--deployment)
10. [Summary: Prioritized Recommendations](#10-summary-prioritized-recommendations)

---

## 1. Overall Architecture Assessment

### Strengths

| Aspect | Rating | Evidence |
|--------|--------|---------|
| Service isolation | Excellent | Services have clear single responsibilities; no circular dependencies at module load time |
| State management (backend) | Excellent | Redis as single source of truth; Lua scripts for atomicity; TTLs prevent orphaned data |
| Security posture | Excellent | Multi-layered: Zod validation → rate limiting → auth middleware → Lua script enforcement |
| Error handling | Excellent | Typed error hierarchy with safe client serialization; `safeEmit` wrapper prevents broadcast failures |
| Graceful degradation | Excellent | Works without PostgreSQL, without external Redis, and fully offline in standalone mode |
| Test coverage | Excellent | 94%+ lines; integration tests cover race conditions, chaos scenarios, full game flows |
| Type safety | Excellent | Strict TypeScript; typed Socket.io events; Zod at all boundaries |
| Build tooling | Excellent | esbuild for production; code splitting; source maps; separate IIFE socket client |

### Areas for Improvement

| Aspect | Current State | Opportunity |
|--------|--------------|-------------|
| Frontend state management | Mutable singleton with direct mutation | Introduce controlled mutation layer |
| Frontend event handling | 600+ line monolithic listener file | Split into domain-specific handler modules |
| Backend `playerService` size | 1,024 lines in one file | Extract sub-modules (mirrors `gameService` pattern) |
| Shared constants | Duplicated between frontend and backend | Single source of truth with build-time sharing |
| Socket handler timeout enforcement | Manual `withTimeout()` per service call | Automatic at handler entry point |

---

## 2. Backend: What Works Well

### 2.1 Service Layer Decomposition

The service layer is the backbone of the architecture and is well-designed:

```
roomService (598 LOC) ─── orchestrates ──→ gameService (427 LOC)
                                         → playerService (1,024 LOC)
                                         → timerService (520 LOC)
```

- **`gameService`** properly delegates to focused sub-modules:
  - `game/boardGenerator.ts` — pure functions (PRNG, shuffling, board layout)
  - `game/revealEngine.ts` — pure functions (reveal logic, outcome determination)
  - `game/luaGameOps.ts` — Redis atomicity concerns
- **`timerService`** is completely self-contained with zero dependencies on other services
- **`roomService`** orchestrates without embedding other services' logic
- The single circular dependency (`playerService` → `roomService` for orphan cleanup) is resolved via lazy `require()` inside a non-critical function — safe and deliberate

### 2.2 Context Handler Pattern

The `contextHandler.ts` eliminates boilerplate across all socket handlers:

```
Socket Event → contextHandler → handler function → service call
                    ↓
              validates input (Zod)
              rate limits request
              resolves player context
              syncs socket rooms on mutation
```

Four factory functions (`createPreRoomHandler`, `createRoomHandler`, `createHostHandler`, `createGameHandler`) enforce appropriate preconditions. This is a clean, DRY pattern.

### 2.3 Atomicity & Concurrency

The distributed locking system and Lua scripts are production-grade:

- **13 Lua scripts** for atomic operations (card reveal, end turn, team switch, host transfer)
- **Distributed locks** with exponential backoff, jitter, ownership tracking, auto-extension
- **WATCH/MULTI fallback** when Lua scripting is unavailable
- **Race condition tests** in integration suite validate these under concurrent load

### 2.4 Socket Function Provider

The dependency injection pattern in `socketFunctionProvider.ts` elegantly solves the circular dependency between `socket/index.ts` and handlers:

- Functions registered at init time, retrieved at runtime via `getSocketFunctions()`
- Mockable for testing
- Runtime validation ensures functions are registered before any handler runs

---

## 3. Backend: Proposed Structural Changes

### 3.1 Extract `playerService` Sub-Modules

**Problem**: At 1,024 lines, `playerService.ts` is the largest service — nearly 2.5x the next largest. It handles player CRUD, team/role operations, socket mapping, disconnect scheduling, and cleanup. This contrasts with `gameService`, which properly delegates to three sub-modules.

**Proposal**: Mirror the `game/` sub-module pattern:

```
services/
├── playerService.ts          # Thin orchestrator (≈200 LOC)
├── player/
│   ├── reconnection.ts       # Already extracted ✓
│   ├── stats.ts              # Already extracted ✓
│   ├── teamOperations.ts     # NEW: setTeam, setRole, Lua scripts (≈200 LOC)
│   ├── cleanup.ts            # NEW: disconnect scheduling, orphan cleanup (≈250 LOC)
│   └── socketMapping.ts      # NEW: socket↔player mapping (≈100 LOC)
```

**Impact**: Easier navigation, focused test files, clearer ownership boundaries. No logic changes needed — purely structural extraction.

**Effort**: Low. Extract functions, re-export from `playerService.ts` for backward compatibility.

### 3.2 Enforce Handler-Level Timeout Wrapping

**Problem**: Timeout protection via `withTimeout()` is applied manually per service call inside handlers. If a developer forgets to wrap a call, it can hang indefinitely.

**Proposal**: Add automatic timeout enforcement at the `contextHandler` level:

```typescript
// In contextHandler.ts
function createGameHandler<T>(schema, handler, options?) {
    return rateLimitWrapper(eventName, async (socket, data, ack) => {
        const result = await withTimeout(
            handler(ctx, validated),
            options?.timeout ?? TIMEOUTS.SOCKET_HANDLER,
            `handler:${eventName}`
        );
        // ...
    });
}
```

**Impact**: Guarantees every handler has a timeout. Individual services can still apply tighter timeouts for specific operations.

**Effort**: Low. Single change in `contextHandler.ts`.

### 3.3 Consolidate Permission Check Location

**Problem**: Card reveal permission checks are split between the handler (defensive, lines ~175-200 in `gameHandlers.ts`) and Lua scripts (authoritative). While this is defense-in-depth, it means permission logic is maintained in two places.

**Proposal**: Extract permission checks into a shared validation function in `revealEngine.ts`:

```typescript
// In game/revealEngine.ts
export function validateRevealPermission(player, game): ValidationResult {
    // Single source of truth for: team match, role check, turn check
}
```

Both the handler (for fast rejection) and the Lua script (for atomicity) reference the same rules. The handler calls it before the service call; the Lua script encodes the same logic for atomic enforcement.

**Impact**: Single place to update permission rules. Reduces risk of handler/Lua divergence.

**Effort**: Low-Medium.

### 3.4 Replace Dynamic `require()` with Dependency Injection

**Problem**: `playerService.ts:778` uses `require('./roomService')` to break a circular dependency. While safe (lazy, inside a function), it's a CommonJS pattern that TypeScript can't fully type-check and that breaks under ESM.

**Proposal**: Pass `cleanupRoom` as a callback during initialization:

```typescript
// In playerService.ts
let roomCleanupFn: ((code: string) => Promise<void>) | null = null;

export function registerRoomCleanup(fn: (code: string) => Promise<void>): void {
    roomCleanupFn = fn;
}

// In index.ts or socket/index.ts (after both services are loaded)
playerService.registerRoomCleanup(roomService.cleanupRoom);
```

**Impact**: Type-safe, ESM-compatible, explicit dependency declaration.

**Effort**: Low.

---

## 4. Frontend: What Works Well

### 4.1 Module Organization

The 30-module frontend is well-organized by feature domain:

- **Core**: `app.ts`, `state.ts`, `game.ts`, `board.ts`
- **Multiplayer**: Split into 4 focused modules (connection, listeners, sync, UI) + socket client
- **Features**: Each concern in its own module (timer, chat, history, i18n, accessibility, notifications)
- **Infrastructure**: Shared utilities, constants, logging, debug tools

This is a good structure for a vanilla TypeScript application.

### 4.2 State Type Safety

The `AppState` interface (173 lines) provides comprehensive typing. The `RoleChangeState` discriminated union is particularly well-designed — it makes impossible states unrepresentable:

```typescript
type RoleChangeState =
    | { phase: 'idle' }
    | { phase: 'changing_team'; target: string; operationId: string; revertFn: () => void }
    | { phase: 'team_then_role'; /* ... */ pendingRole: 'spymaster' | 'clicker' }
    | { phase: 'changing_role'; /* ... */ };
```

### 4.3 Socket Client Wrapper

The `socket-client.ts` (873 LOC) provides a robust abstraction over Socket.io:
- Auto-reconnection with exponential backoff
- Offline queue (max 20 events) for events sent during disconnection
- Listener registration system with cleanup tracking
- Session persistence via sessionStorage
- Request ID correlation for matching responses

### 4.4 Build Pipeline

The esbuild configuration is modern and well-optimized:
- ESM output with code splitting for lazy loading
- Separate IIFE bundle for socket client (can establish connection before app loads)
- Tree shaking, minification, source maps

---

## 5. Frontend: Proposed Structural Changes

### 5.1 Split `multiplayerListeners.ts` into Domain Handlers

**Problem**: `multiplayerListeners.ts` (616 LOC) registers 20+ socket event handlers in a single `setupMultiplayerListeners()` function. Each handler mixes state updates, UI rendering, sound effects, and cross-module calls. This is the closest thing to a "god module" in the frontend.

**Proposal**: Split into domain-specific handler modules:

```
frontend/
├── multiplayer.ts              # Connection management (existing)
├── multiplayerSync.ts          # State sync (existing)
├── multiplayerUI.ts            # UI updates (existing)
├── multiplayerListeners.ts     # Slim orchestrator: imports + registers all handlers
└── handlers/
    ├── gameEventHandlers.ts    # gameStarted, cardRevealed, turnEnded, gameOver
    ├── playerEventHandlers.ts  # playerJoined, playerLeft, playerDisconnected, playerReconnected
    ├── roomEventHandlers.ts    # roomSettings, hostChanged, kicked, warning, error
    ├── timerEventHandlers.ts   # timerStarted, timerTick, timerStopped, timerExpired
    └── chatEventHandlers.ts    # chatMessage, spectatorMessage
```

`multiplayerListeners.ts` becomes a thin registration layer:

```typescript
import { registerGameHandlers } from './handlers/gameEventHandlers.js';
import { registerPlayerHandlers } from './handlers/playerEventHandlers.js';
// ...

export function setupMultiplayerListeners(): void {
    registerGameHandlers();
    registerPlayerHandlers();
    registerRoomHandlers();
    registerTimerHandlers();
    registerChatHandlers();
}
```

**Impact**: Each handler file is 80-150 LOC, focused on one domain. Easier to find, modify, and test handlers. Mirrors the backend's handler structure.

**Effort**: Medium. Mechanical refactoring — extract functions, update imports.

### 5.2 Introduce Controlled State Mutations

**Problem**: Most modules mutate `state` directly (`state.property = value`) rather than going through `stateMutations.ts`. Only team/role/game-mode changes use the validated mutation layer. This makes it hard to track what changed state and when, and impossible to add cross-cutting concerns (logging, undo, syncing).

**Proposal**: Expand `stateMutations.ts` into a lightweight mutation layer with categories:

```typescript
// stateMutations.ts
export function updateGameState(patch: Partial<GameState>): void {
    Object.assign(state.gameState, patch);
    if (__DEV__) logStateChange('gameState', patch);
}

export function updateMultiplayerState(patch: Partial<MultiplayerState>): void {
    Object.assign(state, pick(patch, MULTIPLAYER_KEYS));
    if (__DEV__) logStateChange('multiplayer', patch);
}

export function setPlayerRole(team: string | null, role: string | null): void {
    state.playerTeam = team;
    state.spymasterTeam = role === 'spymaster' ? team : null;
    state.clickerTeam = role === 'clicker' ? team : null;
}
```

**This is NOT a full state management framework** — it's a thin discipline layer that:
1. Groups related mutations (no partial updates that leave state inconsistent)
2. Provides a grep-able surface for "what mutates X?"
3. Optionally enables debug logging in development
4. Creates a natural place to add validation if needed later

**Impact**: Easier debugging, safer state transitions, better code navigation.

**Effort**: Medium-High. Requires touching many modules to replace direct mutations. Can be done incrementally per domain.

### 5.3 Share Constants Between Frontend and Backend

**Problem**: Validation rules, game constants, and configuration values are duplicated:

| Constant | Backend Location | Frontend Location |
|----------|-----------------|-------------------|
| `NICKNAME_REGEX` | `validators/playerSchemas.ts` | `frontend/constants.ts` |
| `ROOM_CODE_PATTERN` | `validators/roomSchemas.ts` | `frontend/constants.ts` |
| `NICKNAME_MAX_LENGTH` | `validators/playerSchemas.ts` | `frontend/constants.ts` |
| `BOARD_SIZE` | `config/gameConfig.ts` | `frontend/constants.ts` |
| `TIMER_MIN/MAX` | `config/roomConfig.ts` | `frontend/constants.ts` |
| Team/role values | `config/gameConfig.ts` | `frontend/constants.ts` |

If the backend changes a validation rule (e.g., max nickname length) but the frontend isn't updated, users get confusing server-side rejections for input the client allowed.

**Proposal**: Create a shared constants module consumed by both:

```
server/src/
├── shared/
│   ├── validation.ts    # Regex patterns, length limits
│   ├── gameRules.ts     # Board size, team/role values, game modes
│   └── index.ts         # Barrel export
├── config/              # Backend-only config (Redis TTLs, rate limits)
└── frontend/            # Imports from ../shared/
```

The esbuild config already resolves TypeScript imports — no additional build step needed. The shared module contains only pure constants (no Node.js or browser dependencies).

**Impact**: Eliminates an entire class of frontend/backend divergence bugs.

**Effort**: Medium. Create shared module, update imports in both frontend and backend constants files.

### 5.4 Separate UI State from Game State in `AppState`

**Problem**: The `AppState` interface (173 lines, 40+ properties) mixes fundamentally different concerns:

- **Game logic**: `gameState`, `gameMode`, `activeWords` — core game data
- **Multiplayer**: `isMultiplayerMode`, `currentRoomId`, `multiplayerPlayers` — network state
- **UI implementation**: `revealingCards`, `revealTimeouts`, `copyButtonTimeoutId` — render details
- **DOM cache**: `cachedElements` — element references
- **Preferences**: `notificationPrefs`, `colorBlindMode`, `language` — user settings

**Proposal**: Partition into typed sub-objects:

```typescript
interface AppState {
    game: GameState;           // Core game data
    multiplayer: MultiplayerState; // Network/room state
    ui: UIState;               // Render-specific state (animations, modals)
    prefs: PreferencesState;   // User preferences
    dom: CachedElements;       // DOM references
}
```

This doesn't require a framework — just grouping existing properties. Benefits:
1. Clearer mental model ("is this game state or UI state?")
2. Easier to reset subsets (e.g., `state.game = initialGameState()` on new game)
3. Better aligns with `stateMutations.ts` categories (5.2)

**Impact**: Clearer state organization, easier partial resets, reduced cognitive load.

**Effort**: Medium-High. Requires updating all `state.property` references to `state.game.property` etc. Can be done incrementally.

---

## 6. Cross-Cutting Concerns

### 6.1 Error Handling — Strong, Minor Inconsistencies

**What works well**:
- `GameError` hierarchy with typed error codes, timestamps, and safe client serialization
- `SAFE_ERROR_CODES` pattern ensures only known-safe messages reach clients
- `safeEmit` wrapper prevents broadcast failures from crashing handlers
- Rate limit handler wraps every socket handler with consistent error emission

**Minor issue**: Not all socket handlers emit errors in exactly the same structure. Some include `requestId` for correlation, others don't.

**Suggestion**: Standardize error emission in `rateLimitHandler.ts` to always include `requestId` when available, so clients can reliably correlate errors with requests.

### 6.2 Security — Enterprise-Grade

The security implementation is thorough and well-layered:

- **CSRF**: Custom header + origin validation (pragmatic for WebSocket-heavy app)
- **Session security**: Rate-limited validation, IP consistency checks, hijacking detection, 8-hour max age
- **Rate limiting**: Dual-layer (per-socket + per-IP at 3x multiplier), LRU eviction, metrics
- **Input validation**: Zod schemas at all entry points + secondary sanitization
- **Audit logging**: Severity-based, Redis-backed with 7-day retention, in-memory fallback

**No security gaps identified.** The defense-in-depth approach (handler validates → service validates → Lua script enforces) provides robust protection.

### 6.3 Observability

**Strengths**:
- Winston logging with correlation IDs
- Request/event timing with slow-operation warnings
- Memory monitoring with configurable thresholds
- Prometheus-compatible metrics endpoint
- SSE real-time metrics stream for admin dashboard
- Audit trail for security events

**Suggestion**: Consider adding structured tracing (e.g., OpenTelemetry) for multi-instance deployments where a single request may span Redis pub/sub across instances. This is low priority for current scale.

---

## 7. Configuration & Types

### 7.1 Configuration — Excellent Organization

The barrel re-export pattern through `config/constants.ts` provides a single import point for all configuration:

```typescript
import { BOARD_SIZE, RATE_LIMITS, ERROR_CODES } from '@config';
```

Domain-specific config files (`gameConfig`, `roomConfig`, `socketConfig`, `rateLimits`, `errorCodes`, `securityConfig`) keep concerns separated. Environment validation in `env.ts` includes production-specific checks (JWT secret length, Fly.io multi-instance detection with memory mode).

**No changes proposed** — this is well-designed.

### 7.2 Type System — Comprehensive

- Barrel re-exports via `types/index.ts` with 7 domain files
- Socket.io events fully typed (`ClientToServerEvents`/`ServerToClientEvents`)
- Discriminated unions for game history entries and role change state machine
- Clear separation: `Player` (internal) vs `PlayerInfo` (public view)
- `GameState` vs `PlayerGameState` (hides unrevealed card types from non-spymasters)

**No changes proposed** — the type system is thorough without being over-engineered.

### 7.3 Zod Schema / Type Relationship

Types (`src/types/`) define storage structures. Zod schemas (`src/validators/`) define input validation with `z.infer<>` for derived types. No duplication between the two — they serve different purposes.

---

## 8. Testing & Quality

### 8.1 Test Architecture — Mature

| Category | Suites | Approach |
|----------|--------|----------|
| Service unit tests | 16 | Mock Redis, test business logic |
| Handler tests | 16 | Mock context + services, test delegation |
| Middleware tests | 8 | Mock Express req/res, test chains |
| Route tests | 9 | Supertest against Express app |
| Security tests | 8 | JWT, session, input validation, ReDoS |
| Integration tests | 5 | Full game flow, race conditions, chaos |
| Frontend tests | 5 | jsdom, board rendering, state management |
| E2E tests | 9 | Playwright, multi-browser |

**Coverage**: 94%+ lines (threshold: 75%). Infrastructure modules (redis.ts, socket/index.ts) have lower coverage by design — they require real integration tests.

### 8.2 Test Utilities — Well-Designed

- `createMockRedis()` with internal storage for assertions
- Factory functions: `createMockPlayer()`, `createMockRoom()`, `createMockGame()`
- `SocketTestServer` class with `waitForEvent()`, `emitAndWait()`, service injection
- `expectAsyncError()`, `flushPromises()`, `sleep()` helpers

### 8.3 Suggestions

**Add contract tests for shared constants**: If proposal 5.3 (shared constants) is implemented, add tests that verify frontend validation rules match backend schemas. This catches divergence at CI time rather than in production.

**Consider adding snapshot tests for Socket.io event payloads**: As the event surface grows, snapshot tests would catch accidental payload shape changes that break client compatibility.

---

## 9. Infrastructure & Deployment

### 9.1 Docker & Docker Compose — Clean

- Multi-stage Dockerfile (builder → runtime) with non-root user
- Health checks on all services
- Resource limits appropriate for game workload
- Docker Compose provides PostgreSQL + Redis for local development

### 9.2 Fly.io Configuration — Production-Ready

- WebSocket-only transport (correct for Fly.io's proxy)
- Health check at `/health/ready` with 30s grace period
- Memory mode detection with clear warnings
- Auto-scaling with concurrency limits

### 9.3 CI/CD — Comprehensive

- GitHub Actions: test, lint, type-check, security scan
- CodeQL for automated vulnerability detection
- Dependabot for dependency updates

### 9.4 Suggestion

**Add a `docker-compose.test.yml`** for running the full test suite (including integration and E2E) against real Redis and PostgreSQL, matching production topology. This catches issues that in-memory mocks miss (e.g., Lua script behavior differences, Redis version-specific features).

---

## 10. Summary: Prioritized Recommendations

### High Impact, Low Effort

| # | Proposal | Section | Impact | Effort |
|---|----------|---------|--------|--------|
| 1 | Enforce handler-level timeout wrapping | 3.2 | Prevents hung handlers | Low |
| 2 | Replace dynamic `require()` with DI callback | 3.4 | ESM compatibility, type safety | Low |
| 3 | Standardize socket error emission format | 6.1 | Consistent client error handling | Low |

### High Impact, Medium Effort

| # | Proposal | Section | Impact | Effort |
|---|----------|---------|--------|--------|
| 4 | Extract `playerService` sub-modules | 3.1 | Mirrors game service pattern, easier navigation | Medium |
| 5 | Split `multiplayerListeners.ts` into domain handlers | 5.1 | Eliminates 600-LOC monolith, mirrors backend | Medium |
| 6 | Share constants between frontend and backend | 5.3 | Eliminates divergence bugs | Medium |

### Medium Impact, Medium-High Effort

| # | Proposal | Section | Impact | Effort |
|---|----------|---------|--------|--------|
| 7 | Introduce controlled state mutations | 5.2 | Safer state transitions, better debugging | Medium-High |
| 8 | Partition `AppState` into sub-objects | 5.4 | Clearer state organization | Medium-High |
| 9 | Consolidate permission check location | 3.3 | Single source of truth for game rules | Medium |

### Lower Priority

| # | Proposal | Section | Impact | Effort |
|---|----------|---------|--------|--------|
| 10 | Add `docker-compose.test.yml` | 9.4 | Catches integration-level issues | Low |
| 11 | Add contract tests for shared constants | 8.3 | CI-time divergence detection | Low |
| 12 | Consider OpenTelemetry tracing | 6.3 | Multi-instance observability | Medium |

---

## Conclusion

This codebase is significantly above average in architectural quality. The service layer is clean, security is comprehensive, and test coverage is excellent. The proposed changes are refinements — they reduce complexity and close small gaps rather than fix fundamental problems.

The highest-leverage changes are:
1. **Automatic handler timeouts** (3.2) — trivial to implement, prevents an entire class of production issues
2. **Shared frontend/backend constants** (5.3) — eliminates systematic divergence risk
3. **`multiplayerListeners.ts` split** (5.1) — the single most impactful frontend improvement

None of these proposals require introducing new dependencies or frameworks. They work with the existing patterns and extend them consistently.
