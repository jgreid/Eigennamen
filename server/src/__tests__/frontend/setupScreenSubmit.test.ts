/**
 * Setup Screen Form Submission Tests
 *
 * Tests handleJoinSubmit, handleHostSubmit, setFieldError, setStatus,
 * and Enter-key form submission via initSetupScreen + handleSetupAction.
 */

// --- Global mock for EigennamenClient (must be before imports) ---
const mockConnect = jest.fn().mockResolvedValue(undefined);
const mockJoinRoom = jest.fn();
const mockCreateRoom = jest.fn();
const mockUpdateSettings = jest.fn();
const mockIsConnected = jest.fn(() => false);
(globalThis as Record<string, unknown>).EigennamenClient = {
    connect: mockConnect,
    joinRoom: mockJoinRoom,
    createRoom: mockCreateRoom,
    updateSettings: mockUpdateSettings,
    isConnected: mockIsConnected,
    isInRoom: jest.fn(() => true),
    getRoomCode: jest.fn(() => 'test-room'),
};

jest.mock('../../frontend/state', () => ({
    state: {
        currentRoomId: null,
        isMultiplayerMode: false,
        teamNames: { red: 'Red', blue: 'Blue' },
    },
}));

jest.mock('../../frontend/constants', () => ({
    validateNickname: jest.fn((nickname: string) => {
        if (!nickname || nickname.length < 1) return { valid: false, error: 'Nickname is required' };
        if (nickname.length > 20) return { valid: false, error: 'Nickname too long' };
        return { valid: true, error: null };
    }),
    validateRoomCode: jest.fn((code: string) => {
        if (!code || code.length < 3) return { valid: false, error: 'Room ID must be at least 3 characters' };
        return { valid: true, error: null };
    }),
}));

jest.mock('../../frontend/utils', () => ({
    safeGetItem: jest.fn(() => ''),
    safeSetItem: jest.fn(),
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn(), info: jest.fn() },
}));

jest.mock('../../frontend/multiplayerListeners', () => ({
    setupMultiplayerListeners: jest.fn(),
}));

jest.mock('../../frontend/multiplayer', () => ({
    onMultiplayerJoined: jest.fn(),
}));

jest.mock('../../frontend/multiplayerSync', () => ({
    getRoomCodeFromURL: jest.fn(() => null),
}));

jest.mock('../../frontend/game', () => ({
    loadGameFromURL: jest.fn(),
}));

jest.mock('../../frontend/clientAccessor', () => ({
    isClientConnected: jest.fn(() => true),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

import { handleSetupAction, initSetupScreen } from '../../frontend/setupScreen';
import { state } from '../../frontend/state';
import { safeSetItem } from '../../frontend/utils';
import { setupMultiplayerListeners } from '../../frontend/multiplayerListeners';
import { onMultiplayerJoined } from '../../frontend/multiplayer';

function setupDOM(): void {
    document.body.innerHTML = `
        <div class="setup-screen" id="setup-screen">
            <div class="setup-board" id="setup-board"></div>
            <div class="setup-form" id="setup-join-form" hidden>
                <div class="setup-form-group">
                    <input type="text" id="setup-join-nickname" />
                    <span class="error-text" id="setup-join-nickname-error"></span>
                </div>
                <div class="setup-form-group">
                    <input type="text" id="setup-join-room-id" />
                    <span class="error-text" id="setup-join-error"></span>
                </div>
                <div class="connection-status" id="setup-join-status"></div>
                <button id="setup-join-btn"></button>
            </div>
            <div class="setup-form" id="setup-host-form" hidden>
                <div class="setup-form-group">
                    <input type="text" id="setup-host-nickname" />
                    <span class="error-text" id="setup-host-nickname-error"></span>
                </div>
                <div class="setup-form-group">
                    <input type="text" id="setup-host-room-id" />
                    <span class="error-text" id="setup-host-error"></span>
                </div>
                <input type="text" id="setup-red-name" />
                <input type="text" id="setup-blue-name" />
                <input type="radio" name="setup-gameMode" value="match" checked />
                <input type="checkbox" id="setup-turn-timer-toggle" />
                <div id="setup-turn-timer-slider" hidden>
                    <input type="range" id="setup-turn-timer-range" value="120" />
                    <span id="setup-turn-timer-value">120s</span>
                </div>
                <div class="connection-status" id="setup-host-status"></div>
                <button id="setup-host-btn"></button>
            </div>
        </div>
        <div class="app-layout" id="app-layout" hidden></div>
    `;
}

beforeEach(() => {
    setupDOM();
    jest.clearAllMocks();
    mockIsConnected.mockReturnValue(false);
    state.currentRoomId = null;
    (state as Record<string, unknown>).teamNames = { red: 'Red', blue: 'Blue' };
});

// ========== JOIN FORM SUBMISSION ==========

describe('handleSetupAction("setup-join-submit")', () => {
    function fillJoinForm(nickname: string, roomId: string): void {
        (document.getElementById('setup-join-nickname') as HTMLInputElement).value = nickname;
        (document.getElementById('setup-join-room-id') as HTMLInputElement).value = roomId;
    }

    test('shows validation error for empty nickname', async () => {
        fillJoinForm('', 'my-room');
        handleSetupAction('setup-join-submit');
        // Allow microtask to resolve
        await Promise.resolve();

        const error = document.getElementById('setup-join-nickname-error')!;
        expect(error.textContent).toBe('Nickname is required');
    });

    test('shows validation error for short room code', async () => {
        fillJoinForm('Player1', 'ab');
        handleSetupAction('setup-join-submit');
        await Promise.resolve();

        const error = document.getElementById('setup-join-error')!;
        expect(error.textContent).toBe('Room ID must be at least 3 characters');
    });

    test('successful join connects, saves nickname, and hides setup screen', async () => {
        const mockResult = {
            room: { code: 'my-room' },
            player: { sessionId: 's1', nickname: 'Player1' },
        };
        mockJoinRoom.mockResolvedValue(mockResult);

        fillJoinForm('Player1', 'my-room');
        handleSetupAction('setup-join-submit');
        // Wait for async operations
        await new Promise((r) => setTimeout(r, 10));

        expect(mockConnect).toHaveBeenCalled();
        expect(setupMultiplayerListeners).toHaveBeenCalled();
        expect(mockJoinRoom).toHaveBeenCalledWith('my-room', 'Player1');
        expect(safeSetItem).toHaveBeenCalledWith('eigennamen-nickname', 'Player1');
        expect(state.currentRoomId).toBe('my-room');
        expect(document.getElementById('setup-screen')!.hidden).toBe(true);
        expect(onMultiplayerJoined).toHaveBeenCalledWith(mockResult, false);
    });

    test('disables button during submission and re-enables after', async () => {
        mockJoinRoom.mockResolvedValue({ room: { code: 'test' } });

        fillJoinForm('Player1', 'test-room');
        const btn = document.getElementById('setup-join-btn') as HTMLButtonElement;

        handleSetupAction('setup-join-submit');
        // Button should be disabled during async operation
        expect(btn.disabled).toBe(true);
        expect(btn.classList.contains('loading')).toBe(true);

        await new Promise((r) => setTimeout(r, 10));

        expect(btn.disabled).toBe(false);
        expect(btn.classList.contains('loading')).toBe(false);
    });

    test('shows ROOM_NOT_FOUND error', async () => {
        mockJoinRoom.mockRejectedValue({ code: 'ROOM_NOT_FOUND' });

        fillJoinForm('Player1', 'nonexistent');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-join-status')!;
        expect(status.textContent).toContain('multiplayer.roomNotFoundDetail');
        expect(status.classList.contains('error')).toBe(true);
    });

    test('shows ROOM_FULL error', async () => {
        mockJoinRoom.mockRejectedValue({ code: 'ROOM_FULL' });

        fillJoinForm('Player1', 'full-room');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-join-status')!;
        expect(status.textContent).toContain('errors.roomFull');
    });

    test('shows connection error', async () => {
        mockJoinRoom.mockRejectedValue({ message: 'Failed to connect to server' });

        fillJoinForm('Player1', 'my-room');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-join-status')!;
        expect(status.textContent).toContain('connect');
    });

    test('shows generic error message as fallback', async () => {
        mockJoinRoom.mockRejectedValue({ message: 'Something unexpected' });

        fillJoinForm('Player1', 'my-room');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-join-status')!;
        expect(status.textContent).toBe('Something unexpected');
    });

    test('skips connect() when already connected', async () => {
        mockIsConnected.mockReturnValue(true);
        mockJoinRoom.mockResolvedValue({ room: { code: 'r' } });

        fillJoinForm('Player1', 'my-room');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(mockConnect).not.toHaveBeenCalled();
    });

    test('normalizes room ID to lower case', async () => {
        mockJoinRoom.mockResolvedValue({ room: { code: 'my-room' } });

        fillJoinForm('Player1', 'MY-ROOM');
        handleSetupAction('setup-join-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(mockJoinRoom).toHaveBeenCalledWith('my-room', 'Player1');
    });
});

// ========== HOST FORM SUBMISSION ==========

describe('handleSetupAction("setup-host-submit")', () => {
    function fillHostForm(nickname: string, roomId: string, opts?: { redName?: string; blueName?: string }): void {
        (document.getElementById('setup-host-nickname') as HTMLInputElement).value = nickname;
        (document.getElementById('setup-host-room-id') as HTMLInputElement).value = roomId;
        if (opts?.redName) (document.getElementById('setup-red-name') as HTMLInputElement).value = opts.redName;
        if (opts?.blueName) (document.getElementById('setup-blue-name') as HTMLInputElement).value = opts.blueName;
    }

    test('shows validation error for empty nickname', async () => {
        fillHostForm('', 'my-room');
        handleSetupAction('setup-host-submit');
        await Promise.resolve();

        expect(document.getElementById('setup-host-nickname-error')!.textContent).toBe('Nickname is required');
    });

    test('shows validation error for short room code', async () => {
        fillHostForm('Host1', 'ab');
        handleSetupAction('setup-host-submit');
        await Promise.resolve();

        expect(document.getElementById('setup-host-error')!.textContent).toBe('Room ID must be at least 3 characters');
    });

    test('successful host creates room with settings', async () => {
        const mockResult = {
            room: { code: 'my-room' },
            player: { sessionId: 's1', nickname: 'Host1', isHost: true },
        };
        mockCreateRoom.mockResolvedValue(mockResult);

        fillHostForm('Host1', 'my-room', { redName: 'Cats', blueName: 'Dogs' });
        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(mockConnect).toHaveBeenCalled();
        expect(setupMultiplayerListeners).toHaveBeenCalled();
        expect(mockCreateRoom).toHaveBeenCalledWith({ roomId: 'my-room', nickname: 'Host1' });
        expect(safeSetItem).toHaveBeenCalledWith('eigennamen-nickname', 'Host1');
        expect(state.teamNames.red).toBe('Cats');
        expect(state.teamNames.blue).toBe('Dogs');
        expect(mockUpdateSettings).toHaveBeenCalledWith(
            expect.objectContaining({
                gameMode: 'match',
                teamNames: { red: 'Cats', blue: 'Dogs' },
            })
        );
        expect(onMultiplayerJoined).toHaveBeenCalledWith(mockResult, true);
    });

    test('defaults team names to Red/Blue when empty', async () => {
        mockCreateRoom.mockResolvedValue({ room: { code: 'r' } });

        fillHostForm('Host1', 'my-room');
        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(state.teamNames.red).toBe('Red');
        expect(state.teamNames.blue).toBe('Blue');
    });

    test('sends timer settings when timer is enabled', async () => {
        mockCreateRoom.mockResolvedValue({ room: { code: 'r' } });

        fillHostForm('Host1', 'my-room');
        const toggle = document.getElementById('setup-turn-timer-toggle') as HTMLInputElement;
        toggle.checked = true;
        const range = document.getElementById('setup-turn-timer-range') as HTMLInputElement;
        range.value = '90';

        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ timerSeconds: 90 }));
    });

    test('does not send timerSeconds when timer is off', async () => {
        mockCreateRoom.mockResolvedValue({ room: { code: 'r' } });

        fillHostForm('Host1', 'my-room');
        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        expect(mockUpdateSettings).toHaveBeenCalledWith(expect.objectContaining({ timerSeconds: undefined }));
    });

    test('shows ROOM_ALREADY_EXISTS error', async () => {
        mockCreateRoom.mockRejectedValue({ code: 'ROOM_ALREADY_EXISTS' });

        fillHostForm('Host1', 'existing');
        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-host-status')!;
        expect(status.textContent).toContain('multiplayer.roomAlreadyExists');
    });

    test('shows connection error for host', async () => {
        mockCreateRoom.mockRejectedValue({ message: 'Unable to connect' });

        fillHostForm('Host1', 'my-room');
        handleSetupAction('setup-host-submit');
        await new Promise((r) => setTimeout(r, 10));

        const status = document.getElementById('setup-host-status')!;
        expect(status.textContent).toContain('connect');
    });

    test('disables button during submission and re-enables on error', async () => {
        mockCreateRoom.mockRejectedValue({ message: 'Error' });

        fillHostForm('Host1', 'my-room');
        const btn = document.getElementById('setup-host-btn') as HTMLButtonElement;

        handleSetupAction('setup-host-submit');
        expect(btn.disabled).toBe(true);

        await new Promise((r) => setTimeout(r, 10));
        expect(btn.disabled).toBe(false);
    });
});

// ========== ENTER KEY SUBMISSION ==========

describe('initSetupScreen enter key handlers', () => {
    test('pressing Enter in join nickname field triggers join submit', async () => {
        mockJoinRoom.mockResolvedValue({ room: { code: 'r' } });
        initSetupScreen();

        const nickInput = document.getElementById('setup-join-nickname') as HTMLInputElement;
        nickInput.value = 'Player1';
        (document.getElementById('setup-join-room-id') as HTMLInputElement).value = 'my-room';

        nickInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 10));

        // Validation ran (join was attempted)
        expect(mockConnect).toHaveBeenCalled();
    });

    test('pressing Enter in host room-id field triggers host submit', async () => {
        mockCreateRoom.mockResolvedValue({ room: { code: 'r' } });
        initSetupScreen();

        (document.getElementById('setup-host-nickname') as HTMLInputElement).value = 'Host1';
        const roomInput = document.getElementById('setup-host-room-id') as HTMLInputElement;
        roomInput.value = 'my-room';

        roomInput.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', bubbles: true }));
        await new Promise((r) => setTimeout(r, 10));

        expect(mockConnect).toHaveBeenCalled();
    });

    test('non-Enter key does not trigger submit', () => {
        initSetupScreen();

        (document.getElementById('setup-join-nickname') as HTMLInputElement).value = 'Player1';
        (document.getElementById('setup-join-room-id') as HTMLInputElement).value = 'room';

        const input = document.getElementById('setup-join-nickname')!;
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'a', bubbles: true }));

        // No connection attempt
        expect(mockConnect).not.toHaveBeenCalled();
    });
});
