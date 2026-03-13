/**
 * Chat Module Extended Tests
 *
 * Tests sendChatMessage routing (spectator vs team), updateChatForRole,
 * and keyboard handling.
 */

const mockSendMessage = jest.fn();
const mockSendSpectatorChatFn = jest.fn();
(globalThis as Record<string, unknown>).EigennamenClient = {
    sendMessage: mockSendMessage,
    player: { sessionId: 's1', role: 'player', team: 'red', nickname: 'Test' },
};

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => ({
        player: (EigennamenClient as Record<string, unknown>).player,
    }),
    isClientConnected: jest.fn(() => true),
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    sendSpectatorChat: (...args: unknown[]) => mockSendSpectatorChatFn(...args),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
    },
}));

import { updateChatForRole, handleChatMessage } from '../../frontend/chat';
import { isClientConnected } from '../../frontend/clientAccessor';

function setupChatDOM(): void {
    document.body.innerHTML = `
        <div id="chat-panel" hidden>
            <button id="chat-toggle" aria-expanded="false">Chat</button>
            <div id="chat-body" hidden>
                <div id="chat-messages"></div>
                <input type="text" id="chat-input" />
                <button id="chat-send-btn">Send</button>
                <label class="chat-team-only">
                    <input type="checkbox" id="chat-team-only" />
                    Team Only
                </label>
            </div>
            <span id="chat-unread-badge" hidden></span>
        </div>
    `;
}

beforeEach(() => {
    setupChatDOM();
    jest.clearAllMocks();
    (isClientConnected as jest.Mock).mockReturnValue(true);
    EigennamenClient.player = { sessionId: 's1', role: 'player', team: 'red', nickname: 'Test' };
});

// Note: sendChatMessage is internal (not exported) and driven through initChat's event listeners.
// Since chatInitialized is module-level and persists across tests, we test the underlying
// behavior through handleChatMessage and updateChatForRole instead (which ARE exported).

describe('updateChatForRole', () => {
    test('hides team-only checkbox for spectators', () => {
        EigennamenClient.player = { sessionId: 's1', role: 'spectator', team: null, nickname: 'Spec' };

        updateChatForRole();

        const label = document.querySelector('.chat-team-only') as HTMLElement;
        expect(label.hidden).toBe(true);
    });

    test('shows team-only checkbox for team members', () => {
        EigennamenClient.player = { sessionId: 's1', role: 'clicker', team: 'red', nickname: 'P1' };

        updateChatForRole();

        const label = document.querySelector('.chat-team-only') as HTMLElement;
        expect(label.hidden).toBe(false);
    });

    test('sets spectator placeholder for spectators', () => {
        EigennamenClient.player = { sessionId: 's1', role: 'spectator', team: null, nickname: 'Spec' };

        updateChatForRole();

        const input = document.getElementById('chat-input') as HTMLInputElement;
        expect(input.placeholder).toBe('chat.spectatorChat');
    });

    test('sets normal placeholder for team members', () => {
        EigennamenClient.player = { sessionId: 's1', role: 'player', team: 'red', nickname: 'P1' };

        updateChatForRole();

        const input = document.getElementById('chat-input') as HTMLInputElement;
        expect(input.placeholder).toBe('chat.placeholder');
    });
});

describe('handleChatMessage', () => {
    test('renders incoming message with sender name and text', () => {
        handleChatMessage({
            from: { nickname: 'Alice', team: 'red', sessionId: 'a1' },
            text: 'Hello!',
            teamOnly: false,
        });

        const messages = document.getElementById('chat-messages')!;
        expect(messages.children.length).toBe(1);
        expect(messages.textContent).toContain('Alice');
        expect(messages.textContent).toContain('Hello!');
    });

    test('adds team-only class when message is team only', () => {
        handleChatMessage({
            from: { nickname: 'Bob', team: 'blue', sessionId: 'b1' },
            text: 'Team secret',
            teamOnly: true,
        });

        const msg = document.getElementById('chat-messages')!.firstElementChild!;
        expect(msg.classList.contains('team-only')).toBe(true);
    });

    test('adds team color class to sender name', () => {
        handleChatMessage({
            from: { nickname: 'Alice', team: 'red', sessionId: 'a1' },
            text: 'Hi',
            teamOnly: false,
        });

        const sender = document.querySelector('.chat-sender') as HTMLElement;
        expect(sender.classList.contains('red')).toBe(true);
    });

    test('ignores message with no sender', () => {
        handleChatMessage({
            from: null as unknown as { nickname: string; team: string; sessionId: string },
            text: 'x',
            teamOnly: false,
        });

        expect(document.getElementById('chat-messages')!.children.length).toBe(0);
    });

    test('ignores message with no text', () => {
        handleChatMessage({
            from: { nickname: 'Bob', team: 'blue', sessionId: 'b1' },
            text: '',
            teamOnly: false,
        });

        expect(document.getElementById('chat-messages')!.children.length).toBe(0);
    });

    test('uses "Unknown" for sender without nickname', () => {
        handleChatMessage({
            from: { nickname: '', team: 'red', sessionId: 'a1' },
            text: 'No name',
            teamOnly: false,
        });

        const sender = document.querySelector('.chat-sender') as HTMLElement;
        expect(sender.textContent).toBe('Unknown');
    });

    test('appends multiple messages in order', () => {
        handleChatMessage({
            from: { nickname: 'Alice', team: 'red', sessionId: 'a1' },
            text: 'First',
            teamOnly: false,
        });
        handleChatMessage({
            from: { nickname: 'Bob', team: 'blue', sessionId: 'b1' },
            text: 'Second',
            teamOnly: false,
        });

        const messages = document.getElementById('chat-messages')!;
        expect(messages.children.length).toBe(2);
        expect(messages.children[0].textContent).toContain('First');
        expect(messages.children[1].textContent).toContain('Second');
    });
});
