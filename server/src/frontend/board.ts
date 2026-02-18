// ========== BOARD MODULE ==========
// Board rendering

import { state, BOARD_SIZE } from './state.js';
import { getCardFontClass, fitCardText } from './utils.js';
import { t } from './i18n.js';
import { logger } from './logger.js';

/**
 * Announce a message to screen readers via the sr-announcements live region.
 * Uses aria-atomic="true" and a timeout-based clearing strategy for reliable
 * detection across screen readers (NVDA, VoiceOver, JAWS).
 */
let srClearTimeout: ReturnType<typeof setTimeout> | null = null;
function announceToScreenReader(message: string): void {
    const el = document.getElementById('sr-announcements');
    if (!el) return;
    // Ensure aria-atomic is set for reliable re-announcement
    if (!el.hasAttribute('aria-atomic')) {
        el.setAttribute('aria-atomic', 'true');
    }
    // Clear any pending clear timeout
    if (srClearTimeout) {
        clearTimeout(srClearTimeout);
        srClearTimeout = null;
    }
    el.textContent = '';
    // Use a short timeout (vs requestAnimationFrame) for more reliable
    // detection — rAF can be batched, causing screen readers to miss changes
    setTimeout(() => {
        el.textContent = message;
        // Clear after 3 seconds so subsequent identical messages are re-announced
        srClearTimeout = setTimeout(() => { el.textContent = ''; srClearTimeout = null; }, 3000);
    }, 50);
}

// Callback for card clicks - set via setCardClickHandler
let cardClickHandler: ((index: number) => void) | null = null;

/**
 * Build a descriptive ARIA label for a card (WCAG 2.1 AA).
 * @param word - Card word
 * @param isRevealed - Whether card is revealed
 * @param type - Card type (red, blue, neutral, assassin)
 * @param row - Grid row (1-indexed)
 * @param col - Grid column (1-indexed)
 * @returns Descriptive ARIA label
 */
function buildCardAriaLabel(word: string, isRevealed: boolean, type: string, row: number, col: number): string {
    const position = t('board.gridPosition', { row, col });
    if (isRevealed) {
        const typeLabel = type === 'assassin' ? t('board.assassinCard') : t('board.teamCard', { type });
        return t('board.revealedCardLabel', { word, typeLabel, position });
    }
    return t('board.unrevealedCardLabel', { word, position });
}

// Re-fit card text on resize (debounced).
// Stored as a named function so it can be removed when leaving a room.
let resizeTimer: ReturnType<typeof setTimeout> | null = null;
function handleResize(): void {
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const board = document.getElementById('board');
        if (board && board.children.length > 0) {
            // Reset inline font sizes so CSS classes take effect at new size
            for (const card of board.querySelectorAll('.card:not(.multi-word)')) {
                (card as HTMLElement).style.fontSize = '';
            }
            fitCardText(board);
        }
    }, 150);
}
let resizeListenerAttached = false;

/**
 * Attach the window resize listener (idempotent).
 * Call once when the board is first rendered.
 */
export function attachResizeListener(): void {
    if (!resizeListenerAttached) {
        window.addEventListener('resize', handleResize);
        resizeListenerAttached = true;
    }
}

/**
 * Remove the window resize listener and cancel any pending debounce.
 * Call when leaving a room to prevent accumulating listeners.
 */
export function detachResizeListener(): void {
    if (resizeListenerAttached) {
        window.removeEventListener('resize', handleResize);
        resizeListenerAttached = false;
    }
    if (resizeTimer) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
    }
}

export function setCardClickHandler(fn: (index: number) => void): void {
    cardClickHandler = fn;
}

export function canClickCards(): boolean {
    if (state.gameState.gameOver) return false;

    // Standalone mode: everyone can click (no team/role restrictions)
    if (!state.isMultiplayerMode) {
        return true;
    }

    // Multiplayer: clicker for the current team can always click
    if (state.clickerTeam && state.clickerTeam === state.gameState.currentTurn) {
        return true;
    }

    // In multiplayer: any team member can click if clicker is disconnected
    if (state.playerTeam === state.gameState.currentTurn) {
        const teamClicker = state.multiplayerPlayers.find(
            p => p.team === state.gameState.currentTurn && p.role === 'clicker'
        );
        // Allow if no clicker assigned or clicker is disconnected
        if (!teamClicker || !teamClicker.connected) {
            return true;
        }
    }

    return false;
}

// Initialize board event delegation (called once)
export function initBoardEventDelegation(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || board.hasAttribute('data-delegated')) return;

    // Single click handler using event delegation
    board.addEventListener('click', (e) => {
        const card = (e.target as Element).closest('.card');
        if (!card || card.classList.contains('revealed')) return;
        // Use data-index attribute for O(1) lookup instead of indexOf
        const index = parseInt((card as HTMLElement).dataset.index!, 10);
        if (!isNaN(index) && index >= 0 && cardClickHandler) cardClickHandler(index);
    });

    // Single keydown handler using event delegation
    board.addEventListener('keydown', (e) => {
        const card = (e.target as Element).closest('.card');
        if (!card) return;
        // Use data-index attribute for O(1) lookup instead of indexOf
        const index = parseInt((card as HTMLElement).dataset.index!, 10);
        if (isNaN(index) || index < 0) return;

        if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') {
            e.preventDefault();
            if (!card.classList.contains('revealed')) {
                if (cardClickHandler) cardClickHandler(index);
            }
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes((e as KeyboardEvent).key)) {
            e.preventDefault();
            navigateCards(index, (e as KeyboardEvent).key);
        }
    });

    board.setAttribute('data-delegated', 'true');
}

// Guard against concurrent full re-renders from overlapping socket events
let renderingInProgress = false;

export function renderBoard(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

    try {
        // Update board class
        let className = 'board';
        if (state.spymasterTeam || state.gameState.gameOver) className += ' spymaster-mode';
        if (!canClickCards()) className += ' no-click';
        board.className = className;

        // Check if we can do an incremental update
        if (state.boardInitialized && board.children.length === BOARD_SIZE) {
            updateBoardIncremental();
            return;
        }

        // Prevent concurrent full re-renders from overlapping socket messages.
        // If a render is already in progress, skip this call. The first render
        // will set boardInitialized=true, and subsequent calls will use the
        // incremental path above.
        if (renderingInProgress) return;
        renderingInProgress = true;

        // Full re-render (only for new games)
        board.innerHTML = '';

        // Board-level accessibility: grid role and description
        board.setAttribute('role', 'grid');
        board.setAttribute('aria-label', t('board.boardAriaLabel'));

        state.gameState.words.forEach((word, index) => {
            const card = document.createElement('div');
            const fontClass = getCardFontClass(word);
            card.className = `card ${fontClass}`;
            if (word.includes(' ')) {
                card.classList.add('multi-word');
            }
            card.textContent = word;
            card.setAttribute('data-index', String(index));
            card.setAttribute('data-testid', 'board-card');

            // Accessibility: make cards focusable and add ARIA attributes
            const isRevealed = state.gameState.revealed[index];
            const row = Math.floor(index / 5) + 1;
            const col = (index % 5) + 1;
            card.setAttribute('role', 'gridcell');
            card.setAttribute('tabindex', isRevealed ? '-1' : '0');
            card.setAttribute('aria-label', buildCardAriaLabel(word, isRevealed, state.gameState.types[index], row, col));
            if (isRevealed) {
                card.setAttribute('aria-disabled', 'true');
            }

            // Add spymaster hints (show all card types when game is over)
            if (state.spymasterTeam || state.gameState.gameOver) {
                card.classList.add(`spy-${state.gameState.types[index]}`);
            }

            // Show revealed cards
            if (isRevealed) {
                card.classList.add('revealed', state.gameState.types[index]);
            }

            board.appendChild(card);
        });

        // Shrink font on any single-word cards that overflow their container
        fitCardText(board);

        state.boardInitialized = true;
        renderingInProgress = false;
        initBoardEventDelegation();
        attachResizeListener();
    } catch (err) {
        renderingInProgress = false;
        logger.error('renderBoard failed:', err);
        // Show a minimal fallback so the board area isn't blank
        board.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'board-error';
        errorDiv.textContent = t('board.renderError');
        board.appendChild(errorDiv);
    }
}

// Incremental update - only update changed cards (much faster)
export function updateBoardIncremental(): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

    try {
        // Update board class
        let className = 'board';
        if (state.spymasterTeam || state.gameState.gameOver) className += ' spymaster-mode';
        if (!canClickCards()) className += ' no-click';
        board.className = className;

        let needsFit = false;
        const cards = board.children;
        for (let index = 0; index < cards.length; index++) {
            const card = cards[index] as HTMLElement;
            const isRevealed = state.gameState.revealed[index];
            const type = state.gameState.types[index];
            const word = state.gameState.words[index];

            // Update card text if it changed (safety measure for sync issues)
            if (card.textContent !== word) {
                card.textContent = word;
                // Update font class based on word length
                card.classList.remove('font-lg', 'font-md', 'font-sm', 'font-xs', 'font-min');
                card.style.fontSize = ''; // clear any fitCardText override
                const fontClass = getCardFontClass(word);
                if (fontClass) card.classList.add(fontClass);
                // Update multi-word class
                if (word.includes(' ')) {
                    card.classList.add('multi-word');
                } else {
                    card.classList.remove('multi-word');
                }
                needsFit = true;
            }

            // Update ARIA
            const row = Math.floor(index / 5) + 1;
            const col = (index % 5) + 1;
            card.setAttribute('tabindex', isRevealed ? '-1' : '0');
            card.setAttribute('aria-label', buildCardAriaLabel(word, isRevealed, type, row, col));
            if (isRevealed) {
                card.setAttribute('aria-disabled', 'true');
            } else {
                card.removeAttribute('aria-disabled');
            }

            // Handle spymaster mode (show all card types when game is over)
            if (state.spymasterTeam || state.gameState.gameOver) {
                card.classList.add(`spy-${type}`);
            } else {
                // Remove all spy- classes
                card.classList.remove('spy-red', 'spy-blue', 'spy-neutral', 'spy-assassin');
            }

            // Handle reveal state
            if (isRevealed && !card.classList.contains('revealed')) {
                card.classList.add('revealed', type);

                // Add animation class for just-revealed card
                if (index === state.lastRevealedIndex) {
                    if (state.lastRevealedWasCorrect) {
                        card.classList.add('success-reveal');
                    } else {
                        card.classList.add('just-revealed');
                    }
                }
            }
        }

        if (needsFit) {
            fitCardText(board);
        }
    } catch (err) {
        logger.error('updateBoardIncremental failed:', err);
    }
}

// Update single card (for card reveal animation)
export function updateSingleCard(index: number): void {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || !board.children[index]) return;

    const card = board.children[index] as HTMLElement;
    const type = state.gameState.types[index];

    card.classList.add('revealed', type);
    card.setAttribute('tabindex', '-1');
    const word = state.gameState.words[index];
    const row = Math.floor(index / 5) + 1;
    const col = (index % 5) + 1;
    card.setAttribute('aria-label', buildCardAriaLabel(word, true, type, row, col));

    // Announce reveal to screen readers
    const typeLabel = type === 'red' ? 'Red' : type === 'blue' ? 'Blue' : type === 'assassin' ? 'Assassin' : 'Neutral';
    announceToScreenReader(`${word} revealed as ${typeLabel}`);

    // Add animation class
    if (state.lastRevealedWasCorrect) {
        card.classList.add('success-reveal');
    } else {
        card.classList.add('just-revealed');
    }
}

// Arrow key navigation for cards (5x5 grid)
export function navigateCards(currentIndex: number, key: string): void {
    const COLS = 5;
    const ROWS = 5;
    const TOTAL = COLS * ROWS;
    const row = Math.floor(currentIndex / COLS);
    const col = currentIndex % COLS;

    let newIndex = currentIndex;

    switch (key) {
        case 'ArrowUp':
            // Wrap to bottom of same column if at top
            newIndex = row > 0 ? currentIndex - COLS : (ROWS - 1) * COLS + col;
            break;
        case 'ArrowDown':
            // Wrap to top of same column if at bottom
            newIndex = row < ROWS - 1 ? currentIndex + COLS : col;
            break;
        case 'ArrowLeft':
            // Wrap to end of previous row if at start
            newIndex = currentIndex > 0 ? currentIndex - 1 : TOTAL - 1;
            break;
        case 'ArrowRight':
            // Wrap to start of next row if at end
            newIndex = currentIndex < TOTAL - 1 ? currentIndex + 1 : 0;
            break;
        case 'Home':
            // Go to first card in current row
            newIndex = row * COLS;
            break;
        case 'End':
            // Go to last card in current row
            newIndex = row * COLS + (COLS - 1);
            break;
    }

    if (newIndex !== currentIndex && newIndex >= 0 && newIndex < TOTAL) {
        const board = state.cachedElements.board || document.getElementById('board');
        if (board && board.children[newIndex]) {
            (board.children[newIndex] as HTMLElement).focus();
        }
    }
}
