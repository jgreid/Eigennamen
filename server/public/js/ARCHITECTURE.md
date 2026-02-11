# Frontend JavaScript Architecture

This document explains the relationship between the modular JavaScript files in `/server/public/js/` and the main `index.html` file.

## Overview

The frontend can operate in two modes:

1. **Standalone Mode** - Uses the monolithic `index.html` with embedded JavaScript
2. **Server Mode** - Uses modular JavaScript files served by the Node.js server

## File Structure

```
server/public/js/
├── modules/
│   ├── app.js              # Main application entry point (284 lines)
│   ├── board.js             # Board rendering & card interaction (318 lines)
│   ├── game.js              # Game logic, PRNG, URL encoding (736 lines)
│   ├── multiplayer.js       # WebSocket multiplayer integration (1,922 lines)
│   ├── state.js             # Centralized state management (397 lines)
│   ├── ui.js                # Toast, modals, announcements (236 lines)
│   ├── roles.js             # Role/team selection & switching (499 lines)
│   ├── history.js           # Game replay system (503 lines)
│   ├── settings.js          # Settings panel management (317 lines)
│   ├── timer.js             # Timer display & status (112 lines)
│   ├── i18n.js              # Internationalization (193 lines)
│   ├── accessibility.js     # Keyboard shortcuts, colorblind mode (184 lines)
│   ├── notifications.js     # Sound & tab notifications (156 lines)
│   ├── utils.js             # Helper functions, PRNG, clipboard (240 lines)
│   └── constants.js         # Shared constants & validators (208 lines)
├── socket-client.js         # Socket.io communication layer (1,019 lines)
├── qrcode.min.js            # QR code generation (vendored)
├── socket.io.min.js         # Socket.io client (vendored)
└── ARCHITECTURE.md          # This file
```

## Module Responsibilities

### `app.js` (284 lines)
Application orchestration:
- Module initialization and lifecycle
- Event routing via `data-action` delegation
- Modal registration system
- Dependency injection to break circular imports

### `board.js` (318 lines)
Board rendering:
- 5x5 card grid creation and management
- Event delegation (single click handler for all cards)
- Keyboard navigation (arrow keys between cards)
- Incremental board updates (avoids full re-renders)
- Font size scaling for multi-word cards

### `game.js` (736 lines)
Game logic:
- Board generation with seeded PRNG (Mulberry32)
- Card reveal logic and turn management
- Win condition checking
- URL state encoding/decoding for standalone mode
- QR code generation

### `multiplayer.js` (1,922 lines)
Multiplayer integration:
- Room creation and joining
- Player list management
- Nickname editing
- Forfeit confirmation
- Spectator join requests
- AbortController for request cancellation

### `state.js` (397 lines)
State management:
- Centralized game state object
- Cached DOM element references
- Debug logging capability
- URL state encoding/decoding

### `ui.js` (236 lines)
User interface utilities:
- Toast notification system with auto-dismiss
- Modal registry pattern
- Screen reader announcements via aria-live
- Focus management for modal stack
- Error modal with details

### `roles.js` (499 lines)
Role management:
- Team switching (Red/Blue)
- Role assignment (Spymaster/Clicker/Spectator)
- Role banner updates
- State validation

### `history.js` (503 lines)
Game replay:
- Game history list rendering
- Replay playback with speed control (0.5x, 1x, 2x, 4x)
- Event delegation for replay controls

### `settings.js` (317 lines)
Settings panel:
- Settings panel switching and state management
- Custom word validation (min 25 words)
- Team name character counter
- localStorage persistence

### `timer.js` (112 lines)
Timer display:
- Timer value updates
- Status handling (running, paused, stopped)
- Aria-live announcements

### `i18n.js` (193 lines)
Internationalization:
- Async translation file loading
- Supports `data-i18n`, `data-i18n-placeholder`, `data-i18n-title`
- Nested key support (e.g., `game.turn.red`)
- `{{variable}}` interpolation
- Browser language auto-detection
- Language persistence in localStorage

### `accessibility.js` (184 lines)
Accessibility features:
- Color blind mode toggle (SVG patterns)
- Keyboard shortcuts (n, e, s, m, h, ?)
- Shortcut help overlay
- Input-aware shortcut disabling
- Escape key modal handling

### `notifications.js` (156 lines)
Notification system:
- Sound notifications (Web Audio API)
- Tab notification badge
- Turn notification logic
- User preference storage

### `utils.js` (240 lines)
Utility functions:
- Mulberry32 PRNG (must match server)
- Crypto API random with Math.random fallback
- XSS prevention via textContent
- Clipboard API with fallback
- Safe storage with QuotaExceededError handling
- Word list parsing

### `constants.js` (208 lines)
Shared constants:
- Validation constants matching server
- Unicode-aware regex patterns (`/\p{L}/u`)
- Validation functions with error messages

### `socket-client.js` (1,019 lines)
WebSocket communication:
- Socket.io connection management
- Event emission and handling
- Reconnection logic with auto-rejoin
- Session management with reconnection tokens
- Offline event queue (max 20)

## Relationship to index.html

The main `index.html` (~625 lines of HTML) loads modular CSS and JavaScript:
- CSS is imported via `<link>` tags (8 modular stylesheets)
- JavaScript modules are loaded via `<script type="module">`
- Vendored libraries (QR code, Socket.io) loaded via regular script tags

For **standalone mode**, `index.html` contains a self-contained implementation with:
- Embedded CSS (glassmorphism design)
- Embedded JavaScript that duplicates core module functionality
- No server required — game state encoded in URL
- QR codes can share game state

## When to Use What

| Scenario | Use |
|----------|-----|
| Standalone offline play | `index.html` only |
| Development/debugging | Modular JS files via server |
| Server deployment | Modular files served by Express |
| Code changes | Update both if public API changes |

## Synchronization

When making changes:
1. Changes to game logic should update both `game.js` AND `index.html`
2. Changes to UI should update both `ui.js` AND `index.html`
3. Server-only features (like multiplayer) only need to update `socket-client.js` and relevant modules

## PRNG Synchronization (Critical)

The Mulberry32 PRNG implementation must be identical in:
- `server/src/services/gameService.ts` (server)
- `server/public/js/modules/utils.js` (modular frontend)
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
