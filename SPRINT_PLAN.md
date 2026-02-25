# Sprint Plan: Eigennamen Online — Next 4 Sprints

**Date**: 2026-02-25
**Baseline**: v2.3.0 — 2,735 tests, 94%+ line coverage, 0 lint errors, 0 TS errors

---

## Rationale

After a thorough review of the codebase, documentation, architecture, and recent commit history, I've identified four sprints ordered by impact. The codebase is already in excellent shape — strong test coverage, well-structured services, typed errors, Lua atomics, and clean CI. These sprints target the areas where investment will compound the most: data durability, frontend modernization, operational visibility, and gameplay depth.

---

## Sprint 1: Persistent Storage & Data Durability

### Problem
All game state lives exclusively in Redis with TTL-based expiry. Restarting Redis loses all game history, replay data, and player statistics. The `fly.toml` currently runs with `REDIS_URL=memory` (single embedded process) — one crash loses everything. The docs explicitly note this gap: "Optional user accounts and game history" is documented as a goal in `ARCHITECTURE.md` but not implemented.

### Tasks

1. **Add SQLite/PostgreSQL persistence layer for game history and replays**
   - Create a `server/src/services/persistenceService.ts` that writes completed game results and replay data to durable storage
   - Use SQLite for single-instance deployments (zero config, file-based) and PostgreSQL for scaled deployments
   - Schema: `games` (id, room_code, mode, winner, duration, player_count, created_at), `game_events` (game_id, seq, event_type, data, timestamp)
   - Files: new `server/src/config/database.ts`, new migration system in `server/src/migrations/`

2. **Persist replay data on game completion**
   - Hook into `gameService.forfeitGame()` and the game-over path in `revealCard()` to write replay snapshots to the persistence layer
   - Modify `gameHistoryService.ts` to read from persistent storage when Redis data has expired
   - Update `GET /api/replays/:roomCode/:gameId` route to fall back to persistent storage

3. **Add player statistics tracking**
   - Track wins, losses, games played, cards revealed per player (keyed by nickname or optional account)
   - New `server/src/services/statsService.ts` with aggregation queries
   - New REST endpoint: `GET /api/stats/:playerId`

4. **Add data retention and cleanup policies**
   - Configurable retention period via `DATA_RETENTION_DAYS` env var (default: 90)
   - Background job to prune old records (runs daily)
   - Document backup procedures in `docs/BACKUP_AND_DR.md` (which already exists but references Redis-only)

5. **Update Fly.io deployment for external Redis**
   - Add `fly redis create` instructions and update `fly.toml` to remove `REDIS_URL=memory` default
   - Document the transition path in `docs/DEPLOYMENT.md`

### Impact
- Game replays survive server restarts
- Players can see their historical stats
- Enables future features like leaderboards and ranked play (noted as backlog in SERVER_SPEC.md)

---

## Sprint 2: Frontend Modernization & Bundle Optimization

### Problem
The frontend is 38 TypeScript modules compiled individually by `tsc` (dev) or bundled by esbuild (prod). The architecture is vanilla JS with a mutable global state singleton (`state.ts` with 50+ properties), direct DOM manipulation, and no component abstraction. While functional, this creates several issues:
- The `state.ts` object mixes unrelated concerns (game state, UI state, timer state, multiplayer state, replay state)
- 8 CSS files are loaded as separate HTTP requests with no critical CSS extraction
- The `index.html` is a 400+ line monolith with all HTML hardcoded
- No service worker for offline play despite PWA manifest existing

### Tasks

1. **Decompose the state singleton into domain-specific stores**
   - Split `_rawState` in `server/src/frontend/state.ts` into focused stores: `gameStore`, `multiplayerStore`, `uiStore`, `timerStore`, `replayStore`
   - Each store gets its own file with typed accessors and change subscriptions
   - Use a lightweight pub/sub pattern so UI modules subscribe to relevant state changes instead of pulling from one global object
   - Preserve backward compatibility: re-export a unified `state` proxy from `state.ts`

2. **Implement CSS bundling and critical CSS extraction**
   - Extend `esbuild.config.js` to bundle the 8 CSS files into a single minified stylesheet
   - Extract critical above-the-fold CSS (board + sidebar) as inline `<style>` in `index.html`
   - Add CSS custom property documentation to `variables.css`
   - Estimated savings: 7 fewer HTTP requests, ~30% smaller total CSS

3. **Add a service worker for offline standalone mode**
   - Standalone mode (URL-encoded state) should work fully offline
   - Service worker caches: `index.html`, bundled JS/CSS, QR code lib, locale files, word list
   - Register in `index.html` with feature detection
   - Add `sw.js` to `server/public/` with cache-first strategy for static assets
   - This completes the PWA story — the manifest already exists at `/manifest.json`

4. **Reduce initial page load with deferred module loading**
   - The esbuild config already has `splitting: true` — verify chunks are actually produced and that non-critical modules (history, chat, settings, debug, accessibility) are lazy-loaded
   - Add dynamic `import()` for the replay system (history.ts), debug tools (debug.ts), and chat module (chat.ts) — these are only needed after user interaction
   - Measure and document bundle sizes in CI (add esbuild `--analyze` output to CI summary)

5. **Add frontend error boundary and crash reporting**
   - Wrap `init()` in `app.ts` with structured error recovery (currently catches but only shows a generic modal)
   - Add `window.onerror` and `window.onunhandledrejection` handlers that log to the server via `POST /api/client-errors`
   - New backend endpoint collects frontend errors for debugging production issues

### Impact
- Faster page loads (fewer requests, smaller bundles, offline caching)
- Better developer experience when working on frontend code
- Offline standalone play works without network
- Visibility into frontend errors in production

---

## Sprint 3: Observability, Monitoring & Operational Readiness

### Problem
The metrics system (`server/src/utils/metrics.ts`) collects counters, gauges, and histograms in memory with Prometheus export, but there's no alerting, no dashboards, no structured log aggregation, and no runbook. The admin dashboard (`admin.html`) shows basic stats but has no historical view. The `docs/BACKUP_AND_DR.md` file exists but is focused on Redis-only scenarios. Production issues would require SSH-ing into the Fly.io machine and reading raw logs.

### Tasks

1. **Add structured JSON logging for production**
   - Winston is already configured but uses text format by default
   - Add `LOG_FORMAT=json` env var support that outputs structured JSON (timestamp, level, message, correlation_id, room_code, session_id)
   - Integrate with Fly.io log drain (document setup for Datadog/Grafana Cloud/Logtail)
   - Add request duration logging middleware for all HTTP endpoints

2. **Build a metrics dashboard into the admin panel**
   - Extend `admin.html` with a historical metrics view using the existing SSE stream (`/admin/api/stats/stream`)
   - Add time-series charts for: active rooms (last 24h), socket connections, operation latency p95, error rate
   - Use a lightweight charting library (Chart.js or uPlot, vendored like qrcode.min.js)
   - Add Redis memory usage display with the existing `getRedisMemoryInfo()` API

3. **Add health check enhancements and SLO tracking**
   - Extend `/health/metrics` to include uptime SLO data (target: 99.9%)
   - Add circuit breaker pattern for Redis operations — if Redis is unhealthy for >30s, reject new room creations gracefully instead of hanging
   - Add `/health/diagnostics` endpoint (admin-only) that returns: event loop lag, memory pressure, active lock count, pub/sub health status
   - Track and expose "time since last successful game completion" as a liveness signal

4. **Create an operations runbook**
   - New `docs/RUNBOOK.md` covering: common failure modes, how to diagnose them, remediation steps
   - Scenarios: Redis connection loss, memory pressure, socket connection storms, orphaned rooms, Lua script failures
   - Include Fly.io specific troubleshooting (`fly ssh console`, `fly logs`, `fly status`)
   - Add alerting rules recommendations (e.g., Fly.io Prometheus alerts for memory > 80%, error rate > 5/min)

5. **Add correlation ID propagation for WebSocket events**
   - `server/src/utils/correlationId.ts` exists but verify it's threaded through all socket handlers
   - Ensure every log line from a single player action (e.g., card reveal) shares the same correlation ID
   - Add correlation ID to error responses so users can report issues with a traceable reference

### Impact
- Production issues become diagnosable without SSH access
- Historical metrics enable capacity planning
- Operations team (or solo dev) has clear playbook for incidents
- Correlation IDs make support requests actionable

---

## Sprint 4: Gameplay Enhancements & Community Features

### Problem
The game supports three modes (Classic, Blitz, Duet) with a single English word list of ~380 words. There's i18n for the UI (en/de/es/fr) but only English game words. The chat system is basic (text only). There's no way for the community to contribute word lists, and no way to share/browse public replays. The SERVER_SPEC.md notes "Tournament/ranked play mode" as deferred.

### Tasks

1. **Add localized word lists**
   - Create word lists for German, Spanish, and French in `server/public/locales/` (matching existing i18n languages)
   - Auto-select word list based on room language setting (new room setting: `language`)
   - Allow custom word lists to be uploaded per-room (already partially supported via settings UI) — extend to validate minimum unique words
   - Add word list selection to the settings modal with preview

2. **Implement a clue-giving UI for spymasters**
   - Currently, clues are just announced in chat with no structured format
   - Add a dedicated "Give Clue" panel for spymasters: text input + number selector (how many cards)
   - Validate clue format server-side (new Zod schema in `gameSchemas.ts`)
   - Display the current clue prominently on the board for all players
   - Track clue history per game (feeds into the replay system)

3. **Add a public replay gallery**
   - New page `/replays` that lists recently completed games (public, anonymous)
   - Filter by game mode, date, and language
   - Shareable replay links already work (`/replay/:roomCode/:gameId`) — add discoverability
   - New REST endpoints: `GET /api/replays/recent`, `GET /api/replays/featured`
   - Requires Sprint 1's persistent storage to be meaningful

4. **Enhance the chat system**
   - Add emoji reactions to chat messages (click-to-react, not full emoji picker)
   - Add system messages for game events (card revealed, turn ended, player joined/left) — some exist but aren't consistent
   - Add chat message timestamps
   - Add "whisper" messages between teammates (visible only to same team)

5. **Add room customization options**
   - Custom team names (UI exists but expand options: color picker for team colors)
   - Room themes (dark/light/custom CSS variables) — extend `variables.css` design token system
   - Configurable board size (e.g., 4x4 mini mode for quick games) — requires changes to `BOARD_SIZE` constant and `boardGenerator.ts`
   - Game speed presets beyond Blitz (e.g., "Lightning" with 15s turns, "Relaxed" with 5min turns)

### Impact
- Broader international appeal with localized word lists
- Better spymaster experience with structured clue UI
- Community engagement through replay sharing
- More gameplay variety with room customization

---

## Sprint Dependencies

```
Sprint 1 (Storage) ─────────────────────────────────────┐
                                                         │
Sprint 2 (Frontend) ── independent, can run in parallel  │
                                                         │
Sprint 3 (Observability) ── independent                  │
                                                         │
Sprint 4 (Gameplay) ── Task 3 (Replay Gallery) depends ──┘
                       on Sprint 1 persistent storage
```

Sprints 1, 2, and 3 are independent and could be parallelized across developers. Sprint 4 Task 3 (replay gallery) depends on Sprint 1's persistent storage layer.

## Risk Assessment

| Sprint | Risk | Mitigation |
|--------|------|------------|
| 1 | Migration complexity with Redis + SQL dual-write | Start with write-through to SQL on game completion only; Redis remains source of truth for active games |
| 2 | Service worker caching stale assets | Use content-hash versioning (esbuild already produces `[hash]` chunks) |
| 3 | Structured logging performance overhead | JSON serialization is ~2x slower than text — benchmark and only enable in production |
| 4 | Localized word lists quality | Source from existing open-source Codenames word list projects; community review |

## Success Metrics

| Sprint | KPI |
|--------|-----|
| 1 | Replays survive Redis restart; player stats page renders |
| 2 | Lighthouse PWA score > 90; offline standalone mode works; LCP < 2s |
| 3 | Zero SSH-required incidents; mean-time-to-diagnose < 5 minutes |
| 4 | Non-English games played > 10% of total within 30 days of launch |
