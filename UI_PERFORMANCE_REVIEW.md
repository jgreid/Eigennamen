# UI Performance Review - Risley-Codenames

**Review Date:** January 2026
**Reviewer:** Claude Code Review
**Focus:** UI Buttons and Interface Performance
**Branch:** `claude/review-ui-performance-OnE38`

---

## Executive Summary

The Codenames UI is a well-designed single-page application with glassmorphism styling and good accessibility features. However, there are several performance optimizations that could significantly improve responsiveness, especially on lower-powered devices and mobile browsers.

**Performance Score (Estimated):** 65/100
**Key Concern:** Full DOM re-renders on every state change

---

## Critical Performance Issues

### 1. Full Board Re-render on Every State Change

**Location:** `index.html:2395-2448` (`renderBoard()` function)
**Severity:** High
**Impact:** Causes jank on every card click

```javascript
function renderBoard() {
    const board = document.getElementById('board');
    if (!board) return;
    board.innerHTML = '';  // Destroys all 25 card elements

    gameState.words.forEach((word, index) => {
        const card = document.createElement('div');
        // ... creates new element for each card
        board.appendChild(card);
    });
}
```

**Problem:** Every card reveal triggers `renderBoard()`, which:
1. Destroys all 25 existing card DOM elements
2. Creates 25 new card elements
3. Attaches 50 new event handlers (onclick + onkeydown per card)
4. Forces browser reflow/repaint

**Recommendation:** Implement incremental updates:
```javascript
function updateCard(index) {
    const cards = document.querySelectorAll('.card');
    const card = cards[index];
    if (card && gameState.revealed[index]) {
        card.classList.add('revealed', gameState.types[index]);
    }
}
```

---

### 2. Expensive Backdrop-Filter Effects

**Location:** `index.html:49-50, 95-96, 802`
**Severity:** Medium-High
**Impact:** GPU-intensive on every frame, especially on mobile

```css
.sidebar {
    backdrop-filter: blur(20px);
    -webkit-backdrop-filter: blur(20px);
}

.glass-panel {
    backdrop-filter: blur(10px);
    -webkit-backdrop-filter: blur(10px);
}

.modal-overlay {
    backdrop-filter: blur(4px);
}
```

**Problem:** `backdrop-filter: blur()` is one of the most expensive CSS operations. Each blur requires:
- Rendering content behind the element to a texture
- Applying a multi-pass Gaussian blur
- Compositing the result

With 3+ elements using this effect, performance degrades significantly.

**Recommendation:**
1. Use solid/semi-transparent backgrounds as fallback
2. Apply `will-change: backdrop-filter` only when element is visible
3. Consider reducing or removing blur on mobile devices:
```css
@media (max-width: 768px), (prefers-reduced-motion: reduce) {
    .sidebar, .glass-panel, .modal-overlay {
        backdrop-filter: none;
        background: rgba(15, 15, 26, 0.95);
    }
}
```

---

### 3. Infinite Animations on Non-Essential Elements

**Location:** `index.html:245-252, 444-450, 1282`
**Severity:** Medium
**Impact:** Constant GPU/CPU usage even when idle

```css
.turn-indicator.your-turn {
    animation: pulse-glow 2s ease-in-out infinite;
}

.btn-end-turn.can-act {
    animation: pulse-glow 2s ease-in-out infinite;
}

.spymaster-warning {
    animation: pulse-warning 2s ease-in-out infinite;
}
```

**Problem:**
- `box-shadow` animations are NOT hardware-accelerated
- Multiple infinite animations run simultaneously
- Browser cannot optimize these to reduce power consumption

**Recommendation:** Use `transform` and `opacity` for GPU-accelerated animations:
```css
@keyframes pulse-glow-optimized {
    0%, 100% {
        transform: scale(1);
        opacity: 1;
    }
    50% {
        transform: scale(1.02);
        opacity: 0.95;
    }
}

/* Or use CSS containment */
.turn-indicator.your-turn {
    contain: layout style paint;
}
```

---

### 4. Non-Specific CSS Transitions

**Location:** `index.html:320, 582`
**Severity:** Medium
**Impact:** Unnecessary property transitions cause micro-stutters

```css
button {
    transition: all 0.2s ease;
}

.card {
    transition: all 0.2s ease;
}
```

**Problem:** `transition: all` transitions every CSS property, including ones that don't need animation (color, border-width, etc.). This forces the browser to check all properties on every state change.

**Recommendation:** Specify exact properties:
```css
button {
    transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card {
    transition: transform 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
}
```

---

## Button-Specific Issues

### 5. Inline onclick Handlers vs Event Delegation

**Location:** `index.html:1454-1627`
**Severity:** Low-Medium
**Impact:** Code maintainability, slight memory overhead

```html
<button class="btn-new-game" onclick="confirmNewGame()">New Game</button>
<button class="btn-team-red" onclick="setTeam('red')">Join</button>
<button class="btn-spymaster-red" onclick="setSpymaster('red')">Spy</button>
<!-- ... 15+ more buttons with inline handlers -->
```

**Problem:**
- Inline handlers pollute global scope
- Cannot be removed/replaced without changing HTML
- Creates implicit function wrappers

**Recommendation:** Use event delegation:
```javascript
document.getElementById('controls').addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;

    const action = btn.dataset.action;
    const team = btn.dataset.team;

    switch (action) {
        case 'new-game': confirmNewGame(); break;
        case 'set-team': setTeam(team); break;
        case 'set-spymaster': setSpymaster(team); break;
        // ...
    }
});
```

---

### 6. Missing Debounce on New Game Button

**Location:** `index.html:2080-2093`
**Severity:** Low
**Impact:** Rapid clicks could cause state inconsistencies

```javascript
function newGame() {
    const seed = generateGameSeed();
    if (initGame(seed, activeWords)) {
        // No protection against rapid re-invocation
        isHost = true;
        // ...
    }
}
```

**Recommendation:** Add debounce:
```javascript
let newGameDebounce = false;
function newGame() {
    if (newGameDebounce) return;
    newGameDebounce = true;
    setTimeout(() => newGameDebounce = false, 500);
    // ... rest of function
}
```

---

### 7. Button State Updates Query DOM Multiple Times

**Location:** `index.html:2259-2335` (`updateControls()`)
**Severity:** Low-Medium
**Impact:** 8 DOM queries on every state change

```javascript
function updateControls() {
    const endTurnBtn = document.getElementById('btn-end-turn');
    const redSpyBtn = document.getElementById('btn-spymaster-red');
    const blueSpyBtn = document.getElementById('btn-spymaster-blue');
    const redClickerBtn = document.getElementById('btn-clicker-red');
    const blueClickerBtn = document.getElementById('btn-clicker-blue');
    const redTeamBtn = document.getElementById('btn-team-red');
    const blueTeamBtn = document.getElementById('btn-team-blue');
    const spectateBtn = document.getElementById('btn-spectate');
    // ... updates each element
}
```

**Recommendation:** Cache DOM references at initialization:
```javascript
const cachedElements = {};

function cacheElements() {
    cachedElements.endTurnBtn = document.getElementById('btn-end-turn');
    cachedElements.redSpyBtn = document.getElementById('btn-spymaster-red');
    // ... etc
}

function updateControls() {
    const { endTurnBtn, redSpyBtn, ... } = cachedElements;
    // ... use cached references
}
```

---

## Event Handler Issues

### 8. Event Handlers Recreated on Every Render

**Location:** `index.html:2435-2445`
**Severity:** Medium
**Impact:** Memory churn, potential memory leaks

```javascript
gameState.words.forEach((word, index) => {
    const card = document.createElement('div');
    // ...
    card.onclick = () => revealCard(index);    // New function every render
    card.onkeydown = (e) => { /* ... */ };     // New function every render
    board.appendChild(card);
});
```

**Problem:** Each render creates 50 new function closures (25 cards x 2 handlers). Old handlers are garbage collected, but this creates memory pressure.

**Recommendation:** Use event delegation on the board:
```javascript
document.getElementById('board').addEventListener('click', (e) => {
    const card = e.target.closest('.card');
    if (card && !card.classList.contains('revealed')) {
        const index = Array.from(card.parentNode.children).indexOf(card);
        revealCard(index);
    }
});
```

---

### 9. Modal Keyboard Handler Always Active

**Location:** `index.html:1835-1836`
**Severity:** Low
**Impact:** Unnecessary event processing

```javascript
document.addEventListener('keydown', handleModalKeydown);
document.addEventListener('click', handleOverlayClick);
```

**Problem:** These global event listeners run on every keydown/click, even when no modal is open.

**Recommendation:** Add/remove listeners when modals open/close:
```javascript
function openModal(modalId) {
    // ...
    document.addEventListener('keydown', handleModalKeydown);
}

function closeModal(modalId) {
    // ...
    if (!activeModal) {
        document.removeEventListener('keydown', handleModalKeydown);
    }
}
```

---

## Rendering Pipeline Issues

### 10. Multiple Synchronous DOM Updates

**Location:** `index.html:2517-2522`
**Severity:** Medium
**Impact:** Forces multiple reflows per action

```javascript
// In revealCard():
updateURL();
renderBoard();
updateScoreboard();
updateTurnIndicator();
updateRoleBanner();
updateControls();
```

**Problem:** Each function queries/modifies the DOM, potentially causing layout thrashing (read-write-read-write pattern forces browser to recalculate layout multiple times).

**Recommendation:** Batch DOM operations:
```javascript
function batchUpdate() {
    requestAnimationFrame(() => {
        renderBoard();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();
    });
}
```

---

### 11. Screen Reader Announcements Use Multiple Timeouts

**Location:** `index.html:1634-1658`
**Severity:** Low
**Impact:** Potential race conditions with rapid updates

```javascript
function announceToScreenReader(message) {
    const announcer = document.getElementById('sr-announcements');
    if (announcer) {
        announcer.textContent = message;
        setTimeout(() => { announcer.textContent = ''; }, 1000);
    }
}
```

**Problem:** Rapid announcements could queue multiple timeouts, clearing messages prematurely.

**Recommendation:** Track and clear previous timeout:
```javascript
let announcerTimeout = null;
function announceToScreenReader(message) {
    if (announcerTimeout) clearTimeout(announcerTimeout);
    const announcer = document.getElementById('sr-announcements');
    if (announcer) {
        announcer.textContent = message;
        announcerTimeout = setTimeout(() => {
            announcer.textContent = '';
            announcerTimeout = null;
        }, 1000);
    }
}
```

---

## CSS Performance Improvements

### 12. Missing CSS Containment

**Severity:** Medium
**Impact:** Browser cannot optimize rendering

**Recommendation:** Add containment to independent UI sections:
```css
.sidebar {
    contain: layout style;
}

.board-container {
    contain: layout style paint;
}

.card {
    contain: layout style;
}

.modal {
    contain: layout style paint;
}
```

---

### 13. Large Box-Shadow Spreads

**Location:** Multiple button hover states
**Severity:** Low

```css
button:hover {
    box-shadow: 0 6px 16px rgba(0,0,0,0.35);
}
```

**Problem:** Large blur radius box-shadows require significant GPU rendering.

**Recommendation:** Use smaller blur radii or pseudo-elements for shadows:
```css
button:hover {
    box-shadow: 0 4px 8px rgba(0,0,0,0.25);
}
```

---

## Mobile-Specific Issues

### 14. Touch Target Sizes

**Location:** `index.html:1070-1072`
**Severity:** Low
**Assessment:** Good - minimum 44px height enforced

```css
@media (max-width: 768px) {
    button {
        min-height: 44px;  /* Meets Apple's 44pt minimum */
    }
}
```

This is correctly implemented for accessibility.

---

### 15. Instructions Hidden on Mobile

**Location:** `index.html:1080-1082`
**Severity:** Low (UX, not performance)

```css
@media (max-width: 768px) {
    .instructions {
        display: none;
    }
}
```

**Observation:** Instructions are hidden on mobile but a Help button is provided. This is acceptable, though collapsible content might be better for discoverability.

---

## Performance Best Practices Already Implemented

1. **Reduced Motion Support** (`index.html:1125-1144`) - Respects `prefers-reduced-motion`
2. **Focus-Visible Styles** (`index.html:344-348`) - Only shows focus ring on keyboard navigation
3. **Clamp for Responsive Typography** (`index.html:76-77, 586`) - Uses CSS clamp for fluid typography
4. **Passive Event Listeners** - Not needed as no scroll listeners are used
5. **XSS Prevention** (`index.html:1846-1850`) - `escapeHTML()` function properly sanitizes output

---

## Priority Matrix

| Issue | Severity | Effort | Priority |
|-------|----------|--------|----------|
| #1 Full board re-render | High | Medium | **P0** |
| #2 Backdrop-filter expense | Medium-High | Low | **P1** |
| #3 Infinite box-shadow animations | Medium | Low | **P1** |
| #4 `transition: all` | Medium | Low | **P1** |
| #8 Event handlers recreated | Medium | Medium | **P2** |
| #10 Synchronous DOM updates | Medium | Medium | **P2** |
| #7 Uncached DOM queries | Low-Medium | Low | **P2** |
| #12 Missing CSS containment | Medium | Low | **P2** |
| #5 Inline onclick handlers | Low-Medium | Medium | **P3** |
| #6 Missing debounce | Low | Low | **P3** |
| #9 Always-active modal listeners | Low | Low | **P3** |
| #11 Announcement race conditions | Low | Low | **P3** |

---

## Recommended Implementation Order

### Phase 1: Quick Wins (Low Effort, High Impact)
1. Add CSS containment to major sections
2. Specify exact transition properties
3. Reduce/remove `backdrop-filter` on mobile
4. Change pulse animations to use transform/opacity

### Phase 2: DOM Optimization (Medium Effort, High Impact)
5. Implement incremental board updates instead of full re-render
6. Cache frequently accessed DOM elements
7. Use event delegation for board cards

### Phase 3: Architecture Improvements (Higher Effort)
8. Batch DOM updates with requestAnimationFrame
9. Convert inline handlers to event delegation
10. Add debouncing to critical user actions

---

## Testing Recommendations

1. **Performance Profiling:** Use Chrome DevTools Performance tab to measure:
   - Time to first contentful paint
   - Layout thrashing during card reveals
   - Memory usage over time

2. **Mobile Testing:** Test on actual mid-range Android devices where:
   - `backdrop-filter` performance is poor
   - Memory is limited
   - CPU throttling is common

3. **Accessibility Testing:** Verify screen reader announcements don't get cut off with rapid interactions

---

## Conclusion

The codebase demonstrates solid fundamentals with good accessibility practices and sensible code organization. The main performance bottlenecks are:

1. **DOM thrashing** from full re-renders on state changes
2. **CSS effects** (`backdrop-filter`, `box-shadow` animations) that don't leverage GPU acceleration
3. **Event handler patterns** that create unnecessary memory pressure

Addressing the P0 and P1 issues would significantly improve perceived performance, especially on mobile devices and during rapid gameplay.
