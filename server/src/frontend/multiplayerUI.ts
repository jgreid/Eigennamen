import { state } from './state.js';
import { escapeHTML, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { VALIDATION, UI } from './constants.js';
import { t } from './i18n.js';
import { showChatPanel, hideChatPanel, initChat } from './chat.js';
import { getClient, isClientConnected } from './clientAccessor.js';
import type {
    ServerPlayerData,
    ServerRoomData,
    ServerGameData,
    RoomStats,
    SpectatorChatData,
} from './multiplayerTypes.js';

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
    const mpOnlyBtns = document.querySelectorAll<HTMLElement>('.mp-only-btn');

    if (room) {
        if (codeEl) codeEl.textContent = room.code;
        if (countEl)
            countEl.textContent =
                players?.length === 1
                    ? t('multiplayer.playerCountOne')
                    : t('multiplayer.playerCount', { count: players?.length || 1 });
        if (indicator) indicator.classList.add('active');

        // Show multiplayer-only buttons (history + forfeit)
        mpOnlyBtns.forEach((btn) => {
            btn.hidden = false;
        });

        // Show chat panel and initialize listeners (idempotent)
        showChatPanel();
        initChat();

        // Update player list
        if (playersUl && players) {
            updatePlayerList(playersUl, players);
        }
    } else {
        if (indicator) indicator.classList.remove('active');
        if (playerListEl) playerListEl.hidden = true;
        // Hide multiplayer-only buttons when not in multiplayer mode
        mpOnlyBtns.forEach((btn) => {
            btn.hidden = true;
        });

        // Hide chat panel
        hideChatPanel();
    }
}

export async function copyRoomId(): Promise<void> {
    if (state.currentRoomId) {
        const copied = await copyToClipboard(state.currentRoomId);
        const btn = document.getElementById('btn-copy-room-id');
        if (copied) {
            showToast(t('toast.roomIdCopied'), 'success', 2000);
            if (btn) {
                btn.classList.add('copied');
                setTimeout(() => btn.classList.remove('copied'), 1000);
            }
        } else {
            showToast(t('toast.failedToCopyShort'), 'error', 2000);
        }
    }
}

export function updatePlayerList(ul: HTMLUListElement, players: ServerPlayerData[]): void {
    const mySessionId = EigennamenClient.player?.sessionId;
    const amHost = EigennamenClient.player?.isHost;

    ul.replaceChildren();
    for (const p of players) {
        const isMe = p.sessionId === mySessionId;
        const li = document.createElement('li');
        if (p.connected === false) li.className = 'player-disconnected';

        const info = document.createElement('span');
        info.className = 'player-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = `player-name${isMe ? ' you' : ''}${p.team ? ` player-team-${escapeHTML(p.team)}` : ''}`;
        nameSpan.textContent = p.nickname + (isMe ? ` (${t('multiplayer.you')})` : '');
        info.appendChild(nameSpan);

        if (p.isHost) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            badge.textContent = t('multiplayer.host');
            info.appendChild(badge);
        }

        const roleSpan = document.createElement('span');
        roleSpan.className = 'player-role';
        roleSpan.textContent =
            (p.role ? `(${p.role})` : '') + (p.connected === false ? ` - ${t('multiplayer.offline')}` : '');
        info.appendChild(roleSpan);

        li.appendChild(info);

        if (amHost && !isMe) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.dataset.session = p.sessionId;
            kickBtn.title = t('multiplayer.kickPlayer');
            kickBtn.textContent = t('multiplayer.kick');
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
            const isExpanded = !playerListEl.hidden;
            playerListEl.hidden = isExpanded;
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

// Show/hide room settings based on multiplayer host status
export function updateRoomSettingsNavVisibility(): void {
    // Show/hide inline game mode section in the merged Game panel
    const gameModeSection = document.getElementById('settings-game-mode-section');
    if (gameModeSection) {
        const isHost = getClient()?.player?.isHost;
        gameModeSection.hidden = !(state.isMultiplayerMode && isHost);
    }
}

// Sync game mode UI with server state
export function syncGameModeUI(gameMode: string): void {
    if (!gameMode) return;
    const escapedMode = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(gameMode) : gameMode;
    const radio = document.querySelector(`input[name="gameMode"][value="${escapedMode}"]`) as HTMLInputElement;
    if (radio) radio.checked = true;
}

// Sync turn timer UI with server state
export function syncTurnTimerUI(turnTimer: number | null): void {
    const toggle = document.getElementById('turn-timer-toggle') as HTMLInputElement;
    const sliderContainer = document.getElementById('turn-timer-slider');
    const range = document.getElementById('turn-timer-range') as HTMLInputElement;
    const valueDisplay = document.getElementById('turn-timer-value');

    if (!toggle) return;

    if (turnTimer != null && turnTimer > 0) {
        toggle.checked = true;
        if (sliderContainer) sliderContainer.hidden = false;
        if (range) range.value = String(turnTimer);
        if (valueDisplay) valueDisplay.textContent = `${turnTimer}s`;
    } else {
        toggle.checked = false;
        if (sliderContainer) sliderContainer.hidden = true;
    }
}

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
 * Show forfeit confirmation modal (host only, during active game)
 */
export function confirmForfeit(): void {
    if (!state.isMultiplayerMode || !isClientConnected()) {
        showToast(t('forfeit.multiplayerOnly'), 'warning');
        return;
    }
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    if (state.gameState.gameOver) {
        showToast(t('forfeit.gameAlreadyOver'), 'info');
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
    if (pendingKickSessionId && state.isMultiplayerMode && isClientConnected()) {
        EigennamenClient.kickPlayer(pendingKickSessionId);
    }
    closeKickConfirm();
}

/**
 * Execute the forfeit action for a specific team
 */
export function forfeitGame(team: string): void {
    if (!state.isMultiplayerMode || !isClientConnected()) return;
    if (!EigennamenClient.player?.isHost) {
        showToast(t('forfeit.hostOnly'), 'warning');
        return;
    }
    if (state.gameState.gameOver) return;

    EigennamenClient.forfeit(team);
}

/**
 * Update forfeit button visibility based on game state.
 * The forfeit button lives inside the settings modal (Game tab).
 * Shows only for host during an active multiplayer game.
 */
export function updateForfeitButton(): void {
    const forfeitSection = document.getElementById('settings-forfeit-section');
    if (!forfeitSection) return;

    const shouldShow = state.isMultiplayerMode && getClient()?.player?.isHost && !state.gameState.gameOver;

    forfeitSection.hidden = !shouldShow;
}

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
                form.hidden = false;
                editBtn.hidden = true;
                // Pre-fill with current nickname
                const nickname = getClient()?.player?.nickname;
                if (input && nickname) {
                    input.value = nickname;
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

    if (
        !nickname ||
        nickname.length < VALIDATION.NICKNAME_MIN_LENGTH ||
        nickname.length > VALIDATION.NICKNAME_MAX_LENGTH
    ) {
        showToast(
            t('multiplayer.nicknameLength', {
                min: VALIDATION.NICKNAME_MIN_LENGTH,
                max: VALIDATION.NICKNAME_MAX_LENGTH,
            }),
            'warning'
        );
        return;
    }

    if (!/^[a-zA-Z0-9\s\-_]+$/.test(nickname)) {
        showToast(t('multiplayer.nicknameCharsOnly'), 'warning');
        return;
    }

    if (isClientConnected()) {
        EigennamenClient.setNickname(nickname);
        // Update stored nickname
        try {
            localStorage.setItem('eigennamen-nickname', nickname);
        } catch {
            /* ignore */
        }
        showToast(t('multiplayer.nicknameUpdated'), 'success', 2000);
    }

    cancelNicknameEdit();
}

function cancelNicknameEdit(): void {
    const form = document.getElementById('nickname-edit-form');
    const editBtn = document.getElementById('btn-edit-nickname');
    if (form) form.hidden = true;
    if (editBtn) {
        editBtn.hidden = false;
        editBtn.focus();
    }
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
