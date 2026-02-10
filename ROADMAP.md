# Roadmap - Codenames Online

**Last Updated:** February 10, 2026
**Project Version:** v2.2.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Test Coverage | 94%+ |
| Backend Tests | 2,980+ passing |
| Frontend Tests | 303 passing |
| E2E Tests | 53 passing |
| Critical Issues | 0 |
| Code Quality | Production-ready |

### Completed Features
- Real-time multiplayer via Socket.io
- Standalone URL-based mode (no server required)
- Custom word lists with database persistence
- Turn timer with pause/resume/add-time
- Team chat with filtering
- Spectator mode with chat and role selection
- QR code room sharing
- Reconnection with token-based authentication
- Full state recovery on reconnect
- Comprehensive security hardening (JWT, rate limiting, CSRF, XSS prevention)
- Performance monitoring (request timing, memory alerts, metrics collection)
- Modular ES6 frontend (`server/public/js/modules/`)
- Internationalization (English, German, Spanish, French with localized word lists)
- Accessibility (colorblind mode, keyboard navigation, screen reader support, ARIA)
- Game modes: Classic, Blitz (30s turns), Duet (cooperative 2-player)
- Game history and replay system
- Admin dashboard with room management, audit logs, and metrics
- Audit logging for security events
- Swagger/OpenAPI documentation
- Audio notifications (Web Audio API)

---

## Remaining Work

### Testing Improvements

| Task | Priority |
|------|----------|
| Complete ES module migration (remove mixed require/import) | Medium |
| Add multiplayer E2E tests (room create -> join -> play -> reconnect) | Medium |
| Automated performance regression testing | Low |

### UX & Accessibility (WCAG 2.1 AA)

| Task | Priority |
|------|----------|
| Board ARIA grid role attributes (`aria-rowindex`/`aria-colindex`) | Medium |
| Improve keyboard navigation between cards | Medium |
| Replace deprecated `document.execCommand('copy')` fallback | Low |

### Security Enhancements (Low Priority)

| Task | Priority |
|------|----------|
| WebAuthn support for persistent accounts | Low |
| Subresource Integrity (SRI) for vendored JS | Low |
| Rate limit room existence HTTP endpoint | Low |

---

## Future Features Backlog

### Tier 1: High Value

| Feature | Notes |
|---------|-------|
| Player profiles | Optional persistent identity with stats |
| Tournament mode | Bracket management, scheduling |

### Tier 2: Medium Value

| Feature | Notes |
|---------|-------|
| Room invites | Direct player invitations |
| Replay sharing | Shareable replay links (replay system exists) |
| Admin dashboard enhancements | Real-time metrics visualization, system health alerts |

### Tier 3: Ambitious Projects

| Feature | Notes |
|---------|-------|
| AI Spymaster | Word embedding model for clue generation |
| Mobile native app | React Native / Capacitor if demand exists |
| Voice chat | WebRTC integration |

---

## Technical Debt

### Code Quality

| Issue | Current State | Target |
|-------|---------------|--------|
| Mixed module systems | Some `require()` alongside ES6 `import` | Full ES module migration |
| Full board re-render | Some paths still use complete DOM replacement | Consistent incremental updates |

### Performance Optimizations

| Metric | Target |
|--------|--------|
| Concurrent rooms | 1,000+ |
| Total connections | 5,000+ |
| Card reveal latency | <40ms |
| Room create latency | <50ms |

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

# Docker
docker compose up -d --build       # Full stack
```

---

*This roadmap is updated with each sprint completion.*
