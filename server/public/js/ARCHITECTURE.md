# Frontend JavaScript Architecture

This document describes the modular JavaScript architecture in `/server/public/js/modules/`.

## Overview

The frontend is a multiplayer-only application that requires a server connection. All game state comes from the server via Socket.io WebSocket events. There is no offline or standalone mode.

## File Structure

```
server/public/
├── index.html              # HTML shell with modals and layout
├── css/                    # 8 modular CSS files
│   ├── variables.css       # CSS custom properties
│   ├── layout.css          # Page layout
│   ├── components.css      # UI components
│   ├── modals.css          # Modal dialogs
│   ├── multiplayer.css     # Multiplayer-specific styles
│   ├── accessibility.css   # Color-blind mode, a11y
│   ├── responsive.css      # Mobile responsive styles
│   └── replay.css          # Game replay styles
└── js/
    ├── modules/            # 12 ES modules
    │   ├── app.js          # Main entry point, event routing
    │   ├── state.js        # Client-side state management
    │   ├── game.js         # Game logic (clues, reveals, turns)
    │   ├── board.js        # Board rendering and card clicks
    │   ├── multiplayer.js  # Socket.io event handlers
    │   ├── roles.js        # Team/role selection
    │   ├── settings.js     # Game settings UI
    │   ├── ui.js           # Modals, toasts, DOM helpers
    │   ├── utils.js        # Utility functions
    │   ├── timer.js        # Turn timer display
    │   ├── history.js      # Game history/replay
    │   └── notifications.js # Browser notifications
    └── socket-client.js    # Socket.io connection management
```

## Module Responsibilities

### `app.js` — Application Entry Point
- Initializes all modules on DOM load
- Routes `data-action` click events to handler functions
- Registers modal close handlers
- Unregisters stale service workers (cleanup from prior PWA support)

### `state.js` — State Management
- Central game state store
- Constants (board size, card counts, default words)
- State getters and setters

### `game.js` — Game Logic
- New game creation (server-only, shows error if disconnected)
- Card reveal handling (sends to server)
- Clue giving and turn management
- Scoreboard and turn indicator updates
- Game over detection and display
- Provides `setRoleCallbacks()` to avoid circular dependency with `roles.js`

### `board.js` — Board Rendering
- Renders the 5x5 card grid
- Handles card click events (validates turn, clue state)
- Spymaster view with color-coded borders
- Color-blind mode shape indicators

### `multiplayer.js` — Socket.io Integration
- Handles all server → client events (`game:started`, `game:cardRevealed`, etc.)
- Room creation, joining, and leaving
- Player list updates
- Settings synchronization
- Reconnection state recovery

### `roles.js` — Team and Role Management
- Team selection (Red/Blue/Spectator)
- Role assignment (Spymaster/Clicker)
- All changes sent to server; shows error if disconnected

### `settings.js` — Settings UI
- Custom word list management
- Team name customization
- Color-blind mode toggle
- Turn timer configuration

### `ui.js` — UI Utilities
- Modal open/close/registration
- Error modals and toast notifications
- DOM helper functions

### `utils.js` — Utilities
- `copyShareLink()` — copy room link to clipboard
- `copyRoomId()` — copy room code to clipboard
- Team name display helpers

### `timer.js` — Turn Timer
- Visual countdown display
- Timer state management

### `history.js` — Game History
- Move-by-move replay
- History panel rendering

### `notifications.js` — Browser Notifications
- Turn notifications when tab is not focused

## Data Flow

```
Server (Socket.io) ──► multiplayer.js ──► game.js / board.js / roles.js
                                              │
User Action ──► app.js (event router) ──► game.js / roles.js / settings.js
                                              │
                                         Socket.io emit ──► Server
```

1. Server sends events (e.g., `game:cardRevealed`)
2. `multiplayer.js` handles the event and updates UI via other modules
3. User clicks trigger `data-action` attributes routed by `app.js`
4. Action handlers in `game.js`, `roles.js`, etc. emit socket events to server

## Key Patterns

### Callback Injection
`game.js` uses `setRoleCallbacks()` to receive functions from `roles.js` without creating circular imports.

### Event Delegation
All button clicks use `data-action` attributes on HTML elements, handled by a central `switch` statement in `app.js`.

### Server-Authoritative State
All game state changes go through the server. The client never modifies game state locally — it only renders what the server sends.

## PRNG Synchronization

The Mulberry32 PRNG implementation must be identical in:
- `server/src/services/gameService.js` (server)

The client does not generate boards — it receives them from the server.
