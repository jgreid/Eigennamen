# Unified Development Document - Die Eigennamen (Codenames Online)

**Last Updated:** January 22, 2026
**Version:** 2.2.0
**Review Status:** Comprehensive synthesis of all code review and development planning documents

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Project Overview](#project-overview)
3. [Current State Assessment](#current-state-assessment)
4. [Consolidated Issue Tracker](#consolidated-issue-tracker)
5. [Test Coverage Analysis](#test-coverage-analysis)
6. [Security Posture](#security-posture)
7. [Architecture Review](#architecture-review)
8. [Prioritized Roadmap](#prioritized-roadmap)
9. [Remaining Work](#remaining-work)
10. [Appendices](#appendices)

---

## Executive Summary

This document consolidates findings from **8 separate review/planning documents** into a single source of truth for the Die Eigennamen (Codenames Online) project.

### Key Metrics (Verified January 22, 2026)

| Metric | Value | Target | Status |
|--------|-------|--------|--------|
| Test Coverage (Lines) | 79.59% | 70%+ | **Exceeded** |
| Test Coverage (Branches) | 71.69% | 70%+ | **Exceeded** |
| Test Count | 1,363 | 800+ | **Exceeded** |
| Critical Issues | 0 remaining | 0 | **Complete** |
| High Priority Issues | 5 remaining | 0 | In Progress |
| Overall Code Quality | B+ | A- | Good |

### Documents Consolidated

| Document | Focus | Issues Found |
|----------|-------|--------------|
| CODE_REVIEW_FINDINGS.md | Comprehensive review (74 issues) | 65 fixed, 5 partial, 4 documented |
| CODEBASE_REVIEW_2026.md | 2026 review update | 18 bugs, 12 optimizations, 15 features |
| DEVELOPMENT_PLAN.md | Sprint-based roadmap | Sprints 7-18 defined |
| NUANCED_DEVELOPMENT_PLAN.md | Deep code analysis | Corrected assumptions, actual gaps |
| ROBUSTNESS_DEVELOPMENT_PLAN.md | Reliability focus | Phases 1-5 defined |
| UI_PERFORMANCE_REVIEW.md | Frontend performance | 11 issues, all fixed |
| DEVELOPMENT_ROADMAP.md | Strategic roadmap | Priority 1-4 features |
| CODE_REVIEW.md | Initial review | 10 issues, all addressed |

---

## Project Overview

### Technology Stack

| Component | Technology | Version |
|-----------|------------|---------|
| Frontend | Vanilla HTML/CSS/JavaScript | SPA (3,800+ lines) |
| Backend | Node.js + Express | 18+ / 4.18 |
| Real-time | Socket.io | 4.7 |
| Database | PostgreSQL (optional) | 15+ via Prisma |
| Cache | Redis (optional) | 7+ |
| Validation | Zod | 3.22 |
| Testing | Jest + Supertest | 29.7 |

### Codebase Statistics

| Category | Lines | Files |
|----------|-------|-------|
| **Total JavaScript** | ~35,000 | 50+ |
| Server Production Code | ~28,400 | 40+ |
| Test Code | ~13,200 | 37 files |
| Frontend | 3,800 | 1 (SPA) |
| Documentation | ~15,000 | 10+ files |

### Key Features

**Implemented:**
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

---

## Current State Assessment

### Strengths

1. **Excellent Test Coverage** (79.59% lines, 1,363 tests)
   - Services: 94.62% coverage
   - Validators: 100% coverage
   - Error handling: 97.87% coverage

2. **Solid Architecture**
   - Clean separation: services → handlers → validators
   - Graceful degradation: works without Redis/PostgreSQL
   - Multi-instance support with Redis pub/sub

3. **Security-First Design**
   - Dual-layer rate limiting (per-socket + per-IP)
   - Comprehensive input validation (Zod schemas)
   - XSS prevention, CSRF protection, Helmet.js headers

4. **Production-Ready Infrastructure**
   - Correlation IDs for request tracing
   - Structured logging with Winston
   - Metrics collection with histogram support
   - Distributed locks for race condition prevention

### Areas for Improvement

| Area | Current | Target | Priority |
|------|---------|--------|----------|
| Socket/index.js coverage | 60.4% | 80% | Medium |
| Audit.js coverage | 26.31% | 80% | Medium |
| CSRF middleware coverage | 34.09% | 70% | Low |
| E2E testing | 0% | Full flows | Medium |
| Frontend unit tests | 0% | 50%+ | Low |

---

## Consolidated Issue Tracker

### Issue Categories

Total issues tracked across all documents: **~100**

| Status | Count | Percentage |
|--------|-------|------------|
| **Implemented** | 78 | 78% |
| **Partial/In Progress** | 8 | 8% |
| **Documented as Acceptable** | 6 | 6% |
| **Remaining Work** | 8 | 8% |

### Critical Issues - ALL RESOLVED

| ID | Description | Source | Resolution |
|----|-------------|--------|------------|
| #28 | Game start overwrites existing | CODE_REVIEW_FINDINGS | Fixed - gameHandlers.js:47-50 |
| #29 | XSS in nicknames | CODE_REVIEW_FINDINGS | Fixed - schemas.js nicknameRegex |
| #30 | Pause timer multi-instance | CODE_REVIEW_FINDINGS | Fixed - pub/sub event for pause |
| #31 | setRole without team | CODE_REVIEW_FINDINGS | Fixed - requires team before role |
| #48 | Multi-tab session conflict | CODE_REVIEW_FINDINGS | Fixed - sessionStorage per-tab |
| #49 | Spymaster view not restored | CODE_REVIEW_FINDINGS | Fixed - sends on join |
| #50 | No event recovery | CODE_REVIEW_FINDINGS | Fixed - room:resync handler |

### High Priority Issues - 5 REMAINING

| ID | Description | Source | Status |
|----|-------------|--------|--------|
| BUG-1 | Chat emit loop lacks error handling | CODEBASE_REVIEW_2026 | Already fixed in chatHandlers.js:59-64 |
| BUG-4 | Timer addTime() missing local timeout | CODEBASE_REVIEW_2026 | Already fixed in timerService.js:493-509 |
| BUG-5 | Game over timer race condition | CODEBASE_REVIEW_2026 | Already fixed in gameHandlers.js:191-192 |
| NEW-1 | Wrong rate limiter bucket for room:reconnect | This review | **TODO** |
| NEW-2 | Race condition in addTime return value | This review | **TODO** |

### Medium Priority Issues - 12 REMAINING

| ID | Description | Source | Status |
|----|-------------|--------|--------|
| #36 | Full JSON on every reveal | CODE_REVIEW_FINDINGS | Fixed - Lua script OPTIMIZED_REVEAL_SCRIPT |
| #37 | Rate limiter array allocation | CODE_REVIEW_FINDINGS | Fixed - filterTimestampsInPlace |
| #42 | Deprecated function exported | CODE_REVIEW_FINDINGS | Partial - comment added |
| #43 | Hardcoded retry count | CODE_REVIEW_FINDINGS | Partial - RETRY_CONFIG exists |
| #47 | Missing integration tests | CODE_REVIEW_FINDINGS | Partial - some added |
| #62 | Missing ARIA labels | CODE_REVIEW_FINDINGS | Partial - some added |
| #69 | Missing structured logging | CODE_REVIEW_FINDINGS | Partial - mix exists |
| NEW-3 | Dead code - unused pendingAddTimeCallbacks | This review | **TODO** |
| NEW-4 | Incomplete addTime multi-instance flow | This review | **TODO** |
| OPT-1 | Board click expensive array search | CODEBASE_REVIEW_2026 | Low priority |
| OPT-5 | Duplicate screen reader functions | CODEBASE_REVIEW_2026 | Low priority |
| OPT-7 | Duplicate player creation functions | CODEBASE_REVIEW_2026 | Low priority |

### Low Priority / Documented as Acceptable

| ID | Description | Reason |
|----|-------------|--------|
| #12 | Duplicate default word list | Acceptable for standalone mode |
| #19 | Team chat leak on team change | Extremely unlikely edge case |
| #21 | Game state sent to disconnected | Wastes resources but harmless |
| #26 | Memory storage cleanup leak | Minor, shutdown handles correctly |
| #27 | Room info exposes player count | Not significant security issue |
| #73 | CSP allows unsafe-inline | Necessary for SPA architecture |

---

## Test Coverage Analysis

### Coverage Summary (January 22, 2026)

```
-----------------------|---------|----------|---------|---------|
File                   | % Stmts | % Branch | % Funcs | % Lines |
-----------------------|---------|----------|---------|---------|
All files              |   79.31 |    71.69 |   71.52 |   79.59 |
-----------------------|---------|----------|---------|---------|
```

### Detailed Coverage by Module

| Module | Statements | Branches | Functions | Lines | Status |
|--------|------------|----------|-----------|-------|--------|
| **services/** | 94.62% | 88.70% | 96.80% | 94.69% | Excellent |
| **validators/** | 100% | 100% | 100% | 100% | Perfect |
| **errors/** | 97.87% | 66.66% | 96.87% | 97.87% | Excellent |
| **utils/** | 88.26% | 78.68% | 81.89% | 87.60% | Good |
| **handlers/** | 87.87% | 69.27% | 92.59% | 87.81% | Good |
| **middleware/** | 81.95% | 78.06% | 70.58% | 81.87% | Good |
| **routes/** | 67.39% | 62.50% | 66.66% | 67.03% | Moderate |
| **config/** | 63.84% | 60.00% | 61.17% | 64.94% | Moderate |
| **socket/** | 57.62% | 46.15% | 56.00% | 58.28% | Needs Work |

### Files Needing Attention

| File | Coverage | Reason | Priority |
|------|----------|--------|----------|
| audit.js | 26.31% | Functions defined but underutilized | Medium |
| csrf.js | 34.09% | Security middleware paths | Medium |
| rateLimitHandler.js | 42.85% | Rate limit edge cases | Medium |
| database.js | 12.76% | Optional feature, graceful degradation | Low |
| socketTestHelper.js | 0% | Test helper, not production code | N/A |

---

## Security Posture

### Implemented Security Measures

| Category | Implementation | Status |
|----------|----------------|--------|
| **Input Validation** | Zod schemas for all inputs | Complete |
| **XSS Prevention** | HTML sanitization, escaping | Complete |
| **CSRF Protection** | X-Requested-With header, same-origin | Complete |
| **Rate Limiting** | Dual-layer: per-socket + per-IP | Complete |
| **Session Security** | Token-based reconnection, IP validation | Complete |
| **Password Hashing** | bcrypt with 10 rounds | Complete |
| **Security Headers** | Helmet.js middleware | Complete |
| **TLS Enforcement** | Forced in production | Complete |
| **Non-root Docker** | Container runs as UID 1001 | Complete |

### Security Review Results

| Check | Result | Notes |
|-------|--------|-------|
| SQL Injection | PASS | Prisma ORM with parameterized queries |
| XSS | PASS | Input sanitization and output encoding |
| CSRF | PASS | Same-origin validation, header checks |
| Session Hijacking | PASS | IP consistency checks, rate limiting |
| Brute Force | PASS | Rate limiting on authentication |
| Information Leakage | PASS | Error messages sanitized in production |

### Known Security Trade-offs

1. **CSP allows `unsafe-inline`** - Required for SPA architecture, mitigated by other controls
2. **X-Forwarded-For trust** - Configured correctly for known proxy environments
3. **Anonymous word lists** - Marked as immutable to prevent abuse

---

## Architecture Review

### Service Layer (Excellent)

```
Services (94.62% coverage)
├── gameService.js (98.81%)    - Core game logic, PRNG, card reveal
├── roomService.js (87.42%)    - Room lifecycle, passwords
├── playerService.js (91.16%)  - Player/team management
├── timerService.js (94.75%)   - Distributed timers, pub/sub
├── eventLogService.js (97.89%) - Event recovery for reconnection
└── wordListService.js (97.34%) - Custom word list CRUD
```

### Handler Layer (Good)

```
Handlers (87.87% coverage)
├── gameHandlers.js (88.46%)   - game:start, reveal, clue
├── roomHandlers.js (87.67%)   - room:join, leave, settings
├── playerHandlers.js (81.35%) - team/role changes
└── chatHandlers.js (100%)     - Team chat messaging
```

### Middleware Layer (Good)

```
Middleware (81.95% coverage)
├── socketAuth.js (96.39%)     - WebSocket authentication
├── validation.js (96.42%)     - Zod validation wrapper
├── errorHandler.js (100%)     - Global error handling
├── rateLimit.js (81.20%)      - Rate limiting
└── csrf.js (34.09%)           - CSRF protection
```

### Data Flow

```
Client Event
    │
    ▼
┌─────────────────┐
│ Socket Handler  │ ◄── Input Validation (Zod)
│  + Rate Limiter │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Service      │ ◄── Business Logic
│    Layer        │ ◄── Redis/PostgreSQL
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Event Broadcast │ ◄── room:*, player:*
│  to Clients     │
└─────────────────┘
```

---

## Prioritized Roadmap

### Phase 1: Immediate Fixes (1-2 days)

**Focus:** Address new issues found in this review

| Task | Priority | Effort | Impact |
|------|----------|--------|--------|
| Fix room:reconnect rate limiter bucket | HIGH | 15 min | Functional bug |
| Fix addTime race condition return value | HIGH | 2 hours | Multi-instance reliability |
| Remove/fix dead pendingAddTimeCallbacks code | MEDIUM | 1 hour | Code quality |
| Improve audit.js coverage | MEDIUM | 3 hours | Observability |

### Phase 2: Quality Improvements (1 week)

**Focus:** Increase coverage in weak areas

| Task | Target | Current | Gap |
|------|--------|---------|-----|
| socket/index.js tests | 80% | 60% | +20% |
| csrf.js tests | 70% | 34% | +36% |
| rateLimitHandler.js tests | 70% | 43% | +27% |
| E2E test framework setup | Playwright | 0 | New |

### Phase 3: Feature Enhancements (2-4 weeks)

**Focus:** High-value feature additions

| Feature | Priority | Effort | Value |
|---------|----------|--------|-------|
| Game history/replay | MEDIUM | 12 hours | User engagement |
| Mobile responsive fixes | MEDIUM | 8 hours | UX improvement |
| Multi-language word lists | LOW | 6 hours | International users |
| Sound notifications | LOW | 4 hours | User engagement |

### Phase 4: Future Work (Backlog)

| Feature | Status | Notes |
|---------|--------|-------|
| Tournament mode | Proposed | Requires significant infrastructure |
| AI Spymaster | Proposed | ML integration required |
| Mobile app | Proposed | React Native or Flutter |
| Admin dashboard | Proposed | Separate application |

---

## Remaining Work

### Immediate Action Items

```
Priority 1 (Fix Now):
├── [ ] Fix room:reconnect rate limiter bucket (roomHandlers.js:349)
├── [ ] Fix addTime race condition (timerService.js:556)
└── [ ] Clean up dead pendingAddTimeCallbacks code

Priority 2 (This Sprint):
├── [ ] Add socket/index.js integration tests
├── [ ] Add csrf.js unit tests
├── [ ] Wire up audit logging calls in handlers
└── [ ] Document remaining partial issues

Priority 3 (Next Sprint):
├── [ ] Set up Playwright E2E framework
├── [ ] Add E2E tests for critical paths
├── [ ] Performance profiling and optimization
└── [ ] Accessibility audit (ARIA labels)
```

### Technical Debt Summary

| Category | Items | Priority |
|----------|-------|----------|
| Duplicate code | 3 functions | LOW |
| Deprecated functions | 1 function | LOW |
| Magic numbers | Mostly migrated | LOW |
| Inconsistent error handling | Some services use plain objects | LOW |

---

## Appendices

### A. File Change Log

Key files modified during review cycles:

| File | Changes | Impact |
|------|---------|--------|
| gameService.js | PRNG improvement, function decomposition | Core logic |
| timerService.js | Redis backing, pub/sub, orphan recovery | Multi-instance |
| roomService.js | Atomic joins via Lua, password versioning | Race conditions |
| playerService.js | Team sets, reconnection tokens | Performance, security |
| index.html | UI performance, event delegation, RAF batching | Frontend |

### B. Testing Commands

```bash
# Run all tests
cd server && npm test

# Run with coverage
npm run test:coverage

# Run specific test file
npm test -- gameService.test.js

# Run lint
npm run lint
```

### C. Deployment Commands

```bash
# Local development
cd server && npm run dev

# Docker development
docker compose up -d --build

# Production (Fly.io)
fly deploy
```

### D. Source Documents

This unified document synthesizes the following sources:

1. `CODE_REVIEW_FINDINGS.md` - Primary issue tracker (74 issues)
2. `CODEBASE_REVIEW_2026.md` - January 2026 review
3. `DEVELOPMENT_PLAN.md` - Sprint planning (Sprints 7-18)
4. `NUANCED_DEVELOPMENT_PLAN.md` - Deep analysis corrections
5. `ROBUSTNESS_DEVELOPMENT_PLAN.md` - Reliability improvements
6. `UI_PERFORMANCE_REVIEW.md` - Frontend performance
7. `DEVELOPMENT_ROADMAP.md` - Strategic roadmap
8. `CODE_REVIEW.md` - Initial code review

---

## Conclusion

The Die Eigennamen (Codenames Online) codebase is in **excellent shape**:

- **79.59% test coverage** with 1,363 passing tests
- **All critical issues resolved**
- **Production-ready** for both single and multi-instance deployments
- **Security-first architecture** with comprehensive protections
- **Good documentation** with clear development roadmap

### Remaining Focus Areas:

1. **Fix 5 remaining high-priority issues** (mostly timer-related)
2. **Improve coverage** in socket/index.js and security middleware
3. **Add E2E testing** for critical user flows
4. **Wire up audit logging** (functions exist but underutilized)

The codebase demonstrates mature engineering practices with clean separation of concerns, comprehensive testing, and thoughtful security measures.

---

*This document supersedes individual review documents for current state reference. Individual documents retained for historical context and detailed issue tracking.*
