# Multiplayer Best Practices Comparison

A comprehensive analysis comparing Codenames Online's multiplayer implementation against industry best practices from successful online board games.

---

## Reference Implementations

| Game | Key Patterns | Scale |
|------|--------------|-------|
| **Board Game Arena** | Turn-based state machines, replay system, ELO matchmaking | 10M+ users |
| **Lichess** | Real-time sync, efficient WebSocket protocol, spectator mode | 50M+ games/month |
| **Colonist.io** | Catan clone, room-based lobbies, trade negotiation | 1M+ users |
| **Tabletop Simulator** | P2P hosting, save/load states, physics sync | Complex state |
| **Official Codenames Online** | Team-based rooms, spectator chat, word validation | Direct comparison |

---

## 1. Room/Lobby Management

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Room Codes** | Short alphanumeric codes (4-6 chars) | All casual games |
| **Private/Public Rooms** | Toggle for matchmaking vs friends-only | BGA, Colonist |
| **Room Browser** | List of open games to join | BGA, TTS |
| **Invite Links** | Direct URL to join game | Most modern games |
| **Password Protection** | Optional room passwords | Common |
| **Spectator Mode** | Watch without participating | Lichess, BGA |
| **Kick/Ban** | Host controls who can join | TTS, Discord |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Room Codes | ✅ Implemented | 6-char alphanumeric |
| Private Rooms | ✅ Implemented | All rooms private by default |
| Public Room Browser | ❌ Missing | No matchmaking |
| Invite Links | ✅ **Now Implemented** | `?room=CODE` parameter |
| Password Protection | ✅ Implemented | Bcrypt hashed |
| Spectator Mode | ⚠️ Partial | Role exists but UI incomplete |
| Kick/Ban | ❌ Missing | Host cannot remove players |

### Gaps Identified

1. **No Public Room Browser** - Users cannot find random games
2. **No Kick/Ban System** - Disruptive players cannot be removed
3. **Spectator UI Incomplete** - Can set role but limited spectator features
4. **No Room Capacity Display** - Before joining, users don't see how many are in room

### Recommendations

```
PRIORITY HIGH:
- Add host kick functionality (emit 'player:kick', target rejoins as spectator or blocked)
- Add room capacity in password lookup response

PRIORITY MEDIUM:
- Optional public room listing (opt-in by host)
- Spectator chat separate from team chat

PRIORITY LOW:
- Room browser with filtering
- ELO-based matchmaking (requires accounts)
```

---

## 2. Game State Synchronization

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Authoritative Server** | Server is single source of truth | All serious games |
| **State Versioning** | Increment version on each change | Lichess |
| **Delta Updates** | Send only what changed | Performance-critical |
| **Full State Snapshots** | Periodic full state for recovery | BGA |
| **Event Sourcing** | Store all events, reconstruct state | Lichess |
| **Optimistic Updates** | Client predicts, server confirms | Real-time games |
| **Pessimistic Updates** | Wait for server before UI update | Turn-based |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Authoritative Server | ✅ Implemented | Redis + Lua scripts |
| State Versioning | ✅ Implemented | `stateVersion` in game object |
| Delta Updates | ⚠️ Partial | Full state sent on most actions |
| Full State Snapshots | ✅ Implemented | `room:resync` endpoint |
| Event Sourcing | ⚠️ Partial | Event log with 5min TTL |
| Optimistic Updates | ⚠️ Partial | Client reveals locally |
| Pessimistic Updates | ✅ Implemented | Server confirms before broadcast |

### Gaps Identified

1. **Delta Updates Not Optimized** - Broadcasting full game state on card reveal instead of just the changed card
2. **Event Log TTL Too Short** - 5 minutes doesn't allow full game replay
3. **No Undo/Redo** - Common in board games (Board Game Arena supports it)
4. **No Game Replay** - Cannot replay completed games

### Recommendations

```
PRIORITY HIGH:
- Optimize card reveal broadcast to include only: { index, type, scores, turn }
- Client should merge delta into local state

PRIORITY MEDIUM:
- Extend event log TTL to match game duration (24h)
- Store complete game history for replay

PRIORITY LOW:
- Implement undo for last action (host permission)
- Game replay viewer
```

---

## 3. Reconnection & Recovery

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Grace Period** | Time window to reconnect | All games (30s-5min) |
| **Session Persistence** | Remember player across refreshes | All games |
| **Reconnection Tokens** | Secure tokens for resuming | Lichess |
| **Auto-Reconnect** | Client automatically retries | Socket.io default |
| **State Recovery** | Full state sent on reconnect | All games |
| **Disconnection Notification** | Tell others when player offline | Common |
| **AI Takeover** | Bot plays for disconnected player | BGA, Colonist |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Grace Period | ✅ Implemented | 10 minutes |
| Session Persistence | ✅ Implemented | sessionStorage per tab |
| Reconnection Tokens | ✅ Implemented | 32-byte tokens, 5min TTL |
| Auto-Reconnect | ✅ Implemented | Socket.io + `_attemptRejoin` |
| State Recovery | ✅ Implemented | Full state on `room:resync` |
| Disconnection Notification | ✅ Implemented | `player:disconnected` event |
| AI Takeover | ❌ Missing | Game pauses |

### Gaps Identified

1. **No AI Fallback** - If clicker disconnects, team cannot play
2. **Grace Period May Be Too Long** - 10 minutes can stall games
3. **No Explicit "Pause Game" Feature** - Host cannot pause timer
4. **No Replacement Player** - Cannot invite new player to take over

### Recommendations

```
PRIORITY HIGH:
- Allow any team member to reveal cards if clicker disconnected
- Add host "pause game" button

PRIORITY MEDIUM:
- Configurable grace period (1-10 minutes)
- Allow host to "replace" disconnected player with new join

PRIORITY LOW:
- Simple AI for disconnected players (random valid moves)
- "Take over" mechanic for spectators
```

---

## 4. Turn Management

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Turn Timers** | Configurable time limits | BGA, Lichess |
| **Turn Timeout Handling** | Auto-pass or forfeit on timeout | All timed games |
| **Active Turn Indicator** | Clear visual of whose turn | All games |
| **Turn History** | Log of past turns | BGA, Lichess |
| **Undo Request** | Request to undo last move | BGA |
| **Turn Notification** | Alert when it's your turn | BGA, Colonist |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Turn Timers | ✅ Implemented | Configurable 30-300s |
| Turn Timeout Handling | ✅ Implemented | Auto-ends turn |
| Active Turn Indicator | ✅ Implemented | Visual team highlight |
| Turn History | ✅ Implemented | Clue history in UI |
| Undo Request | ❌ Missing | No undo |
| Turn Notification | ⚠️ Partial | Toast only, no sound |

### Gaps Identified

1. **No Sound Notifications** - Easy to miss turn in background tab
2. **No Browser Notifications** - Tab notification when turn starts
3. **Timer Not Visible Enough** - No countdown in UI
4. **No Pause/Resume Timer** - Host cannot pause mid-turn

### Recommendations

```
PRIORITY HIGH:
- Add timer countdown display in UI
- Browser tab notification ("🔴 Your Turn - Codenames")
- Audio notification option (configurable)

PRIORITY MEDIUM:
- Host pause/resume timer functionality
- Timer warning at 30 seconds (audio + visual)

PRIORITY LOW:
- Undo last card reveal (requires team vote)
```

---

## 5. Security & Anti-Cheat

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Server Authority** | Never trust client | All games |
| **Rate Limiting** | Prevent spam/abuse | All games |
| **Session Validation** | Verify identity on each request | All games |
| **Move Validation** | Server validates every action | All games |
| **Anti-Farming** | Prevent exploits | Ranked games |
| **Report System** | Report abusive players | BGA, Lichess |
| **IP/Device Bans** | Block repeat offenders | Competitive games |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Server Authority | ✅ Implemented | Full validation |
| Rate Limiting | ✅ Implemented | Per-event limits |
| Session Validation | ✅ Implemented | UUID validation |
| Move Validation | ✅ Implemented | Team/role checks |
| Anti-Farming | N/A | No rankings/rewards |
| Report System | ❌ Missing | No reporting |
| IP/Device Bans | ❌ Missing | No bans |

### Gaps Identified

1. **No Report System** - Cannot report abusive players
2. **No Block List** - Cannot prevent specific users from joining
3. **Spymaster Cheating Possible** - Can inspect network traffic for card types

### Recommendations

```
PRIORITY MEDIUM:
- Add host block list (stored per room)
- Simple report button (logs for review)

PRIORITY LOW:
- Rate limit suspicious patterns
- Spymaster view obfuscation (harder to reverse-engineer)
```

---

## 6. User Experience

### Industry Best Practices

| Pattern | Description | Used By |
|---------|-------------|---------|
| **Onboarding Tutorial** | Teach new players | BGA, TTS |
| **Connection Quality Indicator** | Show latency | Lichess |
| **Error Recovery** | Clear error messages | All games |
| **Keyboard Shortcuts** | Fast navigation | Lichess |
| **Mobile Support** | Responsive design | All modern games |
| **Accessibility** | Screen reader, colorblind | Some games |
| **Language Support** | Internationalization | BGA |

### Codenames Online Current State

| Pattern | Status | Implementation |
|---------|--------|----------------|
| Onboarding Tutorial | ❌ Missing | No tutorial |
| Connection Quality | ⚠️ Partial | Disconnect notice only |
| Error Recovery | ✅ Implemented | Toast messages |
| Keyboard Shortcuts | ❌ Missing | Mouse-only |
| Mobile Support | ✅ Implemented | Responsive CSS |
| Accessibility | ⚠️ Partial | ARIA labels, SR announcements |
| Language Support | ❌ Missing | English only |

### Gaps Identified

1. **No Tutorial** - New players may not understand roles
2. **No Keyboard Navigation** - Cannot navigate cards with arrow keys
3. **No Latency Indicator** - Users don't know if connection is slow
4. **No i18n** - English only

### Recommendations

```
PRIORITY HIGH:
- Add "How to Play" modal with role explanations
- Keyboard: Enter to confirm, Escape to cancel

PRIORITY MEDIUM:
- Connection quality indicator (ping display)
- Keyboard card selection (Tab + Enter)

PRIORITY LOW:
- Multi-language support (i18n framework)
- Colorblind mode for card colors
```

---

## 7. Architecture Comparison

### Successful Patterns from Reference Games

| Game | Architecture | Key Insight |
|------|--------------|-------------|
| **Lichess** | Event sourcing + snapshots | Every move stored, can replay any game |
| **BGA** | Turn-based state machine | Explicit state transitions |
| **Colonist** | Room sharding | Rooms isolated for horizontal scale |
| **TTS** | P2P with host authority | Reduces server load |

### Codenames Architecture Analysis

**Current Architecture:**
```
Client ←→ Socket.io ←→ Express ←→ Redis (state) + PostgreSQL (optional)
                                      ↑
                              Lua Scripts (atomicity)
```

**Strengths:**
- Horizontal scaling ready (Redis Pub/Sub)
- Atomic operations via Lua scripts
- Graceful degradation (works without PostgreSQL)
- Memory fallback for single-instance

**Weaknesses:**
- No room sharding (all rooms in same Redis)
- Event log too short for full replay
- No game archival system
- Single Redis = single point of failure

### Recommendations

```
PRIORITY LOW (Scale Prep):
- Implement room sharding (rooms partitioned by hash)
- Longer event log retention (24h+)
- Game archival to PostgreSQL after completion
- Redis Cluster support for HA
```

---

## 8. Summary: Gap Analysis

### Critical Gaps (User-Facing Issues)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No kick/ban | Griefers can ruin games | Medium | **HIGH** |
| Timer UI missing | Users don't see countdown | Low | **HIGH** |
| No sound notifications | Miss turns | Low | **HIGH** |
| Clicker disconnect blocks team | Game stuck | Medium | **HIGH** |

### Important Gaps (Quality of Life)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No tutorial | New users confused | Medium | MEDIUM |
| No pause button | Cannot pause mid-game | Low | MEDIUM |
| No keyboard nav | Accessibility issue | Medium | MEDIUM |
| Delta updates | Performance | Medium | MEDIUM |

### Nice-to-Have Gaps (Future Features)

| Gap | Impact | Effort | Priority |
|-----|--------|--------|----------|
| No public rooms | Limits discovery | High | LOW |
| No game replay | Cannot review games | High | LOW |
| No AI players | Game pauses on DC | High | LOW |
| No i18n | English only | High | LOW |

---

## 9. Recommended Roadmap

### Phase 1: Critical Fixes (1-2 weeks)
1. Add timer countdown display in game UI
2. Allow any team member to click if clicker disconnected
3. Add sound notification option for turn changes
4. Implement host kick functionality

### Phase 2: Quality Improvements (2-4 weeks)
1. Add "How to Play" tutorial modal
2. Implement host pause/resume timer
3. Add keyboard navigation for cards
4. Optimize to delta updates for card reveals
5. Add browser tab notification

### Phase 3: Feature Enhancements (1-2 months)
1. Game replay system (extend event log TTL)
2. Public room browser (opt-in)
3. Report/block system
4. Connection quality indicator
5. Replace disconnected player feature

### Phase 4: Scale & Polish (Long-term)
1. Room sharding for scale
2. Multi-language support
3. Simple AI for disconnected players
4. Game archival and statistics
5. ELO ranking (requires accounts)

---

## 10. Conclusion

Codenames Online has a **solid foundation** with:
- ✅ Authoritative server architecture
- ✅ Atomic state management (Lua scripts)
- ✅ Robust reconnection system
- ✅ Good security practices

Key areas for improvement:
- **User Experience**: Timer display, sound notifications, tutorial
- **Game Flow**: Handle disconnected clickers, pause functionality
- **Host Controls**: Kick players, manage room
- **Performance**: Delta updates instead of full state

The implementation aligns with ~70% of industry best practices. The remaining 30% are advanced features (AI, replays, rankings) that can be added incrementally.

---

*Document created: January 2026*
*Based on analysis of Board Game Arena, Lichess, Colonist.io, Tabletop Simulator, and Official Codenames Online*
