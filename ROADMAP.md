# Roadmap — Die Eigennamen (Codenames Online)

**Last Updated:** February 11, 2026
**Project Version:** v2.3.0

The application is production-ready. All critical, high, and medium-priority issues from the February 2026 codebase review have been resolved. This roadmap covers only remaining and future work.

For structural/architectural improvements, see [ARCHITECTURE_REVIEW.md](ARCHITECTURE_REVIEW.md).

---

## Architectural Improvements

These items are tracked in detail in `ARCHITECTURE_REVIEW.md`:

1. **Extract infrastructure from `config/`** -- Move `redis.ts`, `memoryStorage.ts`, `database.ts`, `jwt.ts` service logic into an `infrastructure/` directory
2. **Remove duplicate health endpoints** -- Consolidate `app.ts` and `routes/healthRoutes.ts` implementations
3. **Complete ESM migration** -- Remove all `module.exports`/`require()` dual-export boilerplate (~72 files)
4. **Derive types from config** -- Replace 399-line manual type mirrors with `typeof` inference
5. **Convert `socket-client.js` to TypeScript** -- Bring the 1,019-line file into the frontend build pipeline
6. **Shared PRNG module** -- Single source for Mulberry32 used by both server and client
7. **Split validators** -- Domain-specific schema files instead of monolithic `schemas.ts`
8. **Clarify dual package roots** -- Document root vs server `package.json` roles; align Playwright versions

---

## Lower Priority Improvements (Tier D)

| ID | Task | Category | Effort |
|----|------|----------|--------|
| D-1 | Implement chat UI frontend | Frontend | Medium |
| D-2 | Complete i18n markup (audit hardcoded English strings) | Frontend | Medium |
| D-3 | Gate frontend debug logging behind config flag | Performance | Low |
| D-4 | Split multiplayer.js (1,922 lines) into submodules | Architecture | Medium |
| D-5 | Migrate remaining transactions to Lua (replace watch/unwatch) | Performance | Medium |
| D-6 | Add chaos/resilience testing (simulate Redis failures) | Testing | Medium |
| D-7 | Add SRI hashes for vendored JS | Security | Low |
| D-8 | Improve admin dashboard accessibility (skip link, contrast) | Accessibility | Low |
| D-9 | Add i18n plural support | Frontend | Low |
| D-10 | Automated perf regression tests (k6 in CI) | CI/CD | Medium |
| D-11 | Add `.dockerignore` file | Infrastructure | Low |
| D-12 | Add `SECURITY.md` vulnerability disclosure policy | Docs | Low |
| D-13 | Add Dependabot config for automated dependency updates | CI/CD | Low |
| D-14 | Add ReDoS regression tests for clue regex | Testing | Low |

---

## Future Features

### High Value
| Feature | Notes |
|---------|-------|
| Chat UI (in-game) | Backend complete; needs frontend panel with team/spectator tabs |
| Player profiles | Optional persistent identity with stats tracking |
| Tournament mode | Bracket management, scheduling, score tracking |

### Medium Value
| Feature | Notes |
|---------|-------|
| Room invites | Direct player invitations via link or notification |
| Replay sharing | Shareable public replay links (API endpoint exists) |
| Admin dashboard enhancements | Real-time WebSocket metrics, word list moderation |
| Draft mode | Teams draft words before game starts |

### Ambitious
| Feature | Notes |
|---------|-------|
| AI Spymaster | Word embedding model for clue generation |
| Mobile native app | Capacitor wrapper or React Native (PWA works currently) |
| Voice chat | WebRTC integration for in-game voice |
| Observability platform | OpenTelemetry, Grafana dashboards, alerting rules |

---

## Technical Debt

| Issue | Priority |
|-------|----------|
| multiplayer.js is 1,922 lines | Medium -- split into submodules |
| Frontend debug logging always on | Low -- gate behind config |
| Mixed CJS + ESM module exports | Medium -- see ESM migration above |
| Coverage threshold mismatch (package.json vs jest.config) | Low -- align |

---

## Known Testing Gaps

- No tests for malformed WebSocket messages
- No ReDoS regression tests for clue regex
- E2E selectors use classes/IDs instead of `data-testid`
- E2E only runs on Chromium (Firefox/Safari untested)
