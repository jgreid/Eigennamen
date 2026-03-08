import { state } from '../state.js';
import { redRemaining as getRedRemaining, blueRemaining as getBlueRemaining, currentTeamName as getCurrentTeamName, teamName as getTeamName, isPlayerTurn, isDuetMode, isMatchMode, } from '../store/selectors.js';
import { t } from '../i18n.js';
export function checkGameOver() {
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
    }
    else if (state.gameState.blueScore >= state.gameState.blueTotal) {
        state.gameState.gameOver = true;
        state.gameState.winner = 'blue';
    }
}
/** Trigger a CSS bounce animation on a score element when its value changes */
function animateScoreChange(el) {
    const countEl = el.closest('.count') ?? el;
    countEl.classList.remove('changed');
    // Force reflow so re-adding the class restarts the animation
    void countEl.offsetWidth;
    countEl.classList.add('changed');
}
export function updateScoreboard() {
    // Use cached elements with fallback
    const redRemainingEl = state.cachedElements.redRemaining || document.getElementById('red-remaining');
    const blueRemainingEl = state.cachedElements.blueRemaining || document.getElementById('blue-remaining');
    const redTeamNameEl = state.cachedElements.redTeamName || document.getElementById('red-team-name');
    const blueTeamNameEl = state.cachedElements.blueTeamName || document.getElementById('blue-team-name');
    const newRedRemaining = String(getRedRemaining());
    const newBlueRemaining = String(getBlueRemaining());
    if (redRemainingEl) {
        if (redRemainingEl.textContent !== newRedRemaining) {
            redRemainingEl.textContent = newRedRemaining;
            animateScoreChange(redRemainingEl);
        }
    }
    if (blueRemainingEl) {
        if (blueRemainingEl.textContent !== newBlueRemaining) {
            blueRemainingEl.textContent = newBlueRemaining;
            animateScoreChange(blueRemainingEl);
        }
    }
    if (redTeamNameEl)
        redTeamNameEl.textContent = state.teamNames.red;
    if (blueTeamNameEl)
        blueTeamNameEl.textContent = state.teamNames.blue;
}
/**
 * Update the match mode scoreboard (cumulative match scores and round number).
 * Only visible when game mode is 'match'.
 */
export function updateMatchScoreboard() {
    const matchScoreboard = document.getElementById('match-scoreboard');
    if (!matchScoreboard)
        return;
    if (!isMatchMode()) {
        matchScoreboard.hidden = true;
        return;
    }
    matchScoreboard.hidden = false;
    const redMatchEl = document.getElementById('red-match-score');
    const blueMatchEl = document.getElementById('blue-match-score');
    const roundEl = document.getElementById('match-round');
    if (redMatchEl)
        redMatchEl.textContent = String(state.gameState.redMatchScore ?? 0);
    if (blueMatchEl)
        blueMatchEl.textContent = String(state.gameState.blueMatchScore ?? 0);
    if (roundEl)
        roundEl.textContent = String(state.gameState.matchRound ?? 1);
}
export function updateTurnIndicator() {
    const indicator = state.cachedElements.turnIndicator || document.getElementById('turn-indicator');
    if (!indicator)
        return;
    const turnText = indicator.querySelector('.turn-text');
    if (!turnText)
        return;
    const turnTeamName = getCurrentTeamName();
    // When winner is null (non-standard end), fall back to blue
    const winnerTeamName = getTeamName(state.gameState.winner ?? 'blue');
    if (state.gameState.gameOver) {
        indicator.className = 'turn-indicator game-over';
        if (isDuetMode()) {
            if (state.gameState.winner) {
                turnText.textContent = t('game.duetVictory');
            }
            else {
                const assassinIndex = state.gameState.types.indexOf('assassin');
                if (state.gameState.revealed[assassinIndex]) {
                    turnText.textContent = t('game.duetGameOverAssassin');
                }
                else {
                    turnText.textContent = t('game.duetGameOverTimeout');
                }
            }
        }
        else {
            const assassinIndex = state.gameState.types.indexOf('assassin');
            if (state.gameState.revealed[assassinIndex]) {
                turnText.textContent = t('game.winnerAssassin', { team: winnerTeamName });
            }
            else {
                turnText.textContent = t('game.winner', { team: winnerTeamName });
            }
        }
    }
    else {
        const yourTurn = isPlayerTurn();
        // Detect team switch: animate only when the active team color changes
        const wasRedTurn = indicator.classList.contains('red-turn');
        const wasBlueTurn = indicator.classList.contains('blue-turn');
        const teamSwitched = (wasRedTurn && state.gameState.currentTurn === 'blue') ||
            (wasBlueTurn && state.gameState.currentTurn === 'red');
        indicator.className = `turn-indicator ${state.gameState.currentTurn}-turn${yourTurn ? ' your-turn' : ''}`;
        if (teamSwitched) {
            indicator.classList.add('turn-changed');
            setTimeout(() => indicator.classList.remove('turn-changed'), 300);
        }
        if (yourTurn) {
            turnText.textContent = t('game.yourTurnGo', { team: turnTeamName });
        }
        else {
            turnText.textContent = t('game.teamsTurn', { team: turnTeamName });
        }
    }
}
//# sourceMappingURL=scoring.js.map