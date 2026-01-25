# Codenames Online: Sprint Plan 19-20-21

**Created:** January 25, 2026
**Based on:** Comprehensive codebase review and previous sprint completion
**Project Status:** Production-ready (A-grade), 91%+ test coverage

---

## Executive Summary

This document outlines the next 3 development sprints for Codenames Online. Building on the excellent foundation of completed Sprints 13-18, these sprints focus on:

| Sprint | Theme | Focus Area | Risk Level |
|--------|-------|------------|------------|
| **19** | Consolidation & Security | Complete frontend modernization, security hardening | Low |
| **20** | Internationalization | Multi-language support, enhanced accessibility | Low-Medium |
| **21** | Game Modes & Social | Custom game variants, player profiles | Medium |

**Total Estimated Effort:** 8-10 weeks (1 engineer) or 5-6 weeks (2 engineers)

---

## Current Project Status (Post-Sprint 18)

| Metric | Value | Status |
|--------|-------|--------|
| Test Coverage (Statements) | 91%+ | Excellent |
| Test Coverage (Lines) | 91%+ | Excellent |
| Test Coverage (Branches) | 84%+ | Good |
| Backend Tests | 2,345+ passing | Comprehensive |
| E2E Tests | 53 passing | Solid foundation |
| Frontend Tests | 106 passing | Good coverage |
| Critical/High Issues | 0 remaining | Complete |

### Recent Achievements (Sprints 15-18)
- E2E testing framework with 53 Playwright tests
- PWA support (manifest.json, service worker)
- Comprehensive accessibility tests
- Multiplayer support in modular frontend
- Redis benchmarks and multiplayer stress tests
- Quick wins and test coverage improvements

---

## Sprint 19: Frontend Consolidation & Security Hardening

**Duration:** 2-3 weeks
**Focus:** Complete the frontend modernization journey and lock down security
**Risk Level:** Low
**Dependencies:** None

### 19.1 Complete Frontend Modular Migration
**Priority:** HIGH | **Effort:** 22 hours

The modular frontend (`server/public/js/`) is partially complete. This task finishes the migration.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Wire up main.js entry point | 4h | Connect all modules, initialize app |
| Complete ui.js DOM bindings | 6h | All UI interactions through ui.js |
| Update index.html imports | 4h | Switch to bundled modules |
| Remove legacy code paths | 4h | Clean up dual implementation |
| Add module loading tests | 4h | Verify ES module loading works |

**Files to Modify:**
- `server/public/js/main.js` - Entry point wiring
- `server/public/js/ui.js` - DOM binding completion
- `index.html` - Module import switching
- `server/public/js/socket-client.js` - Verify all events connected

**Success Criteria:**
- Single canonical frontend implementation
- All features work through modular code
- Legacy `index.html` inline code removed or migrated
- No functionality regression

---

### 19.2 Security Hardening
**Priority:** HIGH | **Effort:** 16 hours

Implement remaining security improvements identified in code review.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Session rotation on reconnect | 4h | Issue new token after successful reconnection |
| Inactivity timeout | 4h | Disconnect idle sessions after 30 minutes |
| CSP refinement | 4h | Tighten Content-Security-Policy headers |
| Rate limit header validation | 2h | Standardize rate limit response headers |
| JWT validation improvements | 2h | Enhanced token claim verification |

**Implementation Details:**

```javascript
// Session rotation example (playerService.js)
async rotateSessionToken(playerId, oldToken) {
  // Verify old token is valid
  // Generate new token with fresh expiry
  // Invalidate old token in Redis
  // Return new token
}

// Inactivity timeout (socket/index.js)
const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes
socket.on('activity', () => socket.lastActivity = Date.now());
setInterval(() => {
  if (Date.now() - socket.lastActivity > INACTIVITY_TIMEOUT) {
    socket.disconnect(true);
  }
}, 60000);
```

**Files to Modify:**
- `server/src/services/playerService.js` - Session rotation
- `server/src/socket/index.js` - Inactivity timeout
- `server/src/middleware/security.js` - CSP headers
- `server/src/config/constants.js` - Security constants

**Success Criteria:**
- Sessions rotate on reconnection
- Idle connections terminate after 30 minutes
- CSP headers pass security audit
- No security-related warnings in production logs

---

### 19.3 Documentation Completion
**Priority:** MEDIUM | **Effort:** 8 hours

Create missing documentation to improve developer experience.

**Documents to Create:**
| Document | Effort | Purpose |
|----------|--------|---------|
| `docs/ARCHITECTURE.md` | 3h | High-level system design with diagrams |
| `CONTRIBUTING.md` | 2h | Contributor guidelines and workflow |
| `docs/TESTING_GUIDE.md` | 3h | How to write and run tests |

**ARCHITECTURE.md Structure:**
```markdown
# Architecture Overview
1. System Diagram (ASCII art or Mermaid)
2. Component Descriptions
3. Data Flow
4. Technology Choices
5. Deployment Architecture
```

**Success Criteria:**
- All 3 documents created and reviewed
- Architecture diagram clearly shows component relationships
- New contributors can onboard using CONTRIBUTING.md

---

### 19.4 Performance Monitoring
**Priority:** MEDIUM | **Effort:** 6 hours

Add observability for production monitoring.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Add performance timing middleware | 2h | Log request/response times |
| Socket event timing | 2h | Track socket handler execution time |
| Memory usage alerts | 2h | Warn when memory exceeds threshold |

**Implementation:**
```javascript
// Timing middleware
const timing = (req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const duration = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({ path: req.path, duration_ms: duration });
  });
  next();
};
```

**Success Criteria:**
- All HTTP requests logged with timing
- Socket events logged with execution time
- Memory alerts trigger at 80% threshold

---

### Sprint 19 Summary

| Task | Effort | Priority |
|------|--------|----------|
| Frontend modular migration | 22h | HIGH |
| Security hardening | 16h | HIGH |
| Documentation | 8h | MEDIUM |
| Performance monitoring | 6h | MEDIUM |
| **Total** | **52h** | |

**Sprint 19 Exit Criteria:**
- [ ] Single frontend implementation (no dual code paths)
- [ ] Session rotation implemented and tested
- [ ] Inactivity timeout working
- [ ] All 3 documentation files created
- [ ] Performance timing in production logs
- [ ] Test coverage remains above 85%

---

## Sprint 20: Internationalization & Enhanced Accessibility

**Duration:** 2-3 weeks
**Focus:** Make the game accessible to international users and improve accessibility
**Risk Level:** Low-Medium
**Dependencies:** Sprint 19 (frontend consolidation helps with i18n)

### 20.1 Internationalization (i18n) Framework
**Priority:** HIGH | **Effort:** 20 hours

Add multi-language support starting with high-demand languages.

**Phase 1: Framework Setup (8h)**
| Task | Effort | Description |
|------|--------|-------------|
| Add i18n library | 2h | Integrate i18next or similar |
| Extract strings to JSON | 4h | Create en.json translation file |
| Language selector UI | 2h | Allow users to switch languages |

**Phase 2: Initial Translations (12h)**
| Language | Effort | Priority |
|----------|--------|----------|
| German (de) | 4h | HIGH - "Die Eigennamen" origin |
| Spanish (es) | 4h | HIGH - Large player base |
| French (fr) | 4h | MEDIUM - European coverage |

**Translation File Structure:**
```json
// locales/en.json
{
  "game": {
    "newGame": "New Game",
    "endTurn": "End Turn",
    "giveClue": "Give Clue",
    "cardsRemaining": "{{count}} cards remaining"
  },
  "room": {
    "createRoom": "Create Room",
    "joinRoom": "Join Room",
    "roomCode": "Room Code"
  },
  "roles": {
    "spymaster": "Spymaster",
    "operative": "Operative",
    "spectator": "Spectator"
  }
}
```

**Files to Create/Modify:**
- `server/public/locales/en.json` - English (source)
- `server/public/locales/de.json` - German
- `server/public/locales/es.json` - Spanish
- `server/public/locales/fr.json` - French
- `server/public/js/i18n.js` - i18n module
- `index.html` - Language selector

**Success Criteria:**
- Language selector in settings modal
- All UI text translated (4 languages)
- Language preference persisted in localStorage
- Pluralization works correctly

---

### 20.2 Localized Word Lists
**Priority:** HIGH | **Effort:** 12 hours

Provide native word lists for each supported language.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| German word list (400 words) | 3h | Curated German vocabulary |
| Spanish word list (400 words) | 3h | Curated Spanish vocabulary |
| French word list (400 words) | 3h | Curated French vocabulary |
| Language-based list selection | 3h | Auto-select based on UI language |

**Word List Curation Guidelines:**
- Common nouns recognizable to most speakers
- No proper nouns or brand names
- Avoid words with offensive double meanings
- Mix of concrete and abstract concepts
- Appropriate difficulty for word association

**Files to Create:**
- `server/public/wordlists/de-words.txt` - German
- `server/public/wordlists/es-words.txt` - Spanish
- `server/public/wordlists/fr-words.txt` - French
- `server/src/services/wordListService.js` - Update for language selection

**Success Criteria:**
- Each language has 400+ curated words
- Word lists auto-selected based on UI language
- Users can override with custom word lists

---

### 20.3 Enhanced Accessibility (WCAG 2.1 AA)
**Priority:** HIGH | **Effort:** 16 hours

Achieve full WCAG 2.1 AA compliance.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Color contrast audit | 3h | Ensure 4.5:1 ratio for all text |
| Focus indicator improvements | 3h | Visible focus rings on all interactive elements |
| Screen reader optimization | 4h | Meaningful announcements for all actions |
| Keyboard shortcuts | 3h | Add shortcuts for common actions |
| Color blind mode | 3h | Alternative color schemes |

**Color Blind Mode Options:**
- Deuteranopia (green-blind) - Use blue/orange
- Protanopia (red-blind) - Use blue/yellow
- Tritanopia (blue-blind) - Use red/green (with patterns)

**Keyboard Shortcuts:**
| Shortcut | Action |
|----------|--------|
| `N` | New game |
| `E` | End turn |
| `C` | Focus clue input |
| `1-9` | Select card number for clue |
| `?` | Show help modal |
| `Esc` | Close modal |

**Files to Modify:**
- `index.html` - Color contrast, focus styles, shortcuts
- `server/public/js/ui.js` - Keyboard handler
- CSS variables for color themes

**Success Criteria:**
- Lighthouse accessibility score: 95+
- All contrast ratios meet WCAG AA (4.5:1)
- Full keyboard navigation
- Screen reader announces all game events
- Color blind mode toggle in settings

---

### 20.4 Enhanced Game Replay
**Priority:** MEDIUM | **Effort:** 8 hours

Improve game replay experience with shareable links.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Shareable replay links | 3h | Generate unique URLs for replays |
| Replay speed control | 2h | 0.5x, 1x, 2x speed options |
| Replay export | 3h | Download replay as JSON/text |

**Shareable Link Format:**
```
https://codenames.example.com/replay/abc123xyz
```

**Files to Modify:**
- `server/src/services/gameHistoryService.js` - Replay ID generation
- `server/src/routes/replay.js` - Replay API endpoint
- `index.html` - Replay UI enhancements

**Success Criteria:**
- Replay links work for 30 days
- Speed control works smoothly
- Export produces readable format

---

### Sprint 20 Summary

| Task | Effort | Priority |
|------|--------|----------|
| i18n framework + 4 languages | 20h | HIGH |
| Localized word lists | 12h | HIGH |
| Accessibility improvements | 16h | HIGH |
| Enhanced game replay | 8h | MEDIUM |
| **Total** | **56h** | |

**Sprint 20 Exit Criteria:**
- [ ] 4 languages fully supported (en, de, es, fr)
- [ ] 400+ words per language
- [ ] Lighthouse accessibility: 95+
- [ ] Color blind mode available
- [ ] Keyboard shortcuts documented
- [ ] Shareable replay links working

---

## Sprint 21: Custom Game Modes & Social Features

**Duration:** 3-4 weeks
**Focus:** Add engaging new gameplay variants and social features
**Risk Level:** Medium
**Dependencies:** Sprint 19-20 (stable foundation needed)

### 21.1 Custom Game Modes
**Priority:** HIGH | **Effort:** 24 hours

Add alternative game rule sets to increase replayability.

**Mode 1: Blitz Mode (8h)**
| Feature | Description |
|---------|-------------|
| Short timer | 30 seconds per turn (configurable) |
| Fast reveal | No confirmation on card clicks |
| Streak bonus | Extra time for correct guesses |
| Quick win | First to 5 cards wins |

**Mode 2: Duet Mode (Cooperative) (10h)**
| Feature | Description |
|---------|-------------|
| 2 players | Each player is spymaster for the other |
| Shared board | Different views of same board |
| Limited turns | 9 turns total to win |
| Assassin danger | 3 assassins instead of 1 |

**Mode 3: Three-Team Mode (6h)**
| Feature | Description |
|---------|-------------|
| 3 teams | Red, Blue, Green |
| 25 cards | 7-7-7 + 3 neutral + 1 assassin |
| Turn order | Clockwise rotation |

**Implementation:**
```javascript
// Game mode configuration
const GAME_MODES = {
  classic: { teams: 2, cards: [9, 8], assassins: 1, timer: 120 },
  blitz: { teams: 2, cards: [5, 5], assassins: 1, timer: 30, streakBonus: 5 },
  duet: { teams: 1, cooperative: true, cards: [15], assassins: 3, turns: 9 },
  threeTeam: { teams: 3, cards: [7, 7, 7], assassins: 1, timer: 120 }
};
```

**Files to Modify:**
- `server/src/services/gameService.js` - Mode-specific game logic
- `server/src/config/constants.js` - Game mode configurations
- `index.html` - Mode selection UI
- `server/src/__tests__/gameService.test.js` - Tests for each mode

**Success Criteria:**
- All 3 modes playable end-to-end
- Mode selection in room settings
- Existing "classic" mode unchanged
- 90%+ test coverage for new modes

---

### 21.2 Player Profiles (Optional Accounts)
**Priority:** MEDIUM | **Effort:** 20 hours

Add optional persistent player identity.

**Phase 1: Account System (10h)**
| Task | Effort | Description |
|------|--------|-------------|
| User registration | 3h | Email/password or social login |
| Login flow | 3h | JWT-based authentication |
| Profile settings | 2h | Nickname, avatar, preferences |
| Account deletion | 2h | GDPR compliance |

**Phase 2: Statistics (10h)**
| Statistic | Description |
|-----------|-------------|
| Games played | Total game count |
| Win rate | Percentage of games won |
| Win streak | Current consecutive wins |
| Favorite role | Most played role |
| Total guesses | Cards revealed |
| Perfect games | Games with no wrong guesses |

**Database Schema Addition:**
```prisma
model UserStats {
  id            String   @id @default(uuid())
  userId        String   @unique
  gamesPlayed   Int      @default(0)
  gamesWon      Int      @default(0)
  currentStreak Int      @default(0)
  bestStreak    Int      @default(0)
  cardsRevealed Int      @default(0)
  perfectGames  Int      @default(0)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  user          User     @relation(fields: [userId], references: [id])
}
```

**Files to Create/Modify:**
- `server/prisma/schema.prisma` - UserStats model
- `server/src/services/userService.js` - User management
- `server/src/services/statsService.js` - Statistics tracking
- `server/src/routes/auth.js` - Authentication endpoints
- `index.html` - Login/profile UI

**Success Criteria:**
- Optional registration works
- Statistics tracked for logged-in users
- Anonymous play still works
- Account deletion removes all data

---

### 21.3 Room Invites & Friends
**Priority:** MEDIUM | **Effort:** 12 hours

Direct player invitations and friend lists.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Friend list | 4h | Add/remove friends, see online status |
| Room invites | 4h | Invite friends directly to room |
| Invite notifications | 4h | Browser notifications for invites |

**Invite Flow:**
```
1. Player A creates room
2. Player A clicks "Invite" → sees friend list
3. Player A selects friends → sends invites
4. Friend B receives browser notification
5. Friend B clicks notification → joins room
```

**Files to Create/Modify:**
- `server/src/services/friendService.js` - Friend management
- `server/src/socket/handlers/inviteHandlers.js` - Invite events
- `index.html` - Friends list UI, invite modal

**Success Criteria:**
- Friends can be added by username
- Online status visible
- Invites delivered in real-time
- Works without accounts (session-based friends)

---

### 21.4 Sound & Visual Polish
**Priority:** LOW | **Effort:** 8 hours

Enhance the sensory experience.

**Tasks:**
| Task | Effort | Description |
|------|--------|-------------|
| Additional sound effects | 3h | Turn change, timer warning, game end |
| Card flip animation | 2h | Smooth reveal animation |
| Victory celebration | 2h | Confetti/animation on win |
| Theme customization | 1h | Light/dark mode persistence |

**Sound Effects to Add:**
- `turn-change.mp3` - Subtle chime when turn changes
- `timer-warning.mp3` - Alert when 10 seconds remain
- `game-win.mp3` - Victory fanfare
- `game-lose.mp3` - Defeat sound
- `assassin.mp3` - Dramatic reveal

**Success Criteria:**
- All sounds can be muted individually
- Animations smooth at 60fps
- Theme preference persisted

---

### Sprint 21 Summary

| Task | Effort | Priority |
|------|--------|----------|
| Custom game modes (3 modes) | 24h | HIGH |
| Player profiles & stats | 20h | MEDIUM |
| Room invites & friends | 12h | MEDIUM |
| Sound & visual polish | 8h | LOW |
| **Total** | **64h** | |

**Sprint 21 Exit Criteria:**
- [ ] 3 game modes fully playable
- [ ] Optional accounts working
- [ ] Statistics tracked and displayed
- [ ] Friend invites functional
- [ ] Sound effects implemented
- [ ] All features tested (80%+ coverage)

---

## Risk Assessment

### Sprint 19 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Frontend migration breaks features | Medium | High | Comprehensive E2E tests exist |
| Security changes affect UX | Low | Medium | Gradual rollout with feature flags |

### Sprint 20 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Translation quality issues | Medium | Medium | Use native speakers for review |
| Accessibility regressions | Low | High | Automated a11y testing in CI |

### Sprint 21 Risks
| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| Game mode logic complexity | Medium | High | Extensive unit testing |
| Account system security | Medium | High | Use proven auth library (Passport) |
| Scope creep on features | High | Medium | Strict time-boxing, defer enhancements |

---

## Success Metrics Summary

### After Sprint 19
- [ ] Single frontend implementation (no dual code)
- [ ] 3 security improvements deployed
- [ ] All documentation complete
- [ ] Performance monitoring active
- [ ] Test coverage remains 85%+

### After Sprint 20
- [ ] 4 languages fully supported
- [ ] Lighthouse accessibility: 95+
- [ ] Localized word lists for each language
- [ ] Shareable replay links working
- [ ] Color blind mode available

### After Sprint 21
- [ ] 3 game modes playable
- [ ] Optional accounts functional
- [ ] Statistics dashboard working
- [ ] Friend system operational
- [ ] All new features tested

---

## Resource Requirements

| Sprint | Backend | Frontend | QA | Total |
|--------|---------|----------|-----|-------|
| 19 | 0.7 | 0.8 | 0.5 | 2.0 |
| 20 | 0.4 | 1.0 | 0.6 | 2.0 |
| 21 | 1.0 | 1.0 | 0.5 | 2.5 |

**Total:** ~6.5 person-weeks

---

## Post-Sprint 21 Backlog

Features deferred to future consideration:

| Feature | Priority | Estimate | Notes |
|---------|----------|----------|-------|
| Tournament Mode | MEDIUM | 40h+ | Bracket management, scheduling |
| AI Spymaster | LOW | 50h+ | Requires ML/NLP integration |
| Voice Chat | LOW | 50h+ | Consider WebRTC or third-party |
| Mobile Native App | VERY LOW | 80h+ | React Native if demand exists |
| Real-time Spectating | LOW | 20h | Watch live games with delay |
| Achievement System | LOW | 16h | Badges and milestones |

---

## Appendix: Key Files Reference

### Sprint 19 Primary Files
- `server/public/js/main.js` - Entry point
- `server/public/js/ui.js` - UI module
- `server/src/services/playerService.js` - Session rotation
- `server/src/socket/index.js` - Inactivity timeout
- `docs/ARCHITECTURE.md` - New
- `CONTRIBUTING.md` - New

### Sprint 20 Primary Files
- `server/public/js/i18n.js` - New
- `server/public/locales/*.json` - Translation files
- `server/public/wordlists/*.txt` - Localized word lists
- `index.html` - Language selector, accessibility

### Sprint 21 Primary Files
- `server/src/services/gameService.js` - Game modes
- `server/src/services/userService.js` - New
- `server/src/services/statsService.js` - New
- `server/src/services/friendService.js` - New
- `server/prisma/schema.prisma` - UserStats model

---

*This sprint plan should be reviewed and adjusted based on team capacity and user feedback.*
