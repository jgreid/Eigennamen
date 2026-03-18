import { state } from './state.js';
import { showToast } from './ui.js';
import { UI } from './constants.js';
import { t } from './i18n.js';
import { isClientConnected } from './clientAccessor.js';
import type { ServerGameData, RoomStats, SpectatorChatData } from './multiplayerTypes.js';

// Reconnection overlay timeout ID for cleanup
let reconnectionTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Update Duet mode UI elements
export function updateDuetUI(gameData: ServerGameData | null): void {
    const isDuet = state.gameMode === 'duet';
    const mainContent = document.querySelector('.main-content');
    const duetBar = document.getElementById('duet-info-bar');

    if (isDuet) {
        if (mainContent) mainContent.classList.add('duet-mode');
        if (duetBar) {
            duetBar.hidden = false;
            updateDuetInfoBar(gameData?.greenFound || 0, gameData?.timerTokens);
        }
        // Update green total display
        const totalEl = document.getElementById('duet-green-total');
        if (totalEl && gameData?.greenTotal) totalEl.textContent = String(gameData.greenTotal);
    } else {
        if (mainContent) mainContent.classList.remove('duet-mode');
        if (duetBar) duetBar.hidden = true;
    }
}

// Update Duet info bar with current progress
export function updateDuetInfoBar(greenFound: number, timerTokens?: number): void {
    const foundEl = document.getElementById('duet-green-found');
    const tokensEl = document.getElementById('duet-timer-tokens');
    if (foundEl && greenFound !== undefined) foundEl.textContent = String(greenFound);
    if (tokensEl && timerTokens !== undefined) tokensEl.textContent = String(timerTokens);
}

// Update spectator count display
export function updateSpectatorCount(count: number): void {
    // Update inline spectator count in multiplayer indicator
    const mpSpectatorCount = document.getElementById('mp-spectator-count');
    const mpSpectatorInline = document.getElementById('mp-spectator-inline');

    if (mpSpectatorCount) {
        mpSpectatorCount.textContent = String(count);
    }
    if (mpSpectatorInline) {
        mpSpectatorInline.hidden = count <= 0;
    }

    // Store in state for other components
    state.spectatorCount = count;
}

// Update room stats (team counts, spectator count, etc.)
export function updateRoomStats(stats: RoomStats): void {
    if (!stats) return;

    // Update spectator count
    if (typeof stats.spectatorCount === 'number') {
        updateSpectatorCount(stats.spectatorCount);
    }

    // Update team stats if displayed
    const redCountEl = document.getElementById('team-red-count');
    const blueCountEl = document.getElementById('team-blue-count');

    if (redCountEl && stats.teams?.red) {
        redCountEl.textContent = String(stats.teams.red.total || 0);
    }
    if (blueCountEl && stats.teams?.blue) {
        blueCountEl.textContent = String(stats.teams.blue.total || 0);
    }

    // Store full stats in state
    state.roomStats = stats;
}

// Handle spectator chat messages (server sends { from, text, timestamp })
export function handleSpectatorChatMessage(data: SpectatorChatData): void {
    if (!data || typeof data.text !== 'string') return;

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message spectator-message';

    const badgeEl = document.createElement('span');
    badgeEl.className = 'chat-badge spectator-badge';
    badgeEl.textContent = '\uD83D\uDC41';
    badgeEl.title = t('chat.spectatorMessage');

    const senderEl = document.createElement('span');
    senderEl.className = 'chat-sender spectator';
    senderEl.textContent = data.from?.nickname || 'Spectator';

    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';
    contentEl.textContent = data.text;

    messageEl.appendChild(badgeEl);
    messageEl.appendChild(senderEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(contentEl);

    chatMessages.appendChild(messageEl);

    // Auto-scroll if near bottom
    const isNearBottom = chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 60;
    if (isNearBottom) {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
}

// Send a spectator chat message
export function sendSpectatorChat(message: string): void {
    if (!message?.trim()) return;
    if (!isClientConnected()) return;

    // Only spectators can send spectator messages
    const player = EigennamenClient.player;
    if (player?.role !== 'spectator' && player?.team) {
        showToast(t('multiplayer.spectatorChatOnly'), 'error');
        return;
    }

    EigennamenClient.sendSpectatorChat(message.trim());
}

/**
 * Show the reconnection overlay banner with a timeout fallback.
 * If reconnection doesn't succeed or explicitly fail within 15 seconds,
 * the overlay is hidden and a failure toast is shown.
 */
export function showReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.hidden = false;
    }

    // Clear any existing timeout
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
    }

    // Set a fallback timeout to prevent permanently stuck overlay
    reconnectionTimeoutId = setTimeout(() => {
        reconnectionTimeoutId = null;
        const overlayCheck = document.getElementById('reconnection-overlay');
        if (overlayCheck && !overlayCheck.hidden) {
            hideReconnectionOverlay();
            showToast(t('multiplayer.reconnectionFailed'), 'error', 8000);
        }
    }, UI.RECONNECTION_TIMEOUT_MS);
}

/**
 * Hide the reconnection overlay banner and clear the timeout fallback
 */
export function hideReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.hidden = true;
    }

    // Clear the fallback timeout since reconnection resolved
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
    }
}
