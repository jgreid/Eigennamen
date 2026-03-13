/**
 * Roles Module — Multiplayer Path Tests
 *
 * Tests setTeam, setSpymaster, setClicker in multiplayer mode:
 * optimistic updates, server ack errors, revert logic, absolute timeout.
 */

// --- EigennamenClient mock ---
const mockSetTeam = jest.fn();
const mockSetRole = jest.fn();
const mockSetTeamRole = jest.fn();
(globalThis as Record<string, unknown>).EigennamenClient = {
    setTeam: mockSetTeam,
    setRole: mockSetRole,
    setTeamRole: mockSetTeamRole,
    isInRoom: jest.fn(() => true),
    isConnected: jest.fn(() => true),
};

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => null,
    isClientConnected: () => true,
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn(),
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    announceToScreenReader: jest.fn(),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('../../frontend/handlers/errorMessages', () => ({
    getErrorMessage: (err: { code?: string; message?: string }) => err.message || err.code || 'Error',
}));

import { clearRoleChange, setTeam, setSpymaster, setClicker } from '../../frontend/roles';
import { state } from '../../frontend/state';
import { showToast } from '../../frontend/ui';

function setupDOM(): void {
    document.body.innerHTML = `
        <div id="role-banner"></div>
        <button id="btn-end-turn">End Turn</button>
        <button id="btn-spymaster">Spymaster</button>
        <button id="btn-clicker">Clicker</button>
        <button id="btn-team-red">Red</button>
        <button id="btn-team-blue">Blue</button>
        <div id="role-hint"></div>
        <div id="sr-announcements" aria-live="assertive"></div>
    `;
    state.cachedElements.roleBanner = document.getElementById('role-banner');
    state.cachedElements.srAnnouncements = document.getElementById('sr-announcements');
}

beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    jest.clearAllMocks();
    // Re-establish mock implementations after clearAllMocks resets them
    (EigennamenClient.isInRoom as jest.Mock).mockReturnValue(true);
    (EigennamenClient.isConnected as jest.Mock).mockReturnValue(true);
    state.isMultiplayerMode = true;
    state.isHost = false;
    state.playerTeam = null;
    state.spymasterTeam = null;
    state.clickerTeam = null;
    state.roleChange = { phase: 'idle' };
    state.multiplayerPlayers = [];
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.gameState.currentTurn = 'red';
    state.gameState.gameOver = false;
});

afterEach(() => {
    jest.useRealTimers();
    clearRoleChange();
});

// ========== MULTIPLAYER setTeam ==========

describe('setTeam (multiplayer)', () => {
    test('applies optimistic team update immediately', () => {
        setTeam('red');

        expect(state.playerTeam).toBe('red');
        expect(state.roleChange.phase).toBe('changing_team');
        expect(mockSetTeam).toHaveBeenCalled();
    });

    test('clears spymaster/clicker when switching teams optimistically', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        state.clickerTeam = null;

        setTeam('blue');

        expect(state.playerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
    });

    test('reverts optimistic update on server ack error', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';

        setTeam('blue');

        // Simulate server ack with error
        const ackCallback = mockSetTeam.mock.calls[0][1];
        ackCallback({ error: { code: 'NOT_AUTHORIZED', message: 'Not authorized' } });

        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBe('red');
        expect(state.roleChange.phase).toBe('idle');
        expect(showToast).toHaveBeenCalledWith(expect.any(String), 'error');
    });

    test('blocks when not in room', () => {
        (EigennamenClient.isInRoom as jest.Mock).mockReturnValue(false);

        setTeam('red');

        expect(mockSetTeam).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('multiplayer.waitJoiningRoom', 'info');
    });

    test('blocks duplicate requests when role change in progress', () => {
        setTeam('red');
        setTeam('blue');

        // Only first call should go through
        expect(mockSetTeam).toHaveBeenCalledTimes(1);
    });

    test('absolute timeout fires and resets state after 10s', () => {
        setTeam('red');

        expect(state.roleChange.phase).toBe('changing_team');

        jest.advanceTimersByTime(10_000);

        expect(state.roleChange.phase).toBe('idle');
        expect(showToast).toHaveBeenCalledWith('roles.changeTimeout', 'warning');
    });

    test('successful ack does not revert (no error)', () => {
        setTeam('red');

        const ackCallback = mockSetTeam.mock.calls[0][1];
        ackCallback({ success: true });

        // State should remain as optimistically set
        expect(state.playerTeam).toBe('red');
    });
});

// ========== MULTIPLAYER setSpymaster ==========

describe('setSpymaster (multiplayer)', () => {
    test('sets spymaster optimistically and calls setTeamRole for different team', () => {
        state.playerTeam = 'red';
        setSpymaster('blue');

        expect(state.playerTeam).toBe('blue');
        expect(state.spymasterTeam).toBe('blue');
        expect(state.clickerTeam).toBeNull();
        expect(mockSetTeamRole).toHaveBeenCalledWith('blue', 'spymaster', expect.any(Function));
    });

    test('calls setRole("spymaster") when already on same team', () => {
        state.playerTeam = 'red';
        setSpymaster('red');

        expect(state.spymasterTeam).toBe('red');
        expect(mockSetRole).toHaveBeenCalledWith('spymaster', expect.any(Function));
    });

    test('toggles off spymaster when already spymaster for that team', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = 'red';
        setSpymaster('red');

        expect(state.spymasterTeam).toBeNull();
        expect(mockSetRole).toHaveBeenCalledWith('spectator', expect.any(Function));
    });

    test('reverts optimistic update on ack error', () => {
        state.playerTeam = 'red';
        state.spymasterTeam = null;

        setSpymaster('blue');

        const ackCallback = mockSetTeamRole.mock.calls[0][2];
        ackCallback({ error: { code: 'ROLE_TAKEN', message: 'Spymaster taken' } });

        expect(state.playerTeam).toBe('red');
        expect(state.spymasterTeam).toBeNull();
    });

    test('blocks when not in room', () => {
        (EigennamenClient.isInRoom as jest.Mock).mockReturnValue(false);

        setSpymaster('red');

        expect(mockSetRole).not.toHaveBeenCalled();
        expect(mockSetTeamRole).not.toHaveBeenCalled();
    });
});

// ========== MULTIPLAYER setClicker ==========

describe('setClicker (multiplayer)', () => {
    test('sets clicker optimistically and calls setTeamRole for different team', () => {
        state.playerTeam = 'red';
        setClicker('blue');

        expect(state.playerTeam).toBe('blue');
        expect(state.clickerTeam).toBe('blue');
        expect(state.spymasterTeam).toBeNull();
        expect(mockSetTeamRole).toHaveBeenCalledWith('blue', 'clicker', expect.any(Function));
    });

    test('calls setRole("clicker") when already on same team', () => {
        state.playerTeam = 'blue';
        setClicker('blue');

        expect(state.clickerTeam).toBe('blue');
        expect(mockSetRole).toHaveBeenCalledWith('clicker', expect.any(Function));
    });

    test('toggles off clicker when already clicker for that team', () => {
        state.playerTeam = 'blue';
        state.clickerTeam = 'blue';
        setClicker('blue');

        expect(state.clickerTeam).toBeNull();
        expect(mockSetRole).toHaveBeenCalledWith('spectator', expect.any(Function));
    });

    test('reverts clicker optimistic update on ack error', () => {
        state.playerTeam = 'red';
        state.clickerTeam = null;

        setClicker('blue');

        const ackCallback = mockSetTeamRole.mock.calls[0][2];
        ackCallback({ error: { message: 'Role conflict' } });

        expect(state.playerTeam).toBe('red');
        expect(state.clickerTeam).toBeNull();
        expect(state.roleChange.phase).toBe('idle');
    });
});
