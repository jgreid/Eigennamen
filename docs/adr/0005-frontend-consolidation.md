# ADR-0005: Frontend Consolidation Strategy

**Date:** 2026-01-25
**Status:** Completed
**Decision Makers:** Development Team

## Context

The Codenames Online project has two frontend implementations:

1. **Monolithic Frontend** (`index.html`)
   - 5,200+ lines of inline JavaScript
   - 20+ global variables for state management
   - Difficult to test in isolation
   - Works but has maintainability concerns

2. **Modular Frontend** (`src/js/`)
   - ~3,156 lines across 6 modules
   - Clean separation of concerns (state, ui, utils, constants, qrcode, main)
   - Observable state management pattern in `state.js`
   - 106 unit tests with 93%+ coverage
   - Uses ES6 modules

## Decision

**We will consolidate to the modular frontend architecture** (`src/js/`).

The modular implementation is the target architecture. The monolithic `index.html` will be kept for backward compatibility during the transition but new features should be developed in the modular codebase.

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
| ~~`qrcode.js`~~ | ~~QR code generation~~ | ~~552~~ | *Removed — standalone mode removed* |
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
- Vitest Configuration: `vitest.config.js`
- State Management: `src/js/state.js`
- Test Files: `src/js/__tests__/`
