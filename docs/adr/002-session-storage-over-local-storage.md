# ADR 002: sessionStorage Over localStorage for Session Management

## Status
Adopted (2024)

## Context
The Codenames client needs to persist session information (session ID, room code, player state) across page refreshes but had issues with multi-tab usage.

### Problem Statement
Using `localStorage` caused problems when users:
1. Opened multiple tabs to the same game
2. Joined different rooms in different tabs
3. Had stale session data from previous games

Since `localStorage` is shared across all tabs for the same origin, tab A's session would overwrite tab B's, causing:
- Players appearing as duplicates
- Session conflicts when switching rooms
- Reconnection to wrong rooms

## Decision
Use `sessionStorage` instead of `localStorage` for all session data:

```javascript
// Store session per-tab
sessionStorage.setItem('sessionId', sessionId);
sessionStorage.setItem('roomCode', roomCode);
sessionStorage.setItem('reconnectionToken', token);
```

Key characteristics of `sessionStorage`:
- Scoped to a single browser tab/window
- Survives page refreshes within the same tab
- Cleared when the tab is closed
- Not shared between tabs

## Consequences

### Positive
- **Tab Isolation**: Each tab maintains independent session state
- **Multi-Room Support**: Users can participate in different rooms in different tabs
- **Clean State**: Closing a tab automatically cleans up session data
- **No Cross-Tab Conflicts**: No risk of session data corruption

### Negative
- **No Tab Persistence**: Opening a new tab requires re-joining the room
- **Duplicate Tab Issues**: Duplicating a tab copies sessionStorage, potentially creating duplicate sessions (mitigated by server-side session validation)
- **Link Sharing**: Users can't bookmark a "rejoin" link with their session

### Mitigations
1. Room codes are included in URLs for easy sharing
2. Server validates session uniqueness and handles duplicates gracefully
3. Reconnection tokens are short-lived (5 minutes) to prevent session hijacking

## Alternatives Considered

### 1. localStorage with Tab ID
Could generate unique tab IDs and namespace localStorage keys:
```javascript
const tabId = generateTabId();
localStorage.setItem(`session:${tabId}:roomCode`, roomCode);
```
**Rejected**: Complexity of managing tab lifecycle and cleanup

### 2. IndexedDB
Could use IndexedDB for structured session storage.
**Rejected**: Overkill for simple key-value session data

### 3. Cookies
Could use session cookies.
**Rejected**: Unnecessary server round-trips, limited storage, privacy concerns

## Implementation
```javascript
// Session management in index.html
const session = {
    get(key) {
        return sessionStorage.getItem(key);
    },
    set(key, value) {
        sessionStorage.setItem(key, value);
    },
    clear() {
        sessionStorage.removeItem('sessionId');
        sessionStorage.removeItem('roomCode');
        sessionStorage.removeItem('reconnectionToken');
    }
};
```

## References
- [MDN: Window.sessionStorage](https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage)
- Issue #48: Multi-tab session conflicts
