// ========== GAME MODULE ==========
// Core game logic (reveal, turns, scoring, board setup)
// All game state comes from the multiplayer server.

import { state, BOARD_SIZE, FIRST_TEAM_CARDS, SECOND_TEAM_CARDS, NEUTRAL_CARDS, ASSASSIN_CARDS, COPY_BUTTON_TEXT } from './state.js';
import { escapeHTML, seededRandom } from './utils.js';
import { showToast, openModal, closeModal, announceToScreenReader, showErrorModal } from './ui.js';
import { renderBoard, updateBoardIncremental, updateSingleCard, canClickCards } from './board.js';
import { playNotificationSound } from './notifications.js';

export function newGame() {
    // Prevent rapid clicks
    if (state.newGameDebounce) return;
    state.newGameDebounce = true;
    setTimeout(() => { state.newGameDebounce = false; }, 500);

    if (!CodenamesClient || !CodenamesClient.isConnected()) {
        showToast('Not connected to server - join or create a room first', 'error');
        return;
    }

    // Server will generate and broadcast the game to all players
    CodenamesClient.startGame({});
    // Reset local state - will be synced when gameStarted event arrives
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.boardInitialized = false;
}

export function confirmNewGame() {
    const cardsRevealed = state.gameState.revealed.filter(r => r).length;
    if (cardsRevealed === 0) {
        newGame();
    } else {
        openModal('confirm-modal');
    }
}

export function closeConfirm() {
    closeModal('confirm-modal');
}

export function confirmEndTurn() {
    openModal('confirm-end-turn-modal');
}

export function closeEndTurnConfirm() {
    closeModal('confirm-end-turn-modal');
}

export function revealCard(index) {
    // Provide specific feedback for why card click is blocked
    if (state.gameState.gameOver) {
        showToast('Game is over - start a new game to continue', 'warning');
        return;
    }
    if (state.gameState.revealed[index]) {
        return;
    }
    if (!canClickCards()) {
        if (state.spymasterTeam) {
            showToast('Spymasters cannot reveal cards', 'warning');
        } else if (state.clickerTeam && state.clickerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`It's ${currentTeamName}'s turn`, 'warning');
        } else if (!state.clickerTeam && !state.playerTeam) {
            showToast('Join a team and become a clicker to reveal cards', 'warning');
        } else if (state.playerTeam && state.playerTeam !== state.gameState.currentTurn) {
            const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            showToast(`It's ${currentTeamName}'s turn`, 'warning');
        } else {
            showToast('Only the clicker can reveal cards', 'warning');
        }
        return;
    }

    if (!state.gameState.currentClue) {
        showToast('Wait for the spymaster to give a clue first', 'warning');
        return;
    }

    if (!CodenamesClient || !CodenamesClient.isConnected()) {
        showToast('Not connected to server', 'error');
        return;
    }

    // Prevent double-click while waiting for server response
    if (state.isRevealingCard) {
        return;
    }
    state.isRevealingCard = true;

    // Add visual feedback - show card as "pending"
    const card = document.querySelector(`.card[data-index="${index}"]`);
    if (card) {
        card.classList.add('revealing');
    }

    CodenamesClient.revealCard(index);
    // Don't update local state - wait for server confirmation via cardRevealed event
}

/**
 * Reveal a card from server sync (bypasses local validation)
 */
export function revealCardFromServer(index, serverData = {}) {
    if (state.gameState.revealed[index]) return;

    state.gameState.revealed[index] = true;
    const type = serverData.type || state.gameState.types[index];

    state.lastRevealedIndex = index;
    state.lastRevealedWasCorrect = (type === state.gameState.currentTurn);

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

    if (serverData.gameOver !== undefined) {
        state.gameState.gameOver = serverData.gameOver;
        state.gameState.winner = serverData.winner || null;
    } else {
        if (type === 'assassin') {
            state.gameState.gameOver = true;
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        checkGameOver();
    }

    if (serverData.currentTurn) {
        state.gameState.currentTurn = serverData.currentTurn;
    } else if (!state.gameState.gameOver && type !== state.gameState.currentTurn) {
        state.gameState.currentTurn = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
    }

    if (typeof serverData.guessesUsed === 'number') {
        state.gameState.guessesUsed = serverData.guessesUsed;
    }
    if (typeof serverData.guessesAllowed === 'number') {
        state.gameState.guessesAllowed = serverData.guessesAllowed;
    }

    requestAnimationFrame(() => {
        updateSingleCard(index);
        updateBoardIncremental();
        updateScoreboard();
        updateTurnIndicator();
        updateRoleBanner();
        updateControls();
    });
}

export function checkGameOver() {
    const assassinIndex = state.gameState.types.indexOf('assassin');
    if (assassinIndex >= 0 && state.gameState.revealed[assassinIndex]) {
        state.gameState.gameOver = true;
        if (!state.gameState.winner) {
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        return;
    }

    if (state.gameState.redScore >= state.gameState.redTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
    } else if (state.gameState.blueScore >= state.gameState.blueTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
    }
}

export function showGameOverModal() {
    renderBoard();
}

export const showGameOver = showGameOverModal;

export function closeGameOver() {
    closeModal('game-over-modal');
}

export function endTurn() {
    if (state.gameState.gameOver) {
        showToast('Game is over - start a new game to continue', 'warning');
        return;
    }
    if (!state.clickerTeam) {
        showToast('Only clickers can end the turn', 'warning');
        return;
    }
    if (state.clickerTeam !== state.gameState.currentTurn) {
        const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
        showToast(`It's ${currentTeamName}'s turn - only their clicker can end it`, 'warning');
        return;
    }

    if (!CodenamesClient || !CodenamesClient.isConnected()) {
        showToast('Not connected to server', 'error');
        return;
    }

    CodenamesClient.endTurn();
}

export function updateScoreboard() {
    const redRemaining = state.gameState.redTotal - state.gameState.redScore;
    const blueRemaining = state.gameState.blueTotal - state.gameState.blueScore;
    const redRemainingEl = state.cachedElements.redRemaining || document.getElementById('red-remaining');
    const blueRemainingEl = state.cachedElements.blueRemaining || document.getElementById('blue-remaining');
    const redTeamNameEl = state.cachedElements.redTeamName || document.getElementById('red-team-name');
    const blueTeamNameEl = state.cachedElements.blueTeamName || document.getElementById('blue-team-name');
    if (redRemainingEl) redRemainingEl.textContent = redRemaining;
    if (blueRemainingEl) blueRemainingEl.textContent = blueRemaining;
    if (redTeamNameEl) redTeamNameEl.textContent = state.teamNames.red;
    if (blueTeamNameEl) blueTeamNameEl.textContent = state.teamNames.blue;
}

export function updateTurnIndicator() {
    const indicator = state.cachedElements.turnIndicator || document.getElementById('turn-indicator');
    if (!indicator) return;
    const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
    const winnerTeamName = state.gameState.winner === 'red' ? state.teamNames.red : state.teamNames.blue;

    if (state.gameState.gameOver) {
        indicator.className = 'turn-indicator game-over';
        const assassinIndex = state.gameState.types.indexOf('assassin');
        if (state.gameState.revealed[assassinIndex]) {
            indicator.textContent = `${winnerTeamName} WINS! (Assassin revealed)`;
        } else {
            indicator.textContent = `${winnerTeamName} WINS!`;
        }
    } else {
        const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn;
        indicator.className = `turn-indicator ${state.gameState.currentTurn}-turn${isYourTurn ? ' your-turn' : ''}`;

        if (isYourTurn) {
            indicator.textContent = `${currentTeamName}'s Turn - Your move!`;
        } else {
            indicator.textContent = `${currentTeamName}'s Turn`;
        }
    }
}

export async function copyShareLink() {
    const input = state.cachedElements.shareLink || document.getElementById('share-link');
    if (!input || !input.value) return;

    try {
        await navigator.clipboard.writeText(input.value);
        showToast('Room code copied!', 'success', 3000);
    } catch (err) {
        input.select();
        document.execCommand('copy');
        showToast('Room code copied!', 'success', 3000);
    }
}

// Role callback injection to break circular dependency with roles.js
let _updateRoleBanner = () => {};
let _updateControls = () => {};

export function setRoleCallbacks(updateRoleBannerFn, updateControlsFn) {
    _updateRoleBanner = updateRoleBannerFn;
    _updateControls = updateControlsFn;
}

function updateRoleBanner() {
    _updateRoleBanner();
}

function updateControls() {
    _updateControls();
}
