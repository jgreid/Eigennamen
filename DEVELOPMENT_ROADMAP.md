# Development Roadmap - Die Eigennamen (Codenames Online)

**Last Updated:** January 25, 2026
**Project Version:** v2.3.0

This document outlines the development roadmap, planned features, and technical improvements for the Codenames Online project.

---

## Table of Contents

1. [Current State](#current-state)
2. [Priority 1: Critical Improvements](#priority-1-critical-improvements)
3. [Priority 2: Feature Enhancements](#priority-2-feature-enhancements)
4. [Priority 3: Technical Debt](#priority-3-technical-debt)
5. [Priority 4: Future Features](#priority-4-future-features)
6. [Testing Strategy](#testing-strategy)
7. [Performance Goals](#performance-goals)
8. [Security Hardening](#security-hardening)

---

## Current State

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

### Code Review Status
- **74 issues identified** in comprehensive code review
- **65 implemented** (88%)
- **5 partially implemented** (7%)
- **0 critical/high issues remaining**
- **4 documented as acceptable** (5%)

---

## Priority 1: Critical Improvements ✅ COMPLETED

All critical and high-priority security and reliability issues have been resolved as of January 2026.

### 1.1 Security Issues - RESOLVED

| Issue | Description | Status |
|-------|-------------|--------|
| Session Hijacking | Reconnection token implementation (#17) | ✅ Fixed |
| Rate Limiting | Rate limiting on session ID validation (#74) | ✅ Fixed |
| Team Validation | Validate both teams have players during game (#59) | ✅ Fixed |
| XSS Prevention | Nickname and team name sanitization | ✅ Fixed |
| CSRF Protection | Subdomain wildcard bypass fixed | ✅ Fixed |

### 1.2 Multi-Instance Reliability - RESOLVED

| Issue | Description | Status |
|-------|-------------|--------|
| addTime Routing | Route addTime to correct timer instance (#34) | ✅ Fixed |
| Timer Orphan Check | Redis keyspace notifications (#8) | ✅ Fixed |
| Pub/Sub Reliability | Retry logic for pub/sub failures | ✅ Fixed |
| Distributed Locks | Race condition prevention | ✅ Implemented |

---

## Priority 2: Feature Enhancements

### 2.1 User Experience Improvements

#### Enhanced Game History
- **Description:** Persistent game history with replay capability
- **Features:**
  - View previous games
  - Replay turn-by-turn
  - Share memorable games
- **Implementation:** Store completed games in PostgreSQL, add history API

#### Spectator Chat Channel
- **Description:** Separate chat channel for spectators
- **Features:**
  - Spectator-only messages
  - Optional visibility to players
  - Moderation controls
- **Implementation:** Add `spectatorOnly` flag to chat messages

#### Custom Game Modes
- **Description:** Alternative game rule sets
- **Features:**
  - Duet mode (cooperative)
  - Timed blitz mode
  - Custom card counts
- **Implementation:** Extend room settings, create mode-specific game logic

### 2.2 Social Features

#### Player Profiles (Optional)
- **Description:** Optional persistent identity
- **Features:**
  - Win/loss statistics
  - Preferred teams
  - Friend lists
- **Implementation:** JWT-based auth, extend User model

#### Room Invites
- **Description:** Direct player invitations
- **Features:**
  - Invite by username
  - Invite notifications
  - Private room links
- **Implementation:** Add invite system, push notifications

### 2.3 Accessibility Improvements

| Issue | Description | Effort |
|-------|-------------|--------|
| ARIA Labels | Complete ARIA labels on all controls (#62) | Low |
| Keyboard Navigation | Full keyboard support for all actions | Medium |
| Color Blind Mode | Alternative color schemes | Medium |
| Screen Reader | Test and optimize for screen readers | High |

---

## Priority 3: Technical Debt

### 3.1 Performance Optimizations

| Issue | Description | Current State | Target |
|-------|-------------|---------------|--------|
| JSON Serialization | Full stringify on every reveal (#36) | ~2ms per reveal | <0.5ms with selective updates |
| Rate Limiter Arrays | New array allocation per request (#37) | Memory pressure | Object reuse pool |
| Player Fetching | Multiple Redis calls | O(N) calls | MGET batch fetching |

### 3.2 Code Quality Improvements

#### Function Decomposition
- **revealCard()** - 157 lines → Break into validation, execution, broadcast phases
- **giveClue()** - 103 lines → Extract validation, logging, state update
- **createGame()** - 115 lines → Separate board generation, state initialization

#### Error Handling Standardization
- Migrate all services to use `GameError` class
- Implement consistent error codes across handlers
- Add error boundary middleware for uncaught exceptions

#### Socket Event Constants
- Create `SOCKET_EVENTS` enum for all event names
- Update all handlers to use constants
- Add TypeScript definitions for event payloads

### 3.3 Testing Improvements ✅ EXCEEDED TARGETS

| Area | Previous | Current | Target | Status |
|------|----------|---------|--------|--------|
| Line Coverage | 70% | 90.47% | 85% | ✅ Exceeded |
| Branch Coverage | 70% | 83.91% | 80% | ✅ Exceeded |
| Statement Coverage | 70% | 90.21% | 85% | ✅ Exceeded |
| Function Coverage | 70% | 90.35% | 85% | ✅ Exceeded |
| Total Tests | ~800 | 2,320 | 1,000+ | ✅ Exceeded |
| Test Suites | 35 | 71 | 50+ | ✅ Exceeded |
| E2E Tests | 0 | Pending | Full game flow | 🔄 Next Sprint |

---

## Priority 4: Future Features

### 4.1 Mobile Application
- **Platform:** React Native or Flutter
- **Features:**
  - Native push notifications
  - Offline standalone mode
  - Camera-based QR scanning
- **Considerations:** WebSocket compatibility, battery optimization

### 4.2 Tournament Mode
- **Description:** Competitive multi-room tournaments
- **Features:**
  - Bracket generation
  - Automatic room progression
  - Live leaderboard
  - Spectator mode for finals
- **Implementation:** New tournament service, scheduler, bracket management

### 4.3 AI Spymaster
- **Description:** AI-powered clue generation for solo/practice play
- **Features:**
  - Difficulty levels
  - Learning mode with explanations
  - Hint suggestions
- **Implementation:** Integrate word embedding model, implement clue scoring

### 4.4 Internationalization
- **Languages:** German, Spanish, French, Japanese
- **Components:**
  - UI translations
  - Localized word lists
  - Date/time formatting
- **Implementation:** i18n library, translation management system

### 4.5 Admin Dashboard
- **Features:**
  - Room monitoring
  - User management
  - Abuse detection
  - Performance metrics
- **Implementation:** Separate admin React app, admin API endpoints

---

## Testing Strategy

### Unit Testing
```
Coverage targets by component:
├── Services: 90%+ (critical business logic)
├── Handlers: 85%+ (socket/HTTP handlers)
├── Validators: 95%+ (input validation)
├── Utilities: 80%+ (helper functions)
└── Middleware: 85%+ (auth, rate limiting)
```

### Integration Testing
- Full room lifecycle (create → join → play → end)
- Multi-player game scenarios
- Reconnection flows
- Error recovery paths

### Performance Testing
- Concurrent connection stress test (target: 1000 connections)
- Message throughput test (target: 10,000 msg/sec)
- Memory leak detection (72-hour soak test)
- Latency percentiles (p50 < 50ms, p99 < 200ms)

### Security Testing
- Automated dependency scanning (npm audit)
- OWASP ZAP scans
- Manual penetration testing
- Rate limit effectiveness testing

---

## Performance Goals

### Latency Targets
| Operation | Current | Target |
|-----------|---------|--------|
| Room Create | ~100ms | <50ms |
| Room Join | ~150ms | <75ms |
| Card Reveal | ~80ms | <40ms |
| Give Clue | ~60ms | <30ms |
| Chat Message | ~20ms | <10ms |

### Scalability Targets
| Metric | Current | Target |
|--------|---------|--------|
| Concurrent Rooms | ~100 | 1,000+ |
| Players per Room | 20 | 50 |
| Total Connections | ~500 | 5,000+ |
| Redis Memory | ~50MB | <200MB |

### Resource Efficiency
- Memory per connection: <2KB
- CPU per message: <1ms
- Database queries per operation: <3

---

## Security Hardening

### Completed (v2.2.0)
- [x] Input validation with Zod schemas
- [x] XSS prevention (HTML sanitization)
- [x] CSRF protection
- [x] Rate limiting (dual-layer)
- [x] Helmet.js security headers
- [x] Password hashing (bcrypt)
- [x] Session hijacking detection
- [x] Non-root Docker container
- [x] TLS enforcement in production

### Planned
- [ ] Session binding to IP/fingerprint
- [ ] WebAuthn support for persistent accounts
- [ ] Content Security Policy refinement
- [ ] Subresource Integrity (SRI) for CDN assets
- [ ] Security event logging and alerting

---

## Release Schedule

### v2.3.0 ✅ RELEASED (January 2026)
- ✅ All Priority 1 issues resolved
- ✅ Comprehensive test coverage (90%+)
- ✅ Performance optimizations (Redis pooling, batch operations)
- ✅ Spectator mode enhancements
- ✅ Basic admin dashboard
- ✅ OpenAPI/Swagger documentation

### v2.4.0 (Next Release)
- Room password protection
- Sound notifications
- Game history & stats dashboard
- Mobile-responsive improvements
- E2E testing framework (Playwright)

### v3.0.0 (Major - Future)
- Optional user accounts
- Tournament mode (beta)
- AI Spymaster (experimental)
- Full internationalization

---

## Contributing

### Development Process
1. Create feature branch from `main`
2. Implement with tests
3. Run full test suite (`npm test`)
4. Run linter (`npm run lint`)
5. Update documentation
6. Create pull request

### Code Standards
- ESLint configuration in `.eslintrc.js`
- Prettier for formatting
- Conventional commits
- JSDoc for public functions

### Architecture Guidelines
- Services for business logic
- Handlers for request/response only
- Validators at entry points
- Redis for ephemeral data
- PostgreSQL for persistent data

---

## Metrics & Monitoring

### Key Performance Indicators
- Active rooms per hour
- Games completed per day
- Average game duration
- Player retention (return visits)
- Error rate (<0.1% target)

### Observability Stack
- **Logging:** Winston → CloudWatch/ELK
- **Metrics:** Custom metrics → Prometheus/Grafana
- **Tracing:** Correlation IDs → Distributed tracing
- **Alerting:** Threshold-based → PagerDuty/Slack

---

*This roadmap is a living document and will be updated as priorities evolve.*
