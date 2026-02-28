/**
 * Frontend Multiplayer Module Tests
 *
 * Tests exports from src/frontend/multiplayer.ts:
 * openMultiplayer, closeMultiplayer, setMpMode, setMpStatus,
 * setFieldError, clearFormErrors, handleMpAction,
 * onMultiplayerJoined, initMultiplayerModal,
 * cancelJoinOperation, cancelCreateOperation, cancelAllOperations.
 * Test environment: jsdom
 */

const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
    showToast: mockShowToast
}));

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: false,
        multiplayerPlayers: [],
        currentMpMode: 'join',
        currentRoomId: null,
        isHost: false,
        boardInitialized: false,
        gameState: { gameOver: false, status: 'waiting' },
        multiplayerListenersSetup: false,
        spymasterTeam: null,
        clickerTeam: null,
        playerTeam: null,
        roleChange: { phase: 'idle' },
        revealingCards: new Set(),
        revealTimeouts: new Map(),
        pendingRevealRAF: null,
        isRevealingCard: false
    }
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key) => {
        const map: Record<string, string> = {
            'multiplayer.joinGame': 'Join Game',
            'multiplayer.createGame': 'Create Game',
            'multiplayer.joining': 'Joining...',
            'multiplayer.creating': 'Creating...',
            'multiplayer.connecting': 'Connecting...',
            'multiplayer.connected': 'Connected',
            'multiplayer.joiningGame': 'Joining game...',
            'multiplayer.creatingGame': 'Creating game...',
            'multiplayer.gameCreatedShare': 'Game created!',
            'multiplayer.connectedToGame': 'Connected to game'
        };
        return map[key] || key;
    })
}));

jest.mock('../../frontend/utils', () => ({
    safeGetItem: jest.fn(() => ''),
    safeSetItem: jest.fn()
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() }
}));

jest.mock('../../frontend/roles', () => ({
    updateRoleBanner: jest.fn(),
    updateControls: jest.fn()
}));

jest.mock('../../frontend/constants', () => ({
    UI: { MP_JOIN_CLOSE_DELAY_MS: 500 },
    validateNickname: jest.fn((nickname) => {
        if (!nickname || nickname.length < 2) return { valid: false, error: 'Too short' };
        return { valid: true, error: null };
    }),
    validateRoomCode: jest.fn((code) => {
        if (!code || code.length < 3) return { valid: false, error: 'Too short' };
        return { valid: true, error: null };
    })
}));

jest.mock('../../frontend/multiplayerUI', () => ({
    updateMpIndicator: jest.fn(),
    updateRoomSettingsNavVisibility: jest.fn(),
    updateForfeitButton: jest.fn(),
    copyRoomId: jest.fn(),
    initPlayerListUI: jest.fn(),
    initNicknameEditUI: jest.fn(),
    confirmForfeit: jest.fn(),
    closeForfeitConfirm: jest.fn(),
    forfeitGame: jest.fn(),
    closeKickConfirm: jest.fn(),
    confirmKickPlayer: jest.fn()
}));

jest.mock('../../frontend/multiplayerSync', () => ({
    syncLocalPlayerState: jest.fn(),
    syncGameStateFromServer: jest.fn(),
    resetMultiplayerState: jest.fn(),
    getRoomCodeFromURL: jest.fn(() => null),
    updateURLWithRoomCode: jest.fn(),
    leaveMultiplayerMode: jest.fn(),
    cleanupMultiplayerListeners: jest.fn(),
    clearRoomCodeFromURL: jest.fn()
}));

jest.mock('../../frontend/stateMutations', () => ({
    resetGameState: jest.fn()
}));

jest.mock('../../frontend/board', () => ({
    renderBoard: jest.fn()
}));

jest.mock('../../frontend/game', () => ({
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn()
}));

jest.mock('../../frontend/multiplayerListeners', () => ({
    setupMultiplayerListeners: jest.fn()
}));

jest.mock('../../frontend/clientAccessor', () => ({
    isClientConnected: jest.fn(() => true)
}));

// Mock EigennamenClient global
(global as any).EigennamenClient = {
    player: { sessionId: 'session1', isHost: false, nickname: 'Test' },
    isConnected: jest.fn(() => false),
    connect: jest.fn().mockResolvedValue(undefined),
    joinRoom: jest.fn().mockResolvedValue({ room: { code: 'TESTROOM' }, players: [] }),
    createRoom: jest.fn().mockResolvedValue({ room: { code: 'NEWROOM' }, players: [] }),
    startGame: jest.fn()
};

import {
    openMultiplayer, closeMultiplayer, setMpMode, setMpStatus,
    setFieldError, clearFormErrors, onMultiplayerJoined,
    cancelJoinOperation, cancelCreateOperation, cancelAllOperations,
    handleMpAction, initMultiplayerModal, checkURLForRoomJoin
} from '../../frontend/multiplayer';
import { state } from '../../frontend/state';

describe('multiplayer module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        jest.useFakeTimers();
        state.isMultiplayerMode = false;
        state.currentMpMode = 'join';
        state.currentRoomId = null;
        state.isHost = false;
        state.multiplayerPlayers = [];
        document.body.innerHTML = '';
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    describe('openMultiplayer', () => {
        test('opens multiplayer modal', () => {
            setupMultiplayerDOM();
            openMultiplayer();
            expect(mockOpenModal).toHaveBeenCalledWith('multiplayer-modal');
        });

        test('resets room ID input fields', () => {
            setupMultiplayerDOM();
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'OLD';
            (document.getElementById('create-room-id') as HTMLInputElement).value = 'OLD';

            openMultiplayer();

            expect((document.getElementById('join-room-id') as HTMLInputElement).value).toBe('');
            expect((document.getElementById('create-room-id') as HTMLInputElement).value).toBe('');
        });

        test('resets to join mode', () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';

            openMultiplayer();

            expect(state.currentMpMode).toBe('join');
        });
    });

    describe('closeMultiplayer', () => {
        test('closes multiplayer modal', () => {
            closeMultiplayer();
            expect(mockCloseModal).toHaveBeenCalledWith('multiplayer-modal');
        });
    });

    describe('setMpMode', () => {
        test('sets join mode and updates button text', () => {
            setupMultiplayerDOM();
            setMpMode('join');

            expect(state.currentMpMode).toBe('join');
            expect(document.getElementById('join-form')!.classList.contains('active')).toBe(true);
            expect(document.getElementById('create-form')!.classList.contains('active')).toBe(false);
            expect(document.getElementById('btn-mp-action')!.textContent).toBe('Join Game');
        });

        test('sets create mode and updates button text', () => {
            setupMultiplayerDOM();
            setMpMode('create');

            expect(state.currentMpMode).toBe('create');
            expect(document.getElementById('join-form')!.classList.contains('active')).toBe(false);
            expect(document.getElementById('create-form')!.classList.contains('active')).toBe(true);
            expect(document.getElementById('btn-mp-action')!.textContent).toBe('Create Game');
        });

        test('activates correct mode button', () => {
            setupMultiplayerDOM();
            setMpMode('create');

            const btns = document.querySelectorAll('.mode-btn');
            expect((btns[0] as HTMLElement).classList.contains('active')).toBe(false);
            expect((btns[1] as HTMLElement).classList.contains('active')).toBe(true);
        });
    });

    describe('setMpStatus', () => {
        test('sets status message and type', () => {
            document.body.innerHTML = '<div id="mp-status" class="connection-status"></div>';

            setMpStatus('Connected!', 'success');

            const el = document.getElementById('mp-status')!;
            expect(el.textContent).toBe('Connected!');
            expect(el.classList.contains('success')).toBe(true);
        });

        test('clears status type when empty', () => {
            document.body.innerHTML = '<div id="mp-status" class="connection-status error"></div>';

            setMpStatus('Neutral message', '');

            const el = document.getElementById('mp-status')!;
            expect(el.className).toBe('connection-status');
        });
    });

    describe('setFieldError', () => {
        test('sets error message and adds error class', () => {
            document.body.innerHTML = '<div class="form-group"><span id="join-error"></span></div>';

            setFieldError('Invalid input', 'join-error');

            expect(document.getElementById('join-error')!.textContent).toBe('Invalid input');
            expect(document.querySelector('.form-group')!.classList.contains('error')).toBe(true);
        });

        test('clears error message and removes error class', () => {
            document.body.innerHTML = '<div class="form-group error"><span id="join-error">Old error</span></div>';

            setFieldError('', 'join-error');

            expect(document.getElementById('join-error')!.textContent).toBe('');
            expect(document.querySelector('.form-group')!.classList.contains('error')).toBe(false);
        });
    });

    describe('clearFormErrors', () => {
        test('clears all form error fields', () => {
            document.body.innerHTML = `
                <div class="form-group error"><span id="join-error">E1</span></div>
                <div class="form-group error"><span id="join-nickname-error">E2</span></div>
                <div class="form-group error"><span id="create-error">E3</span></div>
                <div class="form-group error"><span id="create-nickname-error">E4</span></div>
            `;

            clearFormErrors();

            ['join-error', 'join-nickname-error', 'create-error', 'create-nickname-error'].forEach(id => {
                expect(document.getElementById(id)!.textContent).toBe('');
            });
        });
    });

    describe('onMultiplayerJoined', () => {
        test('sets multiplayer mode to true', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'ROOM1' }, players: [] });
            expect(state.isMultiplayerMode).toBe(true);
        });

        test('updates URL with room code', () => {
            setupMultiplayerDOM();
            const { updateURLWithRoomCode } = require('../../frontend/multiplayerSync');
            onMultiplayerJoined({ room: { code: 'MYROOM' }, players: [] });
            expect(updateURLWithRoomCode).toHaveBeenCalledWith('MYROOM');
        });

        test('stores player list', () => {
            setupMultiplayerDOM();
            const players = [
                { sessionId: 's1', nickname: 'Alice', team: 'red', role: null, isHost: true, connected: true }
            ];
            onMultiplayerJoined({ room: { code: 'R' }, players });
            expect(state.multiplayerPlayers).toEqual(players);
        });

        test('sets isHost when host parameter is true', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'R' }, players: [] }, true);
            expect(state.isHost).toBe(true);
        });

        test('auto-starts game when creating as host without existing game', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'R' }, players: [] }, true);
            expect((global as any).EigennamenClient.startGame).toHaveBeenCalledWith({});
        });

        test('does not auto-start when joining (not host)', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'R' }, players: [] }, false);
            expect((global as any).EigennamenClient.startGame).not.toHaveBeenCalled();
        });

        test('closes multiplayer modal after delay', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'R' }, players: [] });

            jest.advanceTimersByTime(600);

            expect(mockCloseModal).toHaveBeenCalledWith('multiplayer-modal');
        });
    });

    describe('cancelJoinOperation', () => {
        test('does not throw when no operation is pending', () => {
            expect(() => cancelJoinOperation()).not.toThrow();
        });
    });

    describe('cancelCreateOperation', () => {
        test('does not throw when no operation is pending', () => {
            expect(() => cancelCreateOperation()).not.toThrow();
        });
    });

    describe('cancelAllOperations', () => {
        test('does not throw when no operations are pending', () => {
            expect(() => cancelAllOperations()).not.toThrow();
        });
    });

    describe('handleMpAction', () => {
        test('returns early when no action button exists', async () => {
            document.body.innerHTML = '';
            await handleMpAction();
            // Should not throw
        });

        test('disables button and shows loading state during join', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            // Set valid nickname and room code
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'TESTROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockResolvedValue({
                room: { code: 'TESTROOM' }, players: []
            });

            await handleMpAction();

            const btn = document.getElementById('btn-mp-action') as HTMLButtonElement;
            expect(btn.disabled).toBe(false); // Re-enabled after completion
            expect(btn.classList.contains('loading')).toBe(false);
        });

        test('handles join validation errors (short nickname)', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'A'; // Too short
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'TESTROOM';

            await handleMpAction();

            expect(document.getElementById('join-nickname-error')!.textContent).toBe('Too short');
        });

        test('handles join validation errors (short room code)', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'AB'; // Too short

            await handleMpAction();

            expect(document.getElementById('join-error')!.textContent).toBe('Too short');
        });

        test('handles create mode action', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';
            (document.getElementById('create-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('create-room-id') as HTMLInputElement).value = 'NEWROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.createRoom.mockResolvedValue({
                room: { code: 'NEWROOM' }, players: []
            });

            await handleMpAction();

            expect(state.isMultiplayerMode).toBe(true);
        });

        test('handles create validation errors', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';
            (document.getElementById('create-nickname') as HTMLInputElement).value = 'A'; // Too short

            await handleMpAction();

            expect(document.getElementById('create-nickname-error')!.textContent).toBe('Too short');
        });

        test('handles join error ROOM_NOT_FOUND by switching to create mode', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'MISSING';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockRejectedValue({
                code: 'ROOM_NOT_FOUND', message: 'Room not found'
            });

            await handleMpAction();

            expect(state.currentMpMode).toBe('create');
        });

        test('handles join error ROOM_FULL', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'FULLROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockRejectedValue({
                code: 'ROOM_FULL', message: 'Room is full'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.classList.contains('error')).toBe(true);
        });

        test('handles join error INVALID_INPUT', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'BADROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockRejectedValue({
                code: 'INVALID_INPUT', message: 'Invalid room'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.textContent).toBe('Invalid room');
        });

        test('handles join error with connection message', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'TESTROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockRejectedValue({
                message: 'Failed to connect to server'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.classList.contains('error')).toBe(true);
        });

        test('handles join error generic fallback', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'TESTROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.joinRoom.mockRejectedValue({
                message: 'Something weird'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.textContent).toBe('Something weird');
        });

        test('handles create error ROOM_ALREADY_EXISTS', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';
            (document.getElementById('create-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('create-room-id') as HTMLInputElement).value = 'EXISTINGROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.createRoom.mockRejectedValue({
                code: 'ROOM_ALREADY_EXISTS', message: 'Room exists'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.classList.contains('error')).toBe(true);
        });

        test('handles create error with connection message', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';
            (document.getElementById('create-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('create-room-id') as HTMLInputElement).value = 'NEWROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.createRoom.mockRejectedValue({
                message: 'Failed to connect'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.classList.contains('error')).toBe(true);
        });

        test('handles create error generic fallback', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'create';
            (document.getElementById('create-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('create-room-id') as HTMLInputElement).value = 'NEWROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(true);
            (global as any).EigennamenClient.createRoom.mockRejectedValue({
                message: 'Unexpected error'
            });

            await handleMpAction();

            const statusEl = document.getElementById('mp-status')!;
            expect(statusEl.textContent).toBe('Unexpected error');
        });

        test('connects when not already connected', async () => {
            setupMultiplayerDOM();
            state.currentMpMode = 'join';
            (document.getElementById('join-nickname') as HTMLInputElement).value = 'Alice';
            (document.getElementById('join-room-id') as HTMLInputElement).value = 'TESTROOM';
            (global as any).EigennamenClient.isConnected.mockReturnValue(false);
            (global as any).EigennamenClient.connect.mockResolvedValue(undefined);
            (global as any).EigennamenClient.joinRoom.mockResolvedValue({
                room: { code: 'TESTROOM' }, players: []
            });

            await handleMpAction();

            expect((global as any).EigennamenClient.connect).toHaveBeenCalled();
        });
    });

    describe('onMultiplayerJoined (additional paths)', () => {
        test('resets stale state on room change', () => {
            setupMultiplayerDOM();
            const { resetMultiplayerState } = require('../../frontend/multiplayerSync');
            state.currentRoomId = 'OLD_ROOM';
            onMultiplayerJoined({ room: { code: 'NEW_ROOM' }, players: [] });
            expect(resetMultiplayerState).toHaveBeenCalled();
        });

        test('syncs game state when game is present in result', () => {
            setupMultiplayerDOM();
            const { syncGameStateFromServer } = require('../../frontend/multiplayerSync');
            const game = { words: ['A'], types: ['red'], revealed: [false] };
            onMultiplayerJoined({ room: { code: 'R' }, players: [], game });
            expect(syncGameStateFromServer).toHaveBeenCalledWith(game);
        });

        test('shows host toast when isHost', () => {
            setupMultiplayerDOM();
            state.currentRoomId = 'MYROOM';
            onMultiplayerJoined({ room: { code: 'MYROOM' }, players: [] }, true);

            jest.advanceTimersByTime(600);

            expect(mockShowToast).toHaveBeenCalledWith(
                expect.stringContaining('Game created!'),
                'success',
                8000
            );
        });

        test('shows non-host connected toast', () => {
            setupMultiplayerDOM();
            onMultiplayerJoined({ room: { code: 'R' }, players: [] }, false);

            jest.advanceTimersByTime(600);

            expect(mockShowToast).toHaveBeenCalledWith(
                'Connected to game',
                'success'
            );
        });

        test('uses result.you for syncing player state', () => {
            setupMultiplayerDOM();
            const { syncLocalPlayerState } = require('../../frontend/multiplayerSync');
            const you = { sessionId: 's1', nickname: 'Me', team: 'red', role: 'spymaster', isHost: false, connected: true };
            onMultiplayerJoined({ room: { code: 'R' }, players: [], you });
            expect(syncLocalPlayerState).toHaveBeenCalledWith(you);
        });
    });

    describe('initMultiplayerModal', () => {
        test('sets up mode toggle and action button listeners', () => {
            setupMultiplayerDOM();
            // Add a copy button too
            const copyBtn = document.createElement('button');
            copyBtn.id = 'btn-copy-room-id';
            document.body.appendChild(copyBtn);

            initMultiplayerModal();

            // Mode toggle works
            const createBtn = document.querySelector('.mode-btn[data-mode="create"]') as HTMLElement;
            createBtn.click();
            expect(state.currentMpMode).toBe('create');
        });

        test('only initializes once (idempotent)', () => {
            setupMultiplayerDOM();
            const addSpy = jest.spyOn(HTMLElement.prototype, 'addEventListener');
            const callsBefore = addSpy.mock.calls.length;

            initMultiplayerModal(); // second call (first was above)

            // No additional listeners should be added
            expect(addSpy.mock.calls.length).toBe(callsBefore);
            addSpy.mockRestore();
        });
    });

    describe('checkURLForRoomJoin', () => {
        test('opens modal with pre-filled room code from URL', () => {
            setupMultiplayerDOM();
            const { getRoomCodeFromURL } = require('../../frontend/multiplayerSync');
            (getRoomCodeFromURL as jest.Mock).mockReturnValue('URLROOM');

            checkURLForRoomJoin();

            expect(mockOpenModal).toHaveBeenCalledWith('multiplayer-modal');
            expect((document.getElementById('join-room-id') as HTMLInputElement).value).toBe('URLROOM');
        });

        test('does nothing when URL has no room code', () => {
            setupMultiplayerDOM();
            const { getRoomCodeFromURL } = require('../../frontend/multiplayerSync');
            (getRoomCodeFromURL as jest.Mock).mockReturnValue(null);

            checkURLForRoomJoin();

            expect(mockOpenModal).not.toHaveBeenCalled();
        });

        test('does nothing when room code is invalid (too short)', () => {
            setupMultiplayerDOM();
            const { getRoomCodeFromURL } = require('../../frontend/multiplayerSync');
            (getRoomCodeFromURL as jest.Mock).mockReturnValue('AB'); // Too short for validateRoomCode

            checkURLForRoomJoin();

            expect(mockOpenModal).not.toHaveBeenCalled();
        });
    });
});

// Helpers

function setupMultiplayerDOM(): void {
    document.body.innerHTML = `
        <div id="mp-status" class="connection-status"></div>
        <input id="join-nickname" value="" />
        <input id="join-room-id" value="" />
        <input id="create-nickname" value="" />
        <input id="create-room-id" value="" />
        <div id="join-form"></div>
        <div id="create-form"></div>
        <button id="btn-mp-action">Join Game</button>
        <button class="mode-btn" data-mode="join"></button>
        <button class="mode-btn" data-mode="create"></button>
        <div class="form-group"><span id="join-error"></span></div>
        <div class="form-group"><span id="join-nickname-error"></span></div>
        <div class="form-group"><span id="create-error"></span></div>
        <div class="form-group"><span id="create-nickname-error"></span></div>
    `;
}
