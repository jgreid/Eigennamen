// ========== MULTIPLAYER UI ==========
// UI rendering and interaction functions for multiplayer mode

import { state } from './state.js';
import { escapeHTML, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { VALIDATION, UI } from './constants.js';
import { logger } from './logger.js';
import type { ServerPlayerData, ServerRoomData, ServerGameData, RoomStats, SpectatorChatData } from './multiplayerTypes.js';

// Session ID pending kick confirmation (used by confirm-kick-modal)
let pendingKickSessionId: string | null = null;

// Reconnection overlay timeout ID for cleanup
let reconnectionTimeoutId: ReturnType<typeof setTimeout> | null = null;

export function updateMpIndicator(room: ServerRoomData | null, players: ServerPlayerData[]): void {
    const indicator = document.getElementById('mp-indicator');
    const codeEl = document.getElementById('mp-room-code');
    const countEl = document.getElementById('mp-player-count');
    const playerListEl = document.getElementById('mp-player-list');
    const playersUl = document.getElementById('mp-players-ul') as HTMLUListElement;
    const mpExtraRow = document.getElementById('mp-extra-buttons-row');

    if (room) {
        if (codeEl) codeEl.textContent = room.code;
        if (countEl) countEl.textContent = `${players?.length || 1} player${players?.length !== 1 ? 's' : ''}`;
        if (indicator) indicator.classList.add('active');

        // Show multiplayer-only buttons row (history + forfeit)
        if (mpExtraRow) {
            mpExtraRow.style.display = 'flex';
        }

        // Update player list
        if (playersUl && players) {
            updatePlayerList(playersUl, players);
        }

        // Update share panel for multiplayer mode
        updateSharePanelMode(true, room.code);
    } else {
        if (indicator) indicator.classList.remove('active');
        if (playerListEl) playerListEl.style.display = 'none';
        // Hide multiplayer-only buttons when not in multiplayer mode
        if (mpExtraRow) {
            mpExtraRow.style.display = 'none';
        }

        // Update share panel for standalone mode
        updateSharePanelMode(false);
    }
}

// Toggle share panel between multiplayer (room code) and standalone (URL/QR) modes
export function updateSharePanelMode(isMultiplayer: boolean, roomCode: string | null = null): void {
    const mpShare = document.getElementById('mp-room-code-share');
    const standaloneShare = document.getElementById('standalone-share');
    const shareRoomCode = document.getElementById('share-room-code');
    const shareServerUrl = document.getElementById('share-server-url');
    const qrSection = document.getElementById('qr-section');

    if (isMultiplayer && roomCode) {
        // Multiplayer mode: show room code, hide URL/QR
        if (mpShare) mpShare.style.display = 'block';
        if (standaloneShare) standaloneShare.style.display = 'none';
        if (shareRoomCode) shareRoomCode.textContent = roomCode.toUpperCase();
        if (shareServerUrl) shareServerUrl.textContent = window.location.host;
        // Hide sidebar QR section in multiplayer mode
        if (qrSection) qrSection.style.display = 'none';
    } else {
        // Standalone mode: show URL/QR, hide room code
        if (mpShare) mpShare.style.display = 'none';
        if (standaloneShare) standaloneShare.style.display = 'block';
        // Show sidebar QR section in standalone mode (if library loaded)
        if (qrSection && typeof qrcode === 'function') qrSection.style.display = '';
    }
}

// Copy room code to clipboard
export async function copyRoomCode(): Promise<void> {
    const roomCode = document.getElementById('share-room-code')?.textContent;
    const feedback = document.getElementById('room-code-copy-feedback');

    if (!roomCode || roomCode === '----') return;

    const copied = await copyToClipboard(roomCode);
    if (copied) {
        if (feedback) {
            feedback.textContent = 'Room code copied!';
            setTimeout(() => { feedback.textContent = ''; }, UI.COPY_FEEDBACK_MS);
        }
        showToast('Room code copied to clipboard');
    } else {
        showToast('Failed to copy - please copy manually', 'warning');
    }
}

export async function copyRoomId(): Promise<void> {
    if (state.currentRoomId) {
        const copied = await copyToClipboard(state.currentRoomId);
        if (copied) {
            showToast('Room ID copied!', 'success', 2000);
        } else {
            showToast('Failed to copy', 'error', 2000);
        }
    }
}

export function updatePlayerList(ul: HTMLUListElement, players: ServerPlayerData[]): void {
    const mySessionId = CodenamesClient.player?.sessionId;
    const amHost = CodenamesClient.player?.isHost;

    ul.innerHTML = '';
    for (const p of players) {
        const isMe = p.sessionId === mySessionId;
        const li = document.createElement('li');
        if (p.connected === false) li.className = 'player-disconnected';

        const info = document.createElement('span');
        info.className = 'player-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = `player-name${isMe ? ' you' : ''}${p.team ? ` player-team-${escapeHTML(p.team)}` : ''}`;
        nameSpan.textContent = p.nickname + (isMe ? ' (you)' : '');
        info.appendChild(nameSpan);

        if (p.isHost) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            badge.textContent = 'Host';
            info.appendChild(badge);
        }

        const roleSpan = document.createElement('span');
        roleSpan.className = 'player-role';
        roleSpan.textContent = (p.role ? `(${p.role})` : '') + (p.connected === false ? ' - offline' : '');
        info.appendChild(roleSpan);

        li.appendChild(info);

        if (amHost && !isMe) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.dataset.session = p.sessionId;
            kickBtn.title = 'Kick player';
            kickBtn.textContent = 'Kick';
            li.appendChild(kickBtn);
        }

        ul.appendChild(li);
    }
}

export function initPlayerListUI(): void {
    const playerCountBtn = document.getElementById('mp-player-count-btn');
    const playerListEl = document.getElementById('mp-player-list');
    const playersUl = document.getElementById('mp-players-ul');

    if (playerCountBtn && playerListEl) {
        playerCountBtn.addEventListener('click', () => {
            const isExpanded = playerListEl.style.display !== 'none';
            playerListEl.style.display = isExpanded ? 'none' : 'block';
            playerCountBtn.classList.toggle('expanded', !isExpanded);
        });
    }

    // Event delegation for kick buttons - uses custom modal instead of native confirm()
    if (playersUl) {
        playersUl.addEventListener('click', (e: Event) => {
            const kickBtn = (e.target as HTMLElement).closest('.btn-kick') as HTMLElement | null;
            if (kickBtn) {
                const sessionId = kickBtn.dataset.session;
                if (sessionId) {
                    pendingKickSessionId = sessionId;
                    openModal('confirm-kick-modal');
                }
            }
        });
    }
}

// Show/hide room settings nav item based on multiplayer host status
export function updateRoomSettingsNavVisibility(): void {
    const navItem = document.getElementById('nav-room-settings');
    if (navItem) {
        const isHost = CodenamesClient?.player?.isHost;
        navItem.style.display = (state.isMultiplayerMode && isHost) ? 'flex' : 'none';
    }
}

// Update room info display in settings panel
export function updateRoomInfoDisplay(): void {
    const codeEl = document.getElementById('room-info-code');
    const playersEl = document.getElementById('room-info-players');
    const statusEl = document.getElementById('room-info-status');

    if (codeEl) codeEl.textContent = state.currentRoomId || CodenamesClient?.getRoomCode() || '----';
    if (playersEl) playersEl.textContent = String(state.multiplayerPlayers?.length || 0);
    if (statusEl) statusEl.textContent = state.gameState.status === 'ended' ? 'Game Over' : (state.gameState.status === 'playing' ? 'In Progress' : 'Waiting');
}

// Sync game mode UI with server state
export function syncGameModeUI(gameMode: string): void {
    if (!gameMode) return;
    const radio = document.querySelector(`input[name="gameMode"][value="${gameMode}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;
}

// Update Duet mode UI elements
export function updateDuetUI(gameData: ServerGameData | null): void {
    const isDuet = state.gameMode === 'duet';
    const mainContent = document.querySelector('.main-content');
    const duetBar = document.getElementById('duet-info-bar');

    if (isDuet) {
        if (mainContent) mainContent.classList.add('duet-mode');
        if (duetBar) {
            duetBar.style.display = 'flex';
            updateDuetInfoBar(gameData?.greenFound || 0, gameData?.timerTokens);
        }
        // Update green total display
        const totalEl = document.getElementById('duet-green-total');
        if (totalEl && gameData?.greenTotal) totalEl.textContent = String(gameData.greenTotal);
    } else {
        if (mainContent) mainContent.classList.remove('duet-mode');
        if (duetBar) duetBar.style.display = 'none';
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
        mpSpectatorInline.style.display = count > 0 ? 'flex' : 'none';
    }

    // Legacy standalone element (kept for backwards compat)
    const spectatorCountEl = document.getElementById('spectator-count');
    const spectatorSection = document.getElementById('spectator-section');

    if (spectatorCountEl) {
        spectatorCountEl.textContent = String(count);
    }
    if (spectatorSection) {
        spectatorSection.style.display = count > 0 ? 'flex' : 'none';
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

// Handle spectator chat messages
export function handleSpectatorChatMessage(data: SpectatorChatData): void {
    // Validate message data before rendering into DOM
    if (!data || typeof data.message !== 'string') return;

    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message spectator-message';

    const senderEl = document.createElement('span');
    senderEl.className = 'chat-sender spectator';
    senderEl.textContent = data.sender?.nickname || 'Spectator';

    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';
    contentEl.textContent = data.message;

    const badgeEl = document.createElement('span');
    badgeEl.className = 'chat-badge spectator-badge';
    badgeEl.textContent = '\uD83D\uDC41';
    badgeEl.title = 'Spectator message';

    messageEl.appendChild(badgeEl);
    messageEl.appendChild(senderEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(contentEl);

    chatMessages.appendChild(messageEl);
    chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Send a spectator chat message
export function sendSpectatorChat(message: string): void {
    if (!message?.trim()) return;
    if (!CodenamesClient?.isConnected()) return;

    // Only spectators can send spectator messages
    const player = CodenamesClient.player;
    if (player?.role !== 'spectator' && player?.team) {
        showToast('Only spectators can use spectator chat', 'error');
        return;
    }

    CodenamesClient.sendSpectatorChat(message.trim());
}

// ========== FORFEIT GAME ==========

/**
 * Show forfeit confirmation modal (host only, during active game)
 */
export function confirmForfeit(): void {
    if (!state.isMultiplayerMode || !CodenamesClient?.isConnected()) {
        showToast('Forfeit is only available in multiplayer mode', 'warning');
        return;
    }
    if (!CodenamesClient.player?.isHost) {
        showToast('Only the host can forfeit the game', 'warning');
        return;
    }
    if (state.gameState.gameOver) {
        showToast('The game is already over', 'info');
        return;
    }
    openModal('confirm-forfeit-modal');
}

/**
 * Close the forfeit confirmation modal
 */
export function closeForfeitConfirm(): void {
    closeModal('confirm-forfeit-modal');
}

/**
 * Close the kick confirmation modal
 */
export function closeKickConfirm(): void {
    closeModal('confirm-kick-modal');
    pendingKickSessionId = null;
}

/**
 * Execute the pending kick action
 */
export function confirmKickPlayer(): void {
    if (pendingKickSessionId && state.isMultiplayerMode && CodenamesClient?.isConnected()) {
        CodenamesClient.kickPlayer(pendingKickSessionId);
    }
    closeKickConfirm();
}

/**
 * Execute the forfeit action
 */
export function forfeitGame(): void {
    if (!state.isMultiplayerMode || !CodenamesClient?.isConnected()) return;
    if (!CodenamesClient.player?.isHost) return;
    if (state.gameState.gameOver) return;

    CodenamesClient.forfeit();
}

/**
 * Update forfeit button visibility based on game state
 * Shows only for host during an active multiplayer game
 */
export function updateForfeitButton(): void {
    const forfeitBtn = document.getElementById('btn-forfeit');
    if (!forfeitBtn) return;

    const shouldShow = state.isMultiplayerMode
        && CodenamesClient?.player?.isHost
        && !state.gameState.gameOver;

    forfeitBtn.style.display = shouldShow ? 'inline-block' : 'none';
}

// ========== NICKNAME EDIT ==========

/**
 * Initialize nickname edit UI event handlers
 */
export function initNicknameEditUI(): void {
    const editBtn = document.getElementById('btn-edit-nickname');
    const saveBtn = document.getElementById('btn-nickname-save');
    const cancelBtn = document.getElementById('btn-nickname-cancel');
    const input = document.getElementById('nickname-edit-input') as HTMLInputElement;

    if (editBtn) {
        editBtn.addEventListener('click', () => {
            const form = document.getElementById('nickname-edit-form');
            if (form) {
                form.style.display = 'flex';
                editBtn.style.display = 'none';
                // Pre-fill with current nickname
                if (input && CodenamesClient?.player?.nickname) {
                    input.value = CodenamesClient.player.nickname;
                    input.focus();
                    input.select();
                }
            }
        });
    }

    if (saveBtn) {
        saveBtn.addEventListener('click', () => saveNickname());
    }

    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => cancelNicknameEdit());
    }

    if (input) {
        input.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                saveNickname();
            } else if (e.key === 'Escape') {
                e.preventDefault();
                cancelNicknameEdit();
            }
        });
    }
}

function saveNickname(): void {
    const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
    const nickname = input?.value?.trim();

    if (!nickname || nickname.length < VALIDATION.NICKNAME_MIN_LENGTH || nickname.length > VALIDATION.NICKNAME_MAX_LENGTH) {
        showToast(`Nickname must be ${VALIDATION.NICKNAME_MIN_LENGTH}-${VALIDATION.NICKNAME_MAX_LENGTH} characters`, 'warning');
        return;
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(nickname)) {
        showToast('Only letters, numbers, spaces, hyphens and underscores allowed', 'warning');
        return;
    }

    if (CodenamesClient?.isConnected()) {
        CodenamesClient.setNickname(nickname);
        // Update stored nickname
        try { localStorage.setItem('codenames-nickname', nickname); } catch { /* ignore */ }
        showToast('Nickname updated!', 'success', 2000);
    }

    cancelNicknameEdit();
}

function cancelNicknameEdit(): void {
    const form = document.getElementById('nickname-edit-form');
    const editBtn = document.getElementById('btn-edit-nickname');
    if (form) form.style.display = 'none';
    if (editBtn) editBtn.style.display = '';
}

// ========== RECONNECTION FEEDBACK ==========

/**
 * Show the reconnection overlay banner with a timeout fallback.
 * If reconnection doesn't succeed or explicitly fail within 15 seconds,
 * the overlay is hidden and a failure toast is shown.
 */
export function showReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.style.display = 'block';
    }

    // Clear any existing timeout
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
    }

    // Set a fallback timeout to prevent permanently stuck overlay
    reconnectionTimeoutId = setTimeout(() => {
        reconnectionTimeoutId = null;
        const overlayCheck = document.getElementById('reconnection-overlay');
        if (overlayCheck && overlayCheck.style.display !== 'none') {
            hideReconnectionOverlay();
            showToast('Reconnection failed \u2014 please refresh the page', 'error', 8000);
        }
    }, UI.RECONNECTION_TIMEOUT_MS);
}

/**
 * Hide the reconnection overlay banner and clear the timeout fallback
 */
export function hideReconnectionOverlay(): void {
    const overlay = document.getElementById('reconnection-overlay');
    if (overlay) {
        overlay.style.display = 'none';
    }

    // Clear the fallback timeout since reconnection resolved
    if (reconnectionTimeoutId) {
        clearTimeout(reconnectionTimeoutId);
        reconnectionTimeoutId = null;
    }
}
