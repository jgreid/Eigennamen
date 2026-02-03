# ADR-0005: Frontend Consolidation Strategy

**Date:** 2026-01-25
**Status:** Superseded
**Decision Makers:** Development Team
**Superseded By:** The consolidation was completed in 2026-02, but in the opposite direction — the `server/public/js/modules/` codebase (loaded by `index.html`) was retained as the production frontend, and `src/js/` was deleted as legacy code.

## Context

The Codenames Online project had two frontend implementations:

1. **Monolithic Frontend** (`index.html`)
   - Originally 5,200+ lines of inline JavaScript
   - Later refactored to modular ES6 code in `server/public/js/modules/`
   - This became the production frontend

2. **Experimental Modular Frontend** (`src/js/`)
   - ~3,156 lines across 6 modules
   - Clean separation of concerns (state, ui, utils, constants, qrcode, main)
   - Observable state management pattern in `state.js`
   - 106 unit tests with 93%+ coverage
   - Uses ES6 modules

## Decision (Original)

**We will consolidate to the modular frontend architecture** (`src/js/`).

The modular implementation is the target architecture. The monolithic `index.html` will be kept for backward compatibility during the transition but new features should be developed in the modular codebase.

## Outcome (2026-02)

The consolidation took a different path:
- `index.html` was refactored to load modular code from `server/public/js/modules/`
- The `src/js/` codebase was deleted as it was superseded by the `server/public/js/modules/` implementation
- `index-modular.html` (which loaded `src/js/`) was deleted
- Frontend testing is now done via E2E tests (Playwright) and server integration tests (Jest)

## Rationale

### Advantages of Modular Frontend

1. **Testability**
   - Already has 106 unit tests
   - 93%+ code coverage
   - Easy to add more tests

2. **State Management**
   - Clean observable pattern in `state.js`
   - Immutable-like getters return copies
   - Clear separation of game, player, wordlist, and team state
   - State change notifications via subscription

3. **Build Infrastructure**
   - Vite configured for dev server and production builds
   - Vitest configured for unit testing with jsdom
   - Path aliases for clean imports (@js, @css)
   - Source maps for debugging

4. **Maintainability**
   - Single responsibility principle per module
   - Clear interfaces between modules
   - JSDoc documentation

### Migration Path

1. **Phase 1 (Current):** Both implementations coexist
   - `index.html` serves as the production frontend
   - `src/js/` modules are tested and refined

2. **Phase 2:** Feature parity
   - Ensure all `index.html` functionality exists in modules
   - Add multiplayer/Socket.io support to modular frontend

3. **Phase 3:** Switch
   - Update `index.html` to import bundled modules
   - Or replace with `src/index.html` that uses modules

4. **Phase 4:** Cleanup
   - Remove inline JavaScript from `index.html`
   - Archive or remove duplicate code

## Modules Overview

| Module | Purpose | Lines | Test Coverage |
|--------|---------|-------|---------------|
| `constants.js` | Game constants (board size, team cards, etc.) | 95 | 100% |
| `state.js` | Centralized state management | 719 | 90% |
| `utils.js` | PRNG, hashing, shuffling utilities | 283 | 95% |
| `qrcode.js` | QR code generation | 552 | 96% |
| `ui.js` | DOM manipulation helpers | 705 | Excluded* |
| `main.js` | Application entry point, event wiring | 802 | Excluded* |

*Excluded from coverage thresholds due to DOM dependency requirements.

## Consequences

### Positive
- Improved code quality and maintainability
- Better test coverage and confidence
- Clear path for future enhancements
- Modern development workflow (Vite HMR)

### Negative
- Transition period with two codebases
- Learning curve for contributors
- Need to maintain feature parity during migration

### Neutral
- Build step required for production
- Browser compatibility handled by Vite

## Implementation Notes

### Running Tests
```bash
# Unit tests
npm run test:unit

# With coverage
npm run test:unit:coverage

# Watch mode
npm run test:unit:watch
```

### Development Server
```bash
# Start Vite dev server (hot reload)
npm run dev

# Proxies /api and /socket.io to localhost:3000
```

### Production Build
```bash
npm run build
# Output in dist/
```

## References

- Vite Configuration: `vite.config.js`
- Production Frontend: `server/public/js/modules/`
- Server Tests: `server/src/__tests__/`
- E2E Tests: `tests/` (Playwright)
