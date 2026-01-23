# Risley-Codenames Punch List

**Generated:** January 23, 2026
**Branch:** `claude/repo-review-punch-list-10HAo`
**Overall Status:** Production-Ready with Minor Improvements Needed

---

## Executive Summary

The codebase is mature and well-maintained with excellent documentation. However, there are specific areas requiring attention:

| Category | Critical | High | Medium | Low |
|----------|----------|------|--------|-----|
| Test Coverage | 2 | 3 | 5 | 2 |
| Lint/Code Quality | 0 | 0 | 2 | 1 |
| Bug Fixes | 0 | 0 | 3 | 2 |
| Performance | 0 | 0 | 2 | 1 |
| **Total** | **2** | **3** | **12** | **6** |

---

## 1. CRITICAL: Test Coverage Threshold Failures

The test suite is **FAILING** its coverage thresholds. This must be fixed before any release.

### PUNCH-1: Branch Coverage Below Threshold
- **Current:** 68.94%
- **Required:** 70%
- **Gap:** 1.06%
- **Impact:** CI/CD pipeline fails

### PUNCH-2: Function Coverage Below Threshold
- **Current:** 63.95%
- **Required:** 70%
- **Gap:** 6.05%
- **Impact:** CI/CD pipeline fails

---

## 2. HIGH PRIORITY: Low Coverage Files

These files have coverage significantly below targets and are causing threshold failures:

### PUNCH-3: healthRoutes.js (31.42% coverage)
- **File:** `server/src/routes/healthRoutes.js`
- **Lines uncovered:** 23, 36-72, 87, 98-135
- **Fix:** Add tests for `/health/ready` and `/health/metrics` endpoints
- **Estimated effort:** 1-2 hours

### PUNCH-4: wordListRoutes.js (55.38% coverage)
- **File:** `server/src/routes/wordListRoutes.js`
- **Lines uncovered:** 26-46, 64, 113, 155, 165-178, 188-199, 209-213
- **Fix:** Add tests for auth middleware, PUT/DELETE operations
- **Estimated effort:** 2-3 hours

### PUNCH-5: socket/index.js (58.06% coverage)
- **File:** `server/src/socket/index.js`
- **Lines uncovered:** 66, 77-128, 236-345
- **Fix:** Add tests for disconnect handler, host transfer, timer restart
- **Estimated effort:** 3-4 hours

---

## 3. MEDIUM PRIORITY: Coverage Improvements

### PUNCH-6: memoryStorage.js (61.75% coverage)
- **File:** `server/src/config/memoryStorage.js`
- **Lines uncovered:** Transaction operations, scan iterator, cleanup
- **Fix:** Add tests for edge cases in transaction exec, multi() operations
- **Estimated effort:** 2 hours

### PUNCH-7: jwt.js (62.22% coverage)
- **File:** `server/src/config/jwt.js`
- **Lines uncovered:** 34-41, 47, 53-65, 78, 106, 117, 121, 136
- **Fix:** Add tests for token verification edge cases
- **Estimated effort:** 1-2 hours

### PUNCH-8: pubSubHealth.js (68.29% coverage)
- **File:** `server/src/utils/pubSubHealth.js`
- **Lines uncovered:** 87-130
- **Fix:** Add tests for health degradation scenarios
- **Estimated effort:** 1 hour

### PUNCH-9: logger.js (68.49% coverage)
- **File:** `server/src/utils/logger.js`
- **Lines uncovered:** 22, 45, 52, 56, 85, 88, 91, 122, 135-156, 205, 250-256
- **Fix:** Add tests for log formatting and transport configuration
- **Estimated effort:** 1 hour

### PUNCH-10: rateLimit.js (71.42% coverage)
- **File:** `server/src/middleware/rateLimit.js`
- **Lines uncovered:** 19-50, 69-76, 95-97, 252-286, 332, 349-351, 355, 408-415
- **Fix:** Add tests for IP-based rate limiting edge cases
- **Estimated effort:** 2 hours

---

## 4. LINT ERRORS (Must Fix)

### PUNCH-11: Unused Variables in Test Files
- **Severity:** Error (blocks lint pass)
- **Count:** 13 errors across 7 files
- **Files affected:**
  - `gameServiceExtended.test.js:621,1060` - unused `game`, `e`
  - `timerOperations.test.js:9` - unused `sleep`
  - `playerService.test.js:301` - unused `result`
  - `reconnectionEdgeCases.test.js:167,294` - unused `expiredToken`, `sessionId`
  - `socketAuth.test.js:237` - unused `result`
  - `socketIndexExtended2.test.js:396` - unused `e`
  - `timerServiceExtended.test.js:16,65,539` - unused `originalPid`, `getRedis`, `getPubSubClients`, `lockKey`

**Fix:** Either use the variables or prefix with underscore (`_unused`)

### PUNCH-12: Await in Loop Warnings
- **Severity:** Warning (12 occurrences)
- **Files affected:**
  - `mocks.js:210`
  - `socketTestHelper.js:134,360`
  - `passwordRoomReconnection.test.js:220,221,240,256`
  - `raceConditions.test.js:242,290,295`
  - `timerServiceExtended.test.js:231,233`

**Fix:** Consider using `Promise.all()` where appropriate, or add `// eslint-disable-line no-await-in-loop` with justification

---

## 5. BUG FIXES

### PUNCH-13: memoryStorage O(n²) Complexity (Medium)
- **File:** `server/src/config/memoryStorage.js:239`
- **Issue:** `result.includes(key)` inside loop creates O(n²) complexity
- **Impact:** Performance degradation with many keys
- **Fix:** Use a Set for result collection:
```javascript
const resultSet = new Set();
for (const key of this.sets.keys()) {
    if (!this._isExpired(key) && regex.test(key)) {
        resultSet.add(key);
    }
}
return [...result, ...resultSet];
```

### PUNCH-14: Transaction Error Handling (Medium)
- **File:** `server/src/config/memoryStorage.js:486-488`
- **Issue:** Transaction errors push `null` and continue instead of aborting
- **Impact:** Silent partial failures in multi-step operations
- **Fix:** Consider throwing or returning error state

### PUNCH-15: Timer Lock Without Redis Check (Medium)
- **File:** `server/src/socket/index.js:169-210`
- **Issue:** No explicit Redis availability check before lock operations
- **Impact:** Could fail silently in degraded mode
- **Fix:** Add `isRedisHealthy()` check before attempting distributed lock

### PUNCH-16: Database Module Low Coverage (Low)
- **File:** `server/src/config/database.js` (12.76% coverage)
- **Issue:** Optional module has minimal test coverage
- **Impact:** None if PostgreSQL not used
- **Fix:** Add tests if PostgreSQL support is critical path

### PUNCH-17: Test Worker Force Exit Warning (Low)
- **Issue:** Jest reports "worker process has failed to exit gracefully"
- **Impact:** Potential resource leaks in test environment
- **Fix:** Run with `--detectOpenHandles` to identify, ensure proper cleanup in afterAll hooks

---

## 6. PERFORMANCE OPTIMIZATIONS

### PUNCH-18: Health Check Timeout Protection (Medium)
- **File:** `server/src/routes/healthRoutes.js:35-79`
- **Issue:** `/health/ready` performs multiple async operations without timeout
- **Impact:** Could hang if Redis is slow
- **Fix:** Add Promise.race timeout wrapper (2-3 seconds)

### PUNCH-19: Word List SELECT Optimization (Medium)
- **File:** `server/src/services/wordListService.js:102-106`
- **Issue:** Fetches full word arrays then discards them
- **Impact:** Unnecessary memory and network usage
- **Fix:** Use Prisma select to exclude `words` field when only counting

### PUNCH-20: Board Click Handler (Low - Frontend)
- **File:** `index.html:2526, 2534`
- **Issue:** Uses `Array.from(board.children).indexOf(card)` which is O(n)
- **Impact:** Minor performance impact per click
- **Fix:** Use existing `card.dataset.index` for O(1) lookup

---

## 7. DOCUMENTATION

### PUNCH-21: Consolidate Development Documents (Low)
- **Issue:** 8+ separate planning/review documents exist
- **Impact:** Confusion about current status
- **Recommendation:** Archive old documents, keep only `UNIFIED_DEVELOPMENT_DOCUMENT.md` as source of truth

---

## 8. RECOMMENDED TEST ADDITIONS

### Quick Wins for Coverage:

1. **healthRoutes.js** - Add 3 tests:
   - Test `/health/ready` in memory mode
   - Test `/health/ready` with Redis failure
   - Test `/health/metrics` endpoint

2. **wordListRoutes.js** - Add 4 tests:
   - Test extractUser with invalid JWT
   - Test GET /:id for private list without auth
   - Test PUT /:id endpoint
   - Test DELETE /:id endpoint

3. **socket/index.js** - Add 3 tests:
   - Test handleDisconnect with host transfer
   - Test timer restart with lock acquisition
   - Test cleanupSocketModule

---

## Summary Action Items

### Immediate (This Sprint):
1. [ ] Fix lint errors (PUNCH-11) - 30 min
2. [ ] Add healthRoutes tests (PUNCH-3) - 2 hours
3. [ ] Add wordListRoutes tests (PUNCH-4) - 3 hours
4. [ ] Fix test worker exit warning (PUNCH-17) - 1 hour

### Next Sprint:
5. [ ] Improve socket/index.js coverage (PUNCH-5) - 4 hours
6. [ ] Add memoryStorage tests (PUNCH-6) - 2 hours
7. [ ] Fix memoryStorage O(n²) issue (PUNCH-13) - 30 min
8. [ ] Add health check timeout (PUNCH-18) - 30 min

### Backlog:
9. [ ] Improve jwt.js coverage (PUNCH-7) - 2 hours
10. [ ] Improve pubSubHealth coverage (PUNCH-8) - 1 hour
11. [ ] Fix transaction error handling (PUNCH-14) - 1 hour
12. [ ] Add timer lock Redis check (PUNCH-15) - 30 min

---

## Verification Commands

```bash
# Run tests with coverage
cd server && npm run test:coverage

# Run lint
cd server && npm run lint

# Check for open handles
cd server && npm test -- --detectOpenHandles

# Run specific test file
cd server && npm test -- healthRoutes.test.js
```

---

*This punch list was generated from automated analysis. Review and prioritize based on team capacity.*
