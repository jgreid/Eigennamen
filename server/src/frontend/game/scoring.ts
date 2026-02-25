import { state } from '../state.js';
import { t } from '../i18n.js';

export function checkGameOver(): void {
    // Check for assassin reveal
    const assassinIndex = state.gameState.types.indexOf('assassin');
    if (assassinIndex >= 0 && state.gameState.revealed[assassinIndex]) {
        state.gameState.gameOver = true;
        if (!state.gameState.winner) {
            state.gameState.winner = state.gameState.currentTurn === 'red' ? 'blue' : 'red';
        }
        return;
    }

    // Check for completing all words
    if (state.gameState.redScore >= state.gameState.redTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'red';
    } else if (state.gameState.blueScore >= state.gameState.blueTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
    }
}

export function updateScoreboard(): void {
    const redRemaining = state.gameState.redTotal - state.gameState.redScore;
    const blueRemaining = state.gameState.blueTotal - state.gameState.blueScore;
    // Use cached elements with fallback
    const redRemainingEl = state.cachedElements.redRemaining || document.getElementById('red-remaining');
    const blueRemainingEl = state.cachedElements.blueRemaining || document.getElementById('blue-remaining');
    const redTeamNameEl = state.cachedElements.redTeamName || document.getElementById('red-team-name');
    const blueTeamNameEl = state.cachedElements.blueTeamName || document.getElementById('blue-team-name');
    if (redRemainingEl) redRemainingEl.textContent = String(redRemaining);
    if (blueRemainingEl) blueRemainingEl.textContent = String(blueRemaining);
    if (redTeamNameEl) redTeamNameEl.textContent = state.teamNames.red;
    if (blueTeamNameEl) blueTeamNameEl.textContent = state.teamNames.blue;
}

export function updateTurnIndicator(): void {
    const indicator = state.cachedElements.turnIndicator || document.getElementById('turn-indicator');
    if (!indicator) return;
    const turnText = indicator.querySelector('.turn-text');
    if (!turnText) return;
    const currentTeamName = state.gameState.currentTurn === 'red' ? state.teamNames.red : state.teamNames.blue;
    const winnerTeamName = state.gameState.winner === 'red' ? state.teamNames.red : state.teamNames.blue;

    if (state.gameState.gameOver) {
        indicator.className = 'turn-indicator game-over';
        if (state.gameMode === 'duet') {
            if (state.gameState.winner) {
                turnText.textContent = t('game.duetVictory');
            } else {
                const assassinIndex = state.gameState.types.indexOf('assassin');
                if (state.gameState.revealed[assassinIndex]) {
                    turnText.textContent = t('game.duetGameOverAssassin');
                } else {
                    turnText.textContent = t('game.duetGameOverTimeout');
                }
            }
        } else {
            const assassinIndex = state.gameState.types.indexOf('assassin');
            if (state.gameState.revealed[assassinIndex]) {
                turnText.textContent = t('game.winnerAssassin', { team: winnerTeamName });
            } else {
                turnText.textContent = t('game.winner', { team: winnerTeamName });
            }
        }
    } else {
        const isYourTurn = state.clickerTeam && state.clickerTeam === state.gameState.currentTurn;
        indicator.className = `turn-indicator ${state.gameState.currentTurn}-turn${isYourTurn ? ' your-turn' : ''}`;

        if (isYourTurn) {
            turnText.textContent = t('game.yourTurnGo', { team: currentTeamName });
        } else {
            turnText.textContent = t('game.teamsTurn', { team: currentTeamName });
        }
    }
}
