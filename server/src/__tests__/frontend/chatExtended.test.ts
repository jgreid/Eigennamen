/**
 * Chat Module Extended Tests
 *
 * Tests updateChatForRole role-based UI switching.
 * Core handleChatMessage rendering tests are in chat.test.ts.
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

import { updateChatForRole } from '../../frontend/chat';
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
