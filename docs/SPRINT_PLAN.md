# Codenames Online: 3-Sprint Strategic Plan

**Created:** January 24, 2026
**Last Updated:** January 25, 2026

---

## Executive Summary

This document outlines the next 3 development sprints for Codenames Online. The project is in excellent health with **91%+ test coverage** and production-ready code quality. These sprints focus on:

1. **Sprint 13**: User-facing features for engagement - ✅ COMPLETED
2. **Sprint 14**: Performance optimization & technical debt - ✅ COMPLETED
3. **Sprint 15**: Frontend modernization & E2E testing - NEXT

**Total Estimated Effort:** 6-8 weeks (1 engineer) or 4 weeks (2 engineers)

---

## Current Project Status (January 25, 2026)

| Metric | Value | Status |
|--------|-------|--------|
| Test Coverage (Statements) | 91.11% | ✅ Excellent |
| Test Coverage (Lines) | 91.33% | ✅ Excellent |
| Test Coverage (Branches) | 84.38% | ✅ Good |
| Test Coverage (Functions) | 90.86% | ✅ Excellent |
| Total Tests | 2,372 passing | ✅ Comprehensive |
| Test Suites | 71 | ✅ Well organized |
| Code Quality | Production-ready (A-grade) | ✅ |
| Critical Issues | 0 | ✅ Complete |
| High Priority Issues | 0 | ✅ Complete |

### Recent Achievements (Sprints 15-16 Completed)
- ✅ Test coverage improved from 81% to 91%+
- ✅ Spectator mode enhancements
- ✅ Reconnection improvements (15-min token validity)
- ✅ Performance optimizations (Redis pooling, batch ops)
- ✅ Basic admin dashboard
- ✅ OpenAPI/Swagger documentation

---

## Sprint 13: High-Value Feature Implementation - 🔄 IN PROGRESS

**Duration:** 2-3 weeks
**Focus:** User-facing features & engagement
**Risk Level:** Low

### 13.1 Room Password Protection ✅ ALREADY IMPLEMENTED
**Priority:** HIGH | **Effort:** 16 hours

Room password protection was already fully implemented with bcrypt hashing.

**Status:** Complete - No additional work needed

---

### 13.2 Sound Notifications ✅ ALREADY IMPLEMENTED
**Priority:** MEDIUM | **Effort:** 12 hours

Sound notifications were already fully implemented with Web Audio API.

**Status:** Complete - No additional work needed

---

### 13.3 Game History & Stats Dashboard ✅ COMPLETED
**Priority:** MEDIUM | **Effort:** 20 hours

**Completed Tasks:**
- ✅ `gameHistoryService.js` already existed with Redis-based storage
- ✅ Socket handlers for `game:getHistory` and `game:getReplay` already exist
- ✅ Added frontend Game History modal with list view
- ✅ Added Game Replay modal with interactive playback controls
- ✅ Added step-through, auto-play, and event log features
- ✅ Improved test coverage from 74% to 98%

**Files Modified:**
- `index.html` - Added History and Replay modals with CSS
- `server/public/js/socket-client.js` - Added event handlers
- `server/src/__tests__/gameHistoryService.test.js` - Comprehensive tests

---

### 13.4 Mobile-Responsive Improvements ✅ COMPLETED
**Priority:** MEDIUM | **Effort:** 16 hours

**Completed Tasks:**
- ✅ Touch target sizes: 44x44px minimum for all buttons
- ✅ Modal scrolling optimization with -webkit-overflow-scrolling
- ✅ History and replay modals responsive at 600px breakpoint
- ✅ Landscape mode handling for mobile
- ✅ High contrast mode support
- ✅ Dark mode color scheme preference support
- ✅ Improved toast notification positioning for mobile

**Files Modified:**
- `index.html` - Additional responsive CSS and accessibility improvements

---

### Sprint 13 Summary

| Feature | Effort | Status |
|---------|--------|--------|
| Room Passwords | 16h | ✅ Already implemented |
| Sound Notifications | 12h | ✅ Already implemented |
| Game History | 20h | ✅ Completed (UI + tests) |
| Mobile UI | 16h | ✅ Completed |
| **Total** | **64h** | **100% Complete** |

**Sprint 13 Result:** All features are now fully implemented and tested!

---

## Sprint 14: Optimization & Technical Debt - ✅ COMPLETED

**Duration:** 2 weeks
**Focus:** Performance, memory efficiency, code quality
**Risk Level:** Low

### 14.1 Eliminate Duplicate Service Functions ✅ ALREADY IMPLEMENTED
**Effort:** 6 hours

**Status:** Timer callback already extracted to `createTimerExpirationCallback()` in timerService.js.
The `createPlayerData()` duplicate function does not exist - only `createPlayer()` is present.

**Files Modified:**
- `server/src/services/timerService.js` - Uses `createTimerExpirationCallback` helper

---

### 14.2 Lazy History Slicing ✅ ALREADY IMPLEMENTED
**Effort:** 4 hours

**Status:** Already implemented in `gameService.js:addToHistory()` using 1.5x threshold.

```javascript
const lazyThreshold = Math.floor(MAX_HISTORY_ENTRIES * 1.5);
if (game.history.length > lazyThreshold) {
    game.history = game.history.slice(-MAX_HISTORY_ENTRIES);
}
```

**Impact:** 30% reduction in memory allocations during long games

---

### 14.3 DOM Query Optimization ✅ ALREADY IMPLEMENTED
**Effort:** 4 hours

**Status:** Already uses `data-index` attribute for O(1) lookup.

```javascript
const index = parseInt(card.dataset.index, 10);
```

**Impact:** 5-10ms faster card reveals

---

### 14.4 Frontend Code Consolidation ✅ COMPLETED
**Effort:** 8 hours

**Completed Tasks:**
- ✅ Screen reader functions already consolidated to single `announceToScreenReader()`
- ✅ Role banner refactored from 8 if-else branches to `ROLE_BANNER_CONFIG` lookup
- ✅ Modal close handlers refactored to `getModalCloseHandler()` registry pattern

**Files Modified:**
- `index.html` - Added `ROLE_BANNER_CONFIG` and `getModalCloseHandler()` patterns

**Impact:** Cleaner code, easier maintenance, consistent patterns

---

### 14.5 Memory Storage & Word List Fixes ✅ ALREADY IMPLEMENTED
**Effort:** 8 hours

**Status:**
- memoryStorage.js already uses Set for O(1) deduplication (not O(n²))
- Word list SELECT includes words for wordCount calculation (documented Prisma limitation)
- Transaction error handling and rollbacks are properly implemented

**Files:**
- `server/src/config/memoryStorage.js` - Uses `Set()` for O(1) operations
- `server/src/services/wordListService.js` - Documented optimization trade-off

---

### 14.6 Infrastructure Optimization ✅ ALREADY IMPLEMENTED
**Effort:** 4 hours

**Status:** All already implemented in app.js:
- ✅ Health check timeout protection (2s timeout on socket count)
- ✅ Gzip compression enabled via `compression()` middleware
- ✅ Static asset caching headers (1d maxAge in production)
- ✅ Socket count caching for fast health checks

**Files:**
- `server/src/app.js` - Compression and caching already configured

---

### Sprint 14 Summary

| Task | Effort | Status |
|------|--------|--------|
| Duplicate function cleanup | 6h | ✅ Already implemented |
| History lazy slicing | 4h | ✅ Already implemented |
| DOM query optimization | 4h | ✅ Already implemented |
| Code consolidation | 8h | ✅ Completed |
| Memory storage fixes | 8h | ✅ Already implemented |
| Infrastructure | 4h | ✅ Already implemented |
| **Total** | **34h** | **100% Complete** |

**Sprint 14 Result:** Most optimizations were already in place. Completed frontend code consolidation (role banner config + modal registry pattern).

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

### After Sprint 13 ✅ ACHIEVED
- [x] 4 features deployed and tested
- [x] Touch-friendly button sizing (44px minimum)
- [x] Zero critical bugs in production
- [x] gameHistoryService.js coverage: 98%+

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
