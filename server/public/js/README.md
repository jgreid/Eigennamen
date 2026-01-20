# Codenames Frontend Modules

This directory contains the modular frontend architecture for Codenames.

## Architecture Overview

The frontend is split into four main modules:

### 1. `state.js` - State Management
- `EventEmitter` - Custom event system for state change notifications
- `StateStore` - Generic state container with change detection
- `AppState` - Main application state manager with:
  - `game` - Game state (board, scores, turn)
  - `player` - Player state (role, team)
  - `ui` - UI state (modals, settings)
  - `settings` - Game settings (team names, word list)

### 2. `game.js` - Game Logic
- `seededRandom()` - Mulberry32 PRNG (synced with server)
- `hashString()` - String to numeric seed conversion
- `shuffleWithSeed()` - Deterministic array shuffle
- `initGame()` - Initialize game with word list
- `initGameWithWords()` - Initialize with specific board words
- `revealCard()` - Reveal card and update state (immutable)
- `endTurn()` - End current turn
- `checkGameOver()` - Check win conditions

### 3. `ui.js` - UI Components
- `ElementCache` - DOM element caching for performance
- `ScreenReaderAnnouncer` - Accessibility announcements
- `ToastManager` - Toast notification system
- `ModalManager` - Modal dialog management with focus trapping
- `BoardRenderer` - Game board rendering with incremental updates

### 4. `app.js` - Application Entry Point
- `CodenamesApp` - Main application class
- Coordinates all modules
- Handles user interactions
- Manages URL state

## Usage

### With Module System (Server Mode)
```html
<script src="/js/state.js"></script>
<script src="/js/game.js"></script>
<script src="/js/ui.js"></script>
<script src="/js/app.js"></script>
```

### Standalone Mode
The original `index.html` contains all code inline and works without a server.

## Global Exports

When loaded in a browser, modules export to `window`:

- `window.CodenamesState` - State management classes
- `window.CodenamesGame` - Game logic functions
- `window.CodenamesUI` - UI component classes
- `window.codenamesApp` - Application instance

## Backward Compatibility

The `app.js` module exposes global functions for HTML onclick handlers:
- `newGame()`, `confirmNewGame()`
- `setTeam()`, `setSpymaster()`, `setClicker()`
- `endTurn()`, `copyLink()`
- `openSettings()`, `closeSettings()`, `saveSettings()`
- Modal functions, etc.

## State Flow

```
User Action → Event Handler → State Update → UI Update
                   ↓
              URL Update (for standalone mode)
```

## Key Design Decisions

1. **Immutable Updates**: State changes create new objects
2. **Event-Driven**: UI subscribes to state changes
3. **DOM Caching**: Elements cached on init for performance
4. **requestAnimationFrame**: UI updates batched for smoothness
5. **Backward Compatible**: Works with existing HTML onclick handlers
