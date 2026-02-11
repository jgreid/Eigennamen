# Die Eigennamen — Future Development Plan

**Last Updated:** February 11, 2026 (Tier C Implementation)
**Version:** v2.3.0

This document outlines the development plan for hardening existing functionality and introducing new features, based on comprehensive codebase reviews conducted in February 2026.

## Executive Summary

The codebase is **production-ready** with strong defensive programming patterns including Lua script atomicity, comprehensive error handling, race condition prevention, and defense-in-depth security. All critical, high, and medium-priority (Tier C) issues have been fixed. ESLint reports 0 errors and 0 warnings. Only lower-priority Tier D items remain.

| Area | Status | Priority |
|------|--------|----------|
| Backend Services | Excellent — all critical/high/medium bugs fixed | Maintenance |
| WebSocket Layer | Excellent — safeEmit consistency, timeouts on all handlers | Maintenance |
| Frontend | Good — accessibility, perf, validation improved; chat UI still missing | Medium |
| Testing | Strong — 2,675 total tests; multiplayer E2E added | Maintenance |
| Security | Excellent — session age fix, JWT enforcement, token rotation verified | Maintenance |
| Infrastructure | Excellent — CI/CD, Docker with resource limits, Fly.io | Maintenance |
| Code Quality | Excellent — 0 ESLint errors/warnings, 0 TypeScript errors | Maintenance |

---

## Phase 1: Critical Hardening — COMPLETED

> All 11 items implemented and verified.

### 1.1 Backend Service Fixes
- NFKC Unicode normalization for clue validation
- Atomic Lua scripts for reconnection tokens
- Room creation rollback on player creation failure
- Paused timer resume validation with timestamp checks

### 1.2 WebSocket Hardening
- `safeEmit.ts` wrapper for all Socket.io emissions
- LRU eviction for rate limit metrics cleanup
- Reconnection token TTL reduced to 5 minutes
- Host transfer re-check for reconnected hosts

### 1.3 Security Enhancements
- IP rate limit multiplier reduced to 3x
- Token generation rate limited to 2/10s
- Game data validation before history save

---

## Phase 2: Frontend Improvements — COMPLETED

> All 5 items implemented and verified.

- Modal stack with focus management
- Request cancellation with AbortController
- Shared constants module with HTML maxlength alignment
- Timer aria-live on correct element
- Colorblind-friendly card patterns with SVG

---

## Phase 3: Testing Improvements — COMPLETED

> All items implemented and verified.

- Test helper library (`mocks.ts`, `socketTestHelper.ts`)
- Middleware tests (`contextHandler`, `playerContext`, `socketFunctionProvider`)
- Error scenario tests (`errorScenarios`, `handlerEdgeCases`, `reconnectionEdgeCases`)
- Database integration tests
- Multiplayer E2E tests (11 tests in `multiplayer-lifecycle.spec.js`)

---

## Phase 3.5: Deep Review Fixes — COMPLETED

> 2 critical + 8 high priority issues identified and fixed.

### Critical Fixes
- CRIT-1: Spectator handler signatures corrected to 4-param pattern
- CRIT-2: Max word count validation added (MAX_WORD_LIST_SIZE=10000)

### High Priority Fixes
- HIGH-1: Reconnection token invalidated on player kick
- HIGH-2: History cleanup index verified correct
- HIGH-3: Localized default words wired into game word selection
- HIGH-4: escapeHTML replaced with whitelist check in className context
- HIGH-5: Event listener accumulation fixed via event delegation
- HIGH-6: refreshRoomTTL wrapped in try-catch with warning log
- HIGH-7: Accessibility keyboard listener leak fixed via shared closeOverlay()
- HIGH-8: connectionsPerIP map capped at MAX_TRACKED_IPS=10000

### Remaining Security Items (Medium) — All Fixed in Tier C
- SEC-3: ✅ Session age validation — `connectedAt` fallback removed, always uses `createdAt` (C-3)
- SEC-4: ✅ JWT secret length — now throws error in production if < 32 chars (C-4)

---

## Phase 3.6: Tier C Medium Priority Improvements — COMPLETED

> All 15 items completed (12 implemented, 3 verified already done).

### Code Changes
- C-1: `safeEmitToRoom`/`safeEmitToPlayer` in chat handlers (consistency)
- C-2: `withTimeout()` wrapper on `game:clue` handler (resilience)
- C-3: Removed `connectedAt` fallback in session age validation (security)
- C-4: JWT secret < 32 chars now throws in production (security)
- C-5: Zod `.refine()` for case-insensitive word uniqueness (validation)
- C-6: ARIA roles, tabindex, arrow-key navigation on replay board (accessibility)
- C-7: `Promise.all()` for batched role reset (performance)
- C-8: Shared Unicode-aware `NICKNAME_REGEX` in constants.js (consistency)
- C-9: Batch-read then batch-write DOM pattern in fitCardText (performance)
- C-10: `clearInterval` guard before creating new replay interval (bug fix)
- C-12: `TIMEOUT_*` env var overrides for all timeout values (operations)
- C-13: Docker Compose resource limits: api 512M/1cpu, db 256M/0.5cpu, redis 128M/0.5cpu

### Already Implemented (Verified)
- C-11: Memory audit log expiration — ring buffer with MAX_LOGS_PER_CATEGORY=10000
- C-14: Settings value validation — handled by Zod `roomSettingsSchema`
- C-15: Token rotation — implemented in roomHandlers via `ROTATE_SESSION_ON_RECONNECT`

### ESLint Cleanup
- 8 errors → 0 errors (unused variables removed from test files)
- 117 warnings → 0 warnings (non-null assertions, type imports, indentation fixed)

---

## Phase 4: Feature Completion — Active

### 4.1 Chat UI Implementation
**Status**: Backend complete, frontend missing
**Priority**: Medium

The backend fully supports team and spectator chat via `chatHandlers.ts`. The `socket-client.js` has listeners for `chat:message` and `chat:spectatorMessage`. Missing: frontend chat panel with team/spectator tabs, message display, and mobile-responsive layout.

### 4.2 i18n Completion
**Status**: ~90% complete (localized words now wired in via HIGH-3 fix)
**Priority**: Medium

Four complete language files (EN, DE, ES, FR) with localized word lists. Remaining gaps:
- Some hardcoded English strings in HTML without `data-i18n` attributes
- No plural form support in the translation system
- Date/time formatting uses browser locale (acceptable)

### 4.3 Game Replay Enhancements
**Status**: Partially complete
**Implemented**: History service, replay UI with 4 speed levels, replay data API
**Remaining**:
- Exportable/shareable replay links (API endpoint exists at `/api/replays/:roomCode/:gameId`)
- ~~Replay board keyboard navigation~~ (✅ done in C-6)
- Analysis mode with annotations (future)

### 4.4 Custom Game Modes
**Status**: Partially complete
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

### 4.7 Admin Dashboard Enhancements
**Status**: Partially complete
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
- Needs: Dependabot configuration

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Database migration issues | Low | High | Test migrations in staging first |
| Performance regression | Low | Medium | k6 load tests, monitoring |
| WebSocket scaling issues | Low | High | Redis Pub/Sub verified; load test multi-instance |
| Dependency vulnerabilities | Medium | Medium | npm audit in CI, CodeQL scanning |
| Frontend/server PRNG desync | Low | High | Shared test suite validates both implementations |
| Memory growth in memory mode | Low | Medium | Audit log expiration implemented via ring buffer (C-11 ✅) |

---

## Success Metrics

### Current Achievement
- Zero race condition bugs in production
- All critical + high + medium security issues resolved (25/25)
- Test coverage > 85% (94%+ lines/statements)
- WebSocket connection success rate > 99%
- 0 npm audit vulnerabilities
- TypeScript compiles clean (0 errors)
- ESLint clean (0 errors, 0 warnings)

### Ongoing Targets
- Time to First Byte < 200ms
- Card reveal latency < 40ms
- 1,000+ concurrent rooms
- 5,000+ simultaneous connections
- Zero-downtime deployments

---

## Conclusion

The codebase has completed five major hardening phases (including all Tier C improvements and full ESLint cleanup) and is production-ready with zero open critical, high, or medium-priority issues. Remaining work focuses on:

1. **Lower priority items** (Tier D): 14 items covering frontend features, testing expansion, and infrastructure
2. **Frontend features**: Chat UI, i18n completeness
3. **Testing expansion**: Resilience/chaos testing, ReDoS regression tests, multi-browser E2E
4. **Infrastructure**: Observability, Dependabot, `.dockerignore`, `SECURITY.md`
5. **Future features**: Player profiles, tournament mode, AI spymaster

The architecture supports all planned features without requiring structural changes. The service layer, atomic operations, and graceful degradation patterns provide a solid foundation for continued development.
