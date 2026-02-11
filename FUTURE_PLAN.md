# Die Eigennamen — Future Development Plan

**Last Updated:** February 11, 2026 (Deep Review)
**Version:** v2.2.0

This document outlines the development plan for hardening existing functionality and introducing new features, based on comprehensive line-by-line codebase reviews conducted in February 2026.

## Executive Summary

The codebase is **production-ready** with strong defensive programming patterns including Lua script atomicity, comprehensive error handling, race condition prevention, and defense-in-depth security. Phases 1-3 plus Tier A are fully completed. A deep review identified 2 critical bugs and 8 high-priority issues requiring targeted fixes before production hardening is complete.

| Area | Status | Priority |
|------|--------|----------|
| Backend Services | Strong — 2 critical + 8 high bugs found in deep review | High (targeted fixes) |
| WebSocket Layer | Strong — spectator handler signatures broken (CRIT-1) | High (critical fix) |
| Frontend | Good — i18n dead code, listener leaks, a11y gaps | Medium |
| Testing | Strong — 2,675 total tests; multiplayer E2E added | Maintenance |
| Security | Strong — token invalidation gap + IP map DoS found | Medium (targeted fixes) |
| Infrastructure | Excellent — CI/CD, Docker, Fly.io, staging | Maintenance |

---

## Phase 1: Critical Hardening ✅ COMPLETED

> All 11 items implemented and verified.

### 1.1 Backend Service Fixes ✅
- 1.1.1: NFKC Unicode normalization for clue validation ✅
- 1.1.2: Atomic Lua scripts for reconnection tokens ✅
- 1.1.3: Room creation rollback on player creation failure ✅
- 1.1.4: Paused timer resume validation with timestamp checks ✅

### 1.2 WebSocket Hardening ✅
- 1.2.1: `safeEmit.ts` wrapper for all Socket.io emissions ✅
- 1.2.2: LRU eviction for rate limit metrics cleanup ✅
- 1.2.3: Reconnection token TTL reduced to 5 minutes ✅
- 1.2.4: Host transfer re-check for reconnected hosts ✅

### 1.3 Security Enhancements ✅
- 1.3.1: IP rate limit multiplier reduced to 3x ✅
- 1.3.2: Token generation rate limited to 2/10s ✅
- 1.3.3: Game data validation before history save ✅

---

## Phase 2: Frontend Improvements ✅ COMPLETED

> All 5 items implemented and verified.

- 2.1: Modal stack with focus management ✅
- 2.2: Request cancellation with AbortController ✅
- 2.3: Shared constants module with HTML maxlength alignment ✅
- 2.4: Timer aria-live on correct element ✅
- 2.5: Colorblind-friendly card patterns with SVG ✅

---

## Phase 3: Testing Improvements ✅ COMPLETED

> All items implemented and verified.

- 3.1: Test helper library (`mocks.ts`, `socketTestHelper.ts`) ✅
- 3.2: Middleware tests (`contextHandler`, `playerContext`, `socketFunctionProvider`) ✅
- 3.3: Error scenario tests (`errorScenarios`, `handlerEdgeCases`, `reconnectionEdgeCases`) ✅
- 3.4: Database integration tests (`database.test.ts`, `databaseCoverage.test.ts`) ✅
- 3.5: Multiplayer E2E tests (11 tests in `multiplayer-lifecycle.spec.js`) ✅

---

## Phase 3.5: Deep Review Critical Fixes ✅ COMPLETED

> 2 critical + 8 high priority issues identified in deep line-by-line review.

### 3.5.1 Critical Fixes ✅
- CRIT-1: Fix spectator handler signatures in `playerHandlers.ts` ✅ — corrected to 4-param pattern with `io` from closure
- CRIT-2: Add max word count validation (server + frontend) ✅ — MAX_WORD_LIST_SIZE=10000 enforced

### 3.5.2 High Priority Fixes ✅
- HIGH-1: Invalidate reconnection token when player is kicked ✅
- HIGH-2: Verify `cleanupOldHistory` zRange index direction ✅ — verified correct (only returns excess entries)
- HIGH-3: Wire `state.localizedDefaultWords` into game.js word selection ✅
- HIGH-4: Fix `escapeHTML()` misuse in CSS className context in history.js ✅ — whitelist check
- HIGH-5: Fix event listener accumulation in replay controls ✅ — event delegation
- HIGH-6: Wrap `refreshRoomTTL` callers in try-catch ✅ — warning log, no join failure
- HIGH-7: Fix accessibility keyboard overlay listener leak ✅ — shared closeOverlay()
- HIGH-8: Cap `connectionsPerIP` Map size ✅ — MAX_TRACKED_IPS=10000

### 3.5.3 Security Fixes (Remaining)
- SEC-3: Session age validation uses `connectedAt` fallback — frequent reconnectors bypass 8h limit
- SEC-4: JWT secret length only warned in production, not enforced
- SEC-5: `connectionsPerIP` map unbounded ✅ (= HIGH-8, fixed)

---

## Phase 4: Feature Completion — Active

### 4.1 Chat UI Implementation (NEW)
**Status**: Backend complete, frontend missing
**Priority**: Medium

The backend fully supports team and spectator chat via `chatHandlers.ts`. The `socket-client.js` has listeners for `chat:message` and `chat:spectatorMessage`. What's missing is the frontend chat panel.

**Implementation needs:**
- Chat panel UI with team/spectator tabs
- Message display with timestamps and sender info
- Integration with existing multiplayer UI
- Mobile-responsive layout

### 4.2 i18n Completion
**Status**: 85% complete (deep review found additional gap)
**Priority**: Medium

Four complete language files (EN, DE, ES, FR) with localized word lists exist. Gaps:
- **Localized word lists loaded but never used** (HIGH-3): `i18n.js` populates `state.localizedDefaultWords` but `game.js` ignores it — non-English users always get English words
- Some hardcoded English strings in HTML without `data-i18n` attributes (game.js, roles.js, multiplayer.js)
- No plural form support in the translation system
- Date/time formatting uses browser locale (acceptable)

### 4.3 Game Replay Enhancements — Partially Completed
**Implemented**: History service, replay UI with 4 speed levels, replay data API
**Remaining**:
- Exportable/shareable replay links (API endpoint exists at `/api/replays/:roomCode/:gameId`)
- Analysis mode with annotations (future)

### 4.4 Custom Game Modes — Partially Completed
**Implemented**: Classic, Blitz (30s turns), Duet (cooperative)
**Remaining**:
- Draft Mode: Teams draft words before game starts
- Asymmetric Mode: Different team sizes

### 4.5 Player Statistics & Profiles
**Status**: Schema defined in Prisma, not implemented
**Priority**: Future backlog

### 4.6 Tournament Mode
**Status**: Not started
**Priority**: Future backlog

### 4.7 Admin Dashboard Enhancements — Partially Completed
**Implemented**: Stats, room management, player kick, force close, broadcast, audit logs, SSE streaming
**Remaining**:
- Real-time WebSocket-based dashboard updates
- Word list moderation queue
- System health alerts

---

## Phase 5: Infrastructure & DevOps — Ongoing

### 5.1 Observability Improvements
- Add distributed tracing (OpenTelemetry)
- Create Grafana dashboards for metrics visualization
- Set up alerting rules for critical thresholds
- Current state: Winston logging, Prometheus metrics endpoint, admin SSE streaming

### 5.2 Horizontal Scaling Verification
- Redis Pub/Sub adapter configured (@socket.io/redis-adapter)
- Sticky sessions handled by Fly.io
- Needs: Multi-instance load testing with k6
- Needs: Documented scaling procedures with verification checklist

### 5.3 Database Optimization
- Prisma schema with 5 models, proper indexes, cascade deletes
- Connection pooling configuration documented (PgBouncer)
- Needs: Query performance monitoring under load
- Needs: Index optimization based on actual query patterns

### 5.4 CI/CD Maturation
- Current: 6 quality gates (test, typecheck, lint, security, Docker, E2E)
- Current: CodeQL weekly scanning
- Needs: Automated performance regression testing (k6 scheduled)
- Needs: Preview deployments for PRs
- Needs: Automated changelog generation

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database migration issues | Low | High | Test migrations in staging first |
| Performance regression | Low | Medium | k6 load tests, monitoring |
| WebSocket scaling issues | Low | High | Redis Pub/Sub verified; load test multi-instance |
| Dependency vulnerabilities | Medium | Medium | npm audit in CI, CodeQL scanning |
| Frontend/server PRNG desync | Low | High | Shared test suite validates both implementations |
| Spectator flow broken | Confirmed | Medium | CRIT-1: Handler signatures wrong, needs fix |
| Word list DoS | Medium | High | CRIT-2: No max word count validation |
| Memory DoS via IP spoofing | Medium | Medium | HIGH-8: connectionsPerIP map unbounded |

---

## Success Metrics

### Current Achievement
- Zero race condition bugs in production ✅
- Critical security issues resolved ✅ (2 critical + 8 high from deep review — all fixed)
- Test coverage > 85% ✅ (94%+)
- WebSocket connection success rate > 99% ✅

### Ongoing Targets
- Time to First Byte < 200ms
- Card reveal latency < 40ms
- 1,000+ concurrent rooms
- 5,000+ simultaneous connections
- Zero-downtime deployments

---

## Conclusion

The codebase has completed three major hardening phases plus Tier A improvements and is fundamentally production-ready. A deep line-by-line review identified targeted issues requiring attention:

1. **Critical fixes** (Phase 3.5): Spectator handler signatures, word list DoS validation
2. **High priority fixes**: Token invalidation on kick, localized words wiring, listener leaks, TTL error handling, IP map capping
3. **Frontend polish**: Chat UI, i18n completeness, replay accessibility
4. **Testing expansion**: Resilience/chaos testing, spectator flow tests
5. **Future features**: Player profiles, tournament mode, AI spymaster

The architecture supports all planned features without requiring structural changes. The service layer, atomic operations, and graceful degradation patterns provide a solid foundation for continued development. The critical and high-priority fixes are all low-effort (most are 1-10 line changes) and should be addressed before next production deployment.
