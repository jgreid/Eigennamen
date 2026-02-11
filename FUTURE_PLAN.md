# Die Eigennamen — Future Development Plan

**Last Updated:** February 11, 2026
**Version:** v2.2.0

This document outlines the development plan for hardening existing functionality and introducing new features, based on comprehensive codebase reviews conducted in February 2026.

## Executive Summary

The codebase is **production-ready** with strong defensive programming patterns including Lua script atomicity, comprehensive error handling, race condition prevention, and defense-in-depth security. Phases 1-3 are fully completed. Remaining work focuses on frontend feature completion, testing expansion, and infrastructure maturation.

| Area | Status | Priority |
|------|--------|----------|
| Backend Services | Excellent — all hardening complete | Maintenance |
| WebSocket Layer | Excellent — safeEmit, rate limiting, auth | Maintenance |
| Frontend | Good — chat UI and i18n markup gaps remain | Medium |
| Testing | Strong — 2,664 total tests; E2E multiplayer gap | Medium |
| Security | Excellent — defense-in-depth implemented | Low (minor items) |
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

## Phase 3: Testing Improvements — Mostly Completed

> Core items (3.1-3.4) completed. E2E expansion (3.5) remains.

- 3.1: Test helper library (`mocks.ts`, `socketTestHelper.ts`) ✅
- 3.2: Middleware tests (`contextHandler`, `playerContext`, `socketFunctionProvider`) ✅
- 3.3: Error scenario tests (`errorScenarios`, `handlerEdgeCases`, `reconnectionEdgeCases`) ✅
- 3.4: Database integration tests (`database.test.ts`, `databaseCoverage.test.ts`) ✅
- 3.5: **Multiplayer E2E tests** — Remaining (room create → join → play → reconnect)

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
**Status**: 90% complete
**Priority**: Medium

Four complete language files (EN, DE, ES, FR) with localized word lists exist. Gaps:
- Some hardcoded English strings in HTML without `data-i18n` attributes
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

---

## Success Metrics

### Current Achievement
- Zero race condition bugs in production ✅
- All critical security issues resolved ✅
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

The codebase has completed three major hardening phases and is production-ready. The remaining work is primarily:

1. **Frontend polish**: Chat UI, i18n completeness
2. **Testing expansion**: Multiplayer E2E, resilience testing
3. **Documentation accuracy**: Directory references, CHANGELOG
4. **Future features**: Player profiles, tournament mode, AI spymaster

The architecture supports all planned features without requiring structural changes. The service layer, atomic operations, and graceful degradation patterns provide a solid foundation for continued development.
