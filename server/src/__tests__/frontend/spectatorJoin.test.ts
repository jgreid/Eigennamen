/**
 * Spectator Join Flow Tests (F6)
 *
 * Covers the client wiring for spectator:requestJoin / approve / deny and the
 * request-panel visibility rule.
 */

const eventHandlers: Record<string, (...args: unknown[]) => void> = {};

const mockClient = {
    player: { sessionId: 's1', team: null as string | null, role: 'spectator' as string | null, isHost: false },
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        eventHandlers[event] = handler;
    }),
    requestJoinTeam: jest.fn(),
    respondToJoinRequest: jest.fn(),
    requestResync: jest.fn(() => Promise.resolve()),
};
(globalThis as Record<string, unknown>).EigennamenClient = mockClient;

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => (params ? `${key}:${JSON.stringify(params)}` : key),
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        teamNames: { red: 'Red', blue: 'Blue' },
        gameState: { words: ['a', 'b'], gameOver: false },
    },
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => (globalThis as Record<string, unknown>).EigennamenClient,
    isClientConnected: () => true,
}));

import {
    requestJoinTeam,
    approvePendingJoin,
    denyPendingJoin,
    updateSpectatorJoinUI,
    registerSpectatorJoinHandlers,
} from '../../frontend/spectatorJoin';
import { state } from '../../frontend/state';
import { showToast, openModal } from '../../frontend/ui';

beforeEach(() => {
    jest.clearAllMocks();
    Object.keys(eventHandlers).forEach((k) => delete eventHandlers[k]);
    mockClient.player = { sessionId: 's1', team: null, role: 'spectator', isHost: false };
    state.isMultiplayerMode = true;
    state.gameState.words = ['a', 'b'];
    state.gameState.gameOver = false;
    document.body.innerHTML = `
        <div id="spectator-join-panel" hidden></div>
        <div id="spectator-join-request-text"></div>
    `;
    registerSpectatorJoinHandlers();
});

afterEach(() => {
    // The module keeps a private request queue; drain any leftover so state
    // doesn't leak into the next test (denyPendingJoin no-ops once empty).
    for (let i = 0; i < 20; i++) denyPendingJoin();
});

describe('requestJoinTeam', () => {
    test('a spectator emits the request and gets a confirmation toast', () => {
        requestJoinTeam('red');
        expect(mockClient.requestJoinTeam).toHaveBeenCalledWith('red');
        expect(showToast).toHaveBeenCalled();
    });

    test('a seated team player cannot request (no emit)', () => {
        mockClient.player = { sessionId: 's1', team: 'red', role: 'clicker', isHost: false };
        requestJoinTeam('blue');
        expect(mockClient.requestJoinTeam).not.toHaveBeenCalled();
    });
});

describe('host approval queue', () => {
    test('an incoming request opens the approval modal for the host', () => {
        mockClient.player = { sessionId: 'host', team: 'red', role: 'spymaster', isHost: true };
        eventHandlers['spectatorJoinRequest']({ requesterId: 'r1', requesterNickname: 'Zed', team: 'red' });
        expect(openModal).toHaveBeenCalledWith('spectator-join-modal');
        expect(document.getElementById('spectator-join-request-text')?.textContent).toContain('Zed');
    });

    test('non-host ignores incoming requests', () => {
        mockClient.player = { sessionId: 's1', team: null, role: 'spectator', isHost: false };
        eventHandlers['spectatorJoinRequest']({ requesterId: 'r1', requesterNickname: 'Zed', team: 'red' });
        expect(openModal).not.toHaveBeenCalled();
    });

    test('approve responds with the requested team; deny responds negatively', () => {
        mockClient.player = { sessionId: 'host', team: 'red', role: 'spymaster', isHost: true };
        eventHandlers['spectatorJoinRequest']({ requesterId: 'r1', requesterNickname: 'Zed', team: 'blue' });

        approvePendingJoin();
        expect(mockClient.respondToJoinRequest).toHaveBeenCalledWith('r1', true, 'blue');

        // A second request, this time denied.
        eventHandlers['spectatorJoinRequest']({ requesterId: 'r2', requesterNickname: 'Amy', team: 'red' });
        denyPendingJoin();
        expect(mockClient.respondToJoinRequest).toHaveBeenCalledWith('r2', false, 'red');
    });
});

describe('requester notifications', () => {
    test('approval toasts and triggers a resync', () => {
        eventHandlers['spectatorJoinApproved']({ team: 'red' });
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'success');
        expect(mockClient.requestResync).toHaveBeenCalled();
    });

    test('denial toasts a warning', () => {
        eventHandlers['spectatorJoinDenied']({});
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'warning');
    });
});

describe('updateSpectatorJoinUI', () => {
    test('shows the panel for a spectator during an active game', () => {
        updateSpectatorJoinUI();
        expect(document.getElementById('spectator-join-panel')?.hidden).toBe(false);
    });

    test('hides the panel for the host', () => {
        mockClient.player = { sessionId: 'host', team: 'red', role: 'spymaster', isHost: true };
        updateSpectatorJoinUI();
        expect(document.getElementById('spectator-join-panel')?.hidden).toBe(true);
    });

    test('hides the panel when no game is in progress', () => {
        state.gameState.words = [];
        updateSpectatorJoinUI();
        expect(document.getElementById('spectator-join-panel')?.hidden).toBe(true);
    });
});
