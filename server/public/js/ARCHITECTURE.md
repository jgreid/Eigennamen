# Frontend JavaScript Architecture

This document explains the relationship between the modular JavaScript files in `/server/public/js/` and the main `index.html` file.

## Overview

The frontend can operate in two modes:

1. **Standalone Mode** - Uses the monolithic `index.html` with embedded JavaScript
2. **Server Mode** - Can optionally use modular JavaScript files

## File Structure

```
server/public/js/
├── app.js          # Main application entry point (644 lines)
├── socket-client.js # Socket.io communication layer (943 lines)
├── ui.js           # UI rendering and DOM manipulation (534 lines)
├── game.js         # Game logic and state (331 lines)
├── state.js        # State management utilities (364 lines)
└── ARCHITECTURE.md # This file
```

## Module Responsibilities

### `state.js` (364 lines)
Core state management:
- Game state storage and retrieval
- URL state encoding/decoding for standalone mode
- State change notifications

### `game.js` (331 lines)
Game logic:
- Board generation with seeded PRNG
- Card reveal logic
- Turn management
- Win condition checking

### `ui.js` (534 lines)
User interface:
- DOM element creation and updates
- Event listener attachment
- Modal management
- Responsive layout handling

### `socket-client.js` (943 lines)
Network communication:
- Socket.io connection management
- Event emission and handling
- Reconnection logic
- Session management with reconnection tokens

### `app.js` (644 lines)
Application orchestration:
- Module initialization
- Event routing
- Error handling
- Application lifecycle

## Relationship to index.html

The main `index.html` (~8,000 lines) contains:
- Complete HTML structure
- Embedded CSS (glassmorphism design)
- **Self-contained JavaScript** that duplicates functionality from these modules

This duplication is intentional for **standalone mode compatibility**:
- Users can copy just `index.html` and `wordlist.txt`
- No server required - game state encoded in URL
- QR codes can share game state

## When to Use What

| Scenario | Use |
|----------|-----|
| Standalone offline play | `index.html` only |
| Development/debugging | Modular JS files |
| Server deployment | Either (both work) |
| Code changes | Update both if public API changes |

## Synchronization

When making changes:
1. Changes to game logic should update both `game.js` AND `index.html`
2. Changes to UI should update both `ui.js` AND `index.html`
3. Server-only features (like chat) only need to update `socket-client.js`

## PRNG Synchronization

Critical: The Mulberry32 PRNG implementation must be identical in:
- `server/src/services/gameService.js` (server)
- `server/public/js/game.js` (modular frontend)
- `index.html` (standalone frontend)

This ensures deterministic board generation from room codes.

## Future Considerations

Potential improvements:
1. Use ES modules with build step to generate `index.html`
2. Implement service worker for offline caching
3. Create shared module for PRNG to avoid duplication
