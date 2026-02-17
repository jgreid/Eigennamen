/**
 * Frontend Chat Module Tests
 *
 * Tests chat message rendering, toggle, unread badge, and panel lifecycle.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: () => false,
}));

import {
    initChat,
    handleChatMessage,
    showChatPanel,
    hideChatPanel,
} from '../../frontend/chat';

function setupChatDOM() {
    document.body.innerHTML = `
        <div id="chat-panel" style="display: none;">
            <button id="chat-toggle" aria-expanded="false">Chat</button>
            <div id="chat-body" style="display: none;">
                <div id="chat-messages"></div>
                <input id="chat-input" type="text" />
                <button id="chat-send-btn">Send</button>
                <input id="chat-team-only" type="checkbox" />
            </div>
            <span id="chat-unread-badge" style="display: none;"></span>
        </div>
    `;
}

beforeEach(() => {
    setupChatDOM();
    // Reset module-level state (unreadCount, chatOpen) that persists between tests
    hideChatPanel();
    setupChatDOM();
});

// ========== CHAT MESSAGE RENDERING ==========

describe('handleChatMessage', () => {
    test('renders a basic message', () => {
        handleChatMessage({
            from: { nickname: 'Alice', team: 'red', role: 'clicker' },
            text: 'Hello everyone!',
        });

        const messages = document.getElementById('chat-messages')!;
        expect(messages.children.length).toBe(1);

        const msg = messages.children[0] as HTMLElement;
        expect(msg.className).toContain('chat-message');

        const sender = msg.querySelector('.chat-sender')!;
        expect(sender.textContent).toBe('Alice');
        expect(sender.classList.contains('red')).toBe(true);

        const content = msg.querySelector('.chat-content')!;
        expect(content.textContent).toBe('Hello everyone!');
    });

    test('uses textContent for message safety (no XSS)', () => {
        handleChatMessage({
            from: { nickname: 'Evil', team: null, role: null },
            text: '<img src=x onerror=alert(1)>',
        });

        const content = document.querySelector('.chat-content')!;
        expect(content.textContent).toBe('<img src=x onerror=alert(1)>');
        expect(content.innerHTML).not.toContain('<img');
    });

    test('adds team-only class and badge for team messages', () => {
        handleChatMessage({
            from: { nickname: 'Bob', team: 'blue', role: 'clicker' },
            text: 'Secret team message',
            teamOnly: true,
        });

        const msg = document.querySelector('.chat-message')! as HTMLElement;
        expect(msg.classList.contains('team-only')).toBe(true);

        const badge = msg.querySelector('.chat-badge')!;
        expect(badge).not.toBeNull();
    });

    test('adds spectator badge for spectator messages', () => {
        handleChatMessage({
            from: { nickname: 'Viewer', team: null, role: 'spectator' },
            text: 'Nice game!',
        });

        const badge = document.querySelector('.spectator-badge')!;
        expect(badge).not.toBeNull();
    });

    test('handles missing sender nickname', () => {
        handleChatMessage({
            from: { nickname: '', team: null, role: null },
            text: 'Anonymous message',
        });

        // Should render 'Unknown' as fallback
        // Actually the code uses `data.from.nickname || 'Unknown'`
        const sender = document.querySelector('.chat-sender')!;
        expect(sender.textContent).toBe('Unknown');
    });

    test('ignores messages with missing from or text', () => {
        const messages = document.getElementById('chat-messages')!;
        handleChatMessage({ from: null as any, text: 'Test' });
        expect(messages.children.length).toBe(0);

        handleChatMessage({ from: { nickname: 'A', team: null, role: null }, text: '' });
        expect(messages.children.length).toBe(0);
    });

    test('increments unread badge when chat is closed', () => {
        // Chat starts closed
        handleChatMessage({
            from: { nickname: 'Alice', team: 'red', role: 'clicker' },
            text: 'Message 1',
        });
        handleChatMessage({
            from: { nickname: 'Bob', team: 'blue', role: 'clicker' },
            text: 'Message 2',
        });

        const badge = document.getElementById('chat-unread-badge')!;
        expect(badge.style.display).toBe('inline-block');
        expect(badge.textContent).toBe('2');
    });

    test('caps unread badge at 99+', () => {
        for (let i = 0; i < 100; i++) {
            handleChatMessage({
                from: { nickname: 'Spammer', team: null, role: null },
                text: `Message ${i}`,
            });
        }

        const badge = document.getElementById('chat-unread-badge')!;
        expect(badge.textContent).toBe('99+');
    });
});

// ========== CHAT PANEL LIFECYCLE ==========

describe('showChatPanel', () => {
    test('makes chat panel visible', () => {
        showChatPanel();
        expect(document.getElementById('chat-panel')!.style.display).toBe('block');
    });
});

describe('hideChatPanel', () => {
    test('hides panel and resets state', () => {
        showChatPanel();

        // Add some messages
        handleChatMessage({
            from: { nickname: 'Test', team: null, role: null },
            text: 'test',
        });

        hideChatPanel();

        expect(document.getElementById('chat-panel')!.style.display).toBe('none');
        expect(document.getElementById('chat-body')!.style.display).toBe('none');
        expect(document.getElementById('chat-toggle')!.getAttribute('aria-expanded')).toBe('false');
        expect(document.getElementById('chat-unread-badge')!.style.display).toBe('none');
        expect(document.getElementById('chat-messages')!.innerHTML).toBe('');
    });
});

// ========== INIT CHAT ==========

describe('initChat', () => {
    test('sets up event listeners without error', () => {
        expect(() => initChat()).not.toThrow();
    });

    test('chat toggle opens and closes body', () => {
        initChat();
        const toggle = document.getElementById('chat-toggle')!;
        const body = document.getElementById('chat-body')!;

        toggle.click();
        expect(body.style.display).toBe('block');
        expect(toggle.getAttribute('aria-expanded')).toBe('true');

        toggle.click();
        expect(body.style.display).toBe('none');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
    });

    test('opening chat clears unread badge', () => {
        initChat();

        // Receive messages while chat is closed
        handleChatMessage({
            from: { nickname: 'Test', team: null, role: null },
            text: 'unread msg',
        });

        const badge = document.getElementById('chat-unread-badge')!;
        expect(badge.style.display).toBe('inline-block');

        // Open chat
        document.getElementById('chat-toggle')!.click();
        expect(badge.style.display).toBe('none');
    });
});
