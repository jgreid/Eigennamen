/**
 * Chat Module Branch Coverage Tests
 *
 * Covers branches not hit by the main chat.test.ts:
 * - updateChatForRole (spectator vs team member)
 * - sendChatMessage via spectator channel
 * - sendChatMessage via team channel
 * - Auto-scroll near-bottom detection
 * - hideChatPanel full reset flow
 * - initChat idempotency
 */

const mockSendMessage = jest.fn();
const mockSendSpectatorChat = jest.fn();

(globalThis as Record<string, unknown>).EigennamenClient = {
    player: { sessionId: 's1', nickname: 'Me', role: 'clicker', team: 'red' },
    sendMessage: mockSendMessage,
};

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

const mockIsClientConnected = jest.fn(() => true);
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: (...args: unknown[]) => mockIsClientConnected(...args),
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    sendSpectatorChat: (...args: unknown[]) => mockSendSpectatorChat(...args),
}));

import { initChat, handleChatMessage, updateChatForRole, hideChatPanel } from '../../frontend/chat';

function setupChatDOM() {
    document.body.innerHTML = `
        <div id="chat-panel" hidden>
            <button id="chat-toggle" aria-expanded="false">Chat</button>
            <div id="chat-body" hidden>
                <div id="chat-messages"></div>
                <input id="chat-input" type="text" />
                <button id="chat-send-btn">Send</button>
                <label class="chat-team-only">
                    <input id="chat-team-only" type="checkbox" />
                </label>
            </div>
            <span id="chat-unread-badge" hidden></span>
        </div>
    `;
}

beforeEach(() => {
    jest.clearAllMocks();
    mockIsClientConnected.mockReturnValue(true);
    setupChatDOM();
    // Reset module state by hiding panel (resets chatInitialized, chatOpen, etc.)
    hideChatPanel();
    setupChatDOM();

    (globalThis as Record<string, unknown>).EigennamenClient = {
        player: { sessionId: 's1', nickname: 'Me', role: 'clicker', team: 'red' },
        sendMessage: mockSendMessage,
    };
});

describe('updateChatForRole', () => {
    test('hides team-only checkbox for spectators', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', role: 'spectator', team: null },
        };
        updateChatForRole();
        const label = document.querySelector('.chat-team-only') as HTMLElement;
        expect(label.hidden).toBe(true);
    });

    test('shows team-only checkbox for team members', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', role: 'clicker', team: 'red' },
        };
        updateChatForRole();
        const label = document.querySelector('.chat-team-only') as HTMLElement;
        expect(label.hidden).toBe(false);
    });

    test('sets spectator placeholder for spectators', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', role: 'spectator', team: null },
        };
        updateChatForRole();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        expect(input.placeholder).toBe('chat.spectatorChat');
    });

    test('sets regular placeholder for team members', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', role: 'clicker', team: 'red' },
        };
        updateChatForRole();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        expect(input.placeholder).toBe('chat.placeholder');
    });
});

describe('sendChatMessage (via UI interaction)', () => {
    test('sends through spectator channel when player is spectator', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', role: 'spectator', team: null },
            sendMessage: mockSendMessage,
        };

        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        input.value = 'Hello from spectator';
        document.getElementById('chat-send-btn')!.click();

        expect(mockSendSpectatorChat).toHaveBeenCalledWith('Hello from spectator');
        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(input.value).toBe('');
    });

    test('sends through team channel with teamOnly flag', () => {
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        const teamOnly = document.getElementById('chat-team-only') as HTMLInputElement;

        input.value = 'Team message';
        teamOnly.checked = true;
        document.getElementById('chat-send-btn')!.click();

        expect(mockSendMessage).toHaveBeenCalledWith('Team message', true);
    });

    test('sends through team channel without teamOnly', () => {
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;

        input.value = 'Public message';
        document.getElementById('chat-send-btn')!.click();

        expect(mockSendMessage).toHaveBeenCalledWith('Public message', false);
    });

    test('does not send empty messages', () => {
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        input.value = '   ';
        document.getElementById('chat-send-btn')!.click();

        expect(mockSendMessage).not.toHaveBeenCalled();
        expect(mockSendSpectatorChat).not.toHaveBeenCalled();
    });

    test('does not send when not connected', () => {
        mockIsClientConnected.mockReturnValue(false);
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        input.value = 'Test message';
        document.getElementById('chat-send-btn')!.click();

        expect(mockSendMessage).not.toHaveBeenCalled();
    });

    test('sends on Enter key press', () => {
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        input.value = 'Enter message';

        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(event);

        expect(mockSendMessage).toHaveBeenCalledWith('Enter message', false);
    });

    test('does not send on Shift+Enter', () => {
        initChat();
        const input = document.getElementById('chat-input') as HTMLInputElement;
        input.value = 'No send';

        const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            shiftKey: true,
            bubbles: true,
            cancelable: true,
        });
        input.dispatchEvent(event);

        expect(mockSendMessage).not.toHaveBeenCalled();
    });
});

describe('initChat idempotency', () => {
    test('does not add duplicate listeners on second call', () => {
        initChat();
        const toggleSpy = jest.spyOn(document.getElementById('chat-toggle')!, 'addEventListener');
        initChat();
        expect(toggleSpy).not.toHaveBeenCalled();
    });
});

describe('handleChatMessage auto-scroll', () => {
    test('does not auto-scroll when user has scrolled up', () => {
        const messagesEl = document.getElementById('chat-messages')!;
        // Simulate a scrolled-up state
        Object.defineProperty(messagesEl, 'scrollHeight', { value: 500, writable: true });
        Object.defineProperty(messagesEl, 'scrollTop', { value: 100, writable: true });
        Object.defineProperty(messagesEl, 'clientHeight', { value: 200, writable: true });

        handleChatMessage({
            from: { nickname: 'Test', team: null, role: null },
            text: 'Test message',
        });

        // scrollTop should not be changed to scrollHeight since user is scrolled up
        expect(messagesEl.scrollTop).toBe(100);
    });
});

describe('hideChatPanel', () => {
    test('allows reinitializing chat after hide', () => {
        initChat();
        hideChatPanel();
        setupChatDOM();

        // Should be able to init again (chatInitialized was reset)
        const toggleSpy = jest.spyOn(document.getElementById('chat-toggle')!, 'addEventListener');
        initChat();
        expect(toggleSpy).toHaveBeenCalledWith('click', expect.any(Function));
    });
});
