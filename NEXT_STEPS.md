# Next Steps Proposal - Codenames Online

**Created:** January 25, 2026
**Based on:** Comprehensive codebase review and existing roadmap analysis

---

## Executive Summary

The Codenames Online project is in **excellent health** with production-ready code quality (A-grade), 90%+ test coverage, and comprehensive documentation. This proposal outlines prioritized next steps to continue momentum while addressing remaining gaps.

### Current Status at a Glance

| Metric | Value |
|--------|-------|
| Test Coverage | 90%+ (statements/lines/functions) |
| Total Tests | 2,372 passing |
| Critical Issues | 0 remaining |
| Sprint Progress | 13-14 complete, 15 partially complete |
| Code Quality | Production-ready |

---

## Recommended Next Steps

### Phase 1: Complete Sprint 15 (Immediate)

**Remaining Sprint 15 Work:**

| Task | Effort | Priority | Impact |
|------|--------|----------|--------|
| Rate limiter event naming consistency | 2h | Medium | Code quality |
| JWT validation improvements | 3h | Medium | Security |
| Timer lock Redis verification | 3h | Medium | Reliability |
| Socket error handling hardening | 4h | Medium | Reliability |
| **Subtotal** | **12h** | | |

**Recommendation:** Complete these remaining reliability/security items before moving to new features. All are low-risk, high-value improvements.

---

### Phase 2: Frontend Consolidation (High Priority)

**Problem:** The project has two frontend implementations:
1. `index.html` - Monolithic 5,200-line SPA (currently used)
2. `src/js/` - Modular ES6 modules (~2,600 lines, partially implemented)

**Impact:** Maintaining both creates technical debt and confusion.

**Recommendation:** Make a strategic decision:

**Option A: Consolidate into Modular Frontend** (Recommended)
- Effort: 30-40 hours
- Benefits: Better maintainability, easier testing, modern patterns
- Tasks:
  1. Complete migration of remaining `index.html` logic to modules
  2. Add build tooling (Vite/esbuild) for bundling
  3. Implement frontend unit tests for modules
  4. Remove monolithic `index.html` once parity achieved

**Option B: Keep Monolithic Frontend**
- Effort: 8 hours (cleanup only)
- Benefits: Simpler, works now
- Tasks:
  1. Remove unused `src/js/` modules
  2. Document decision in ADR
  3. Accept maintenance burden

---

### Phase 3: State Management Refactoring

**Problem:** The `index.html` file contains 20+ global variables managing game state, making it difficult to test and maintain.

**Recommended Approach:**

```javascript
// Phase 1: Create state container (8 hours)
class GameState {
    constructor() {
        this.state = {
            roomCode: null,
            gamePhase: 'waiting',
            players: {},
            board: [],
            currentTeam: null,
            currentClue: null
        };
        this.listeners = new Set();
    }

    update(partial) {
        this.state = { ...this.state, ...partial };
        this.notify();
    }

    subscribe(listener) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

// Phase 2: Migrate global variables (12 hours)
// - Replace direct variable access with state.get()
// - Replace assignments with state.update()
// - Add state change logging for debugging
```

**Benefits:**
- Enables frontend unit testing
- Clearer data flow
- Easier debugging with state snapshots
- Foundation for potential framework adoption later

---

### Phase 4: Frontend Unit Testing

**Current State:** 0% frontend unit test coverage

**Recommended Framework:** Vitest (fast, modern, ESM-native)

**Target Areas:**

| Module | Priority | Complexity |
|--------|----------|------------|
| Game state logic | High | Low |
| Board generation (PRNG) | High | Medium |
| Team/role management | High | Low |
| Timer display logic | Medium | Low |
| Modal state management | Medium | Low |
| URL state encoding | High | Medium |

**Effort:** 16-20 hours for initial setup + core tests

**Target Coverage:** 70% for frontend modules

---

### Phase 5: Documentation Updates

**Missing Documentation:**

| Document | Purpose | Effort |
|----------|---------|--------|
| `ARCHITECTURE.md` | High-level system design diagram | 4h |
| `CONTRIBUTING.md` | Contributor guidelines | 2h |
| `TESTING_GUIDE.md` | How to write and run tests | 2h |
| `FRONTEND_MODULES.md` | Frontend code organization | 2h |

**Recommendation:** Create these as part of onboarding new contributors.

---

### Phase 6: Medium-Priority Security Items

| Item | Effort | Description |
|------|--------|-------------|
| Session rotation on reconnect | 3h | Issue new token after successful reconnect |
| Inactivity timeout | 4h | Disconnect idle sessions after 30 minutes |
| CSP refinement | 3h | Tighten Content-Security-Policy headers |
| SRI for CDN assets | 2h | Add integrity hashes for external scripts |

---

## Future Features Backlog (Post-Phase 6)

Prioritized by value and feasibility:

### Tier 1: High Value, Feasible
| Feature | Effort | Notes |
|---------|--------|-------|
| Color blind mode | 8h | Alternative color schemes for cards |
| Game replay improvements | 12h | Shareable replay links |
| Multi-language support | 20h | Start with German, Spanish |

### Tier 2: Medium Value, Medium Effort
| Feature | Effort | Notes |
|---------|--------|-------|
| Custom game modes | 24h | Duet mode, blitz mode |
| Player profiles | 30h | Optional persistent identity |
| Room invites | 16h | Direct player invitations |

### Tier 3: Ambitious Projects
| Feature | Effort | Notes |
|---------|--------|-------|
| Tournament mode | 40h+ | Bracket management, auto-progression |
| AI Spymaster | 50h+ | Word embedding model integration |
| Mobile native app | 80h+ | React Native implementation |
| Voice chat | 50h+ | WebRTC integration |

---

## Proposed Sprint 16 Plan

**Focus:** Frontend quality and consolidation

| Task | Effort | Priority |
|------|--------|----------|
| Complete Sprint 15 remaining items | 12h | P1 |
| Decide frontend consolidation strategy | 2h | P1 |
| Implement state management container | 8h | P1 |
| Set up frontend unit testing (Vitest) | 8h | P1 |
| Write core frontend unit tests | 12h | P2 |
| Session rotation implementation | 3h | P2 |
| **Total** | **45h** | |

---

## Proposed Sprint 17 Plan

**Focus:** Frontend completion and documentation

| Task | Effort | Priority |
|------|--------|----------|
| Complete frontend module migration | 20h | P1 |
| Create ARCHITECTURE.md | 4h | P2 |
| Create CONTRIBUTING.md | 2h | P2 |
| Inactivity timeout implementation | 4h | P2 |
| Color blind mode | 8h | P3 |
| **Total** | **38h** | |

---

## Success Criteria

### After Sprint 16
- [ ] All Sprint 15 items completed
- [ ] Frontend unit test framework operational
- [ ] 50%+ frontend test coverage
- [ ] State management container implemented
- [ ] Frontend consolidation decision documented

### After Sprint 17
- [ ] 70%+ frontend test coverage
- [ ] Single canonical frontend implementation
- [ ] Core documentation complete
- [ ] Session security improvements deployed
- [ ] Color blind mode available

---

## Risk Assessment

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Frontend refactoring breaks features | Medium | High | Comprehensive E2E tests already exist |
| State migration introduces bugs | Medium | Medium | Incremental migration with feature flags |
| Scope creep on "quick" items | High | Medium | Strict time-boxing, defer enhancements |

---

## Conclusion

The project is mature and well-engineered. The recommended focus is:

1. **Immediate:** Complete Sprint 15 reliability items
2. **Short-term:** Consolidate frontend and add unit tests
3. **Medium-term:** Documentation and security hardening
4. **Long-term:** Feature expansion (i18n, custom modes, tournament)

The codebase is ready for production deployment now. These improvements will enhance maintainability and enable faster feature development in the future.

---

*This proposal should be reviewed and prioritized based on team capacity and business needs.*
