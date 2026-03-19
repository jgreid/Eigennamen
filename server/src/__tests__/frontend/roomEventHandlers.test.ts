/**
 * Room Event Handlers Tests
 *
 * Tests the client-side room event handler registration and behavior:
 * hostChanged, roomWarning, settingsUpdated, disconnected, kicked,
 * playerKicked, rejoinFailed, and reconnection flows.
 */

type ListenerMap = Record<string, ((...args: unknown[]) => void)[]>;

const mockListeners: ListenerMap = {};
const mockRequestResync = jest.fn().mockResolvedValue({});
const mockGetRoomCode = jest.fn(() => 'TEST');
const mockUpdateSettings = jest.fn();

(globalThis as Record<string, unknown>).EigennamenClient = {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (!mockListeners[event]) mockListeners[event] = [];
        mockListeners[event].push(handler);
    }),
    player: { sessionId: 's1', nickname: 'Me', isHost: false, role: 'clicker', team: 'red' },
    getRoomCode: mockGetRoomCode,
    requestResync: mockRequestResync,
    updateSettings: mockUpdateSettings,
};

function emit(event: string, data: unknown): void {
    mockListeners[event]?.forEach((h) => h(data));
}

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        isHost: false,
        resyncInProgress: false,
        multiplayerPlayers: [
            { sessionId: 's1', nickname: 'Me', isHost: false },
            { sessionId: 's2', nickname: 'Other', isHost: true },
        ],
        gameState: { gameOver: false },
        gameMode: 'classic',
        teamNames: { red: 'Red', blue: 'Blue' },
        currentRoomId: 'TEST',
        multiplayerListenersSetup: true,
        revealTimeouts: new Map(),
        revealingCards: new Map(),
        revealTimestamps: new Map(),
        isRevealingCard: false,
        spectatorCount: 0,
        roomStats: null,
    },
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string, params?: Record<string, unknown>) => {
        if (params?.name) return `${key}:${params.name}`;
        return key;
    },
}));

jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn(),
    revertAndClearRoleChange: jest.fn(),
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
}));

jest.mock('../../frontend/game', () => ({
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn(),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    updateMpIndicator: jest.fn(),
    updateForfeitButton: jest.fn(),
    updateRoomSettingsNavVisibility: jest.fn(),
    showReconnectionOverlay: jest.fn(),
    hideReconnectionOverlay: jest.fn(),
    syncGameModeUI: jest.fn(),
    syncTurnTimerUI: jest.fn(),
    updateSpectatorCount: jest.fn(),
    updateRoomStats: jest.fn(),
}));

jest.mock('../../frontend/multiplayerSync', () => ({
    syncGameStateFromServer: jest.fn(),
    syncLocalPlayerState: jest.fn(),
    leaveMultiplayerMode: jest.fn(),
    detectOfflineChanges: jest.fn(() => []),
    domListenerCleanup: [],
}));

jest.mock('../../frontend/store/batch', () => ({
    batch: jest.fn((fn: () => void) => fn()),
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => ({
        player: { sessionId: 's1', isHost: false },
    }),
}));

import { state } from '../../frontend/state';
import { showToast } from '../../frontend/ui';
import {
    updateMpIndicator,
    updateForfeitButton,
    updateRoomSettingsNavVisibility,
    showReconnectionOverlay,
    hideReconnectionOverlay,
    syncGameModeUI,
    syncTurnTimerUI,
} from '../../frontend/multiplayerUI';
import { updateRoleBanner, updateControls, revertAndClearRoleChange } from '../../frontend/roles';
import { leaveMultiplayerMode, detectOfflineChanges } from '../../frontend/multiplayerSync';
import { renderBoard } from '../../frontend/board';
import { registerRoomHandlers } from '../../frontend/handlers/roomEventHandlers';

beforeEach(() => {
    jest.clearAllMocks();
    // Reset listeners
    Object.keys(mockListeners).forEach((key) => delete mockListeners[key]);

    // Reset state
    (state as Record<string, unknown>).isHost = false;
    (state as Record<string, unknown>).resyncInProgress = false;
    (state as Record<string, unknown>).isMultiplayerMode = true;
    (state as Record<string, unknown>).multiplayerPlayers = [
        { sessionId: 's1', nickname: 'Me', isHost: false },
        { sessionId: 's2', nickname: 'Other', isHost: true },
    ];

    (globalThis as Record<string, unknown>).EigennamenClient = {
        on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
            if (!mockListeners[event]) mockListeners[event] = [];
            mockListeners[event].push(handler);
        }),
        player: { sessionId: 's1', nickname: 'Me', isHost: false },
        getRoomCode: mockGetRoomCode,
        requestResync: mockRequestResync,
        updateSettings: mockUpdateSettings,
    };

    document.body.innerHTML = '';

    registerRoomHandlers();
});

describe('hostChanged', () => {
    test('updates isHost when current player becomes host', () => {
        emit('hostChanged', { newHostSessionId: 's1', newHostNickname: 'Me' });
        expect(state.isHost).toBe(true);
    });

    test('shows "you are host" toast when becoming host', () => {
        emit('hostChanged', { newHostSessionId: 's1', newHostNickname: 'Me' });
        expect(showToast).toHaveBeenCalledWith('multiplayer.youAreHost', 'info');
    });

    test('shows new host name toast when another player becomes host', () => {
        emit('hostChanged', { newHostSessionId: 's3', newHostNickname: 'NewHost' });
        expect(showToast).toHaveBeenCalledWith('multiplayer.newHost:NewHost', 'info');
    });

    test('updates UI elements on host change', () => {
        emit('hostChanged', { newHostSessionId: 's1' });
        expect(updateRoomSettingsNavVisibility).toHaveBeenCalled();
        expect(updateRoleBanner).toHaveBeenCalled();
        expect(updateForfeitButton).toHaveBeenCalled();
    });

    test('updates player list host flags', () => {
        emit('hostChanged', { newHostSessionId: 's1' });
        const players = state.multiplayerPlayers as Array<{ sessionId: string; isHost: boolean }>;
        expect(players.find((p) => p.sessionId === 's1')?.isHost).toBe(true);
        expect(players.find((p) => p.sessionId === 's2')?.isHost).toBe(false);
    });

    test('skips processing during resync', () => {
        (state as Record<string, unknown>).resyncInProgress = true;
        emit('hostChanged', { newHostSessionId: 's1' });
        expect(updateRoomSettingsNavVisibility).not.toHaveBeenCalled();
    });
});

describe('roomWarning', () => {
    test('triggers resync on STATS_STALE warning', () => {
        emit('roomWarning', { code: 'STATS_STALE' });
        expect(mockRequestResync).toHaveBeenCalled();
    });

    test('does not resync for other warning codes', () => {
        emit('roomWarning', { code: 'OTHER_WARNING' });
        expect(mockRequestResync).not.toHaveBeenCalled();
    });
});

describe('disconnected', () => {
    test('shows disconnection toast and reverts role change', () => {
        emit('disconnected', {});
        expect(revertAndClearRoleChange).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Disconnected from server', 'warning');
    });

    test('shows reconnection overlay when in multiplayer mode', () => {
        emit('disconnected', {});
        expect(showReconnectionOverlay).toHaveBeenCalled();
    });

    test('does not show overlay when not in multiplayer mode', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        emit('disconnected', {});
        expect(showReconnectionOverlay).not.toHaveBeenCalled();
    });
});

describe('kicked', () => {
    test('leaves multiplayer mode and shows toast with reason', () => {
        emit('kicked', { reason: 'Misbehaving' });
        expect(leaveMultiplayerMode).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Misbehaving', 'error', 5000);
    });

    test('shows default message when no reason', () => {
        emit('kicked', {});
        expect(showToast).toHaveBeenCalledWith('You were kicked from the room', 'error', 5000);
    });
});

describe('playerKicked', () => {
    test('removes kicked player from list and updates UI', () => {
        emit('playerKicked', { sessionId: 's2', nickname: 'Other' });
        const players = state.multiplayerPlayers as Array<{ sessionId: string }>;
        expect(players.find((p) => p.sessionId === 's2')).toBeUndefined();
        expect(updateMpIndicator).toHaveBeenCalled();
        expect(updateControls).toHaveBeenCalled();
        expect(renderBoard).toHaveBeenCalled();
    });

    test('skips during resync', () => {
        (state as Record<string, unknown>).resyncInProgress = true;
        emit('playerKicked', { sessionId: 's2', nickname: 'Other' });
        expect(updateControls).not.toHaveBeenCalled();
    });
});

describe('settingsUpdated', () => {
    test('syncs game mode when provided', () => {
        emit('settingsUpdated', { settings: { gameMode: 'duet' } });
        expect(syncGameModeUI).toHaveBeenCalledWith('duet');
    });

    test('syncs turn timer', () => {
        emit('settingsUpdated', { settings: { turnTimer: 120 } });
        expect(syncTurnTimerUI).toHaveBeenCalledWith(120);
    });

    test('syncs turn timer as null when not provided', () => {
        emit('settingsUpdated', { settings: {} });
        expect(syncTurnTimerUI).toHaveBeenCalledWith(null);
    });

    test('does nothing when settings is missing', () => {
        emit('settingsUpdated', {});
        expect(syncGameModeUI).not.toHaveBeenCalled();
    });

    test('shows toast after settings update', () => {
        emit('settingsUpdated', { settings: { gameMode: 'match' } });
        expect(showToast).toHaveBeenCalledWith('Room settings updated', 'info');
    });
});

describe('rejoinFailed', () => {
    test('hides overlay and shows room not found toast', () => {
        emit('rejoinFailed', { error: { code: 'ROOM_NOT_FOUND' } });
        expect(hideReconnectionOverlay).toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('Previous game no longer exists', 'warning');
    });

    test('shows generic toast for other errors', () => {
        emit('rejoinFailed', { error: { code: 'OTHER_ERROR' } });
        expect(showToast).toHaveBeenCalledWith('Could not rejoin previous game', 'warning');
    });

    test('calls leaveMultiplayerMode', () => {
        emit('rejoinFailed', {});
        expect(leaveMultiplayerMode).toHaveBeenCalled();
    });
});

describe('reconnection (rejoined/roomReconnected)', () => {
    test('hides overlay and updates UI on rejoined', () => {
        jest.mocked(detectOfflineChanges).mockReturnValue([]);
        emit('rejoined', { players: [], room: null, game: null });
        expect(hideReconnectionOverlay).toHaveBeenCalled();
        expect(updateControls).toHaveBeenCalled();
        expect(updateRoleBanner).toHaveBeenCalled();
        expect(updateForfeitButton).toHaveBeenCalled();
    });

    test('shows changes toast when offline changes detected', () => {
        jest.mocked(detectOfflineChanges).mockReturnValue(['Turn changed', 'Card revealed']);
        emit('rejoined', { players: [], room: null, game: null });
        expect(showToast).toHaveBeenCalledWith('Reconnected! Turn changed. Card revealed', 'info', 6000);
    });

    test('shows simple reconnected toast when no changes', () => {
        jest.mocked(detectOfflineChanges).mockReturnValue([]);
        emit('roomReconnected', { players: [], room: null, game: null });
        expect(showToast).toHaveBeenCalledWith('Reconnected!', 'success');
    });
});

describe('rejoining', () => {
    test('shows reconnection overlay', () => {
        emit('rejoining', {});
        expect(showReconnectionOverlay).toHaveBeenCalled();
    });
});
