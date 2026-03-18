import { state } from './state.js';
import { formatGameTimestamp, formatShortDuration } from './utils.js';
import { openModal, closeModal, showToast } from './ui.js';
import { t } from './i18n.js';
import type { GameHistoryEntry } from './multiplayerTypes.js';

// Re-export replay engine so existing imports from './history.js' keep working
export {
    closeReplay,
    renderReplayData,
    renderReplayBoard,
    applyReplayState,
    renderReplayEventLog,
    updateReplayControls,
    setupReplayControls,
    toggleReplayPlayback,
    cycleReplaySpeed,
    copyReplayLink,
    scrollToCurrentEvent,
    checkURLForReplayLoad,
} from './history-replay.js';

export function openGameHistory(): void {
    if (!state.isMultiplayerMode || !EigennamenClient.isConnected()) {
        showToast(t('history.multiplayerOnly'), 'info');
        return;
    }

    // Show loading state
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const listEl = document.getElementById('history-list');
    if (loadingEl) loadingEl.hidden = false;
    if (emptyEl) emptyEl.hidden = true;
    if (listEl) listEl.hidden = true;

    openModal('history-modal');

    // Request game history from server
    EigennamenClient.getGameHistory(10);
}

export function closeGameHistory(): void {
    closeModal('history-modal');
}

export function renderGameHistory(games: GameHistoryEntry[]): void {
    const loadingEl = document.getElementById('history-loading');
    const emptyEl = document.getElementById('history-empty');
    const listEl = document.getElementById('history-list');
    const actionsEl = document.getElementById('history-actions');

    if (loadingEl) loadingEl.hidden = true;

    if (!games || games.length === 0) {
        if (emptyEl) emptyEl.hidden = false;
        if (listEl) listEl.hidden = true;
        if (actionsEl) actionsEl.hidden = true;
        return;
    }

    if (emptyEl) emptyEl.hidden = true;
    if (listEl) listEl.hidden = false;
    // Show clear history button only for the host
    if (actionsEl) actionsEl.hidden = !state.isHost;

    if (!listEl) return;
    listEl.replaceChildren();
    for (const game of games) {
        const dateStr = formatGameTimestamp(game.timestamp || 0);
        const winner = game.winner || '';
        const winnerName =
            (game.teamNames && winner ? game.teamNames[winner] : undefined) || (winner === 'red' ? 'Red' : 'Blue');

        const item = document.createElement('div');
        item.className = 'history-item';
        item.dataset.gameId = game.id;

        const info = document.createElement('div');
        info.className = 'history-item-info';
        const winnerDiv = document.createElement('div');
        const winnerClass = game.winner === 'red' ? 'red' : 'blue';
        winnerDiv.className = `history-item-winner ${winnerClass}`;
        winnerDiv.textContent = t('history.teamWins', { team: winnerName });
        info.appendChild(winnerDiv);
        const dateDiv = document.createElement('div');
        dateDiv.className = 'history-item-date';
        dateDiv.textContent = dateStr;
        info.appendChild(dateDiv);

        const stats = document.createElement('div');
        stats.className = 'history-item-stats';
        const scoreDiv = document.createElement('div');
        scoreDiv.className = 'history-item-score';
        const redSpan = document.createElement('span');
        redSpan.className = 'red-score';
        redSpan.textContent = String(game.redScore || 0);
        const blueSpan = document.createElement('span');
        blueSpan.className = 'blue-score';
        blueSpan.textContent = String(game.blueScore || 0);
        scoreDiv.appendChild(redSpan);
        scoreDiv.append(' - ');
        scoreDiv.appendChild(blueSpan);
        stats.appendChild(scoreDiv);
        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'history-item-details';
        const endReasonLabel = game.endReason ? t(`history.endReason.${game.endReason}`) : '';
        const durationLabel = game.duration ? formatShortDuration(game.duration) : '';
        const clueLabel = t('history.clueCount', { count: game.clueCount || 0 });
        detailsDiv.textContent = [endReasonLabel, durationLabel, clueLabel].filter(Boolean).join(' \u00B7 ');
        stats.appendChild(detailsDiv);

        item.appendChild(info);
        item.appendChild(stats);
        listEl.appendChild(item);
    }

    // Event delegation is set up once via setupHistoryEventDelegation()
    // No need to add listeners per item - prevents memory leaks
}

// Use event delegation for history items to prevent memory leaks
// Only set up once during initialization
export function setupHistoryEventDelegation(): void {
    if (state.historyDelegationSetup) return;
    state.historyDelegationSetup = true;

    const listEl = document.getElementById('history-list');
    if (listEl) {
        listEl.addEventListener('click', (event: MouseEvent) => {
            // Find the closest history-item ancestor
            const historyItem = (event.target as HTMLElement).closest('.history-item') as HTMLElement | null;
            if (historyItem && historyItem.dataset.gameId) {
                openReplay(historyItem.dataset.gameId);
            }
        });
    }
}

export function openReplay(gameId: string): void {
    closeGameHistory();

    // Show loading in replay modal
    const replayInfoEl = document.getElementById('replay-info');
    const replayBoardEl = document.getElementById('replay-board');
    const replayEventLogEl = document.getElementById('replay-event-log');
    const replayProgressEl = document.getElementById('replay-progress');
    if (replayInfoEl) replayInfoEl.textContent = t('history.loadingReplay');
    if (replayBoardEl) replayBoardEl.replaceChildren();
    if (replayEventLogEl) replayEventLogEl.replaceChildren();
    if (replayProgressEl) replayProgressEl.textContent = t('history.loading');

    openModal('replay-modal');

    // Request replay data
    EigennamenClient.getReplay(gameId);
}

export function clearGameHistory(): void {
    if (!state.isMultiplayerMode || !EigennamenClient.isConnected()) {
        showToast(t('history.multiplayerOnly'), 'info');
        return;
    }

    if (!EigennamenClient.isHost()) {
        showToast(t('history.hostOnly'), 'warning');
        return;
    }

    // Confirm before clearing
    if (!confirm(t('history.clearConfirm'))) {
        return;
    }

    EigennamenClient.clearHistory();
}

export function onHistoryCleared(): void {
    const listEl = document.getElementById('history-list');
    const emptyEl = document.getElementById('history-empty');
    const actionsEl = document.getElementById('history-actions');

    if (listEl) {
        listEl.replaceChildren();
        listEl.hidden = true;
    }
    if (emptyEl) emptyEl.hidden = false;
    if (actionsEl) actionsEl.hidden = true;

    showToast(t('history.cleared'), 'success');
}
