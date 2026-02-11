# Roadmap — Die Eigennamen (Codenames Online)

**Last Updated:** February 11, 2026 (Comprehensive Review)
**Project Version:** v2.2.0

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
| ESLint | 8 errors (unused vars in tests), 117 warnings |
| npm audit | 0 vulnerabilities |
| Critical/High Issues | 0 open (all 10 fixed) |
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
- Multi-stage Docker build with non-root user
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

---

## Remaining Work

### Tier C: Medium Priority (15 items)

| ID | Task | Category | Effort |
|----|------|----------|--------|
| C-1 | Use safeEmit in chat handlers | Consistency | Low |
| C-2 | Add timeout to game:clue handler | Resilience | Low |
| C-3 | Fix session age validation (`connectedAt` fallback bypasses 8h limit) | Security | Low |
| C-4 | Enforce JWT secret length in production (throw, not warn) | Security | Low |
| C-5 | Add word uniqueness validation in Zod schema | Validation | Low |
| C-6 | Replay board keyboard navigation (ARIA roles, tabindex) | Accessibility | Medium |
| C-7 | Batch role reset for new games (pipeline/Lua instead of N ops) | Performance | Medium |
| C-8 | Unify nickname validation regex (multiplayer.js vs constants.js) | Consistency | Low |
| C-9 | Fix fitCardText layout thrashing (batch reads/writes) | Performance | Low |
| C-10 | Guard replay interval creation (prevent duplicates on rapid toggle) | Bug | Low |
| C-11 | Expire memory-mode audit logs (TTL or max entries) | Memory | Low |
| C-12 | Make timeouts configurable via env vars | Operations | Low |
| C-13 | Add Docker Compose resource limits | Infrastructure | Low |
| C-14 | Validate settings values (team names in updateSettings) | Validation | Low |
| C-15 | Implement token rotation on use | Security | Medium |

### Tier D: Lower Priority / Future (15 items)

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
| D-15 | Fix ESLint errors (8 unused vars in test files) | Code Quality | Low |

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
| ESLint warnings | 117 non-null assertions in tests | Low |
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
