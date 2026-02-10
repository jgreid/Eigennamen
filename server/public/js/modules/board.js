// ========== BOARD MODULE ==========
// Board rendering

import { state, BOARD_SIZE } from './state.js';
import { getCardFontClass, fitCardText } from './utils.js';

// Callback for card clicks - set via setCardClickHandler
let cardClickHandler = null;

/**
 * Build a descriptive ARIA label for a card (WCAG 2.1 AA).
 * @param {string} word - Card word
 * @param {boolean} isRevealed - Whether card is revealed
 * @param {string} type - Card type (red, blue, neutral, assassin)
 * @param {number} row - Grid row (1-indexed)
 * @param {number} col - Grid column (1-indexed)
 * @returns {string} Descriptive ARIA label
 */
function buildCardAriaLabel(word, isRevealed, type, row, col) {
    const position = `Row ${row}, column ${col}`;
    if (isRevealed) {
        const typeLabel = type === 'assassin' ? 'assassin card' : `${type} team card`;
        return `${word}, revealed as ${typeLabel}. ${position}`;
    }
    return `${word}, unrevealed card. ${position}. Press Enter to reveal.`;
}

// Re-fit card text on resize (debounced)
let resizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
        const board = document.getElementById('board');
        if (board && board.children.length > 0) {
            // Reset inline font sizes so CSS classes take effect at new size
            for (const card of board.querySelectorAll('.card:not(.multi-word)')) {
                card.style.fontSize = '';
            }
            fitCardText(board);
        }
    }, 150);
});

export function setCardClickHandler(fn) {
    cardClickHandler = fn;
}

export function canClickCards() {
    if (state.gameState.gameOver) return false;

    // Clicker for the current team can always click
    if (state.clickerTeam && state.clickerTeam === state.gameState.currentTurn) {
        return true;
    }

    // In multiplayer: any team member can click if clicker is disconnected
    if (state.isMultiplayerMode && state.playerTeam === state.gameState.currentTurn) {
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
export function initBoardEventDelegation() {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || board.hasAttribute('data-delegated')) return;

    // Single click handler using event delegation
    board.addEventListener('click', (e) => {
        const card = e.target.closest('.card');
        if (!card || card.classList.contains('revealed')) return;
        // Use data-index attribute for O(1) lookup instead of indexOf
        const index = parseInt(card.dataset.index, 10);
        if (!isNaN(index) && index >= 0 && cardClickHandler) cardClickHandler(index);
    });

    // Single keydown handler using event delegation
    board.addEventListener('keydown', (e) => {
        const card = e.target.closest('.card');
        if (!card) return;
        // Use data-index attribute for O(1) lookup instead of indexOf
        const index = parseInt(card.dataset.index, 10);
        if (isNaN(index) || index < 0) return;

        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (!card.classList.contains('revealed')) {
                if (cardClickHandler) cardClickHandler(index);
            }
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) {
            e.preventDefault();
            navigateCards(index, e.key);
        }
    });

    board.setAttribute('data-delegated', 'true');
}

export function renderBoard() {
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

        // Full re-render (only for new games)
        board.innerHTML = '';

        // Board-level accessibility: grid role and description
        board.setAttribute('role', 'grid');
        board.setAttribute('aria-label', 'Codenames game board - 5 by 5 grid of word cards');

        state.gameState.words.forEach((word, index) => {
            const card = document.createElement('div');
            const fontClass = getCardFontClass(word);
            card.className = `card ${fontClass}`;
            if (word.includes(' ')) {
                card.classList.add('multi-word');
            }
            card.textContent = word;
            card.setAttribute('data-index', index);

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
        initBoardEventDelegation();
    } catch (err) {
        console.error('renderBoard failed:', err);
        // Show a minimal fallback so the board area isn't blank
        board.innerHTML = '<div class="board-error">Board rendering error. Please start a new game.</div>';
    }
}

// Incremental update - only update changed cards (much faster)
export function updateBoardIncremental() {
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
            const card = cards[index];
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
        console.error('updateBoardIncremental failed:', err);
    }
}

// Update single card (for card reveal animation)
export function updateSingleCard(index) {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board || !board.children[index]) return;

    const card = board.children[index];
    const type = state.gameState.types[index];

    card.classList.add('revealed', type);
    card.setAttribute('tabindex', '-1');
    card.setAttribute('aria-label', `${state.gameState.words[index]}, revealed as ${type}`);

    // Add animation class
    if (state.lastRevealedWasCorrect) {
        card.classList.add('success-reveal');
    } else {
        card.classList.add('just-revealed');
    }
}

// Arrow key navigation for cards (5x5 grid)
export function navigateCards(currentIndex, key) {
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
            board.children[newIndex].focus();
        }
    }
}
