# Frontend Consolidation Plan

**Date:** 2026-01-25
**Status:** Draft
**References:** ADR-0005, Sprint Plan 19-20-21

---

## Executive Summary

The Codenames Online project has **three separate frontend implementations** that need to be consolidated into a single, maintainable codebase. This document provides a detailed, actionable plan to achieve that consolidation.

### Current State

| Implementation | Location | Lines | Status |
|----------------|----------|-------|--------|
| **Monolithic** | `/index.html` | 7,323 | Production (active) |
| **Legacy Modular** | `/server/public/js/` | ~3,100 | Deprecated |
| **New Modular** | `/src/js/` | ~5,500 | Target architecture |

### Target State

Single modular frontend in `/src/js/` with:
- Vite-bundled production build
- 93%+ test coverage
- Clean separation of concerns
- Modern ES6 modules

---

## Phase 1: Preparation & Verification (1-2 days)

### 1.1 Feature Parity Audit

Before migration, verify the new modular frontend (`/src/js/`) has complete feature parity with the monolithic version.

**Checklist:**

| Feature | Monolithic | New Modular | Gap |
|---------|------------|-------------|-----|
| Standalone game (URL state) | ✓ | ✓ | None |
| Multiplayer (Socket.io) | ✓ | ✓ | None |
| Spymaster/Clicker roles | ✓ | ✓ | None |
| Custom word lists | ✓ | ✓ | None |
| Team name customization | ✓ | ✓ | None |
| Turn timer | ✓ | ✓ | None |
| QR code sharing | ✓ | ✓ | None |
| Game forfeit | ✓ | ✓ | None |
| Spectator mode | ✓ | ✓ | None |
| Settings persistence | ✓ | ✓ | None |
| Toast notifications | ✓ | ✓ | None |
| Modal management | ✓ | ✓ | None |
| Keyboard navigation | ✓ | ✓ | None |
| Screen reader support | ✓ | ✓ | None |

**Action Items:**
1. Run full E2E test suite against both implementations
2. Manual testing of edge cases
3. Document any gaps found

### 1.2 Backup Current Production

```bash
# Create backup branch
git checkout -b backup/pre-consolidation-$(date +%Y%m%d)
git push origin backup/pre-consolidation-$(date +%Y%m%d)
```

---

## Phase 2: Build Pipeline Setup (1-2 days)

### 2.1 Vite Production Build Configuration

The project already has Vite configured. Verify the production build works correctly.

**Current Configuration (`vite.config.js`):**
```javascript
export default {
  root: '.',
  build: {
    outDir: './dist/'
  },
  server: {
    port: 5173,
    proxy: {
      '/socket.io': 'http://localhost:3000',
      '/api': 'http://localhost:3000',
      '/health': 'http://localhost:3000'
    }
  },
  resolve: {
    alias: {
      '@js': '/src/js',
      '@css': '/src/css'
    }
  }
}
```

**Action Items:**
1. Run `npm run build` and verify output
2. Test built output serves correctly
3. Verify standalone mode works from built files
4. Verify multiplayer mode works from built files

### 2.2 Create Production Entry Point

Create a new `index.html` that uses the modular build:

**File: `/index-new.html`** (to be created)
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Codenames Online</title>
  <link rel="stylesheet" href="/src/css/main.css">
  <!-- PWA -->
  <link rel="manifest" href="/public/manifest.json">
  <meta name="theme-color" content="#1a1a2e">
</head>
<body>
  <!-- HTML structure from original index.html -->
  <script type="module" src="/src/js/main.js"></script>
</body>
</html>
```

---

## Phase 3: Code Consolidation (3-5 days)

### 3.1 PRNG Synchronization

**Problem:** Mulberry32 PRNG exists in 3 places. All must be identical for deterministic board generation.

**Current Locations:**
1. `/src/js/utils.js` (lines 22-31) - Client modular
2. `/server/public/js/game.js` (lines 1-20) - Legacy client
3. `/server/src/services/gameService.js` - Server

**Solution:** Create shared PRNG module

**File: `/src/js/prng.js`** (to be created)
```javascript
/**
 * Mulberry32 PRNG - Deterministic random number generator
 * CRITICAL: This exact implementation must match server-side
 *
 * @param {number} seed - 32-bit integer seed
 * @returns {function} - Function returning random number [0, 1)
 */
export function mulberry32(seed) {
  return function() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle using seeded PRNG
 */
export function shuffleWithSeed(array, seed) {
  const result = [...array];
  const rng = mulberry32(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Convert string to numeric seed
 */
export function hashString(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash);
}
```

**Migration Steps:**
1. Create `/src/js/prng.js` with shared implementation
2. Update `/src/js/utils.js` to import from `prng.js`
3. Update server to use same algorithm (already matches)
4. Add tests verifying client-server produce identical results
5. Remove duplicate PRNG from `/server/public/js/game.js`

### 3.2 Default Words Consolidation

**Problem:** 400-word array duplicated in:
1. `/src/js/state.js` (lines 30-82)
2. `/index.html` (inline)

**Solution:** Single source of truth

**File: `/src/js/words.js`** (to be created)
```javascript
/**
 * Default Codenames word list
 * 400 classic Codenames words
 */
export const DEFAULT_WORDS = [
  'AFRICA', 'AGENT', 'AIR', 'ALIEN', 'ALPS', 'AMAZON', 'AMBULANCE', 'AMERICA',
  // ... rest of words
];

export default DEFAULT_WORDS;
```

**Migration Steps:**
1. Extract words to `/src/js/words.js`
2. Update `/src/js/state.js` to import from `words.js`
3. Remove inline word list from monolithic `index.html`

### 3.3 CSS Extraction

**Problem:** CSS exists in two places:
1. `/src/css/main.css` (2,226 lines) - Extracted, refined
2. `/index.html` lines 23-3770 (3,748 lines) - Inline, older

**Solution:** Use extracted CSS exclusively

**Migration Steps:**
1. Compare `/src/css/main.css` with inline CSS
2. Identify any missing styles in extracted version
3. Add missing styles to `/src/css/main.css`
4. Update production build to use extracted CSS
5. Remove inline CSS from `index.html` in final phase

### 3.4 Socket.io Layer Consolidation

**Problem:** Three Socket.io implementations:
1. `/src/js/socket.js` + `/src/js/multiplayer.js` (1,446 lines) - New, clean
2. `/server/public/js/socket-client.js` (874 lines) - Legacy
3. `/index.html` (inline) - Monolithic

**Solution:** Use new modular implementation exclusively

**New Modular Architecture:**
```
socket.js (750 lines)
├── Connection management
├── Event abstraction
├── Reconnection logic
└── Error handling

multiplayer.js (696 lines)
├── Room management
├── Game actions
├── Player management
└── High-level API
```

**Migration Steps:**
1. Verify `/src/js/socket.js` handles all server events
2. Verify `/src/js/multiplayer.js` provides all required APIs
3. Document any missing functionality
4. Add missing handlers if needed
5. Mark `/server/public/js/socket-client.js` as deprecated

### 3.5 QR Code Consolidation

**Problem:** Two QR code approaches:
1. `/src/js/qrcode.js` (552 lines) - Self-contained
2. `/index.html` - Uses CDN library

**Solution:** Use self-contained implementation

**Advantages:**
- No external dependency
- Works offline
- Consistent behavior
- Already tested (96% coverage)

**Migration Steps:**
1. Remove CDN script tag from `index.html`
2. Import `qrcode.js` module in build
3. Update any QR generation calls

---

## Phase 4: Service Worker Consolidation (1 day)

### 4.1 Service Worker Unification

**Problem:** Two service workers:
1. `/public/sw.js` - References new modular paths (`/src/js/`)
2. `/server/public/service-worker.js` - References old paths (`/js/`)

**Solution:** Single service worker aligned with new architecture

**File: `/public/sw.js`** (update existing)
```javascript
const CACHE_NAME = 'codenames-v5.0.0';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/src/css/main.css',
  '/src/js/main.js',
  '/src/js/state.js',
  '/src/js/ui.js',
  '/src/js/utils.js',
  '/src/js/constants.js',
  '/src/js/socket.js',
  '/src/js/multiplayer.js',
  '/src/js/qrcode.js',
  '/src/js/prng.js',
  '/src/js/words.js',
  '/wordlist.txt'
];
```

**Migration Steps:**
1. Update `/public/sw.js` asset list
2. Increment cache version
3. Remove `/server/public/service-worker.js`
4. Update service worker registration in `index.html`

---

## Phase 5: HTML Structure Migration (2-3 days)

### 5.1 Extract HTML Template

The current `index.html` has HTML structure embedded with inline CSS/JS. Extract clean HTML.

**Structure to preserve:**
```html
<body>
  <div class="app-container">
    <aside class="sidebar">
      <!-- Game title, role banner, scoreboard, controls -->
    </aside>
    <main class="main-content">
      <div class="game-board">
        <!-- 25 card grid -->
      </div>
    </main>
  </div>

  <!-- Modals -->
  <div id="settings-modal" class="modal-overlay">...</div>
  <div id="new-game-modal" class="modal-overlay">...</div>
  <div id="end-turn-modal" class="modal-overlay">...</div>
  <div id="game-over-modal" class="modal-overlay">...</div>
  <div id="error-modal" class="modal-overlay">...</div>
</body>
```

**Migration Steps:**
1. Create `/src/index.html` with clean HTML structure
2. Link to `/src/css/main.css`
3. Add module script tag for `/src/js/main.js`
4. Test all UI interactions
5. Verify accessibility (ARIA labels, focus management)

### 5.2 Update Event Bindings

The modular `main.js` needs to wire up all DOM events.

**Event Categories:**

| Category | Events | Handler Module |
|----------|--------|----------------|
| Game Board | Card clicks | `main.js` → `state.js` |
| Controls | New game, end turn | `main.js` |
| Settings | Form inputs | `main.js` → `state.js` |
| Modals | Open/close | `ui.js` |
| Multiplayer | Room actions | `main.js` → `multiplayer.js` |

**Migration Steps:**
1. Audit all `onclick`, `onchange` handlers in monolithic
2. Verify all events handled in `main.js`
3. Add missing event handlers
4. Use event delegation where possible

---

## Phase 6: Testing & Validation (2-3 days)

### 6.1 Unit Test Updates

Ensure all new/modified modules have tests.

**Test Coverage Targets:**
| Module | Current | Target |
|--------|---------|--------|
| `constants.js` | 100% | 100% |
| `state.js` | 90% | 95% |
| `utils.js` | 95% | 95% |
| `prng.js` | N/A | 100% |
| `words.js` | N/A | 100% |
| `socket.js` | 85% | 90% |
| `multiplayer.js` | 80% | 85% |
| `qrcode.js` | 96% | 96% |
| `ui.js` | Excluded | Excluded |
| `main.js` | Excluded | Excluded |

**New Tests to Add:**
1. `prng.test.js` - PRNG determinism tests
2. `words.test.js` - Word list validation
3. Client-server PRNG synchronization test

### 6.2 E2E Test Verification

Run full E2E suite against new modular build.

```bash
cd server
npm run test:e2e
```

**E2E Test Categories:**
- Standalone game flow
- Multiplayer game flow
- Accessibility checks
- Timer functionality
- Settings persistence

### 6.3 Manual Testing Checklist

| Test Case | Standalone | Multiplayer |
|-----------|------------|-------------|
| New game creation | [ ] | [ ] |
| Card revealing | [ ] | [ ] |
| Turn ending | [ ] | [ ] |
| Spymaster view | [ ] | [ ] |
| Clicker view | [ ] | [ ] |
| Spectator mode | [ ] | [ ] |
| Custom word list | [ ] | [ ] |
| Team name change | [ ] | [ ] |
| QR code generation | [ ] | [ ] |
| URL sharing | [ ] | [ ] |
| Timer functionality | [ ] | [ ] |
| Game forfeit | [ ] | [ ] |
| Reconnection | [ ] | [ ] |
| Mobile responsiveness | [ ] | [ ] |
| Keyboard navigation | [ ] | [ ] |
| Screen reader | [ ] | [ ] |

---

## Phase 7: Deployment & Cutover (1 day)

### 7.1 Gradual Rollout Strategy

**Stage 1: Shadow Deployment**
- Deploy new build alongside existing
- Route 10% of traffic to new build
- Monitor for errors

**Stage 2: Canary Release**
- Increase to 50% traffic
- Compare metrics (errors, performance)
- Verify no regressions

**Stage 3: Full Rollout**
- Switch 100% traffic to new build
- Keep old build available for rollback

### 7.2 Rollback Plan

If issues detected:
```bash
# Immediate rollback to monolithic
git checkout backup/pre-consolidation-YYYYMMDD -- index.html
git commit -m "Rollback: revert to monolithic frontend"
git push origin main
```

### 7.3 Monitoring

**Metrics to Watch:**
- JavaScript error rate
- WebSocket connection failures
- Page load time
- User session duration
- Game completion rate

---

## Phase 8: Cleanup (1-2 days)

### 8.1 Remove Deprecated Code

After successful rollout, remove:

| File/Directory | Lines | Action |
|----------------|-------|--------|
| `/server/public/js/app.js` | 644 | Delete |
| `/server/public/js/socket-client.js` | 874 | Delete |
| `/server/public/js/ui.js` | 534 | Delete |
| `/server/public/js/game.js` | 331 | Delete |
| `/server/public/js/state.js` | 364 | Delete |
| `/server/public/js/ARCHITECTURE.md` | 103 | Delete |
| `/server/public/js/README.md` | - | Delete |
| `/server/public/service-worker.js` | ~200 | Delete |
| `/index-modular.html` | 324 | Delete |

**Total Cleanup:** ~3,400 lines

### 8.2 Archive Original Monolithic

```bash
# Move to archive
mv index.html docs/archive/index-monolithic-backup.html
git add docs/archive/index-monolithic-backup.html
git commit -m "Archive original monolithic index.html"
```

### 8.3 Update Documentation

Update these files:
- `CLAUDE.md` - Remove references to dual implementation
- `README.md` - Update development instructions
- `docs/ARCHITECTURE.md` - Document new structure
- `/server/public/js/ARCHITECTURE.md` - Remove after archiving

---

## File Mapping Summary

### Files to Create

| File | Purpose | Priority |
|------|---------|----------|
| `/src/js/prng.js` | Shared PRNG module | HIGH |
| `/src/js/words.js` | Default word list | HIGH |
| `/src/index.html` | New production entry point | HIGH |

### Files to Modify

| File | Changes | Priority |
|------|---------|----------|
| `/src/js/utils.js` | Import from prng.js | HIGH |
| `/src/js/state.js` | Import from words.js | HIGH |
| `/src/css/main.css` | Add any missing styles | MEDIUM |
| `/public/sw.js` | Update asset list | MEDIUM |
| `/vite.config.js` | Ensure production build | HIGH |

### Files to Delete (After Success)

| File | Size |
|------|------|
| `/server/public/js/*.js` (5 files) | ~105 KB |
| `/server/public/service-worker.js` | ~7 KB |
| `/index-modular.html` | ~18 KB |

### Files to Archive

| File | Destination |
|------|-------------|
| `/index.html` (original) | `/docs/archive/index-monolithic-backup.html` |

---

## Timeline Estimate

| Phase | Duration | Dependencies |
|-------|----------|--------------|
| 1. Preparation | 1-2 days | None |
| 2. Build Pipeline | 1-2 days | Phase 1 |
| 3. Code Consolidation | 3-5 days | Phase 2 |
| 4. Service Worker | 1 day | Phase 3 |
| 5. HTML Migration | 2-3 days | Phase 4 |
| 6. Testing | 2-3 days | Phase 5 |
| 7. Deployment | 1 day | Phase 6 |
| 8. Cleanup | 1-2 days | Phase 7 |

**Total: 12-19 days** (with buffer for unexpected issues)

---

## Success Criteria

### Technical Criteria
- [ ] Single frontend implementation (no dual code paths)
- [ ] All E2E tests passing
- [ ] Unit test coverage ≥ 90% on core modules
- [ ] Production build < 200 KB gzipped
- [ ] Lighthouse performance score ≥ 90
- [ ] Zero JavaScript errors in production logs

### Functional Criteria
- [ ] Standalone mode works identically
- [ ] Multiplayer mode works identically
- [ ] All settings persist correctly
- [ ] QR codes generate correctly
- [ ] Timer works across all modes
- [ ] Reconnection works for multiplayer

### Maintainability Criteria
- [ ] Clear module boundaries
- [ ] All modules documented with JSDoc
- [ ] Development workflow documented
- [ ] No deprecated code remaining

---

## Risks & Mitigations

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Feature regression | Medium | High | Comprehensive E2E tests |
| Browser compatibility | Low | Medium | Vite handles transpilation |
| Performance degradation | Low | Medium | Lighthouse CI checks |
| Rollback needed | Medium | Low | Backup branch ready |
| Incomplete migration | Medium | Medium | Phased approach, checkpoints |

---

## Appendix: Module Dependency Graph

```
main.js (entry point)
├── constants.js
├── state.js
│   └── words.js
├── ui.js
│   └── qrcode.js
├── utils.js
│   └── prng.js
├── socket.js
└── multiplayer.js
    └── socket.js
```

---

## Appendix: Current vs Target Architecture

### Current (Three Implementations)
```
index.html (7,323 lines)
├── Inline CSS (3,748 lines)
├── Inline JS (3,521 lines)
└── Self-contained

server/public/js/ (Legacy Modular)
├── app.js (644 lines)
├── socket-client.js (874 lines)
├── ui.js (534 lines)
├── game.js (331 lines)
└── state.js (364 lines)

src/js/ (New Modular)
├── main.js (1,234 lines)
├── state.js (939 lines)
├── ui.js (946 lines)
├── socket.js (750 lines)
├── multiplayer.js (696 lines)
├── utils.js (283 lines)
├── constants.js (95 lines)
└── qrcode.js (552 lines)
```

### Target (Single Modular)
```
src/
├── index.html (< 500 lines)
├── css/
│   └── main.css (2,300 lines)
└── js/
    ├── main.js (entry)
    ├── state.js
    ├── ui.js
    ├── socket.js
    ├── multiplayer.js
    ├── utils.js
    ├── constants.js
    ├── qrcode.js
    ├── prng.js (new)
    └── words.js (new)

dist/ (production build)
├── index.html
├── assets/
│   ├── main-[hash].css
│   └── main-[hash].js
└── (static assets)
```

---

*Last Updated: 2026-01-25*
