// ========== BOARD MODULE ==========
// Board rendering

import { state, BOARD_SIZE } from './state.js';
import { getCardFontClass } from './utils.js';

// Callback for card clicks - set via setCardClickHandler
let cardClickHandler = null;

export function setCardClickHandler(fn) {
    cardClickHandler = fn;
}

export function canClickCards() {
    if (state.gameState.gameOver) return false;

    // Must wait for spymaster to give a clue before revealing cards
    if (state.isMultiplayerMode && !state.gameState.currentClue) return false;

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
        } else if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            e.preventDefault();
            navigateCards(index, e.key);
        }
    });

    board.setAttribute('data-delegated', 'true');
}

export function renderBoard() {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

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

    state.gameState.words.forEach((word, index) => {
        const card = document.createElement('div');
        const fontClass = getCardFontClass(word);
        card.className = `card ${fontClass}`;
        card.textContent = word;
        card.setAttribute('data-index', index);

        // Accessibility: make cards focusable and add ARIA attributes
        const isRevealed = state.gameState.revealed[index];
        card.setAttribute('role', 'gridcell');
        card.setAttribute('tabindex', isRevealed ? '-1' : '0');
        card.setAttribute('aria-label', `${word}${isRevealed ? ', revealed as ' + state.gameState.types[index] : ''}`);

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

    state.boardInitialized = true;
    initBoardEventDelegation();
}

// Incremental update - only update changed cards (much faster)
export function updateBoardIncremental() {
    const board = state.cachedElements.board || document.getElementById('board');
    if (!board) return;

    // Update board class
    let className = 'board';
    if (state.spymasterTeam || state.gameState.gameOver) className += ' spymaster-mode';
    if (!canClickCards()) className += ' no-click';
    board.className = className;

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
            card.classList.remove('small-text', 'tiny-text');
            const fontClass = getCardFontClass(word);
            if (fontClass) card.classList.add(fontClass);
        }

        // Update ARIA
        card.setAttribute('tabindex', isRevealed ? '-1' : '0');
        card.setAttribute('aria-label', `${word}${isRevealed ? ', revealed as ' + type : ''}`);

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
    const row = Math.floor(currentIndex / COLS);
    const col = currentIndex % COLS;

    let newIndex = currentIndex;

    switch (key) {
        case 'ArrowUp':
            newIndex = row > 0 ? currentIndex - COLS : currentIndex;
            break;
        case 'ArrowDown':
            newIndex = row < ROWS - 1 ? currentIndex + COLS : currentIndex;
            break;
        case 'ArrowLeft':
            newIndex = col > 0 ? currentIndex - 1 : currentIndex;
            break;
        case 'ArrowRight':
            newIndex = col < COLS - 1 ? currentIndex + 1 : currentIndex;
            break;
    }

    if (newIndex !== currentIndex) {
        const board = state.cachedElements.board || document.getElementById('board');
        if (board && board.children[newIndex]) {
            board.children[newIndex].focus();
        }
    }
}
