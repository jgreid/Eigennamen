import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { renderBoard, updateBoardIncremental, updateSingleCard, canClickCards } from '../board.js';
import { updateRoleBanner, updateControls } from '../roles.js';
import { UI, BOARD_SIZE } from '../constants.js';
import { logger } from '../logger.js';
import { t } from '../i18n.js';
import { updateURL } from '../url-state.js';
import { isClientConnected } from '../clientAccessor.js';
import { closeModal } from '../ui.js';
import { checkGameOver, updateScoreboard, updateTurnIndicator } from './scoring.js';

/** Data received from the server when a card is revealed */
interface ServerRevealData {
    type?: string;
    redScore?: number;
    blueScore?: number;
    gameOver?: boolean;
    winner?: string | null;
    currentTurn?: string;
    guessesUsed?: number;
    guessesAllowed?: number;
    turnEnded?: boolean;
    cardScore?: number;
}

export function revealCard(index: number): void {
    // Bounds check: prevent out-of-bounds array access
    if (typeof index !== 'number' || index < 0 || index >= state.gameState.words.length) {
        logger.error(`revealCard: invalid index ${index}`);
        return;
    }
    // Provide specific feedback for why card click is blocked
    if (state.gameState.gameOver) {
        showToast(t('game.gameOverStartNew'), 'warning');
        return;
    }
    if (state.gameState.revealed[index]) {
        // Card already revealed - silent return is OK here as it's visually obvious
        return;
    }
    if (!canClickCards()) {
        // Determine specific reason
        if (state.spymasterTeam) {
            showToast(t('game.spymasterCannotReveal'), 'warning');
        } else if (state.clickerTeam && state.clickerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(t('game.notYourTurn', { team: currentTeamName }), 'warning');
        } else if (!state.clickerTeam && !state.playerTeam) {
            showToast(t('game.joinTeamToClick'), 'warning');
        } else if (state.playerTeam && state.playerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(t('game.notYourTurn', { team: currentTeamName }), 'warning');
        } else {
            showToast(t('game.onlyClickerCanReveal'), 'warning');
        }
        return;
    }

    // In multiplayer mode, send reveal to server and let it broadcast
    if (state.isMultiplayerMode && isClientConnected()) {
        // Prevent double-click on same card while waiting for server response
        if (state.revealingCards.has(index)) {
            return;
        }
        // Safety cap: if the Set is somehow at BOARD_SIZE, clear it — all cards
        // would be pending which indicates lost server responses, not real reveals.
        if (state.revealingCards.size >= BOARD_SIZE) {
            logger.warn(`revealingCards Set at capacity (${state.revealingCards.size}), clearing stale entries`);
            state.revealTimeouts.forEach((tid) => clearTimeout(tid));
            state.revealTimeouts.clear();
            state.revealingCards.clear();
        }
        state.revealingCards.add(index);
        state.isRevealingCard = state.revealingCards.size > 0;

        // Per-card safety timeout: if server doesn't respond in time,
        // clear only this card's pending state (not all cards)
        const timeoutId = setTimeout(() => {
            if (state.revealingCards.has(index)) {
                state.revealingCards.delete(index);
                state.isRevealingCard = state.revealingCards.size > 0;
                const pendingCard = document.querySelector(`.card[data-index="${index}"]`);
                if (pendingCard) (pendingCard as HTMLElement).classList.remove('revealing');
                showToast(t('game.revealTimeout'), 'warning');
            }
        }, UI.CARD_REVEAL_TIMEOUT_MS);
        state.revealTimeouts.set(index, timeoutId);

        // Add visual feedback - show card as "pending"
        const card = document.querySelector(`.card[data-index="${index}"]`);
        if (card) {
            card.classList.add('revealing');
        }

        EigennamenClient.revealCard(index);
        // Don't update local state - wait for server confirmation via cardRevealed event
        // isRevealingCard is cleared in cardRevealed or error handler
        return;
    }

    state.gameState.revealed[index] = true;
    const type = state.gameState.types[index];

    // Track for animation
    state.lastRevealedIndex = index;
    state.lastRevealedWasCorrect = type === state.gameState.currentTurn;

    if (type === 'red') {
        state.gameState.redScore++;
    } else if (type === 'blue') {
        state.gameState.blueScore++;
    }

    // Check for assassin
    if (type === 'assassin') {
        state.gameState.gameOver = true;
        state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    // Check for win by completing all words
    checkGameOver();

    // End turn if wrong guess (and game not over)
    if (!state.gameState.gameOver && type !== state.gameState.currentTurn) {
        state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    updateURL();

    // Batch DOM updates using requestAnimationFrame for better performance
    if (!state.pendingUIUpdate) {
        state.pendingUIUpdate = true;
        requestAnimationFrame(() => {
            updateSingleCard(index); // Only update the revealed card
            updateBoardIncremental(); // Update board classes
            updateScoreboard();
            updateTurnIndicator();
            updateRoleBanner();
            updateControls();
            state.pendingUIUpdate = false;
        });
    }

    // Clear animation tracking after animation completes (animation duration + buffer)
    setTimeout(() => {
        state.lastRevealedIndex = -1;
        state.lastRevealedWasCorrect = false;
    }, UI.ANIMATION_CLEAR_MS);

    // Screen reader announcement
    const word = state.gameState.words[index];
    const typeNames: Record<string, string> = {
        red: state.teamNames.red,
        blue: state.teamNames.blue,
        neutral: 'neutral',
        assassin: 'assassin',
    };
    const typeName = typeNames[type] || type;
    announceToScreenReader(t('game.wordRevealedAs', { word, type: typeName }));

    if (state.gameState.gameOver) {
        showGameOverModal();
    }
}

/**
 * Reveal a card from server sync (bypasses local validation)
 * @param index - Card index to reveal
 * @param serverData - Data from server including currentTurn, scores, etc.
 */
export function revealCardFromServer(index: number, serverData: ServerRevealData = {}): void {
    // Bounds check: reject invalid index to prevent array growth from malformed server data
    if (typeof index !== 'number' || index < 0 || index >= state.gameState.words.length) {
        logger.error(`revealCardFromServer: invalid index ${index} (board size: ${state.gameState.words.length})`);
        return;
    }
    if (state.gameState.revealed[index]) return; // Already revealed

    // Clear pending reveal state for this card (safety net — also cleared in cardRevealed handler)
    const pendingTimeout = state.revealTimeouts.get(index);
    if (pendingTimeout) {
        clearTimeout(pendingTimeout);
        state.revealTimeouts.delete(index);
    }
    state.revealingCards.delete(index);
    state.isRevealingCard = state.revealingCards.size > 0;

    state.gameState.revealed[index] = true;
    // Use server-provided type; fall back to local only if non-null (spymasters have types,
    // non-spymasters have null for unrevealed cards — using null causes wrong scoring)
    const type = serverData.type || state.gameState.types[index] || 'neutral';

    // Bug fix: Update the types array with the revealed type from server
    // This is critical for non-spymasters who have null for unrevealed cards
    if (serverData.type) {
        state.gameState.types[index] = serverData.type;
    }

    // Track for animation (same as local reveal)
    state.lastRevealedIndex = index;
    state.lastRevealedWasCorrect = type === state.gameState.currentTurn;

    // Use server-provided scores if available, otherwise calculate locally
    if (typeof serverData.redScore === 'number') {
        state.gameState.redScore = serverData.redScore;
    } else if (type === 'red') {
        state.gameState.redScore++;
    }

    if (typeof serverData.blueScore === 'number') {
        state.gameState.blueScore = serverData.blueScore;
    } else if (type === 'blue') {
        state.gameState.blueScore++;
    }

    // Use server game over state if provided
    if (serverData.gameOver !== undefined) {
        state.gameState.gameOver = serverData.gameOver;
        state.gameState.winner = serverData.winner || null;
    } else {
        // Check for assassin locally
        if (type === 'assassin') {
            state.gameState.gameOver = true;
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        // Check for win by completing all words
        checkGameOver();
    }

    // Use server-provided turn state (authoritative)
    if (serverData.currentTurn) {
        state.gameState.currentTurn = serverData.currentTurn;
    } else if (!state.gameState.gameOver && type !== state.gameState.currentTurn) {
        // Fallback: end turn if wrong guess (and game not over)
        state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    // Sync guess tracking from server
    if (typeof serverData.guessesUsed === 'number') {
        state.gameState.guessesUsed = serverData.guessesUsed;
    }
    if (typeof serverData.guessesAllowed === 'number') {
        state.gameState.guessesAllowed = serverData.guessesAllowed;
    }

    // Clear clue state when a reveal causes the turn to end (wrong guess, max guesses)
    // The server clears currentClue on turn change but the cardRevealed event only
    // includes a turnEnded flag — no separate turnEnded event is emitted for this path.
    if (serverData.turnEnded && !state.gameState.gameOver) {
        state.gameState.currentClue = null;
    }

    // Match mode: update card score for this card and revealedBy tracking
    if (typeof serverData.cardScore === 'number' && state.gameState.cardScores) {
        state.gameState.cardScores[index] = serverData.cardScore;
    }
    if (state.gameState.revealedBy && serverData.currentTurn) {
        // The revealing team is the team that was on turn before any turn switch
        // Use previous turn (before server updated it) for attribution
        state.gameState.revealedBy[index] =
            type === state.gameState.currentTurn
                ? state.gameState.currentTurn
                : state.gameState.currentTurn === 'red'
                  ? 'blue'
                  : 'red';
    }

    // Batch DOM updates using requestAnimationFrame for better performance.
    // Store the rAF ID so it can be cancelled on room switch to prevent
    // orphaned callbacks updating a cleared/rebuilt DOM.
    state.pendingRevealRAF = requestAnimationFrame(() => {
        state.pendingRevealRAF = null;
        updateSingleCard(index);
        updateBoardIncremental();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();
    });
}

export function showGameOverModal(_winner?: string | null, _reason?: string): void {
    // Clear all pending reveal timeouts — game is over, no more reveals expected
    state.revealTimeouts.forEach((timeoutId) => clearTimeout(timeoutId));
    state.revealTimeouts.clear();
    state.revealingCards.clear();
    state.isRevealingCard = false;

    // Instead of showing a modal, reveal the spymaster view to all players
    // so they can see the board and discuss before the next game.
    // The turn indicator already shows the winner at the top of the board.
    renderBoard();
}

/**
 * Sweep stale entries from revealingCards.
 * Per-card timeouts handle the normal case, but if timeouts are throttled
 * (e.g., tab backgrounded), entries can linger. This periodic sweep is
 * the safety net.
 */
export function sweepStaleRevealingCards(): void {
    if (state.revealingCards.size === 0) return;

    // Any card in revealingCards that no longer has a pending timeout is stale
    for (const index of state.revealingCards) {
        if (!state.revealTimeouts.has(index)) {
            state.revealingCards.delete(index);
            const pendingCard = document.querySelector(`.card[data-index="${index}"]`);
            if (pendingCard) (pendingCard as HTMLElement).classList.remove('revealing');
        }
    }
    state.isRevealingCard = state.revealingCards.size > 0;
}

let revealSweepInterval: ReturnType<typeof setInterval> | null = null;

/**
 * Start periodic sweep of stale revealingCards entries.
 * Call when entering multiplayer mode.
 */
export function startRevealSweep(): void {
    stopRevealSweep();
    revealSweepInterval = setInterval(sweepStaleRevealingCards, UI.CARD_REVEAL_TIMEOUT_MS);
}

/**
 * Stop the periodic sweep. Call when leaving multiplayer mode.
 */
export function stopRevealSweep(): void {
    if (revealSweepInterval !== null) {
        clearInterval(revealSweepInterval);
        revealSweepInterval = null;
    }
}

// Alias for multiplayer listener compatibility
export const showGameOver = showGameOverModal;

export function closeGameOver(): void {
    closeModal('game-over-modal');
}
