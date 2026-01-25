# Multiplayer Game Joining Flow - Cleanup Proposal

This document analyzes the three methods for joining multiplayer games in Codenames Online and proposes improvements for consolidation and consistency.

---

## Current State Analysis

### Method 1: QR Code Joining

**Status**: Partially Implemented (Display Only)

| Component | Status | Location |
|-----------|--------|----------|
| QR Generation | Complete | `src/js/qrcode.js` |
| QR Display | Complete | `server/public/index.html` (canvas) |
| QR Scanning | **Not Implemented** | - |

**Flow**:
```
Host creates room → QR code generated with URL → User scans QR → Opens URL in browser
```

**Issues**:
1. QR code only encodes standalone game URL (seed-based), not multiplayer room
2. No camera/scanner integration for joining via QR
3. QR becomes stale if password changes

**Recommendation**: Update QR code to encode room code URL (`?room=CODE`) for multiplayer mode.

---

### Method 2: URL Sharing

**Status**: Now Implemented (via this PR)

**New Flow**:
```
1. Host creates room → URL updated to ?room=CODE
2. Host shares URL + password with players
3. Player opens URL → Modal pre-populates with room context
4. Player enters password → Joins room directly
```

**Changes Made**:
- Added `getRoomCodeFromURL()` - parses `?room=` or `?join=` from URL
- Added `updateURLWithRoomCode()` - updates browser URL after joining
- Added `clearRoomCodeFromURL()` - cleans URL when leaving
- Added `checkURLForRoomJoin()` - auto-opens modal when room code in URL
- Added `copyRoomLink()` - copies shareable link to clipboard

**Benefits**:
- True deep-linking support for multiplayer
- URL can be bookmarked/shared
- Room code visible in address bar
- Compatible with QR code sharing

---

### Method 3: Password-Based Joining (Server/Client)

**Status**: Fully Implemented

**Current Flow**:
```
1. User opens multiplayer modal
2. Enters nickname + password
3. Client calls /api/rooms/by-password/{password} → Gets room code
4. Client emits room:join with { code, nickname, password }
5. Server validates password (bcrypt)
6. Server adds player to room
7. Server emits room:joined with full state
8. Client updates UI
```

**Issues Identified & Fixed**:

| Issue | Status | Solution |
|-------|--------|----------|
| Double-join race condition | Fixed | Added `joinInProgress` guard |
| Multi-tab localStorage conflict | Fixed | Changed room code to sessionStorage |
| Memory leak from listeners | Fixed | Added listener tracking + cleanup |
| Silent failures | Partially Fixed | Improved error messages |

---

## Consolidated Join Architecture

### Proposed Unified Flow

```
                    ┌─────────────────────────────────────────┐
                    │           JOIN ENTRY POINTS             │
                    └─────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
    ┌───────────┐              ┌───────────┐              ┌───────────┐
    │  QR Code  │              │    URL    │              │  Manual   │
    │   Scan    │              │  ?room=X  │              │  Password │
    └─────┬─────┘              └─────┬─────┘              └─────┬─────┘
          │                           │                           │
          └───────────────────────────┼───────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │         UNIFIED JOIN HANDLER            │
                    │                                         │
                    │  1. Validate inputs                     │
                    │  2. Resolve room code (if needed)       │
                    │  3. Connect to server                   │
                    │  4. Emit room:join                      │
                    │  5. Handle response                     │
                    │  6. Update URL + storage                │
                    └─────────────────────────────────────────┘
                                      │
                                      ▼
                    ┌─────────────────────────────────────────┐
                    │            SERVER HANDLER               │
                    │                                         │
                    │  1. Validate room exists                │
                    │  2. Validate password (bcrypt)          │
                    │  3. Add to room players                 │
                    │  4. Join socket.io room                 │
                    │  5. Emit room:joined                    │
                    └─────────────────────────────────────────┘
```

---

## Storage Strategy

### Current (After Fixes)

| Data | Storage | Scope | Purpose |
|------|---------|-------|---------|
| Session ID | `sessionStorage` | Per-tab | Prevent multi-tab conflicts |
| Room Code | `sessionStorage` | Per-tab | Current room (per-tab) |
| Nickname | `localStorage` | Global | User convenience |
| Password | Memory only | Per-session | Security |

### Rationale

- **Session ID in sessionStorage**: Each tab gets unique session, preventing one tab from interfering with another
- **Room Code in sessionStorage**: Each tab can be in different room
- **Nickname in localStorage**: User shouldn't re-enter name for each tab

---

## Remaining Work

### High Priority

1. **Update QR Code for Multiplayer**
   - Generate QR with `?room=CODE` URL when in multiplayer mode
   - Add visual indicator that QR is for multiplayer vs standalone

2. **Add Shareable Link UI**
   - Add "Copy Invite Link" button in multiplayer indicator
   - Include room code but NOT password for security

3. **Implement QR Scanner** (Future)
   - Camera-based QR scanner for mobile
   - Parse room code from scanned URL

### Medium Priority

4. **Validation Consolidation**
   - Create shared validation utilities between client/server
   - Consider client-side Zod for schema matching

5. **Error Message Mapping**
   - Centralize error code to user message mapping
   - Add error code constants to client

6. **Reconnection Token Flow**
   - Automatically request token on successful join
   - Store token for seamless reconnection

### Low Priority

7. **Direct Room Code Join**
   - Add room code input field as alternative to password
   - Still require password validation on server

8. **Room History**
   - Store recent rooms in localStorage
   - Quick rejoin from history list

---

## Security Considerations

### Current Protections
- Password hashed with bcrypt (10 rounds)
- Rate limiting on join attempts
- Session ID validation
- Socket.io authentication middleware

### Recommendations
1. Never expose password in URL (use room code only)
2. Consider time-limited invite tokens
3. Add CAPTCHA for repeated failed joins
4. Log and alert on suspicious join patterns

---

## Implementation Checklist

- [x] Add room code URL parameter support (`?room=CODE`)
- [x] Update URL after joining room
- [x] Clear URL when leaving room
- [x] Auto-open modal when room code in URL
- [x] Fix multi-tab storage conflicts
- [x] Add double-join prevention
- [x] Implement listener cleanup
- [ ] Update QR code generation for multiplayer
- [ ] Add "Copy Invite Link" button
- [ ] Add join history feature
- [ ] Consider direct room code input

---

## Files Modified in This Cleanup

| File | Changes |
|------|---------|
| `server/public/js/socket-client.js` | Listener cleanup, sessionStorage for room, double-join guard |
| `server/public/index.html` | URL parsing/updating, room code pre-fill, shareable links |
| `server/src/socket/socketFunctionProvider.js` | New file - breaks circular dependencies |
| `server/src/socket/index.js` | Uses socketFunctionProvider, centralized constants |
| `server/src/socket/handlers/gameHandlers.js` | Uses socketFunctionProvider |
| `server/src/socket/handlers/roomHandlers.js` | Uses socketFunctionProvider |
| `server/src/config/constants.js` | Added SOCKET timing constants |
| `server/src/app.js` | Uses centralized SOCKET constants |

---

*Document created: January 2026*
