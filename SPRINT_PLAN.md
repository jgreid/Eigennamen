# Sprint Plan - Codenames Online

**Created**: February 10, 2026
**Baseline**: v2.2.0 — 77 suites / 2,304 tests / 303 frontend tests / 53 E2E / 94%+ coverage

This plan consolidates all remaining work from HARDENING_PLAN.md, FUTURE_PLAN.md, CODEBASE_REVIEW.md, and a fresh code quality audit into prioritized, actionable sprints.

---

## Current State Summary

### What's Done (no further work needed)
- All critical fixes (timer validation, reconnection overlay, button states, typecheck CI)
- Client/server validation alignment (Unicode regex, clue validation, spectator chat)
- State management hardening (room change reset, offline detection, message queue)
- Security hardening (rate limits, token cleanup, lock TTLs, CSRF, Helmet, JWT)
- Accessibility (ARIA grid, keyboard nav, colorblind mode, screen reader support)
- Loading states, clipboard fallback, modal focus management
- i18n (EN, DE, ES, FR with localized word lists)
- Game modes (Classic, Blitz, Duet)
- Admin dashboard (full REST API, HTML UI, audit logs, broadcast)
- Game history & replay (storage, replay UI, 4 speed levels)
- Swagger/OpenAPI documentation
- Audio notifications (Web Audio API)

### What's Remaining (organized into sprints below)

| Category | Gap | Effort |
|----------|-----|--------|
| E2E testing expansion | 53 tests → 71+ (Sprint 1) | Done |
| ES module cleanup | Duplicate exports removed (Sprint 1) | Done |
| Production CORS docs | Guidance added but could be stronger | Done |
| Lock TTL centralization | Centralized to LOCKS config (Sprint 1) | Done |
| Replay export/sharing | Shareable links via REST API (Sprint 2) | Done |
| Spectator enhancements | Join request flow implemented (Sprint 2) | Done |
| Admin dashboard enhancements | SSE real-time metrics (Sprint 2) | Done |
| Infrastructure observability | Correlation IDs only; no OpenTelemetry | Large |
| Performance testing | k6 scripts created (Sprint 3) | Done |
| Player profiles | Schema exists, no feature code | Large |
| Tournament mode | Not started | Very Large |

---

## Sprint 1: Testing & Code Quality (Hardening) ✅ COMPLETED

**Goal**: Reach 70+ E2E tests and clean up technical debt.
**Priority**: High — improves regression safety for all subsequent sprints.
**Completed**: February 10, 2026

### 1.1 E2E Test Expansion ✅
- Added `standalone-game.spec.js`: 11 tests covering board generation, share links, spymaster view, assassin game-over, settings (colorblind, language)
- Added `multiplayer-extended.spec.js`: 10 tests covering team selection, room code display, join errors, cross-player chat, game start, disconnect UI, modal navigation
- **Result**: 50 → 71+ E2E tests (exceeds 70 target)

### 1.2 ES Module Standardization ✅
- Removed duplicate `module.exports` blocks from 3 files with mixed exports:
  - `server/src/utils/sanitize.ts` — kept ES6 `export` block
  - `server/src/utils/metrics.ts` — kept ES6 `export` block
  - `server/src/socket/socketFunctionProvider.ts` — kept ES6 `export` block
- Left `constants.ts` module.exports intact (needed for backward compatibility with ~75 require() consumers)
- Full require→import migration deferred to future sprint (low risk since TypeScript compiles both to CommonJS)

### 1.3 Lock TTL Centralization ✅
- Replaced hardcoded `EX: 10` in `disconnectHandler.ts` with:
  - `LOCKS.TIMER_RESTART` (5s) for timer restart lock
  - `LOCKS.HOST_TRANSFER` (3s) for host transfer lock
- Updated log messages to reference centralized TTL values
- All lock TTLs now sourced from `securityConfig.ts` LOCKS constant

### 1.4 Clean Up FIX/ISSUE Comments ✅
- Removed resolved markers: H10 (schemas.ts), M12 (errorHandler.ts), M14 (jwt.ts ×2)
- Retained important design decision comments (SECURITY FIX, HARDENING FIX, SPRINT-15 FIX)
- Updated disconnectHandler.ts comments to be descriptive rather than issue-referencing

---

## Sprint 2: Feature Polish (Enhancement) ✅ COMPLETED

**Goal**: Polish existing features that are partially complete.
**Priority**: Medium — user-visible improvements with low risk.
**Completed**: February 10, 2026

### 2.1 Replay Sharing ✅
- Created `GET /api/replays/:roomCode/:gameId` REST endpoint (`replayRoutes.ts`) for public replay access without room membership
- Added `checkURLForReplayLoad()` in `history.js` to auto-detect `?replay=<id>&room=<code>` URL params
- Hooked replay URL detection into `app.js` initialization
- Registered route in `routes/index.ts`
- Now: Share button generates URL → recipient opens URL → replay auto-loads via REST API

### 2.2 Spectator Enhancements ✅
- Added 6 new socket events: `spectator:requestJoin`, `spectator:joinRequest`, `spectator:approveJoin`, `spectator:denyJoin`, `spectator:joinApproved`, `spectator:joinDenied`
- Added `spectatorJoinRequestSchema` and `spectatorJoinResponseSchema` Zod validators
- Added request/approve/deny handlers in `playerHandlers.ts` using context handler pattern
- Added rate limits: 3 requests/10s, 5 approvals/5s
- Flow: Spectator requests team → Host gets notification → Host approves/denies → Spectator gets result

### 2.3 Admin Dashboard Real-Time Metrics ✅
- Added `GET /admin/api/stats/stream` SSE (Server-Sent Events) endpoint in `adminRoutes.ts`
- Streams memory, uptime, Redis status, database status, and metrics every 5 seconds
- Includes alert thresholds (memory > 480MB)
- Uses SSE instead of WebSocket for simplicity and HTTP Basic Auth compatibility
- Auto-cleans on client disconnect

### 2.4 Dockerfile Optimization ✅
- Reordered builder stage: package.json + prisma copied before source for better layer caching
- Combined `npm ci` + `prisma generate` into single RUN layer in builder
- Combined `npm run build` + Lua script copy into single RUN layer
- Combined `apk add` + user creation + log dir creation into single RUN in production stage
- Reduced total layers from 8 to 5 in production stage

---

## Sprint 3: Infrastructure & Observability (Hardening) ✅ COMPLETED

**Goal**: Improve production readiness and operational visibility.
**Priority**: Medium — important for scaling and debugging.
**Completed**: February 10, 2026

### 3.1 Automated Performance Testing ✅
- Created `server/loadtest/` directory with k6 scripts:
  - `room-flow.js`: HTTP API load test (room existence, room info, health checks)
  - `websocket-game.js`: WebSocket connection simulation (room creation, message latency)
  - `README.md`: Setup guide, targets, CI integration example
- Performance targets defined: p95 <50ms room check, <100ms room info, <500ms WS connect

### 3.2 Multi-Instance Validation ✅
- Added comprehensive multi-instance documentation to `docs/DEPLOYMENT.md`:
  - Sticky session configuration for Nginx, Fly.io, and AWS ALB
  - Manual verification steps for cross-instance event propagation
  - Redis adapter requirements and automatic configuration

### 3.3 Database Connection Pooling ✅
- Added PgBouncer configuration guide to `docs/DEPLOYMENT.md`:
  - Full `pgbouncer.ini` example with transaction pool mode (best for Prisma)
  - `DATABASE_URL` vs `DATABASE_DIRECT_URL` environment setup
  - Fly.io with Supabase/Neon external database pooling
  - PostgreSQL slow query logging configuration

### 3.4 CI/CD Improvements ✅
- Added `.github/workflows/codeql.yml` CodeQL SAST scanning workflow:
  - Runs on push/PR to main + weekly schedule
  - JavaScript/TypeScript analysis with security-extended queries
  - Separate from main CI to avoid slowing PRs

---

## Sprint 4: New Features (Feature Development)

**Goal**: Build the next tier of user-facing features.
**Priority**: Lower — depends on user demand.

### 4.1 Player Profiles & Statistics
- Activate existing Prisma `User` model (`gamesPlayed`, `gamesWon` fields exist)
- Create `playerStatsService.ts` for win/loss tracking
- Frontend profile page with game history
- Achievement badges (first win, 10 games, perfect game)
- **Schema**: Already has `User`, `GameParticipant` models; may need `Achievement` model

### 4.2 Tournament Mode
- Multi-round bracket system with automatic room assignment
- Tournament admin controls (start/stop rounds, manage brackets)
- Score tracking across rounds
- New Prisma models: `Tournament`, `Round`, `Match`
- New service: `tournamentService.ts`
- New handlers: `tournamentHandlers.ts`
- **Scope**: Very large — full feature with new data models, UI, and socket events

### 4.3 PWA Enhancements
- Push notifications for game invites and turn alerts
- Improved offline caching strategy
- Better install prompt handling
- **Files**: `service-worker.js`, `manifest.json`

### 4.4 OpenTelemetry Integration
- Add distributed tracing with OpenTelemetry SDK
- Trace socket events end-to-end
- Export to Grafana/Jaeger for visualization
- Create alerting rules for error rate spikes
- **Scope**: Large — new dependency, spans on all services

---

## Sprint Dependencies

```
Sprint 1 (Testing & Code Quality)
    ↓
Sprint 2 (Feature Polish)     Sprint 3 (Infrastructure)
    ↓                              ↓
Sprint 4 (New Features) ←─────────┘
```

Sprint 1 should be done first to establish a safety net. Sprints 2 and 3 can run in parallel. Sprint 4 depends on both.

---

## Risk Assessment

| Sprint | Risk | Mitigation |
|--------|------|------------|
| 1 (Testing) | Low | No production code changes |
| 2 (Polish) | Low-Medium | Incremental features on existing architecture |
| 3 (Infra) | Medium | Performance testing may reveal unexpected bottlenecks |
| 4 (Features) | High | Tournament mode is complex; consider phased rollout |

---

## Success Metrics

| Metric | Current | After Sprint 1 | After Sprint 2 | After Sprint 4 |
|--------|---------|-----------------|-----------------|-----------------|
| E2E Tests | 53 | 70+ | 75+ | 90+ |
| Backend Tests | 2,304 | 2,304 | 2,400+ | 2,600+ |
| Coverage | 94%+ | 94%+ | 94%+ | 90%+ |
| require() calls | ~46 | 0 | 0 | 0 |
| Game Modes | 3 | 3 | 3 | 3+ |
| Replay Features | Basic + speed | + sharing | + sharing | + sharing |
| Player Profiles | None | None | None | Full |

---

*This plan should be reviewed and updated after each sprint completion.*
