import { state } from './state.js';
import { escapeHTML, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { VALIDATION } from './constants.js';
import { t } from './i18n.js';
import { showChatPanel, hideChatPanel, initChat } from './chat.js';
import { getClient, isClientConnected } from './clientAccessor.js';
import type { ServerPlayerData, ServerRoomData } from './multiplayerTypes.js';

// Session ID pending kick confirmation (used by confirm-kick-modal)
let pendingKickSessionId: string | null = null;

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
