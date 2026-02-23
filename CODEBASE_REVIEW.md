# Codebase Review Report — Eigennamen Online

**Date**: 2026-02-23
**Scope**: Full codebase review covering build configuration, security, dependencies, architecture, code quality, and testing
**Previous review**: 2026-02-17 (see git history for original)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Current Health Dashboard](#current-health-dashboard)
3. [Progress Since Last Review](#progress-since-last-review)
4. [New Findings](#new-findings)
5. [Outstanding Items from Previous Review](#outstanding-items-from-previous-review)
6. [Architecture Strengths](#architecture-strengths)
7. [Prioritized Next Steps](#prioritized-next-steps)

---

## Executive Summary

The codebase has improved since the February 17 review. Several high-priority issues were addressed (ADMIN_PASSWORD enforcement, disconnect handler cleanup). The core architecture remains production-grade with strict TypeScript, comprehensive validation, and a strong test suite.

This review surfaced **new build-breaking issues** not present in the previous review — most critically, the Dockerfile references Prisma infrastructure that was removed in commit `096982b`, which would cause Docker builds to fail. Additionally, `swagger-jsdoc` introduces 3 high-severity production vulnerabilities while providing zero value (the OpenAPI spec is already fully defined inline).

**Overall Quality: Strong** — The same high-quality architecture and patterns from the previous review are intact. The issues found are almost entirely in build/deployment configuration rather than application logic.

---

## Current Health Dashboard

| Check | Status | Details |
|-------|--------|---------|
| **Lint** | 0 errors, 0 warnings | ESLint clean |
| **TypeScript** | 0 errors | Strict mode, all checks enabled |
| **Tests** | 2,888 passing / 106 suites | Backend + frontend, 0 failures |
| **Coverage** | 85.3% stmts, 75.9% branches, 78.4% functions, 86.1% lines | Exceeds configured thresholds |
| **TODO/FIXME** | 0 found in source | No deferred work |
| **Skipped tests** | 0 found | All tests active |
| **Production vulns** | 3 high | All from `swagger-jsdoc` → `minimatch` chain |
| **Dev vulns** | 37 (non-shipping) | Mostly jest/stryker transitive deps |

---

## Progress Since Last Review

Items from the February 17 review that have been addressed:

| # | Previous Finding | Status | Notes |
|---|-----------------|--------|-------|
| 1 | ADMIN_PASSWORD not enforced in production | **Fixed** | Admin routes now return 401 when `ADMIN_PASSWORD` is unset (`adminRoutes.ts:33-41`) |
| 2 | Runtime `require()` calls in disconnect handler (6 occurrences) | **Partially fixed** | Reduced from 6 to 1 remaining in `connectionHandler.ts:111` |
| 3 | No database integration tests | **Resolved** | Prisma/PostgreSQL scaffolding was removed entirely — no longer applicable |
| 4 | Database connection failures silently continue | **Resolved** | Database layer removed in MVP simplification |

---

## New Findings

### P0 — Build-Breaking Issues

#### 1. Dockerfile references removed Prisma directory

Prisma scaffolding was removed in commit `096982b`, but `server/Dockerfile` still references it in both stages:

**Build stage** (lines 10, 13):
```dockerfile
COPY server/prisma ./prisma
RUN npm ci && npx prisma generate
```

**Production stage** (lines 43-47):
```dockerfile
COPY --chown=eigennamen:nodejs server/prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate && npm cache clean --force
```

**Impact**: `docker compose up --build`, `fly deploy`, and the CI Docker job will all fail because `server/prisma/` does not exist.

**Fix**:
- Remove both `COPY server/prisma ./prisma` lines
- Change build-stage RUN to: `RUN npm ci`
- Change production-stage RUN to: `RUN npm ci --omit=dev && npm cache clean --force`
- Remove `openssl` from `apk add` (only needed for Prisma)

#### 2. ESLint config references 3 nonexistent files

`server/eslint.config.js` (lines 128-131) lists files for `no-await-in-loop` suppression that no longer exist:

| File | Status |
|------|--------|
| `src/config/database.ts` | Removed with Prisma |
| `src/utils/retry.ts` | Does not exist |
| `src/socket/reliableEmit.ts` | Does not exist |

**Impact**: No runtime effect (ESLint ignores missing paths), but misleads contributors about what files exist.

**Fix**: Remove the three nonexistent paths from the `files` array.

---

### P1 — Security

#### 3. Production dependency vulnerabilities: `swagger-jsdoc` → `minimatch` ReDoS

```
npm audit --omit=dev:

swagger-jsdoc >= 1.3.0
  └─ glob 3.0.0 - 10.5.0
     └─ minimatch < 10.2.1  ← HIGH: ReDoS via repeated wildcards

3 high severity vulnerabilities
```

The CI security audit step (`ci.yml:230`) fails on high-severity production dependencies, so this blocks CI.

**Key insight**: `swagger-jsdoc` provides zero value in this project. Its purpose is to scan JSDoc annotations across source files to generate an OpenAPI spec — but `server/src/config/swagger.ts` defines the entire spec inline as a JavaScript object. The `apis: []` array on line 359 is empty; no source files are scanned.

**Fix**: Remove `swagger-jsdoc` from dependencies and `server/src/types/vendor.d.ts`. Use the inline spec directly:

```typescript
// swagger.ts — before
import swaggerJsdoc from 'swagger-jsdoc';
const swaggerSpec = swaggerJsdoc(options);

// swagger.ts — after
const swaggerSpec = options.definition;
```

This eliminates 3 high-severity production vulnerabilities and removes an unnecessary dependency.

---

### P2 — Configuration Hygiene

#### 4. Node.js version mismatch across environments

| Environment | Node Version |
|-------------|-------------|
| Dockerfile (build & production) | 20 (`node:20-alpine`) |
| CI primary | 22 |
| CI matrix | 20, 22 |
| `package.json` engines | `>=18.0.0` |

The Docker image runs on Node 20 while CI primarily tests on Node 22. Subtle behavior differences in core APIs could cause production-only issues.

**Fix**: Align the Dockerfile to `node:22-alpine` to match the CI primary version (22).

#### 5. Unused TypeScript path aliases

`server/tsconfig.json` (lines 53-64) defines 10 path aliases:

```json
"@/*": ["src/*"],
"@config/*": ["src/config/*"],
"@services/*": ["src/services/*"],
"@errors/*": ["src/errors/*"],
"@utils/*": ["src/utils/*"],
"@middleware/*": ["src/middleware/*"],
"@routes/*": ["src/routes/*"],
"@socket/*": ["src/socket/*"],
"@validators/*": ["src/validators/*"],
"@types/*": ["src/types/*"],
"@shared/*": ["src/shared/*"]
```

Zero usages exist anywhere in source code. No runtime resolution (e.g., `tsconfig-paths` or `module-alias`) is configured.

**Fix**: Remove the `paths` block from `tsconfig.json`.

#### 6. Docker Compose uses deprecated `version` key

`docker-compose.yml` line 1: `version: '3.8'` is deprecated in Docker Compose v2+ and produces a warning. It is silently ignored.

**Fix**: Remove the `version: '3.8'` line.

---

### P3 — Dependency Maintenance

#### 7. Stryker mutation testing packages: evaluate usefulness

Three Stryker packages are installed as dev dependencies:
- `@stryker-mutator/core`
- `@stryker-mutator/jest-runner`
- `@stryker-mutator/typescript-checker`

These contribute to the dev-dependency vulnerability count (the `tmp` package vulnerability chain) and add significant dependency weight. `npm-check` flags 2 of 3 as potentially unused.

**Recommendation**: If mutation testing is part of the active workflow, keep them. If not, removing them eliminates several vulnerability chains and speeds up `npm ci`.

---

## Outstanding Items from Previous Review

These findings from the February 17 review remain unaddressed:

### Still Relevant

| Priority | Finding | Location |
|----------|---------|----------|
| High | 1 remaining runtime `require()` call in disconnect handler | `connectionHandler.ts:111` |
| High | Room sync mutex could evict active locks during LRU cleanup | `playerHandlers.ts:87-97` |
| Medium | JWT claims validation missing sessionId check | `jwtHandler.ts:48-50` |
| Medium | Timer restart async IIFE has no timeout protection | `connectionHandler.ts` disconnect path |
| Medium | `safeEmit` functions have inconsistent error propagation | `safeEmit.ts:72-214` |
| Medium | Inconsistent error handling patterns across services | Cross-cutting |
| Medium | Frontend test coverage threshold is 50% (vs 80% backend) | `jest.config.ts.js` |
| Low | Keyboard shortcut listener never removed on room leave | `accessibility.ts:45` |
| Low | `initChat()` not idempotent — accumulates duplicate listeners | `chat.ts:14-28` |
| Low | Timer start duration unbounded (no max limit) | `timerService.ts` |
| Low | IP header trust auto-detects via env vars (spoofable) | `clientIP.ts:38-49` |

### No Longer Relevant

| Finding | Reason |
|---------|--------|
| Database integration tests missing | PostgreSQL/Prisma removed |
| `database.ts` silent connection failures | File removed |
| `RedisClient` type uses `as unknown as` cast | Would need re-verification |

---

## Architecture Strengths

The following architectural qualities remain strong and are worth preserving:

1. **Strict TypeScript** — All strict flags enabled, `noUncheckedIndexedAccess`, `noImplicitOverride`, zero compile errors
2. **Comprehensive Zod validation** — All socket events and HTTP requests validated at entry points with Unicode-aware sanitization
3. **Security-first middleware ordering** — Helmet → CORS → rate limits → CSRF → routes → error handler
4. **Atomic Redis operations** — 6 Lua scripts prevent race conditions in critical game state mutations
5. **Graceful degradation** — Works fully without Redis (memory mode) or any external service
6. **Context handler pattern** — Uniform validation, rate limiting, and authorization across 34+ socket events
7. **Error hierarchy** — Typed `GameError` subclasses with safe client serialization (whitelisted error codes only)
8. **CI/CD pipeline** — lint, typecheck, build, test (multi-node matrix), security audit, Docker build+scan+verify, E2E, gate job
9. **Test suite** — 2,888 tests, 85%+ coverage, chaos/resilience tests, ReDoS regression tests, E2E
10. **ADR documentation** — 4 adopted ADRs covering Lua scripts, sessionStorage, distributed locks, and graceful degradation

---

## Prioritized Next Steps

### Immediate (P0 — blocks builds/deployments)

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 1 | Remove Prisma references from Dockerfile | `server/Dockerfile` | Small |
| 2 | Remove nonexistent file paths from ESLint config | `server/eslint.config.js` | Small |

### Security (P1 — blocks CI, fixes vulnerabilities)

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 3 | Remove `swagger-jsdoc`, use inline spec directly (fixes 3 high-severity vulns) | `server/package.json`, `server/src/config/swagger.ts`, `server/src/types/vendor.d.ts` | Small |

### Configuration (P2 — prevents environment drift)

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 4 | Align Node.js version: Dockerfile → `node:22-alpine` | `server/Dockerfile` | Small |
| 5 | Remove unused path aliases from tsconfig.json | `server/tsconfig.json` | Small |
| 6 | Remove deprecated `version` key from docker-compose.yml | `docker-compose.yml` | Small |

### Dependency hygiene (P3)

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 7 | Evaluate and potentially remove Stryker packages | `server/package.json` | Small |
| 8 | Run `npm audit fix` for safe dev-dep updates | `server/package-lock.json` | Small |

### Code quality (P4 — from previous review, still outstanding)

| # | Action | Files | Effort |
|---|--------|-------|--------|
| 9 | Replace last runtime `require()` with ES module import | `server/src/socket/connectionHandler.ts` | Small |
| 10 | Fix room sync mutex LRU eviction of active locks | `server/src/socket/handlers/playerHandlers.ts` | Medium |
| 11 | Add sessionId to JWT claims validation | `server/src/middleware/auth/jwtHandler.ts` | Small |
| 12 | Add timeout protection to disconnect handler timer restart | `server/src/socket/connectionHandler.ts` | Small |
| 13 | Increase frontend test coverage threshold to 70% | Tests + `jest.config.ts.js` | Medium |

---

*Generated by automated codebase review. Line references are approximate and should be verified against current source.*
