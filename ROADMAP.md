# Roadmap - Codenames Online

**Last Updated:** January 29, 2026
**Project Version:** v2.3.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Test Coverage | 91%+ (statements/lines/functions) |
| Backend Tests | 2,345+ passing |
| Frontend Tests | 106 passing |
| E2E Tests | 53 passing |
| Critical Issues | 0 remaining |
| Code Quality | Production-ready |

### Completed Features
- Real-time multiplayer via Socket.io
- Standalone URL-based mode (no server required)
- Custom word lists with database persistence
- Turn timer with pause/resume
- Password-protected rooms
- Team chat with filtering
- Spectator mode
- QR code room sharing
- Reconnection with token-based authentication
- Full state recovery on reconnect
- Comprehensive security hardening (JWT, rate limiting, CSRF, XSS prevention)
- Performance monitoring (request timing, memory alerts)

### Code Review Status
- **74 issues identified** in comprehensive code review
- **65 implemented** (88%)
- **5 partially implemented** (7%)
- **0 critical/high issues remaining**

---

## Completed Sprints

| Sprint | Focus | Status |
|--------|-------|--------|
| Sprint 19 | Security hardening, documentation, performance monitoring | Completed |
| Sprint 18 | Quick wins, test coverage | Completed |
| Sprint 17 | E2E tests, architecture | Completed |
| Sprint 16 | Improvements | Completed |
| Sprint 15 | Reliability, security | Completed |
| Sprint 14 | Performance, consolidation | Completed |
| Sprint 13 | Room passwords, mobile UI | Completed |

---

## Remaining Work

### Phase 1: Frontend Modernization

The modular frontend (`server/public/js/`) coexists with the monolithic `index.html` (see [ADR-005](docs/adr/0005-frontend-consolidation.md)). Both implementations work; the modular version is the target architecture.

| Task | Priority |
|------|----------|
| Add multiplayer panel HTML to modular frontend | High |
| Wire up all multiplayer socket events in modules | High |
| Verify feature parity between monolithic and modular | Medium |
| Remove monolithic inline JS once modular is verified | Low |

### Phase 2: Internationalization

| Task | Priority |
|------|----------|
| i18n framework setup | High |
| English translations (source) | High |
| German, Spanish, French translations | High |
| Localized word lists (400 words each) | High |

### Phase 3: Accessibility (WCAG 2.1 AA)

| Task | Priority |
|------|----------|
| Color contrast audit (4.5:1 ratio) | High |
| Color blind mode (alternative schemes) | High |
| Keyboard shortcuts for common actions | Medium |
| Screen reader optimization | Medium |

### Phase 4: Game Modes

| Task | Priority |
|------|----------|
| Blitz mode (30s turns) | High |
| Duet mode (cooperative, 2-player) | High |
| Three-team mode | Medium |

---

## Future Features Backlog

### Tier 1: High Value

| Feature | Notes |
|---------|-------|
| Game replay sharing | Shareable replay links |
| Player profiles | Optional persistent identity with stats |

### Tier 2: Medium Value

| Feature | Notes |
|---------|-------|
| Room invites | Direct player invitations |
| Sound & visual polish | Effects, animations, themes |
| Admin dashboard | Room monitoring, abuse detection |

### Tier 3: Ambitious Projects

| Feature | Notes |
|---------|-------|
| Tournament mode | Bracket management, scheduling |
| AI Spymaster | Word embedding model for clue generation |
| Mobile native app | React Native if demand exists |
| Voice chat | WebRTC integration |

---

## Technical Debt

### Performance Optimizations

| Issue | Current State | Target |
|-------|---------------|--------|
| JSON Serialization | ~2ms per reveal | <0.5ms with selective updates |
| Player Fetching | O(N) Redis calls | MGET batch fetching |
| Full board re-render | Complete DOM replacement | Incremental updates |

### Code Quality

- **Function decomposition**: `revealCard()` (157 lines), `giveClue()` (103 lines), `createGame()` (115 lines) should be broken into phases
- **Socket event constants**: Create `SOCKET_EVENTS` enum for all event names
- **Error handling**: Standardize on `GameError` class across all services

### Security Enhancements (Low Priority)

- Session binding to IP/fingerprint
- WebAuthn support for persistent accounts
- Subresource Integrity (SRI) for CDN assets
- Security event logging and alerting

---

## Testing Strategy

### Coverage Targets

| Component | Target |
|-----------|--------|
| Services | 90%+ |
| Handlers | 85%+ |
| Validators | 95%+ |
| Utilities | 80%+ |
| Middleware | 85%+ |

### Performance Testing Targets

| Metric | Target |
|--------|--------|
| Concurrent rooms | 1,000+ |
| Total connections | 5,000+ |
| Card reveal latency | <40ms |
| Room create latency | <50ms |

---

## Commands Reference

```bash
# Development
cd server && npm run dev           # Start server
npm test                           # Run tests
npm run test:coverage              # Coverage report
npm run lint                       # Lint code

# E2E Testing
npx playwright test                # Run E2E tests

# Docker
docker compose up -d --build       # Full stack
```

---

*This roadmap is updated with each sprint completion.*
