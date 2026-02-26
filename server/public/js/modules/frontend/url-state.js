import { state, BOARD_SIZE } from './state.js';
import { encodeWordsForURL } from './utils.js';
/**
 * Update the browser URL with current game state.
 * Called after any state change (reveal, new game, end turn).
 */
export function updateURL() {
    const revealed = state.gameState.revealed.map(r => r ? '1' : '0').join('');
    const turn = state.gameState.currentTurn === 'blue' ? 'b' : 'r';
    let url = `${window.location.origin}${window.location.pathname}?game=${state.gameState.seed}&r=${revealed}&t=${turn}`;
    // Include custom words in URL if using them
    if (state.gameState.customWords && state.gameState.words.length === BOARD_SIZE) {
        url += `&w=${encodeWordsForURL(state.gameState.words)}`;
    }
    // Only include team names if they're not defaults
    if (state.teamNames.red !== 'Red') {
        url += `&rn=${encodeURIComponent(state.teamNames.red)}`;
    }
    if (state.teamNames.blue !== 'Blue') {
        url += `&bn=${encodeURIComponent(state.teamNames.blue)}`;
    }
    window.history.replaceState({}, '', url);
}
//# sourceMappingURL=url-state.js.map