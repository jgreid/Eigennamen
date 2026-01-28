# Comprehensive Code Review Prompt

Use this prompt to systematically review the Codenames Online codebase for issues, bugs, and improvements.

---

## Instructions for AI Assistant

Review the Codenames Online codebase thoroughly, examining each category below. For each issue found:
1. Identify the **file path and line number(s)**
2. Describe the **problem** clearly
3. Assess **severity** (Critical/High/Medium/Low)
4. Provide a **recommended fix**

---

## 1. SECURITY

### 1.1 Input Validation & Sanitization
- [ ] Are all user inputs validated on both client AND server?
- [ ] Is HTML properly escaped before rendering (XSS prevention)?
- [ ] Are SQL/NoSQL injection vectors protected?
- [ ] Are regex patterns safe from ReDoS attacks?
- [ ] Are file paths validated to prevent path traversal?
- [ ] Are URLs validated before fetching/redirecting?

### 1.2 Authentication & Authorization
- [ ] Are session tokens generated securely (crypto.randomBytes)?
- [ ] Is session fixation prevented?
- [ ] Are authorization checks performed on every protected operation?
- [ ] Can players perform actions they shouldn't (host-only actions, team-specific actions)?
- [ ] Are reconnection tokens secure and time-limited?

### 1.3 Rate Limiting
- [ ] Are all socket events rate-limited?
- [ ] Are REST endpoints rate-limited?
- [ ] Can rate limits be bypassed by manipulating identifiers?
- [ ] Are rate limit windows appropriate for the action?

### 1.4 Data Exposure
- [ ] Is sensitive data (session IDs, internal state) exposed to clients?
- [ ] Are error messages leaking internal details?
- [ ] Is debug logging disabled in production?
- [ ] Are secrets properly managed (not hardcoded)?

---

## 2. CONCURRENCY & RACE CONDITIONS

### 2.1 State Mutations
- [ ] Can two players reveal the same card simultaneously?
- [ ] Can two players join/leave causing player count inconsistency?
- [ ] Can host transfer race with player kick?
- [ ] Can game start while settings are being updated?
- [ ] Are Redis operations atomic where needed (use Lua scripts)?

### 2.2 Event Ordering
- [ ] Can events arrive out of order on reconnection?
- [ ] Is event log replay idempotent?
- [ ] Can duplicate events cause state corruption?

### 2.3 Connection State
- [ ] What happens if disconnect fires during a pending operation?
- [ ] Can reconnect race with room deletion?
- [ ] Are socket listeners properly cleaned up?

---

## 3. ERROR HANDLING

### 3.1 Server-Side
- [ ] Are all async operations wrapped in try-catch?
- [ ] Do promises have .catch() handlers or use async/await with try-catch?
- [ ] Are errors logged with appropriate context?
- [ ] Do timeout errors clean up properly?
- [ ] Are Redis connection failures handled gracefully?
- [ ] Are database connection failures handled gracefully?

### 3.2 Client-Side
- [ ] Are network errors handled and displayed to users?
- [ ] Are WebSocket disconnections handled gracefully?
- [ ] Are localStorage/sessionStorage quota errors handled?
- [ ] Are missing DOM elements handled without crashing?
- [ ] Are JSON parse errors caught?

### 3.3 Error Recovery
- [ ] Can the game recover from a partial state update?
- [ ] Is there a resync mechanism for state drift?
- [ ] Can players rejoin after a crash?

---

## 4. MEMORY & RESOURCE MANAGEMENT

### 4.1 Server Memory
- [ ] Are rooms/players cleaned up after TTL expiration?
- [ ] Are timer intervals cleared when rooms are deleted?
- [ ] Are event listeners removed when sockets disconnect?
- [ ] Is there unbounded growth in any data structures?
- [ ] Are Lua scripts cached or recreated each time?

### 4.2 Client Memory
- [ ] Are setInterval/setTimeout cleared on cleanup?
- [ ] Are event listeners removed when elements are removed?
- [ ] Are large objects (game history) bounded in size?
- [ ] Is there DOM node accumulation (memory leak)?

### 4.3 Redis Memory
- [ ] Do all keys have appropriate TTLs?
- [ ] Are orphaned keys possible (room deleted but players remain)?
- [ ] Is event log size bounded?
- [ ] Are pub/sub subscriptions cleaned up?

---

## 5. DATA CONSISTENCY

### 5.1 State Synchronization
- [ ] Can client state diverge from server state?
- [ ] Is the single source of truth always the server?
- [ ] Are optimistic updates properly reconciled?
- [ ] Does reconnection fully restore state?

### 5.2 Validation Boundaries
- [ ] Is data validated at entry points (handlers)?
- [ ] Is validation consistent between REST and Socket APIs?
- [ ] Are constraints enforced at the database level?
- [ ] Can invalid state be persisted?

### 5.3 Relationships
- [ ] Can a player exist without a room?
- [ ] Can a room have zero players indefinitely?
- [ ] Can game state reference non-existent players?
- [ ] Are cascading deletes handled?

---

## 6. INTERNATIONALIZATION (Reviewed ✓)

### 6.1 Timezone Handling
- [x] Are timers synchronized using server time, not client clocks?
- [x] Are timestamps displayed with timezone context?
- [ ] Are date comparisons timezone-aware?

### 6.2 Locale Handling
- [x] Is case conversion locale-safe (Turkish i problem)?
- [x] Are string comparisons using proper collation?
- [x] Are Unicode combining characters normalized?

### 6.3 Character Encoding
- [x] Does input validation support international characters?
- [x] Are emoji/surrogate pairs handled correctly?
- [ ] Is UTF-8 enforced throughout the stack?

---

## 7. PERFORMANCE

### 7.1 Algorithmic Efficiency
- [ ] Are there O(n²) or worse operations on player lists?
- [ ] Are there unnecessary iterations or repeated lookups?
- [ ] Is data structured for efficient access patterns?

### 7.2 Network Efficiency
- [ ] Are large payloads chunked or paginated?
- [ ] Are unnecessary events being broadcast?
- [ ] Is there redundant data in socket messages?
- [ ] Are reconnection syncs minimal (delta vs full state)?

### 7.3 Database/Redis Efficiency
- [ ] Are there N+1 query patterns?
- [ ] Are indexes used appropriately?
- [ ] Are pipelines used for multiple Redis operations?
- [ ] Are Lua scripts used for atomic operations?

### 7.4 Client Rendering
- [ ] Is the DOM updated efficiently (batch updates)?
- [ ] Are expensive operations debounced/throttled?
- [ ] Is there unnecessary re-rendering?

---

## 8. FRONTEND QUALITY

### 8.1 State Management
- [ ] Is global state minimized and well-organized?
- [ ] Are UI updates triggered by state changes, not vice versa?
- [ ] Is state persisted appropriately (localStorage vs sessionStorage)?

### 8.2 Event Handling
- [ ] Are event listeners using delegation where appropriate?
- [ ] Are handlers debounced/throttled where needed?
- [ ] Are keyboard shortcuts accessible and documented?

### 8.3 Accessibility
- [ ] Do interactive elements have proper ARIA labels?
- [ ] Is color not the only indicator (for colorblind users)?
- [ ] Can the game be played with keyboard only?
- [ ] Are focus states visible?

### 8.4 Responsive Design
- [ ] Does the UI work on mobile screens?
- [ ] Are touch targets large enough (44px minimum)?
- [ ] Does the layout adapt to different viewport sizes?

---

## 9. API DESIGN

### 9.1 Socket Events
- [ ] Are event names consistent (noun:verb pattern)?
- [ ] Are payloads consistent in structure?
- [ ] Are all events documented?
- [ ] Are acknowledgment callbacks used where appropriate?

### 9.2 REST Endpoints
- [ ] Are HTTP methods used correctly (GET vs POST)?
- [ ] Are status codes appropriate for each response?
- [ ] Is error response format consistent?
- [ ] Are endpoints RESTful (resource-based)?

### 9.3 Error Responses
- [ ] Do all errors include a machine-readable code?
- [ ] Are error messages user-friendly?
- [ ] Is sensitive information excluded from errors?

---

## 10. CODE QUALITY

### 10.1 Dead Code
- [ ] Are there unused functions or variables?
- [ ] Are there unreachable code paths?
- [ ] Are there commented-out blocks that should be removed?

### 10.2 Duplication
- [ ] Is logic duplicated between client and server?
- [ ] Are similar validation rules repeated?
- [ ] Could helper functions reduce duplication?

### 10.3 Naming & Documentation
- [ ] Are function/variable names descriptive?
- [ ] Are complex algorithms documented?
- [ ] Are magic numbers extracted to constants?
- [ ] Are JSDoc comments accurate and complete?

### 10.4 Code Organization
- [ ] Is the file structure logical?
- [ ] Are concerns properly separated?
- [ ] Are circular dependencies avoided?

---

## 11. TESTING

### 11.1 Coverage
- [ ] Are critical paths (game logic) well-tested?
- [ ] Are edge cases tested (empty arrays, null values)?
- [ ] Are error conditions tested?
- [ ] Are race conditions tested?

### 11.2 Test Quality
- [ ] Are tests isolated (no shared state)?
- [ ] Are tests deterministic (no flaky tests)?
- [ ] Do tests verify behavior, not implementation?
- [ ] Are mocks used appropriately?

### 11.3 Missing Tests
- [ ] Socket event handlers
- [ ] Reconnection flows
- [ ] Timer edge cases
- [ ] Multi-player race conditions

---

## 12. DEPLOYMENT & OPERATIONS

### 12.1 Configuration
- [ ] Are all config values environment-variable driven?
- [ ] Are defaults safe for production?
- [ ] Is there validation of required environment variables?

### 12.2 Logging
- [ ] Are logs structured (JSON)?
- [ ] Are log levels used appropriately?
- [ ] Is PII excluded from logs?
- [ ] Are request IDs included for tracing?

### 12.3 Monitoring
- [ ] Are health check endpoints comprehensive?
- [ ] Are metrics exposed for monitoring?
- [ ] Are errors reported to a tracking service?

### 12.4 Graceful Shutdown
- [ ] Are in-flight requests completed on shutdown?
- [ ] Are connections properly closed?
- [ ] Is state persisted before shutdown?

---

## 13. SPECIFIC GAME LOGIC

### 13.1 Turn Management
- [ ] Can the wrong team take an action?
- [ ] Can actions be taken after game ends?
- [ ] Is turn switching atomic?
- [ ] Are timer expirations handled correctly?

### 13.2 Card Revealing
- [ ] Can the same card be revealed twice?
- [ ] Is the assassin card immediately game-ending?
- [ ] Are card counts updated atomically?
- [ ] Does revealing update both teams' views correctly?

### 13.3 Clue Validation
- [ ] Are all board words checked (not just unrevealed)?
- [ ] Are compound words handled correctly?
- [ ] Is the number validated (0 = unlimited)?
- [ ] Are special characters in clues handled?

### 13.4 Win Conditions
- [ ] Is game over detected immediately?
- [ ] Are all win/lose conditions covered?
- [ ] Is the winner correctly determined?
- [ ] Is the game state locked after ending?

### 13.5 Player Roles
- [ ] Can a player be both spymaster and guesser?
- [ ] Can spectators see spymaster view?
- [ ] Are role changes handled mid-game?
- [ ] Is host transfer handled correctly?

---

## Output Format

For each issue found, provide:

```markdown
### [Category] Issue Title

**File:** `path/to/file.js:123-145`
**Severity:** Critical | High | Medium | Low

**Problem:**
Description of what's wrong and why it matters.

**Example:**
```javascript
// Problematic code
```

**Recommended Fix:**
```javascript
// Fixed code
```

**Impact:**
What could go wrong if this isn't fixed.
```

---

## Priority Order

1. **Critical:** Security vulnerabilities, data loss, game-breaking bugs
2. **High:** Race conditions, state corruption, significant UX issues
3. **Medium:** Performance issues, minor bugs, code quality
4. **Low:** Documentation, style, minor improvements
