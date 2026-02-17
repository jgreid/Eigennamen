# Frontend JavaScript Architecture

This document explains the relationship between the modular JavaScript files in `/server/public/js/` and the main `index.html` file.

## Overview

The frontend can operate in two modes:

1. **Standalone Mode** - Uses the monolithic `index.html` with embedded JavaScript
2. **Server Mode** - Uses modular JavaScript files served by the Node.js server

## File Structure

All modules are compiled from TypeScript source in `server/src/frontend/`.

```
server/public/js/
├── modules/
│   ├── frontend/              # Compiled frontend modules
│   │   ├── handlers/          # Domain-specific event handlers
│   │   │   ├── chatEventHandlers.js
│   │   │   ├── gameEventHandlers.js
│   │   │   ├── playerEventHandlers.js
│   │   │   ├── roomEventHandlers.js
│   │   │   ├── timerEventHandlers.js
│   │   │   └── errorMessages.js
│   │   ├── app.js             # Main application entry point
│   │   ├── board.js           # Board rendering & card interaction
│   │   ├── chat.js            # Chat UI
│   │   ├── game.js            # Game logic, PRNG, URL encoding
│   │   ├── multiplayer.js     # Multiplayer core & barrel re-export
│   │   ├── multiplayerListeners.js  # Thin orchestrator (delegates to handlers/)
│   │   ├── multiplayerSync.js       # State synchronization & cleanup
│   │   ├── multiplayerUI.js         # Multiplayer UI components
│   │   ├── state.js           # Centralized state management
│   │   ├── stateMutations.js  # Controlled state mutation helpers
│   │   ├── ui.js              # Toast, modals, announcements
│   │   ├── roles.js           # Role/team selection & switching
│   │   ├── history.js         # Game replay system
│   │   ├── settings.js        # Settings panel management
│   │   ├── timer.js           # Timer display & status
│   │   ├── i18n.js            # Internationalization
│   │   ├── accessibility.js   # Keyboard shortcuts, colorblind mode
│   │   ├── notifications.js   # Sound & tab notifications
│   │   ├── logger.js          # Frontend logging utility
│   │   ├── debug.js           # Debug utilities
│   │   ├── url-state.js       # URL state encoding/decoding
│   │   ├── utils.js           # Helper functions, PRNG, clipboard
│   │   ├── constants.js       # Shared constants & validators
│   │   ├── clientAccessor.js  # Socket client accessor
│   │   ├── socket-client.js         # Socket.io communication layer
│   │   ├── socket-client-events.js  # Socket event definitions
│   │   ├── socket-client-storage.js # Socket session storage
│   │   ├── socket-client-types.js   # Socket type definitions
│   │   ├── multiplayerTypes.js      # Multiplayer type definitions
│   │   └── stateTypes.js            # State type definitions
│   ├── shared/                # Shared constants (validation, game rules)
│   └── chunks/                # Build chunks
├── socket-client.js           # Legacy socket client wrapper
├── qrcode.min.js              # QR code generation (vendored)
├── socket.io.min.js           # Socket.io client (vendored)
└── ARCHITECTURE.md            # This file
```

## Module Responsibilities

### Core Modules

- **`app.js`** — Application orchestration: module initialization, event routing via `data-action` delegation, modal registration, dependency injection
- **`state.js`** — Centralized game state object, cached DOM element references, debug logging
- **`stateMutations.js`** — Controlled state mutation helpers
- **`ui.js`** — Toast notification system, modal registry, screen reader announcements, focus management
- **`board.js`** — 5x5 card grid rendering, event delegation, keyboard navigation, incremental updates, font scaling
- **`game.js`** — Board generation with seeded PRNG (Mulberry32), card reveal, turn management, win conditions, URL state encoding
- **`roles.js`** — Team switching (Red/Blue), role assignment (Spymaster/Clicker/Spectator), role banner updates

### Multiplayer Modules

- **`multiplayer.js`** — Multiplayer orchestration: room creation/joining, AbortController, barrel re-exports
- **`multiplayerListeners.js`** — Thin orchestrator that delegates Socket.io events to domain-specific handlers in `handlers/`
- **`multiplayerSync.js`** — State synchronization (syncGameStateFromServer, syncLocalPlayerState), room code URL management, cleanup
- **`multiplayerUI.js`** — Player list rendering, nickname editing, forfeit/kick dialogs, room info display

### Event Handlers (in `handlers/`)

- **`gameEventHandlers.js`** — Game start, card reveal, turn end, game over events
- **`roomEventHandlers.js`** — Room join/leave, settings updates, host changes, reconnection
- **`playerEventHandlers.js`** — Player updates, kicks, disconnection
- **`timerEventHandlers.js`** — Timer start/pause/resume/stop/tick events
- **`chatEventHandlers.js`** — Chat message handling
- **`errorMessages.js`** — Error message formatting

### Feature Modules

- **`history.js`** — Game history list, replay playback with speed control (0.5x, 1x, 2x, 4x)
- **`settings.js`** — Settings panel switching, custom word validation (min 25 words), team name counter, localStorage persistence
- **`timer.js`** — Timer value updates, status handling (running/paused/stopped), aria-live announcements
- **`chat.js`** — Chat UI rendering and interaction
- **`i18n.js`** — Async translation loading, `data-i18n-*` attribute support, `{{variable}}` interpolation, browser language detection
- **`accessibility.js`** — Colorblind mode toggle (SVG patterns), keyboard shortcuts (n, e, s, m, h, ?), escape key handling
- **`notifications.js`** — Sound notifications (Web Audio API), tab notification badge, turn notification logic

### Socket Communication

- **`socket-client.js`** — Socket.io connection management, event emission/handling, reconnection with auto-rejoin, session management
- **`socket-client-events.js`** — Socket event name constants
- **`socket-client-storage.js`** — Session storage for reconnection tokens
- **`socket-client-types.js`** — Socket-related type definitions
- **`clientAccessor.js`** — Accessor pattern for socket client instance

### Utilities

- **`utils.js`** — Mulberry32 PRNG (must match server), crypto random fallback, XSS prevention, clipboard API, safe storage
- **`url-state.js`** — URL state encoding/decoding for standalone mode
- **`constants.js`** — Validation constants matching server, Unicode-aware regex patterns
- **`logger.js`** — Conditional console logging with debug/info/warn/error levels
- **`debug.js`** — Debug mode utilities

## Relationship to index.html

The main `index.html` loads modular CSS and JavaScript:
- CSS is imported via `<link>` tags (8 modular stylesheets)
- JavaScript modules are loaded via `<script type="module">`
- Vendored libraries (QR code, Socket.io) loaded via regular script tags

For **standalone mode**, `index.html` contains a self-contained implementation with:
- Embedded CSS (glassmorphism design)
- Embedded JavaScript that duplicates core module functionality
- No server required — game state encoded in URL
- QR codes can share game state

## TypeScript Source

All frontend modules are written in TypeScript and compiled to JavaScript:

```
Source:   server/src/frontend/*.ts        (31 modules)
          server/src/frontend/handlers/   (6 handler modules)
Compiled: server/public/js/modules/frontend/
```

When making code changes, edit the **TypeScript source** in `server/src/frontend/`, not the compiled JS files.

## When to Use What

| Scenario | Use |
|----------|-----|
| Standalone offline play | `index.html` only |
| Development/debugging | TypeScript source in `server/src/frontend/` |
| Server deployment | Compiled modules served by Express |
| Code changes | Edit TypeScript source; update `index.html` if public API changes |

## Synchronization

When making changes:
1. Changes to game logic should update both `game.ts` AND `index.html`
2. Changes to UI should update both `ui.ts` AND `index.html`
3. Server-only features (like multiplayer) only need to update the relevant TypeScript modules

## PRNG Synchronization (Critical)

The Mulberry32 PRNG implementation must be identical in:
- `server/src/services/gameService.ts` (server)
- `server/src/frontend/utils.ts` (modular frontend)
- `index.html` (standalone frontend)

This ensures deterministic board generation from room codes/seeds. Any divergence breaks standalone mode compatibility.

## CSS Architecture

```
server/public/css/
├── variables.css       # Design tokens & CSS custom properties
├── layout.css          # Grid/flexbox layouts
├── components.css      # Card, button, role banner styles
├── modals.css          # Modal & settings panel styles
├── responsive.css      # Mobile & tablet breakpoints (1024, 768, 480px)
├── multiplayer.css     # Multiplayer UI styles
├── accessibility.css   # SR-only, toast, keyboard focus styles
└── replay.css          # Game replay UI styles
```

## Internationalization

```
server/public/locales/
├── en.json             # English (base language)
├── de.json             # German
├── es.json             # Spanish
├── fr.json             # French
├── wordlist-de.txt     # German word list
├── wordlist-es.txt     # Spanish word list
└── wordlist-fr.txt     # French word list
```
