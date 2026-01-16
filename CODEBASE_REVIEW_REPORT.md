# Codebase Review Report: Risley-Codenames

**Review Date:** January 16, 2026
**Project:** Codenames Online - Web-based multiplayer game
**Reviewer:** Claude (Automated Code Review)

---

## Executive Summary

This report presents a comprehensive review of the Risley-Codenames codebase, a web-based implementation of the Codenames board game with both standalone (URL-based) and real-time multiplayer server capabilities.

### Overall Assessment

| Category | Status | Severity |
|----------|--------|----------|
| Security | Needs Attention | CRITICAL |
| Code Quality | Good with Issues | MEDIUM |
| Performance | Good with Issues | MEDIUM |
| Testing | Significant Gaps | HIGH |
| Documentation | Good | LOW |

### Key Findings Summary

- **5 Critical Security Issues** requiring immediate attention
- **8 High-Priority Issues** that should be addressed soon
- **15+ Medium/Low Issues** for ongoing improvement
- **~12% Test Coverage** vs. 70% target threshold
- Well-structured architecture with modern Node.js patterns

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Security Issues](#2-security-issues)
3. [Code Quality Issues](#3-code-quality-issues)
4. [Performance Issues](#4-performance-issues)
5. [Testing Gaps](#5-testing-gaps)
6. [Action Plan](#6-action-plan)
7. [Recommendations Summary](#7-recommendations-summary)

---

## 1. Architecture Overview

### Project Structure

```
Risley-Codenames/
├── index.html              # Standalone client (1,456 lines)
├── wordlist.txt            # Sample custom word lists
├── server/                 # Real-time multiplayer backend
│   ├── src/
│   │   ├── index.js        # Server entry point
│   │   ├── app.js          # Express configuration
│   │   ├── config/         # Environment, Redis, database
│   │   ├── routes/         # REST API endpoints
│   │   ├── services/       # Business logic (~2,000 LOC)
│   │   ├── socket/         # WebSocket handlers
│   │   ├── middleware/     # Auth, validation, rate limiting
│   │   ├── validators/     # Zod schemas
│   │   └── __tests__/      # Test suite
│   ├── prisma/             # Database schema
│   └── docker-compose.yml  # Container orchestration
└── docs/                   # Technical documentation
```

### Technology Stack

| Layer | Technology |
|-------|------------|
| Frontend | Vanilla JavaScript, HTML5, CSS3 |
| Backend | Node.js 18+, Express.js 4.18 |
| Real-time | Socket.io 4.7 with Redis adapter |
| Database | PostgreSQL 15 + Prisma ORM 5.6 |
| Cache | Redis 7+ |
| Validation | Zod 3.22 |
| Security | Helmet 7.1, bcryptjs, JWT |
| Testing | Jest 29.7, Supertest |

### Key Architectural Patterns

1. **Dual-mode Operation**: Works offline (URL-encoded state) or with server (real-time sync)
2. **Deterministic Shuffle**: Seeded PRNG enables reproducible game states
3. **Layered Architecture**: Clear separation (Routes → Services → Data)
4. **Redis-first State**: Fast ephemeral state; PostgreSQL for persistence

---

## 2. Security Issues

### 2.1 CRITICAL Issues

#### 2.1.1 Missing Authentication on Word List API Routes

**Files:**
- `server/src/routes/wordListRoutes.js` (lines 104-152)

**Issue:** Word list creation, update, and delete endpoints have no authentication. The `ownerId` is always set to `null`.

```javascript
// Line 113 - No authentication
ownerId: null
// Line 133 - Explicit TODO
null // No auth check for now
```

**Impact:** Any user can create, modify, or delete any word list.

**Fix:** Add JWT authentication middleware to these routes.

---

#### 2.1.2 Weak Authorization Bypass

**File:** `server/src/services/wordListService.js` (lines 196-198)

**Issue:** If `requesterId` is null, the authorization check is bypassed entirely.

```javascript
if (requesterId && existing.ownerId && existing.ownerId !== requesterId) {
    throw new ServiceError(ERROR_CODES.FORBIDDEN, ...);
}
```

**Impact:** Anonymous users can modify/delete any word list by bypassing client-side checks.

**Fix:** Require non-null requesterId for destructive operations.

---

#### 2.1.3 Hardcoded Credentials in Version Control

**Files:**
- `server/docker-compose.yml` (lines 12, 30)
- `server/.env.example` (line 12)

**Issue:** Database credentials and JWT secrets are hardcoded:

```yaml
DATABASE_URL=postgresql://codenames:password@db:5432/codenames
POSTGRES_PASSWORD=password
JWT_SECRET=${JWT_SECRET:-change-this-in-production}
```

**Impact:** Credentials exposed in repository; default secrets can be exploited.

**Fix:** Use Docker secrets or environment variables. Remove all hardcoded values.

---

#### 2.1.4 CORS Misconfiguration with Credentials

**Files:**
- `server/src/app.js` (lines 20-23)
- `server/src/socket/index.js` (lines 20-24)

**Issue:** CORS allows wildcard origin (`*`) with credentials enabled:

```javascript
cors({
    origin: process.env.CORS_ORIGIN || '*',
    credentials: true  // DANGEROUS with wildcard
})
```

**Impact:** Cross-origin attacks possible; session hijacking from malicious sites.

**Fix:** Set specific allowed origins or disable credentials for wildcard.

---

#### 2.1.5 Socket.io Events Not Rate Limited

**Files:**
- `server/src/socket/handlers/*.js` (all handlers)
- `server/src/middleware/rateLimit.js` (defined but not used)

**Issue:** `createSocketRateLimiter` is defined but never applied to socket handlers.

**Impact:** DoS attacks possible via rapid socket event spam (room creation, chat, reveals).

**Fix:** Apply rate limiter to all socket event handlers.

---

### 2.2 HIGH Priority Security Issues

| Issue | File | Line(s) | Description |
|-------|------|---------|-------------|
| Session hijacking incomplete | `socketAuth.js` | 28-37 | Allows session reuse when check fails |
| Host verification incomplete | `gameHandlers.js` | 28-30 | No room membership cross-check |
| Sensitive data in logs | `socketAuth.js` | 67 | Full session IDs logged |
| Player list broadcast | `roomHandlers.js` | 62 | All player data sent to all users |
| Word arrays in list responses | `wordListRoutes.js` | 71 | Full word lists exposed in pagination |

### 2.3 MEDIUM Priority Security Issues

| Issue | File | Description |
|-------|------|-------------|
| Chat message sanitization | `validators/schemas.js` | Only length validation, no sanitization |
| URL team name potential XSS | `index.html` (976-981) | Safe now but fragile if changed |
| Error messages in dev mode | `errorHandler.js` | Could leak stack traces |

---

## 3. Code Quality Issues

### 3.1 Code Duplication

| Location | Description | Impact |
|----------|-------------|--------|
| `index.html` (831-854) + `gameService.js` (23-52) | Seeded random/shuffle duplicated | MEDIUM - Changes need sync |
| Multiple files | `game.currentTurn === 'red' ? 'blue' : 'red'` pattern | LOW |
| `gameService.js` (309, 448, 452) | History/clues array initialization repeated | LOW |

### 3.2 Inconsistent Coding Patterns

| Issue | Files | Description |
|-------|-------|-------------|
| Fire-and-forget async | `wordListService.js:313` | `incrementUsageCount()` not awaited |
| Null checking style | Multiple | Mix of ternary and if-statements |
| Array initialization | `gameService.js` | Should be in game creation |

### 3.3 Error Handling Gaps

| Issue | File | Line(s) | Description |
|-------|------|---------|-------------|
| Unhandled promise in metrics | `app.js` | 115-122 | `io.fetchSockets()` chain incomplete |
| Silent increment failures | `wordListService.js` | 280-291 | Error logged as warning only |
| Missing JSON.parse protection | `roomService.js` | 83 | Corrupted Redis data could crash |
| Timer callback error level | `socket/index.js` | 172-185 | Errors only at debug level |

### 3.4 Hard-coded Values

| Value | File | Line | Recommended |
|-------|------|------|-------------|
| 10s shutdown timeout | `index.js` | 77 | Move to constants |
| `maxRetries = 3` | `gameService.js` | 215, 396, 495, 560 | Extract to config |
| Socket ping timeout/interval | `socket/index.js` | 25-26 | Move to config |

### 3.5 Memory Concerns

| Issue | File | Description |
|-------|------|-------------|
| Unbounded timer map | `timerService.js:9` | `activeTimers` has no size limit |
| Unbounded game history | `gameService.js` | History array grows indefinitely |
| Large word array in client | `index.html` | 855+ words parsed on every page load |

---

## 4. Performance Issues

### 4.1 N+1 Query Patterns

#### 4.1.1 Player Fetching (CRITICAL)

**File:** `server/src/services/playerService.js` (lines 115-130)

```javascript
const sessionIds = await redis.sMembers(`room:${roomCode}:players`);
for (const sessionId of sessionIds) {
    const player = await getPlayer(sessionId);  // N+1 queries!
    // ...
}
```

**Fix:** Use Redis MGET or pipeline for batch fetching.

#### 4.1.2 Chat Broadcasting

**File:** `server/src/socket/handlers/chatHandlers.js` (lines 42-46)

Team-only messages loop through all players to find teammates.

**Fix:** Maintain team-specific socket rooms for efficient broadcasting.

### 4.2 Missing Database Indexes

**File:** `server/prisma/schema.prisma`

| Missing Index | Line | Query Affected |
|---------------|------|----------------|
| `WordList.ownerId` | 82 | `getUserWordLists()` |
| `WordList.createdAt` | 88 | Sort by creation date |
| `GameParticipant.sessionId` | 102 | Participant lookups |
| `Room.status` | 37 | Room filtering |
| Composite: `Room(hostId, expiresAt)` | - | Host room queries |

### 4.3 Redis Inefficiencies

| Issue | File | Line(s) | Fix |
|-------|------|---------|-----|
| Separate TTL refreshes | `roomService.js` | 215-229 | Use pipelining |
| Redundant exists check | `roomService.js` | 225-228 | expire() returns 0 if missing |
| Sequential deletes in loop | `roomService.js` | 241-244 | Use pipeline |

### 4.4 Client-Side Performance

| Issue | File | Line(s) | Impact |
|-------|------|---------|--------|
| Full board rerender | `index.html` | 1137-1167 | Clears and recreates 25 cards on every reveal |
| Multiple DOM updates per event | `index.html` | 1197-1201 | 5 separate DOM writes on card click |
| Linear assassin search | `index.html` | 1210, 1232, 1272 | `indexOf('assassin')` in hot paths |

### 4.5 WebSocket Inefficiencies

| Issue | File | Line(s) | Description |
|-------|------|---------|-------------|
| Per-player game emit | `gameHandlers.js` | 45-48 | Loops through players for game state |
| Double room emissions | `roomHandlers.js` | 62-65 | Could combine into single broadcast |

---

## 5. Testing Gaps

### 5.1 Current Coverage

**Test Files (3 total):**
- `gameService.test.js` (300 lines) - Game logic
- `timerService.test.js` (250 lines) - Timer management
- `validators.test.js` (336 lines) - Zod schemas

**Estimated Coverage:** ~12% of codebase (target: 70%)

### 5.2 Critical Untested Areas

#### Completely Untested Services (0% Coverage)

| Service | Lines | Risk Level |
|---------|-------|------------|
| `playerService.js` | 207 | CRITICAL - Core player state |
| `roomService.js` | 272 | CRITICAL - Race conditions |
| `wordListService.js` | 332 | CRITICAL - Authorization |

#### Untested Security-Critical Components

| Component | Lines | Risk |
|-----------|-------|------|
| `socketAuth.js` | 90 | HIGH - Session hijacking |
| `rateLimit.js` | 144 | MEDIUM - DoS protection |
| `errorHandler.js` | 78 | LOW - Error leakage |

#### Untested Socket Handlers (593 lines total)

| Handler | Lines | Critical Functions |
|---------|-------|-------------------|
| `gameHandlers.js` | 281 | Card reveal with Redis transactions |
| `roomHandlers.js` | 140 | Room join/leave, host transfer |
| `playerHandlers.js` | 111 | Team/role changes |
| `chatHandlers.js` | 61 | Team filtering |

#### Untested Routes

| Route | Security Concern |
|-------|------------------|
| Word list routes | Authorization bypass confirmed |
| Room routes | No validation tests |

### 5.3 Missing Test Types

1. **Integration Tests** - No service-to-service tests
2. **E2E Tests** - No full game lifecycle tests
3. **Concurrency Tests** - No race condition tests
4. **Security Tests** - No authentication/authorization tests
5. **Socket Tests** - No WebSocket integration tests

### 5.4 Edge Cases Not Tested

- Redis watch/transaction failures
- Room code collision (10 retry limit)
- Player count race conditions
- Socket reconnection during gameplay
- Timer expiration during state transitions
- Word list boundary conditions (exactly 25 words)

---

## 6. Action Plan

### Phase 1: Critical Security Fixes (Immediate)

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| P0 | Remove hardcoded credentials | `docker-compose.yml`, `.env.example` | Small |
| P0 | Fix CORS configuration | `app.js`, `socket/index.js` | Small |
| P0 | Add auth middleware to word list routes | `wordListRoutes.js` | Medium |
| P0 | Fix authorization bypass | `wordListService.js` | Small |
| P0 | Apply socket rate limiting | `socket/handlers/*.js` | Medium |

### Phase 2: High-Priority Fixes

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| P1 | Add playerService tests | `__tests__/` | Large |
| P1 | Add roomService tests | `__tests__/` | Large |
| P1 | Fix N+1 player queries | `playerService.js` | Medium |
| P1 | Add database indexes | `prisma/schema.prisma` | Small |
| P1 | Add socket auth tests | `__tests__/` | Medium |

### Phase 3: Code Quality Improvements

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| P2 | Add try-catch around JSON.parse | `roomService.js` | Small |
| P2 | Fix fire-and-forget async | `wordListService.js` | Small |
| P2 | Extract hard-coded values to constants | Multiple | Medium |
| P2 | Add wordListService tests | `__tests__/` | Large |
| P2 | Optimize client board rendering | `index.html` | Medium |

### Phase 4: Performance Optimizations

| Priority | Task | Files | Effort |
|----------|------|-------|--------|
| P3 | Implement Redis pipelining | `roomService.js`, `playerService.js` | Medium |
| P3 | Add game history size limit | `gameService.js` | Small |
| P3 | Optimize DOM updates | `index.html` | Medium |
| P3 | Add team-specific socket rooms | `chatHandlers.js` | Medium |
| P3 | Cache assassin index | `index.html` | Small |

### Phase 5: Testing & Documentation

| Priority | Task | Effort |
|----------|------|--------|
| P4 | Add integration tests | Large |
| P4 | Add E2E test suite | Large |
| P4 | Add socket handler tests | Large |
| P4 | Document security requirements | Medium |

---

## 7. Recommendations Summary

### Immediate Actions Required

1. **Remove all hardcoded credentials** from docker-compose.yml and .env.example
2. **Fix CORS configuration** - either specific origins or disable credentials
3. **Add authentication** to word list API routes
4. **Apply rate limiting** to all socket events
5. **Fix authorization bypass** in wordListService

### Short-term Improvements

1. Add comprehensive tests for playerService, roomService, wordListService
2. Fix N+1 query patterns with Redis pipelining/MGET
3. Add missing database indexes
4. Implement proper error handling for JSON.parse operations

### Medium-term Enhancements

1. Optimize client-side rendering (incremental DOM updates)
2. Add integration and E2E test suites
3. Implement game history size limits
4. Extract configuration values to centralized constants

### Long-term Considerations

1. Consider TypeScript migration for type safety
2. Add comprehensive audit logging
3. Implement CSP headers for the client
4. Consider adding Prometheus metrics for observability

---

## Appendix A: File-by-File Issue Index

| File | Critical | High | Medium | Low |
|------|----------|------|--------|-----|
| `wordListRoutes.js` | 1 | 1 | 0 | 0 |
| `wordListService.js` | 1 | 0 | 1 | 0 |
| `docker-compose.yml` | 1 | 0 | 0 | 0 |
| `app.js` | 1 | 0 | 1 | 0 |
| `socket/index.js` | 1 | 0 | 1 | 1 |
| `socketAuth.js` | 0 | 1 | 1 | 0 |
| `gameHandlers.js` | 0 | 1 | 1 | 0 |
| `playerService.js` | 0 | 1 | 0 | 1 |
| `roomService.js` | 0 | 0 | 2 | 0 |
| `index.html` | 0 | 0 | 2 | 2 |
| `gameService.js` | 0 | 0 | 1 | 2 |
| `timerService.js` | 0 | 0 | 1 | 0 |

---

## Appendix B: Security Checklist

- [ ] Remove hardcoded credentials from all config files
- [ ] Configure specific CORS origins for production
- [ ] Add JWT authentication to word list routes
- [ ] Fix null requesterId bypass in authorization
- [ ] Apply rate limiting to all socket events
- [ ] Add session hijacking protection tests
- [ ] Sanitize chat messages before broadcast
- [ ] Review error messages in production mode
- [ ] Add CSP headers to index.html
- [ ] Implement audit logging for sensitive operations

---

*Report generated by automated code review. Manual verification recommended for all critical findings.*
