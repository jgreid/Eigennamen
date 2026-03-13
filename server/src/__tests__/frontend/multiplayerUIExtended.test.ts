/**
 * MultiplayerUI Extended Tests
 *
 * Tests nickname editing flow (validation, save, cancel, keyboard shortcuts),
 * copyRoomId, and reconnection overlay with timeout.
 */

const mockSetNickname = jest.fn();
const mockCopyToClipboard = jest.fn();
(globalThis as Record<string, unknown>).EigennamenClient = {
    setNickname: mockSetNickname,
    player: { sessionId: 's1', nickname: 'OldName', isHost: false },
    getRoomCode: jest.fn(() => 'TEST'),
};

jest.mock('../../frontend/state', () => ({
    state: {
        currentRoomId: 'test-room',
        isMultiplayerMode: true,
        multiplayerPlayers: [],
        gameState: { gameOver: false },
    },
}));

jest.mock('../../frontend/utils', () => ({
    escapeHTML: (s: string) => s,
    copyToClipboard: (...args: unknown[]) => mockCopyToClipboard(...args),
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
}));

jest.mock('../../frontend/constants', () => ({
    VALIDATION: { NICKNAME_MIN_LENGTH: 1, NICKNAME_MAX_LENGTH: 20 },
    UI: { RECONNECTION_TIMEOUT_MS: 15000 },
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

jest.mock('../../frontend/chat', () => ({
    showChatPanel: jest.fn(),
    hideChatPanel: jest.fn(),
    initChat: jest.fn(),
}));

jest.mock('../../frontend/clientAccessor', () => ({
    getClient: () => ({
        player: { sessionId: 's1', nickname: 'OldName', isHost: false },
    }),
    isClientConnected: jest.fn(() => true),
}));

import {
    copyRoomId,
    initNicknameEditUI,
    showReconnectionOverlay,
    hideReconnectionOverlay,
} from '../../frontend/multiplayerUI';
import { state } from '../../frontend/state';
import { showToast } from '../../frontend/ui';

function setupDOM(): void {
    document.body.innerHTML = `
        <div id="mp-indicator"></div>
        <span id="mp-room-code"></span>
        <span id="mp-player-count"></span>
        <div id="mp-player-list"><ul id="mp-players-ul"></ul></div>
        <button id="btn-copy-room-id"></button>
        <button id="btn-edit-nickname">Edit</button>
        <div id="nickname-edit-form" hidden>
            <input type="text" id="nickname-edit-input" />
            <button id="btn-nickname-save">Save</button>
            <button id="btn-nickname-cancel">Cancel</button>
        </div>
        <div id="reconnection-overlay" hidden></div>
    `;
}

beforeEach(() => {
    jest.useFakeTimers();
    setupDOM();
    jest.clearAllMocks();
    state.currentRoomId = 'test-room';
});

afterEach(() => {
    jest.useRealTimers();
});

// ========== COPY ROOM ID ==========

describe('copyRoomId', () => {
    test('copies room ID to clipboard and shows success toast', async () => {
        mockCopyToClipboard.mockResolvedValue(true);

        await copyRoomId();

        expect(mockCopyToClipboard).toHaveBeenCalledWith('test-room');
        expect(showToast).toHaveBeenCalledWith('toast.roomIdCopied', 'success', 2000);
    });

    test('adds and removes "copied" class on button', async () => {
        mockCopyToClipboard.mockResolvedValue(true);

        await copyRoomId();

        const btn = document.getElementById('btn-copy-room-id')!;
        expect(btn.classList.contains('copied')).toBe(true);

        jest.advanceTimersByTime(1000);
        expect(btn.classList.contains('copied')).toBe(false);
    });

    test('shows error toast when copy fails', async () => {
        mockCopyToClipboard.mockResolvedValue(false);

        await copyRoomId();

        expect(showToast).toHaveBeenCalledWith('toast.failedToCopyShort', 'error', 2000);
    });

    test('does nothing when no current room ID', async () => {
        state.currentRoomId = null as unknown as string;

        await copyRoomId();

        expect(mockCopyToClipboard).not.toHaveBeenCalled();
    });
});

// ========== NICKNAME EDIT UI ==========

describe('initNicknameEditUI', () => {
    test('clicking edit button shows form and hides edit button', () => {
        initNicknameEditUI();

        const editBtn = document.getElementById('btn-edit-nickname')!;
        editBtn.click();

        const form = document.getElementById('nickname-edit-form')!;
        expect(form.hidden).toBe(false);
        expect(editBtn.hidden).toBe(true);
    });

    test('clicking edit pre-fills input with current nickname', () => {
        initNicknameEditUI();

        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        expect(input.value).toBe('OldName');
    });

    test('clicking save with valid name calls setNickname and persists', () => {
        initNicknameEditUI();

        // Open form
        document.getElementById('btn-edit-nickname')!.click();

        // Type new name
        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = 'NewName';

        // Save
        document.getElementById('btn-nickname-save')!.click();

        expect(mockSetNickname).toHaveBeenCalledWith('NewName');
        expect(showToast).toHaveBeenCalledWith('multiplayer.nicknameUpdated', 'success', 2000);
    });

    test('save stores nickname in localStorage', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = 'SavedName';

        const setItemSpy = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {});
        document.getElementById('btn-nickname-save')!.click();

        expect(setItemSpy).toHaveBeenCalledWith('eigennamen-nickname', 'SavedName');
        setItemSpy.mockRestore();
    });

    test('save rejects empty nickname', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = '';

        document.getElementById('btn-nickname-save')!.click();

        expect(mockSetNickname).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('multiplayer.nicknameLength', 'warning');
    });

    test('save rejects nickname with special characters', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = 'Bad<Script>';

        document.getElementById('btn-nickname-save')!.click();

        expect(mockSetNickname).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('multiplayer.nicknameCharsOnly', 'warning');
    });

    test('clicking cancel hides form and shows edit button', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        document.getElementById('btn-nickname-cancel')!.click();

        const form = document.getElementById('nickname-edit-form')!;
        const editBtn = document.getElementById('btn-edit-nickname')!;
        expect(form.hidden).toBe(true);
        expect(editBtn.hidden).toBe(false);
    });

    test('Enter key in input saves nickname', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = 'EnterName';

        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(mockSetNickname).toHaveBeenCalledWith('EnterName');
    });

    test('Escape key in input cancels edit', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

        const form = document.getElementById('nickname-edit-form')!;
        expect(form.hidden).toBe(true);
    });

    test('save rejects nickname exceeding max length', () => {
        initNicknameEditUI();
        document.getElementById('btn-edit-nickname')!.click();

        const input = document.getElementById('nickname-edit-input') as HTMLInputElement;
        input.value = 'A'.repeat(25);

        document.getElementById('btn-nickname-save')!.click();

        expect(mockSetNickname).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('multiplayer.nicknameLength', 'warning');
    });
});

// ========== RECONNECTION OVERLAY ==========

describe('reconnection overlay', () => {
    test('showReconnectionOverlay makes overlay visible', () => {
        showReconnectionOverlay();

        const overlay = document.getElementById('reconnection-overlay')!;
        expect(overlay.hidden).toBe(false);
    });

    test('hideReconnectionOverlay hides overlay', () => {
        showReconnectionOverlay();
        hideReconnectionOverlay();

        const overlay = document.getElementById('reconnection-overlay')!;
        expect(overlay.hidden).toBe(true);
    });

    test('timeout hides overlay after 15 seconds and shows error toast', () => {
        showReconnectionOverlay();

        jest.advanceTimersByTime(15_000);

        const overlay = document.getElementById('reconnection-overlay')!;
        expect(overlay.hidden).toBe(true);
        expect(showToast).toHaveBeenCalledWith('multiplayer.reconnectionFailed', 'error', 8000);
    });

    test('manual hide clears timeout (no double-hide or toast)', () => {
        showReconnectionOverlay();
        hideReconnectionOverlay();

        jest.advanceTimersByTime(15_000);

        // Toast should NOT be called since we hid manually
        expect(showToast).not.toHaveBeenCalled();
    });

    test('calling show twice resets timeout', () => {
        showReconnectionOverlay();
        jest.advanceTimersByTime(10_000);

        // Show again (resets the 15s timer)
        showReconnectionOverlay();
        jest.advanceTimersByTime(10_000);

        // Only 10s into the reset — should still be visible
        const overlay = document.getElementById('reconnection-overlay')!;
        expect(overlay.hidden).toBe(false);

        jest.advanceTimersByTime(5_000);
        // Now 15s — should be hidden
        expect(overlay.hidden).toBe(true);
    });
});
