import { state, BOARD_SIZE, COPY_BUTTON_TEXT } from './state.js';
import { encodeWordsForURL, copyToClipboard } from './utils.js';
import { showToast } from './ui.js';
import { t } from './i18n.js';

/**
 * Update the browser URL with current game state.
 * Called after any state change (reveal, new game, end turn).
 */
export function updateURL(): void {
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
    const shareLink = state.cachedElements.shareLink || document.getElementById('share-link');
    if (shareLink) (shareLink as HTMLInputElement).value = url;
}

/**
 * Copy the current game link to clipboard.
 */
export async function copyLink(): Promise<void> {
    const input = state.cachedElements.shareLink || document.getElementById('share-link');
    const btn = document.querySelector('.btn-copy');

    if (!input) return;

    // Clear any existing timeout to prevent flickering
    if (state.copyButtonTimeoutId) {
        clearTimeout(state.copyButtonTimeoutId);
        state.copyButtonTimeoutId = null;
    }

    const urlToCopy = (input as HTMLInputElement).value || window.location.href;

    const copied = await copyToClipboard(urlToCopy);
    if (copied) {
        showToast(t('toast.linkCopied'), 'success', 3000);
    } else {
        showToast(t('toast.failedToCopy'), 'warning', 3000);
    }

    if (btn) {
        btn.textContent = t('game.copiedShort');
    }

    state.copyButtonTimeoutId = setTimeout(() => {
        if (btn) btn.textContent = COPY_BUTTON_TEXT;
        state.copyButtonTimeoutId = null;
    }, 3000);
}
