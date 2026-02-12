// ========== D-1: CHAT MODULE ==========
// Handles chat UI: toggle, send messages, render incoming messages
import { t } from './i18n.js';
// CodenamesClient is a global declared in globals.d.ts (loaded via <script>)
let unreadCount = 0;
let chatOpen = false;
/**
 * Initialize chat UI event listeners
 */
export function initChat() {
    const toggle = document.getElementById('chat-toggle');
    const sendBtn = document.getElementById('chat-send-btn');
    const input = document.getElementById('chat-input');
    toggle?.addEventListener('click', toggleChat);
    sendBtn?.addEventListener('click', sendChatMessage);
    input?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendChatMessage();
        }
    });
}
/**
 * Toggle the chat panel open/closed
 */
function toggleChat() {
    const body = document.getElementById('chat-body');
    const toggle = document.getElementById('chat-toggle');
    if (!body || !toggle)
        return;
    chatOpen = !chatOpen;
    body.style.display = chatOpen ? 'block' : 'none';
    toggle.setAttribute('aria-expanded', String(chatOpen));
    if (chatOpen) {
        // Clear unread badge
        unreadCount = 0;
        updateUnreadBadge();
        // Scroll to bottom
        const messages = document.getElementById('chat-messages');
        if (messages)
            messages.scrollTop = messages.scrollHeight;
        // Focus input
        document.getElementById('chat-input')?.focus();
    }
}
/**
 * Send a chat message from the input field
 */
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    if (!input)
        return;
    const text = input.value.trim();
    if (!text)
        return;
    if (!CodenamesClient?.isConnected())
        return;
    const teamOnly = document.getElementById('chat-team-only')?.checked ?? false;
    CodenamesClient.sendMessage(text, teamOnly);
    input.value = '';
    input.focus();
}
/**
 * Handle an incoming chat message from the server
 */
export function handleChatMessage(data) {
    if (!data?.from || !data.text)
        return;
    const messagesEl = document.getElementById('chat-messages');
    if (!messagesEl)
        return;
    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message';
    if (data.teamOnly)
        messageEl.classList.add('team-only');
    // Sender name with team color
    const senderEl = document.createElement('span');
    senderEl.className = 'chat-sender';
    if (data.from.team)
        senderEl.classList.add(data.from.team);
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
function updateUnreadBadge() {
    const badge = document.getElementById('chat-unread-badge');
    if (!badge)
        return;
    if (unreadCount > 0) {
        badge.textContent = String(unreadCount > 99 ? '99+' : unreadCount);
        badge.style.display = 'inline-block';
    }
    else {
        badge.style.display = 'none';
    }
}
/**
 * Show the chat panel (called when entering multiplayer mode)
 */
export function showChatPanel() {
    const panel = document.getElementById('chat-panel');
    if (panel)
        panel.style.display = 'block';
}
/**
 * Hide and reset the chat panel (called when leaving multiplayer mode)
 */
export function hideChatPanel() {
    const panel = document.getElementById('chat-panel');
    if (panel)
        panel.style.display = 'none';
    // Reset state
    chatOpen = false;
    unreadCount = 0;
    updateUnreadBadge();
    const body = document.getElementById('chat-body');
    if (body)
        body.style.display = 'none';
    const toggle = document.getElementById('chat-toggle');
    if (toggle)
        toggle.setAttribute('aria-expanded', 'false');
    // Clear messages
    const messages = document.getElementById('chat-messages');
    if (messages)
        messages.innerHTML = '';
}
//# sourceMappingURL=chat.js.map