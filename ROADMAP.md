# Roadmap — Die Eigennamen (Codenames Online)

**Last Updated:** February 11, 2026
**Project Version:** v2.2.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Tests | 2,308 passing (77 suites) |
| Frontend Tests | 303 passing (4 suites) |
| E2E Tests | 53+ passing (7 spec files) |
| Total Tests | ~2,664 |
| Backend Coverage | 94%+ |
| Critical Issues | 0 |
| Code Quality | Production-ready |

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

## Remaining Work

### High Priority

| Task | Category | Notes |
|------|----------|-------|
| Harden game state Zod validation | Code Quality | Replace `.passthrough()` with explicit fields in gameService |
| Add timeout wrappers for Redis Lua calls | Code Quality | Prevent indefinite hangs on slow Redis |
| Fix documentation directory references | Docs | Update "Risley-Codenames" → "Eigennamen" throughout |
| Document IP validation security defaults | Security | Clarify `ALLOW_IP_MISMATCH` implications |

### Medium Priority

| Task | Category | Notes |
|------|----------|-------|
| Add multiplayer E2E tests | Testing | Room create → join → play → reconnect flow |
| Implement chat UI | Frontend | Panel with team/spectator tabs (backend ready) |
| Complete i18n markup | Frontend | Audit hardcoded English strings in HTML |
| Implement token rotation on reconnection | Security | Rotate tokens after successful use |
| Gate frontend debug logging | Performance | Make state.js logging conditional |
| Add CHANGELOG.md | Docs | Structured changelog following Keep a Changelog |
| Complete ES module migration | Code Quality | Remove remaining `require()`/`module.exports` |

### Lower Priority

| Task | Category | Notes |
|------|----------|-------|
| Split multiplayer.js | Architecture | Decompose 1,922-line file into submodules |
| Migrate all transactions to Lua | Performance | Replace watch/unwatch patterns |
| Add chaos/resilience testing | Testing | Simulate Redis failures during operations |
| Add SRI for vendored JS | Security | Integrity hashes for socket.io, qrcode |
| Improve admin dashboard a11y | Accessibility | Skip link, contrast review |
| Add i18n plural support | Frontend | Plural form handling in i18n.js |
| Automated perf regression tests | CI/CD | Schedule k6 load tests |
| Board ARIA grid role attributes | Accessibility | `aria-rowindex`/`aria-colindex` |

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
| Zod `.passthrough()` usage | gameService game state schema | Explicit field validation |
| multiplayer.js size | 1,922 lines | Split into focused submodules |
| Frontend debug logging | Always-on console.log | Conditional on config flag |

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
        │  E2E    │  53+ tests (Playwright)
        │  Tests  │  Game flow, multiplayer, a11y, timer
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
