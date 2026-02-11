# Roadmap — Die Eigennamen (Codenames Online)

**Last Updated:** February 11, 2026 (Tier C Implementation)
**Project Version:** v2.3.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Tests | 2,308 passing (77 suites) |
| Frontend Tests | 303 passing (4 suites) |
| E2E Tests | 64+ passing (8 spec files) |
| Total Tests | ~2,675 |
| Backend Coverage | 94%+ lines/statements |
| TypeScript | Clean (0 errors) |
| ESLint | Clean (0 errors, 0 warnings) |
| npm audit | 0 vulnerabilities |
| Critical/High Issues | 0 open (all 10 fixed) |
| Medium Issues (Tier C) | 0 open (all 15 completed) |
| Code Quality | Production-ready |

### Completed Features

- Real-time multiplayer via Socket.io with Redis Pub/Sub adapter
- Standalone URL-based mode (no server required)
- Custom word lists with database persistence
- Turn timer with pause/resume/add-time (Redis-backed)
- Team chat with filtering (backend complete)
- Spectator mode with join requests and role selection
- QR code room sharing
- Reconnection with token-based authentication and full state recovery
- Comprehensive security hardening (JWT, rate limiting, CSRF, XSS prevention, Helmet, audit logging)
- Performance monitoring (request timing, memory alerts, metrics collection, Prometheus endpoint)
- Modular ES6 frontend (15 modules in `server/public/js/modules/`)
- Internationalization (English, German, Spanish, French with localized word lists)
- Accessibility (colorblind SVG patterns, keyboard navigation, screen reader support, ARIA, focus traps)
- Game modes: Classic, Blitz (30s turns), Duet (cooperative 2-player)
- Game history and replay system with speed control (0.5x, 1x, 2x, 4x)
- Admin dashboard with room management, audit logs, metrics, SSE streaming, broadcast messaging
- Swagger/OpenAPI interactive documentation
- Audio notifications (Web Audio API)
- Distributed locks for concurrent operations
- 6 Redis Lua scripts for atomic game operations
- Multi-stage Docker build with non-root user and resource limits
- CI/CD pipeline: 6 quality gates (test, typecheck, lint, security, Docker, E2E)
- CodeQL weekly security scanning

---

## Previously Completed Improvements

### Phases 1-3 + Tier A (Feb 2026) — All Done

- **Phase 1**: Backend service fixes (NFKC normalization, atomic Lua scripts, room rollback, timer validation)
- **Phase 2**: Frontend improvements (modal stack, AbortController, shared constants, ARIA, colorblind SVG)
- **Phase 3**: Testing improvements (test helpers, middleware tests, error scenarios, DB integration, multiplayer E2E)
- **Tier A**: Zod `.passthrough()` removal, timeout wrappers, IP validation docs, multiplayer E2E tests, deprecated file cleanup

### Deep Review Critical + High Fixes (Feb 11, 2026) — All Done

| ID | Task | Category |
|----|------|----------|
| CRIT-1 | Fix spectator handler signatures | Bug |
| CRIT-2 | Add max word count validation (server + client) | Security |
| HIGH-1 | Invalidate token on player kick | Security |
| HIGH-2 | Verify history cleanup index direction | Data |
| HIGH-3 | Wire localized words into game | Bug |
| HIGH-4 | Fix className escapeHTML misuse | Bug |
| HIGH-5 | Fix replay event listener leak | Memory |
| HIGH-6 | Handle refreshRoomTTL failures | Resilience |
| HIGH-7 | Fix accessibility listener leak | Memory |
| HIGH-8 | Cap connectionsPerIP map size | Security |

### Tier C: Medium Priority Improvements (Feb 11, 2026) — All Done

| ID | Task | Category | Notes |
|----|------|----------|-------|
| C-1 | Use safeEmit in chat handlers | Consistency | Replaced raw `io.to().emit()` with `safeEmitToRoom`/`safeEmitToPlayer` |
| C-2 | Add timeout to game:clue handler | Resilience | Wrapped `giveClue` with `withTimeout(TIMEOUTS.GAME_ACTION)` |
| C-3 | Fix session age validation | Security | Removed `connectedAt` fallback — always uses `createdAt` |
| C-4 | Enforce JWT secret length in production | Security | Short JWT secret now throws error (not just warning) |
| C-5 | Add word uniqueness validation | Validation | Zod `.refine()` checks case-insensitive uniqueness |
| C-6 | Replay board keyboard navigation | Accessibility | ARIA roles, tabindex, arrow-key grid navigation |
| C-7 | Batch role reset for new games | Performance | `Promise.all()` instead of sequential updates |
| C-8 | Unify nickname validation regex | Consistency | Shared Unicode-aware regex in `constants.js` |
| C-9 | Fix fitCardText layout thrashing | Performance | Batch-read then batch-write DOM pattern |
| C-10 | Guard replay interval creation | Bug | `clearInterval` before creating new interval |
| C-11 | Expire memory-mode audit logs | Memory | Already implemented via ring buffer (MAX_LOGS_PER_CATEGORY=10000) |
| C-12 | Make timeouts configurable via env vars | Operations | `TIMEOUT_*` env var overrides for all timeout values |
| C-13 | Add Docker Compose resource limits | Infrastructure | Memory/CPU caps: api 512M/1cpu, db 256M/0.5cpu, redis 128M/0.5cpu |
| C-14 | Validate settings values | Validation | Already handled by Zod `roomSettingsSchema` |
| C-15 | Token rotation on use | Security | Already implemented in `roomHandlers.ts` via `ROTATE_SESSION_ON_RECONNECT` |

### ESLint Cleanup (Feb 11, 2026) — All Done

- Fixed 8 ESLint errors (unused variables in test files)
- Fixed 117 ESLint warnings (non-null assertions, consistent-type-imports, indentation)
- Added test file override to allow non-null assertions in tests
- Converted `import()` type annotations to proper `import type` statements
- Replaced all source-file non-null assertions with proper null checks

---

## Remaining Work

### Tier D: Lower Priority / Future (14 items)

| ID | Task | Category | Effort |
|----|------|----------|--------|
| D-1 | Implement chat UI frontend | Frontend | Medium |
| D-2 | Complete i18n markup (audit hardcoded English strings) | Frontend | Medium |
| D-3 | Gate frontend debug logging behind config flag | Performance | Low |
| D-4 | Split multiplayer.js (1,922 lines) into submodules | Architecture | Medium |
| D-5 | Migrate all transactions to Lua (replace watch/unwatch) | Performance | Medium |
| D-6 | Add chaos/resilience testing (simulate Redis failures) | Testing | Medium |
| D-7 | Add SRI hashes for vendored JS | Security | Low |
| D-8 | Improve admin dashboard a11y (skip link, contrast) | Accessibility | Low |
| D-9 | Add i18n plural support | Frontend | Low |
| D-10 | Automated perf regression tests (k6 in CI) | CI/CD | Medium |
| D-11 | Add `.dockerignore` file | Infrastructure | Low |
| D-12 | Add `SECURITY.md` vulnerability disclosure policy | Docs | Low |
| D-13 | Add Dependabot config for automated dependency updates | CI/CD | Low |
| D-14 | Add ReDoS regression tests for clue regex | Testing | Low |

---

## Future Features Backlog

### Tier 1: High Value

| Feature | Notes |
|---------|-------|
| Chat UI (in-game) | Backend complete; needs frontend panel with team/spectator tabs |
| Player profiles | Optional persistent identity with stats tracking |
| Tournament mode | Bracket management, scheduling, score tracking |

### Tier 2: Medium Value

| Feature | Notes |
|---------|-------|
| Room invites | Direct player invitations via link or notification |
| Replay sharing | Shareable public replay links (API endpoint exists) |
| Admin dashboard enhancements | Real-time WebSocket metrics, word list moderation |
| Draft mode | Teams draft words before game starts |

### Tier 3: Ambitious Projects

| Feature | Notes |
|---------|-------|
| AI Spymaster | Word embedding model for clue generation |
| Mobile native app | Capacitor wrapper or React Native (PWA works currently) |
| Voice chat | WebRTC integration for in-game voice |
| Observability platform | OpenTelemetry, Grafana dashboards, alerting rules |

---

## Technical Debt

| Issue | Current State | Priority |
|-------|---------------|----------|
| multiplayer.js size | 1,922 lines | Medium — split into submodules |
| Frontend debug logging | Always-on console.log | Low — gate behind config |
| Mixed module exports | Some handlers dual-export CJS + ESM | Low — standardize |
| Coverage threshold mismatch | package.json (80%) vs jest.config.ts.js (65/80/75/75) | Low — align |

### Performance Targets

| Metric | Target |
|--------|--------|
| Concurrent rooms | 1,000+ |
| Total connections | 5,000+ |
| Card reveal latency | <40ms |
| Room create latency | <50ms |

---

## Testing Strategy

### Coverage Targets

| Component | Target | Current |
|-----------|--------|---------|
| Services | 90%+ | Met |
| Handlers | 85%+ | Met |
| Validators | 95%+ | Met |
| Utilities | 80%+ | Met |
| Middleware | 85%+ | Met |
| Frontend (unit) | 70%+ | Growing |

### Test Pyramid

```
        ┌─────────┐
        │  E2E    │  64+ tests (Playwright, 8 spec files)
        │  Tests  │  Game flow, multiplayer lifecycle, a11y, timer
       ┌┴─────────┴┐
       │ Integration │  4 test files
       │   Tests     │  Full game flow, race conditions
      ┌┴─────────────┴┐
      │  Frontend Unit  │  303 tests (4 suites)
      │     Tests       │  State, board, utils, rendering
     ┌┴─────────────────┴┐
     │   Backend Unit      │  2,308 tests (77 suites)
     │      Tests          │  Services, handlers, middleware, config
     └─────────────────────┘
```

### Known Testing Gaps

- No tests for malformed WebSocket messages
- No ReDoS regression tests for clue regex
- E2E selectors use classes/IDs instead of `data-testid` (fragile)
- E2E only runs on Chromium (Firefox/Safari untested)

---

## CI/CD Pipeline

6 quality gates run on every PR:

1. **Test** — Jest with coverage (Node 20 + 22 matrix)
2. **Typecheck** — `tsc --noEmit`
3. **Lint** — ESLint with `--max-warnings 0`
4. **Security** — `npm audit` (fails on critical vulns)
5. **Docker** — Build image and verify health endpoint
6. **E2E** — Playwright tests against running server

Plus: CodeQL weekly security scanning

---

## Commands Reference

```bash
# Development
cd server && npm run dev           # Start server
npm test                           # Run backend tests
npm run test:coverage              # Coverage report
npm run test:frontend              # Frontend tests
npm run lint                       # Lint code
npm run typecheck                  # Type check

# E2E Testing
npm run test:e2e                   # Run E2E tests
npm run test:e2e:headed            # E2E in headed browser

# Docker
docker compose up -d --build       # Full stack
docker compose down                # Stop stack

# Database
npm run db:migrate                 # Run migrations
npm run db:generate                # Generate Prisma client
npm run db:studio                  # Visual database editor
```

---

*This roadmap is updated with each sprint completion and codebase review.*
