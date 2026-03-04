import type { ChatMessageData } from './multiplayerTypes.js';
import { t } from './i18n.js';
import { isClientConnected } from './clientAccessor.js';
import { sendSpectatorChat } from './multiplayerUI.js';

let unreadCount = 0;
let chatOpen = false;
let chatInitialized = false;

/**
 * Initialize chat UI event listeners (idempotent)
 */
export function initChat(): void {
    if (chatInitialized) return;
    chatInitialized = true;

    const toggle = document.getElementById('chat-toggle');
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input') as HTMLInputElement | null;

    toggle?.addEventListener('click', toggleChat);

    sendBtn?.addEventListener('click', sendChatMessage);

    input?.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
}

/**
 * Toggle the chat panel open/closed
 */
function toggleChat(): void {
    const body = document.getElementById('chat-body');
    const toggle = document.getElementById('chat-toggle');
    if (!body || !toggle) return;

    chatOpen = !chatOpen;
    body.hidden = !chatOpen;
    toggle.setAttribute('aria-expanded', String(chatOpen));

    if (chatOpen) {
        // Clear unread badge
        unreadCount = 0;
        updateUnreadBadge();
        // Scroll to bottom
        const messages = document.getElementById('chat-messages');
        if (messages) messages.scrollTop = messages.scrollHeight;
        // Focus input
        document.getElementById('chat-input')?.focus();
    }
}

/**
 * Send a chat message from the input field.
 * Spectators are routed through the spectator-only chat channel.
 */
function sendChatMessage(): void {
    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    if (!input) return;

    const text = input.value.trim();
    if (!text) return;
    if (!isClientConnected()) return;

    const player = EigennamenClient.player;
    if (player?.role === 'spectator') {
        sendSpectatorChat(text);
    } else {
        const teamOnly = (document.getElementById('chat-team-only') as HTMLInputElement | null)?.checked ?? false;
        EigennamenClient.sendMessage(text, teamOnly);
    }
    input.value = '';
    input.focus();
}

/**
 * Handle an incoming chat message from the server
 */
export function handleChatMessage(data: ChatMessageData): void {
    if (!data?.from || !data.text) return;

    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    if (data.teamOnly) messageEl.classList.add('team-only');

    // Sender name with team color
    const senderEl = document.createElement('span');
    senderEl.className = 'chat-sender';
    if (data.from.team) senderEl.classList.add(data.from.team);
    senderEl.textContent = data.from.nickname || 'Unknown';

    // Message content (server already sanitized, use textContent for safety)
    const contentEl = document.createElement('span');
    contentEl.className = 'chat-content';
    contentEl.textContent = data.text;

    // Team-only badge
    if (data.teamOnly) {
        const badgeEl = document.createElement('span');
        badgeEl.className = 'chat-badge';
        badgeEl.textContent = '🔒';
        badgeEl.title = t('chat.teamOnly');
        messageEl.appendChild(badgeEl);
    }

    // Spectator badge
    if (data.from.role === 'spectator') {
        const badgeEl = document.createElement('span');
        badgeEl.className = 'chat-badge spectator-badge';
        badgeEl.textContent = '👁';
        badgeEl.title = t('chat.spectatorMessage');
        messageEl.appendChild(badgeEl);
    }

    messageEl.appendChild(senderEl);
    messageEl.appendChild(document.createTextNode(': '));
    messageEl.appendChild(contentEl);

    messagesEl.appendChild(messageEl);

    // Auto-scroll if near bottom
    const isNearBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight < 60;
    if (isNearBottom) {
        messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    // Update unread count if chat is closed
    if (!chatOpen) {
        unreadCount++;
        updateUnreadBadge();
    }
}

/**
 * Update the unread badge display
 */
function updateUnreadBadge(): void {
    const badge = document.getElementById('chat-unread-badge');
    if (!badge) return;

    if (unreadCount > 0) {
        badge.textContent = String(unreadCount > 99 ? '99+' : unreadCount);
        badge.hidden = false;
    } else {
        badge.hidden = true;
    }
}

/**
 * Update chat UI based on whether the current player is a spectator.
 * Hides the team-only checkbox and updates the placeholder for spectators.
 */
export function updateChatForRole(): void {
    const player = EigennamenClient.player;
    const isSpectator = player?.role === 'spectator';

    const teamOnlyLabel = document.querySelector('.chat-team-only') as HTMLElement | null;
    if (teamOnlyLabel) {
        teamOnlyLabel.hidden = isSpectator;
    }

    const input = document.getElementById('chat-input') as HTMLInputElement | null;
    if (input) {
        input.placeholder = isSpectator ? t('chat.spectatorChat') : t('chat.placeholder');
    }
}

/**
 * Show the chat panel (called when entering multiplayer mode)
 */
export function showChatPanel(): void {
    const panel = document.getElementById('chat-panel');
    if (panel) panel.hidden = false;
}

/**
 * Hide and reset the chat panel (called when leaving multiplayer mode)
 */
export function hideChatPanel(): void {
    const panel = document.getElementById('chat-panel');
    if (panel) panel.hidden = true;

    // Reset state — includes chatInitialized so listeners are re-attached
    // when the panel is shown again (DOM elements are recreated between rooms)
    chatOpen = false;
    chatInitialized = false;
    unreadCount = 0;
    updateUnreadBadge();

    const body = document.getElementById('chat-body');
    if (body) body.hidden = true;

    const toggle = document.getElementById('chat-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', 'false');

    // Clear messages
    const messages = document.getElementById('chat-messages');
    if (messages) messages.innerHTML = '';
}
