# Roadmap — Die Eigennamen (Codenames Online)

**Last Updated:** February 11, 2026 (Deep Review)
**Project Version:** v2.2.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Tests | 2,308 passing (77 suites) |
| Frontend Tests | 303 passing (4 suites) |
| E2E Tests | 64+ passing (8 spec files) |
| Total Tests | ~2,675 |
| Backend Coverage | 94%+ |
| Critical Issues | 2 (identified in deep review) |
| High Priority Issues | 8 |
| Code Quality | Production-ready (with targeted fixes needed) |

### Completed Features

- Real-time multiplayer via Socket.io with Redis Pub/Sub adapter
- Standalone URL-based mode (no server required)
- Custom word lists with database persistence
- Turn timer with pause/resume/add-time (Redis-backed)
- Team chat with filtering (backend)
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
- Multi-stage Docker build with non-root user
- CI/CD pipeline: 6 quality gates (test, typecheck, lint, security, Docker, E2E)
- CodeQL weekly security scanning

---

## Previous Improvements — All Completed

### Tier 1-3 (Feb 9, 2026) ✅
Magic numbers, safe JSON, Zod builders, domain split, auth refactor, connection tracker,
frontend tests, focus trap, state docs, staging docs, Docker optimization — all done.

### Tier A (Feb 11, 2026) ✅
Zod `.passthrough()` removal, timeout wrappers, IP validation docs, directory references,
multiplayer E2E tests (11 tests), deprecated file cleanup — all done.

---

## Remaining Work (Deep Review Findings)

### Critical — Must Fix

| ID | Task | Category | Description |
|----|------|----------|-------------|
| CRIT-1 | Fix spectator handler signatures | Bug | `spectator:requestJoin`/`approveJoin` pass wrong params — handlers non-functional |
| CRIT-2 | Add max word count validation | Security | No upper limit on word lists — DoS vector via memory exhaustion |

### High Priority — Should Fix

| ID | Task | Category | Description |
|----|------|----------|-------------|
| HIGH-1 | Invalidate token on player kick | Security | Kicked players retain reconnection tokens |
| HIGH-2 | Verify history cleanup index | Data | `cleanupOldHistory` zRange params need verification |
| HIGH-3 | Wire localized words into game | Bug | Localized word lists loaded but never used by game logic |
| HIGH-4 | Fix className escapeHTML misuse | Bug | `escapeHTML()` wrong for CSS class context in history.js |
| HIGH-5 | Fix replay event listener leak | Memory | Listener accumulation on repeated replay opens |
| HIGH-6 | Handle refreshRoomTTL failures | Resilience | TTL refresh failure propagates and fails room join |
| HIGH-7 | Fix accessibility listener leak | Memory | Keyboard overlay listener persists on click-close |
| HIGH-8 | Cap connectionsPerIP map size | Security | Unbounded map growth under IP spoofing attack |

### Medium Priority

| ID | Task | Category | Description |
|----|------|----------|-------------|
| C-1 | Use safeEmit in chat handlers | Consistency | Chat uses raw emit instead of safeEmit pattern |
| C-2 | Add timeout to game:clue handler | Resilience | giveClue service call has no timeout wrapper |
| C-3 | Fix session age validation | Security | `connectedAt` fallback lets frequent reconnectors bypass 8h limit |
| C-4 | Enforce JWT secret length | Security | Short secrets only warned, not rejected in production |
| C-5 | Add word uniqueness validation | Validation | Zod schema allows duplicate words |
| C-6 | Replay board keyboard navigation | Accessibility | No ARIA roles or tabindex on replay cards |
| C-7 | Batch role reset for new games | Performance | N individual Redis ops instead of pipeline/Lua |
| C-8 | Unify nickname validation regex | Consistency | multiplayer.js differs from constants.js |
| C-9 | Fix fitCardText layout thrashing | Performance | Read/write loop per card causes reflows |
| C-10 | Guard replay interval creation | Bug | Rapid toggle can create duplicate intervals |
| C-11 | Expire memory-mode audit logs | Memory | Audit logs grow unbounded in memory mode |
| C-12 | Make timeouts configurable | Operations | Timeout values hardcoded, not env-configurable |
| C-13 | Add Docker Compose resource limits | Infrastructure | No memory/CPU caps on containers |
| C-14 | Validate settings values | Validation | Team names in updateSettings not validated |
| C-15 | Implement token rotation on use | Security | Reconnection tokens not rotated after successful use |

### Lower Priority / Future

| ID | Task | Category | Description |
|----|------|----------|-------------|
| D-1 | Implement chat UI | Frontend | Panel with team/spectator tabs (backend ready) |
| D-2 | Complete i18n markup | Frontend | Audit hardcoded English strings |
| D-3 | Gate frontend debug logging | Performance | Conditional state.js logging |
| D-4 | Add CHANGELOG.md | Docs | Structured changelog |
| D-5 | Split multiplayer.js | Architecture | Decompose 1,922-line file |
| D-6 | Migrate all transactions to Lua | Performance | Replace watch/unwatch patterns |
| D-7 | Add chaos/resilience testing | Testing | Simulate Redis failures |
| D-8 | Add SRI for vendored JS | Security | Integrity hashes |
| D-9 | Improve admin dashboard a11y | Accessibility | Skip link, contrast review |
| D-10 | Add i18n plural support | Frontend | Plural form handling |
| D-11 | Automated perf regression tests | CI/CD | Schedule k6 in CI |
| D-12 | Add .dockerignore | Infrastructure | Exclude build artifacts from context |
| D-13 | Add SECURITY.md | Docs | Vulnerability disclosure policy |
| D-14 | Add Dependabot config | CI/CD | Automated dependency updates |
| D-15 | Add ReDoS regression tests | Testing | Test regex against pathological inputs |

---

## Future Features Backlog

### Tier 1: High Value

| Feature | Notes |
|---------|-------|
| Player profiles | Optional persistent identity with stats tracking |
| Tournament mode | Bracket management, scheduling, score tracking |
| Chat UI (in-game) | Team and spectator chat with the existing backend |

### Tier 2: Medium Value

| Feature | Notes |
|---------|-------|
| Room invites | Direct player invitations via link or notification |
| Replay sharing | Shareable public replay links (replay system exists) |
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

### Code Quality

| Issue | Current State | Target |
|-------|---------------|--------|
| Mixed module systems | Some `require()` alongside ES6 `import` | Full ES module migration |
| ~~Zod `.passthrough()` usage~~ | ~~All 5 service schemas~~ | ✅ Fixed — explicit fields |
| Spectator handler signatures | Broken — wrong factory params | Fix with correct 4-param pattern |
| multiplayer.js size | 1,922 lines | Split into focused submodules |
| Frontend debug logging | Always-on console.log | Conditional on config flag |
| Localized words unused | Loaded but ignored by game.js | Wire into word selection |

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
        │  E2E    │  64+ tests (Playwright)
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

### Testing Gaps (from Deep Review)

- No tests for spectator join flow (broken handlers — CRIT-1)
- No ReDoS regression tests for clue word regex
- No history cleanup index correctness tests
- No malformed WebSocket message tests
- E2E selectors fragile (class-based instead of data-testid)

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
