# Codenames Online: 3-Sprint Strategic Plan

**Created:** January 24, 2026
**Last Updated:** January 25, 2026

---

## Executive Summary

This document outlines the next 3 development sprints for Codenames Online. The project is in excellent health with **90%+ test coverage** and production-ready code quality. These sprints focus on:

1. **Sprint 13**: User-facing features for engagement
2. **Sprint 14**: Performance optimization & technical debt
3. **Sprint 15**: Frontend modernization & E2E testing

**Total Estimated Effort:** 6-8 weeks (1 engineer) or 4 weeks (2 engineers)

---

## Current Project Status (January 25, 2026)

| Metric | Value | Status |
|--------|-------|--------|
| Test Coverage (Statements) | 90.21% | ✅ Excellent |
| Test Coverage (Lines) | 90.47% | ✅ Excellent |
| Test Coverage (Branches) | 83.91% | ✅ Good |
| Test Coverage (Functions) | 90.35% | ✅ Excellent |
| Total Tests | 2,320 passing | ✅ Comprehensive |
| Test Suites | 71 | ✅ Well organized |
| Code Quality | Production-ready (A-grade) | ✅ |
| Critical Issues | 0 | ✅ Complete |
| High Priority Issues | 0 | ✅ Complete |

### Recent Achievements (Sprints 15-16 Completed)
- ✅ Test coverage improved from 81% to 90%+
- ✅ Spectator mode enhancements
- ✅ Reconnection improvements (15-min token validity)
- ✅ Performance optimizations (Redis pooling, batch ops)
- ✅ Basic admin dashboard
- ✅ OpenAPI/Swagger documentation

---

## Sprint 13: High-Value Feature Implementation

**Duration:** 2-3 weeks
**Focus:** User-facing features & engagement
**Risk Level:** Low

### 13.1 Room Password Protection
**Priority:** HIGH | **Effort:** 16 hours

Prevent unwanted players from joining private games.

**Tasks:**
- Add password field to room schema in validators
- Implement bcryptjs hashing for password storage
- Update `room:join` handler to validate password
- Add password input to "Create Room" and "Join Room" UI
- Add "Change Password" option in room settings

**Files to Modify:**
- `server/src/validators/schemas.js`
- `server/src/socket/handlers/roomHandlers.js`
- `server/src/services/roomService.js`
- `index.html`

---

### 13.2 Sound Notifications
**Priority:** MEDIUM | **Effort:** 12 hours

Improve engagement by alerting users when the tab is inactive.

**Tasks:**
- Add Web Audio API or HTML5 audio elements
- Create sounds for: turn change, card reveal, game over, chat message
- Add settings: volume slider, mute toggle, individual toggles
- Persist settings in localStorage

**Files to Modify:**
- `index.html` (frontend only)

---

### 13.3 Game History & Stats Dashboard
**Priority:** MEDIUM | **Effort:** 20 hours

Increase replayability with game history tracking.

**Tasks:**
- Add `GameHistory` table to database schema
- Create `gameHistoryService.js` for CRUD operations
- Add REST endpoints for saving/retrieving history
- Create "Game History" modal in frontend
- Display: date, winner, duration, team scores

**Files to Create/Modify:**
- `server/prisma/schema.prisma`
- `server/src/services/gameHistoryService.js` (new)
- `server/src/routes/gameRoutes.js` (new)
- `index.html`

---

### 13.4 Mobile-Responsive Improvements
**Priority:** MEDIUM | **Effort:** 16 hours

Improve experience for 40%+ mobile traffic.

**Tasks:**
- Update board grid: `grid-template-columns: repeat(auto-fit, minmax(60px, 1fr))`
- Increase tap target sizes to 44x44px minimum
- Optimize modal scrolling for small screens
- Add viewport-specific margins/padding
- Hide unnecessary elements on mobile (<768px)

**Success Metrics:**
- Mobile Lighthouse score: 85+ (from 65)
- Tap target compliance: 100%

**Files to Modify:**
- `index.html` (CSS section)

---

### Sprint 13 Summary

| Feature | Effort | User Impact |
|---------|--------|-------------|
| Room Passwords | 16h | High - Privacy control |
| Sound Notifications | 12h | Medium - Engagement |
| Game History | 20h | Medium - Replayability |
| Mobile UI | 16h | High - User experience |
| **Total** | **64h** | |

---

## Sprint 14: Optimization & Technical Debt

**Duration:** 2 weeks
**Focus:** Performance, memory efficiency, code quality
**Risk Level:** Low

### 14.1 Eliminate Duplicate Service Functions
**Effort:** 6 hours

**Issues:**
- `playerService.js`: `createPlayer()` and `createPlayerData()` nearly identical
- `timerService.js`: Timer expiration logic duplicated

**Tasks:**
- Merge `createPlayer()` and `createPlayerData()` with optional parameter
- Extract timer callback to `createTimerCallback()` helper
- Update all call sites
- Add tests for merged functions

**Files:**
- `server/src/services/playerService.js`
- `server/src/services/timerService.js`

---

### 14.2 Lazy History Slicing
**Effort:** 4 hours

**Issue:** Game history sliced on every entry, creating O(n) allocations.

**Fix:**
```javascript
// Only slice when exceeding 1.5x threshold
if (game.history.length > MAX_HISTORY_ENTRIES * 1.5) {
    game.history = game.history.slice(-MAX_HISTORY_ENTRIES);
}
```

**Impact:** 30% reduction in memory allocations during long games

---

### 14.3 DOM Query Optimization
**Effort:** 4 hours

**Issue:** `Array.from(board.children).indexOf(card)` = O(n) on every click

**Fix:** Use existing `data-index` attribute for O(1) lookup
```javascript
const index = parseInt(card.dataset.index, 10);
```

**Impact:** 5-10ms faster card reveals

---

### 14.4 Frontend Code Consolidation
**Effort:** 8 hours

**Issues:**
- Three duplicate screen reader functions
- Role banner has 8 if-else branches
- Modal close handlers repeated

**Tasks:**
- Create 1 generic screen reader function
- Replace if-else with configuration object
- Implement modal registry pattern

**Impact:** 300+ lines of code removed, 15% easier maintenance

---

### 14.5 Memory Storage & Word List Fixes
**Effort:** 8 hours

**Tasks:**
- Update word list SELECT to exclude `words` field
- Fix memoryStorage O(n²) complexity in key checking
- Improve transaction error handling
- Add proper error reporting in rollbacks

**Files:**
- `server/src/services/wordListService.js`
- `server/src/utils/memoryStorage.js`

**Impact:** 40% improvement in word list queries

---

### 14.6 Infrastructure Optimization
**Effort:** 4 hours

**Tasks:**
- Add health check timeout protection
- Optimize socket.io configuration for production
- Enable gzip compression for large payloads
- Add caching headers for static assets

**Files:**
- `server/src/app.js`
- `server/src/socket/index.js`

---

### Sprint 14 Summary

| Task | Effort | Improvement |
|------|--------|-------------|
| Duplicate function cleanup | 6h | Maintainability +20% |
| History lazy slicing | 4h | Memory usage -30% |
| DOM query optimization | 4h | Card reveal +5-10ms |
| Code consolidation | 8h | -300 LOC |
| Memory storage fixes | 8h | Query speed +40% |
| Infrastructure | 4h | Page load -15% |
| **Total** | **34h** | |

---

## Sprint 15: Frontend Modernization & E2E Testing

**Duration:** 2-3 weeks
**Focus:** Testing infrastructure, architecture, accessibility
**Risk Level:** Low-Medium

### 15.1 End-to-End Testing Framework
**Effort:** 12 hours

**Tasks:**
- Configure Playwright (already in package.json)
- Create `playwright.config.js`
- Configure browsers: Chromium, Firefox, WebKit

**Critical Path Tests:**
- User joins room and starts game
- Complete full game flow (all roles)
- Spectator mode
- Timer functions
- Chat messaging
- Reconnection handling
- Password-protected rooms

**Test Structure:**
```
server/src/__tests__/e2e/
├── basic-flow.spec.js
├── multiplayer.spec.js
├── timer.spec.js
├── chat.spec.js
└── auth.spec.js
```

---

### 15.2 Frontend State Management Refactoring
**Effort:** 20 hours

**Problem:** 3800+ line index.html with 20+ global variables

**Phase 1: State Container (8 hours)**
```javascript
class GameState {
    constructor() {
        this.state = { roomCode: null, gameState: 'waiting', players: {}, board: [] };
        this.listeners = [];
    }
    update(newState) { /* ... */ }
    subscribe(listener) { /* ... */ }
}
```

**Phase 2: Module Extraction (12 hours)**
- Extract UI rendering to `ui.js`
- Extract game logic to `game.js`
- Extract socket events to `socket.js`
- Keep `index.html` as module loader

**Benefits:** Easier testing, better organization, clearer dependencies

---

### 15.3 Accessibility Improvements
**Effort:** 12 hours

**Tasks:**
1. **ARIA Labels (4h):** Add labels to all interactive elements, live regions
2. **Keyboard Navigation (4h):** Focus indicators, tab order logic
3. **Screen Reader Testing (4h):** Test with NVDA, JAWS, VoiceOver

**Success Criteria:**
- Lighthouse accessibility score: 95+
- WCAG 2.1 AA compliance

---

### 15.4 Progressive Web App (PWA) Support
**Effort:** 10 hours

**Tasks:**
- Create `manifest.json` with app metadata and icons
- Create service worker for offline caching
- Register service worker in index.html
- Add viewport meta tags

**Benefits:**
- Install on home screen (mobile/desktop)
- Offline gameplay (standalone mode)
- Push notifications for turn changes

---

### 15.5 Documentation Improvements
**Effort:** 8 hours

**Create:**
- `ARCHITECTURE.md` - High-level system design
- `FRONTEND_MODULES.md` - Frontend code organization
- `TESTING_GUIDE.md` - How to write tests
- `CONTRIBUTING.md` - How to contribute

---

### 15.6 Known Issues Resolution
**Effort:** 19 hours

| Issue | Effort | Description |
|-------|--------|-------------|
| Rate limiter event naming | 2h | Silent failures in validation |
| JWT validation | 3h | Missing algorithm specification |
| memoryStorage O(n²) | 4h | Key checking complexity |
| Transaction error handling | 3h | Proper error propagation |
| Timer lock Redis check | 3h | Add health check before lock |
| Socket error handling | 4h | Comprehensive error handling |

---

### Sprint 15 Summary

| Milestone | Effort | Impact |
|-----------|--------|--------|
| E2E Testing Framework | 12h | Full user flow coverage |
| State Management | 20h | Easier maintenance |
| Accessibility | 12h | WCAG 2.1 AA compliance |
| PWA Support | 10h | Mobile install & offline |
| Documentation | 8h | Developer onboarding |
| Issue Resolution | 19h | Code quality |
| **Total** | **81h** | |

---

## Backlog (Post-Sprint 15)

These features have value but should wait:

| Feature | Priority | Estimate | Notes |
|---------|----------|----------|-------|
| Game Replay/Viewer | MEDIUM | 16h | Nice-to-have |
| Multi-language Support | MEDIUM | 12h | International expansion |
| Spectator Delay Mode | LOW | 8h | Edge case |
| Tournament Mode | LOW | 30h+ | Requires design phase |
| AI Spymaster | LOW | 40h+ | ML integration required |
| Voice Chat | VERY LOW | 50h+ | Use external services |
| Mobile Native App | VERY LOW | 80h+ | Consider React Native later |

---

## Risk Assessment

### Sprint 13 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Password complexity | Low | Medium | Use bcryptjs (tested library) |
| Sound API compatibility | Low | Low | Provide fallback/mute option |
| History DB migration | Medium | Medium | Test migrations on staging |
| Mobile responsive CSS | Medium | Medium | Test on real devices early |

### Sprint 14 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| Regression from refactoring | Medium | High | Comprehensive test suite |
| Performance not improving | Low | Low | Profile before/after |

### Sprint 15 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|-----------|
| E2E tests flaky | Medium | Medium | Reliable test selectors |
| State refactoring breaks features | Medium | High | Feature parity tests |

---

## Success Metrics

### After Sprint 13
- [ ] 4 features deployed and tested
- [ ] Mobile Lighthouse score: 85+
- [ ] Zero critical bugs in production

### After Sprint 14
- [ ] Card reveal speed improves by 5-10ms
- [ ] Word list query speed improves 40%
- [ ] Code coverage remains 80%+

### After Sprint 15
- [ ] 15+ E2E tests passing
- [ ] Lighthouse accessibility score: 95+
- [ ] WCAG 2.1 AA compliance verified
- [ ] 6 medium-priority issues resolved

---

## Resource Requirements

| Sprint | Backend | Frontend | QA |
|--------|---------|----------|-----|
| 13 | 0.5 | 1.0 | 0.5 |
| 14 | 0.5 | 0.5 | 0.5 |
| 15 | 0.5 | 1.0 | 1.0 |

**Total:** ~7.5 person-weeks

---

## Appendix: File Reference

### Most-Modified Files by Sprint

**Sprint 13:**
- `index.html` (all features)
- `server/src/services/roomService.js`
- `server/src/socket/handlers/roomHandlers.js`
- `server/src/validators/schemas.js`
- `server/prisma/schema.prisma`

**Sprint 14:**
- `server/src/services/playerService.js`
- `server/src/services/timerService.js`
- `server/src/services/gameService.js`
- `server/src/services/wordListService.js`
- `server/src/utils/memoryStorage.js`
- `index.html`

**Sprint 15:**
- `index.html` (major refactor)
- `playwright.config.js` (new)
- `server/src/__tests__/e2e/*` (new)
- `manifest.json` (new)
- `service-worker.js` (new)
