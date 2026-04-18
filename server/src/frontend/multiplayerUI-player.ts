import { state } from './state.js';
import { escapeHTML, copyToClipboard } from './utils.js';
import { showToast, openModal, closeModal } from './ui.js';
import { VALIDATION } from './constants.js';
import { t } from './i18n.js';
import { showChatPanel, hideChatPanel, initChat } from './chat.js';
import { getClient, isClientConnected } from './clientAccessor.js';
import { initPlayerListKeyNav } from './accessibility.js';
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

/**
 * Build a single player list item element.
 */
function buildPlayerLi(p: ServerPlayerData, isMe: boolean, amHost: boolean): HTMLLIElement {
    const li = document.createElement('li');
    li.dataset.sessionId = p.sessionId;
    li.setAttribute('role', 'listitem');
    li.tabIndex = 0;
    if (p.connected === false) li.classList.add('player-disconnected');

    // Compose descriptive aria-label
    const parts: string[] = [p.nickname];
    if (isMe) parts.push(t('multiplayer.you'));
    if (p.team) parts.push(p.team);
    if (p.role) parts.push(p.role);
    if (p.isHost) parts.push(t('multiplayer.host'));
    if (p.connected === false) parts.push(t('multiplayer.offline'));
    li.setAttribute('aria-label', parts.join(', '));

    const info = document.createElement('span');
    info.className = 'player-info';

    const nameSpan = document.createElement('span');
    nameSpan.className = `player-name${isMe ? ' you' : ''}${p.team ? ` player-team-${escapeHTML(p.team)}` : ''}`;
    nameSpan.textContent = p.nickname + (isMe ? ` (${t('multiplayer.you')})` : '');
    info.appendChild(nameSpan);

    if (p.isHost) {
        const badge = document.createElement('span');
        badge.className = 'host-badge';
        badge.setAttribute('aria-hidden', 'true');
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
        kickBtn.setAttribute('aria-label', `${t('multiplayer.kick')} ${p.nickname}`);
        kickBtn.textContent = t('multiplayer.kick');
        li.appendChild(kickBtn);
    }

    return li;
}

/**
 * Generate a fingerprint of the player's display-affecting properties
 * so we can detect when an existing DOM node needs updating.
 */
function playerFingerprint(p: ServerPlayerData, isMe: boolean, amHost: boolean): string {
    return `${p.nickname}|${p.team}|${p.role}|${p.isHost}|${p.connected}|${isMe}|${amHost}`;
}

// Track fingerprints to detect changes without DOM reads
const playerFingerprints = new Map<string, string>();

export function updatePlayerList(ul: HTMLUListElement, players: ServerPlayerData[]): void {
    const mySessionId = EigennamenClient.player?.sessionId;
    const amHost = EigennamenClient.player?.isHost;

    ul.setAttribute('role', 'list');

    // Build map of existing DOM nodes keyed by session ID
    const existingNodes = new Map<string, HTMLLIElement>();
    for (const child of Array.from(ul.children)) {
        const li = child as HTMLLIElement;
        const sid = li.dataset.sessionId;
        if (sid) existingNodes.set(sid, li);
    }

    // Track which session IDs are in the new player list
    const newSessionIds = new Set(players.map((p) => p.sessionId));

    // Remove departed players with animation
    for (const [sid, li] of existingNodes) {
        if (!newSessionIds.has(sid)) {
            li.classList.add('player-leaving');
            li.addEventListener(
                'animationend',
                () => {
                    li.remove();
                },
                { once: true }
            );
            // Fallback removal if animation doesn't fire
            setTimeout(() => {
                if (li.parentNode) li.remove();
            }, 300);
            playerFingerprints.delete(sid);
        }
    }

    // Add or update players in order
    let insertBefore: Node | null = null;
    for (let i = players.length - 1; i >= 0; i--) {
        const p = players[i];
        const isMe = p.sessionId === mySessionId;
        const fp = playerFingerprint(p, isMe, amHost ?? false);
        const existing = existingNodes.get(p.sessionId);

        if (existing) {
            const oldFp = playerFingerprints.get(p.sessionId);
            if (oldFp !== fp) {
                // Properties changed — rebuild in-place
                const newLi = buildPlayerLi(p, isMe, amHost ?? false);
                newLi.classList.add('player-changed');
                ul.replaceChild(newLi, existing);
                playerFingerprints.set(p.sessionId, fp);
                insertBefore = newLi;
            } else {
                // Ensure correct order
                if (existing.nextSibling !== insertBefore) {
                    ul.insertBefore(existing, insertBefore);
                }
                insertBefore = existing;
            }
        } else {
            // New player — create and animate in
            const newLi = buildPlayerLi(p, isMe, amHost ?? false);
            newLi.classList.add('player-entering');
            ul.insertBefore(newLi, insertBefore);
            playerFingerprints.set(p.sessionId, fp);
            insertBefore = newLi;
        }
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

    // Initialize keyboard navigation for the player list
    initPlayerListKeyNav();

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
