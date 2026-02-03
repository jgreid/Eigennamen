# Roadmap - Codenames Online

**Last Updated:** February 3, 2026
**Project Version:** v2.4.0

---

## Current Status

| Metric | Value |
|--------|-------|
| Backend Test Coverage | 94%+ |
| Backend Tests | 2,600+ passing |
| E2E Tests | 53 passing |
| Critical Issues | 0 |
| Code Quality | Production-ready |

### Completed Features
- Real-time multiplayer via Socket.io
- Standalone URL-based mode (no server required)
- Custom word lists with database persistence
- Turn timer with pause/resume
- Team chat with filtering
- Spectator mode with role selection
- QR code room sharing
- Reconnection with token-based authentication
- Full state recovery on reconnect
- Comprehensive security hardening (JWT, rate limiting, CSRF, XSS prevention)
- Performance monitoring (request timing, memory alerts)
- Modular ES6 frontend (`server/public/js/modules/`)

---

## Remaining Work

### Phase 1: Internationalization

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
| Full board re-render | Complete DOM replacement | Incremental updates |

### Security Enhancements (Low Priority)

- WebAuthn support for persistent accounts
- Subresource Integrity (SRI) for CDN assets

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
