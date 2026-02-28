import { state } from '../state.js';
import { showToast, announceToScreenReader } from '../ui.js';
import { renderBoard } from '../board.js';
import { revealCardFromServer, showGameOver, updateTurnIndicator, updateMatchScoreboard } from '../game.js';
import { updateRoleBanner, updateControls } from '../roles.js';
import { playNotificationSound, setTabNotification, checkAndNotifyTurn } from '../notifications.js';
import { updateDuetUI, updateDuetInfoBar, updateForfeitButton } from '../multiplayerUI.js';
import { syncGameStateFromServer } from '../multiplayerSync.js';
export function registerGameHandlers() {
    EigennamenClient.on('gameStarted', (data) => {
        // Clear loading state on new game button
        const newGameBtn = document.getElementById('btn-new-game');
        if (newGameBtn) {
            newGameBtn.disabled = false;
            newGameBtn.classList.remove('loading');
        }
        // Full sync game state from server for new games
        if (data.game) {
            syncGameStateFromServer(data.game);
            state.gameMode = data.gameMode || 'classic';
            updateDuetUI(data.game);
            updateForfeitButton();
            const modeLabels = { blitz: 'Blitz game started!', duet: 'Duet game started!', match: 'Match started!', classic: 'New game started!' };
            const label = modeLabels[data.gameMode || 'classic'] || 'New game started!';
            // All roles are reset to spectator on new game — guide players to pick a role
            showToast(`${label} Pick your team and role to play.`, 'success', 5000);
        }
    });
    EigennamenClient.on('cardRevealed', (data) => {
        // Skip stale reveals during a full state resync
        if (state.resyncInProgress)
            return;
        // Clear per-card reveal tracking for the revealed card
        if (data.index !== undefined) {
            state.revealingCards.delete(data.index);
            const revealTimeout = state.revealTimeouts.get(data.index);
            if (revealTimeout) {
                clearTimeout(revealTimeout);
                state.revealTimeouts.delete(data.index);
            }
        }
        state.isRevealingCard = state.revealingCards.size > 0;
        // Remove pending visual state from the revealed card
        if (data.index !== undefined) {
            const card = document.querySelector(`.card[data-index="${data.index}"]`);
            if (card)
                card.classList.remove('revealing');
        }
        if (data.index !== undefined) {
            revealCardFromServer(data.index, data);
            playNotificationSound('reveal');
            // Announce card reveal to screen readers
            const word = data.word || (state.gameState.words && state.gameState.words[data.index]) || '';
            const type = data.type || '';
            if (word) {
                announceToScreenReader(`Card revealed: ${word}. ${type} card.`);
            }
        }
        // Update Duet info if present
        if (data.timerTokens !== undefined || data.greenFound !== undefined) {
            updateDuetInfoBar(data.greenFound || 0, data.timerTokens);
        }
        // Update match mode scores if present
        if (data.redMatchScore !== undefined || data.blueMatchScore !== undefined) {
            if (typeof data.redMatchScore === 'number')
                state.gameState.redMatchScore = data.redMatchScore;
            if (typeof data.blueMatchScore === 'number')
                state.gameState.blueMatchScore = data.blueMatchScore;
            updateMatchScoreboard();
        }
    });
    EigennamenClient.on('turnEnded', (data) => {
        if (state.resyncInProgress)
            return;
        if (data.currentTurn) {
            const previousTurn = state.gameState.currentTurn;
            // Update turn locally
            state.gameState.currentTurn = data.currentTurn;
            // Reset clue and guess state for new turn
            state.gameState.currentClue = null;
            state.gameState.guessesUsed = 0;
            state.gameState.guessesAllowed = 0;
            updateTurnIndicator();
            updateRoleBanner();
            updateControls();
            // Re-render board so the no-click class updates for the new turn's team
            renderBoard();
            // Check and send notifications if it's now our turn
            checkAndNotifyTurn(data.currentTurn, previousTurn);
            // Announce turn change
            const newTeamName = data.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
            announceToScreenReader(`Turn ended. Now ${newTeamName}'s turn.`);
        }
    });
    EigennamenClient.on('gameOver', (data) => {
        // Duet mode can have null winner (cooperative loss)
        if (data.winner || state.gameMode === 'duet') {
            // Sync all card types from server so non-spymasters can see the full board
            if (data.types && Array.isArray(data.types)) {
                state.gameState.types = data.types;
            }
            if (data.duetTypes && Array.isArray(data.duetTypes)) {
                state.gameState.duetTypes = data.duetTypes;
            }
            state.gameState.gameOver = true;
            state.gameState.winner = data.winner || null;
            if (state.gameMode === 'duet') {
                const duetWin = data.reason === 'completed';
                showGameOver(duetWin ? 'red' : null, data.reason);
            }
            else {
                showGameOver(data.winner || null, data.reason);
            }
            setTabNotification(false);
            playNotificationSound('gameOver');
            updateForfeitButton();
        }
    });
    // Handle spymaster view (card types for spymasters)
    EigennamenClient.on('spymasterView', (data) => {
        if (data.types && Array.isArray(data.types)) {
            state.gameState.types = data.types;
            renderBoard();
        }
    });
    // Match mode: round ended (round over but match continues)
    EigennamenClient.on('game:roundEnded', (data) => {
        if (!data.roundResult)
            return;
        // Update cumulative match scores
        state.gameState.redMatchScore = data.redMatchScore ?? state.gameState.redMatchScore;
        state.gameState.blueMatchScore = data.blueMatchScore ?? state.gameState.blueMatchScore;
        state.gameState.matchRound = data.matchRound ?? state.gameState.matchRound;
        // Append round result to history
        if (!state.gameState.roundHistory)
            state.gameState.roundHistory = [];
        state.gameState.roundHistory.push(data.roundResult);
        updateMatchScoreboard();
        showRoundSummary(data.roundResult, data.redMatchScore, data.blueMatchScore);
    });
    // Match mode: match over (final round complete, overall winner determined)
    EigennamenClient.on('game:matchOver', (data) => {
        if (!data.roundResult)
            return;
        state.gameState.redMatchScore = data.redMatchScore ?? state.gameState.redMatchScore;
        state.gameState.blueMatchScore = data.blueMatchScore ?? state.gameState.blueMatchScore;
        state.gameState.matchOver = true;
        state.gameState.matchWinner = data.matchWinner ?? null;
        if (!state.gameState.roundHistory)
            state.gameState.roundHistory = [];
        state.gameState.roundHistory.push(data.roundResult);
        updateMatchScoreboard();
        showMatchOverSummary(data);
        playNotificationSound('gameOver');
    });
}
/**
 * Show a round summary toast/modal for match mode.
 */
function showRoundSummary(roundResult, redMatchScore, blueMatchScore) {
    const roundWinner = roundResult.roundWinner;
    const winnerName = roundWinner === 'red' ? state.teamNames.red : state.teamNames.blue;
    const bonusText = roundResult.redBonusAwarded || roundResult.blueBonusAwarded
        ? ' (+7 bonus)'
        : '';
    const msg = `Round ${roundResult.roundNumber} complete! ${winnerName} wins${bonusText}. ` +
        `Match: ${state.teamNames.red} ${redMatchScore} - ${blueMatchScore} ${state.teamNames.blue}`;
    showToast(msg, 'info', 8000);
}
/**
 * Show the match-over summary.
 */
function showMatchOverSummary(data) {
    const winnerName = data.matchWinner === 'red' ? state.teamNames.red : state.teamNames.blue;
    const msg = `Match over! ${winnerName} wins ${data.redMatchScore} - ${data.blueMatchScore}!`;
    showToast(msg, 'success', 12000);
    announceToScreenReader(msg);
}
//# sourceMappingURL=gameEventHandlers.js.map