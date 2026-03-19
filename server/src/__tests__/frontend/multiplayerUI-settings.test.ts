/**
 * MultiplayerUI-Settings Tests
 *
 * Tests settings visibility, forfeit flow, game mode sync,
 * and turn timer sync for the multiplayer settings UI module.
 */

const mockForfeit = jest.fn();
const mockUpdateSettings = jest.fn();
(globalThis as Record<string, unknown>).EigennamenClient = {
    player: { sessionId: 's1', nickname: 'Host', isHost: true },
    forfeit: mockForfeit,
    updateSettings: mockUpdateSettings,
};

jest.mock('../../frontend/state', () => ({
    state: {
        isMultiplayerMode: true,
        gameState: { gameOver: false },
        gameMode: 'classic',
    },
}));

jest.mock('../../frontend/ui', () => ({
    showToast: jest.fn(),
    openModal: jest.fn(),
    closeModal: jest.fn(),
}));

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
}));

const mockGetClient = jest.fn(() => ({
    player: { sessionId: 's1', nickname: 'Host', isHost: true },
}));
const mockIsClientConnected = jest.fn(() => true);
jest.mock('../../frontend/clientAccessor', () => ({
    getClient: (...args: unknown[]) => mockGetClient(...args),
    isClientConnected: (...args: unknown[]) => mockIsClientConnected(...args),
}));

import { state } from '../../frontend/state';
import { showToast, openModal, closeModal } from '../../frontend/ui';
import {
    updateRoomSettingsNavVisibility,
    syncGameModeUI,
    syncTurnTimerUI,
    confirmForfeit,
    closeForfeitConfirm,
    forfeitGame,
    updateForfeitButton,
} from '../../frontend/multiplayerUI-settings';

function setupDOM() {
    document.body.innerHTML = `
        <div id="settings-game-mode-section" hidden></div>
        <input type="radio" name="gameMode" value="classic" />
        <input type="radio" name="gameMode" value="duet" />
        <input type="radio" name="gameMode" value="match" />
        <input type="checkbox" id="turn-timer-toggle" />
        <div id="turn-timer-slider" hidden></div>
        <input type="range" id="turn-timer-range" value="120" />
        <span id="turn-timer-value"></span>
        <div id="settings-forfeit-section" hidden></div>
    `;
}

beforeEach(() => {
    jest.clearAllMocks();
    setupDOM();
    (state as Record<string, unknown>).isMultiplayerMode = true;
    (state as Record<string, unknown>).gameMode = 'classic';
    (state.gameState as Record<string, unknown>).gameOver = false;
    mockGetClient.mockReturnValue({
        player: { sessionId: 's1', nickname: 'Host', isHost: true },
    });
    mockIsClientConnected.mockReturnValue(true);
    (globalThis as Record<string, unknown>).EigennamenClient = {
        player: { sessionId: 's1', nickname: 'Host', isHost: true },
        forfeit: mockForfeit,
        updateSettings: mockUpdateSettings,
    };
});

describe('updateRoomSettingsNavVisibility', () => {
    test('shows game mode section when multiplayer host', () => {
        updateRoomSettingsNavVisibility();
        const section = document.getElementById('settings-game-mode-section');
        expect(section!.hidden).toBe(false);
    });

    test('hides game mode section when not multiplayer', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        updateRoomSettingsNavVisibility();
        const section = document.getElementById('settings-game-mode-section');
        expect(section!.hidden).toBe(true);
    });

    test('hides game mode section when not host', () => {
        mockGetClient.mockReturnValue({
            player: { sessionId: 's1', isHost: false },
        });
        updateRoomSettingsNavVisibility();
        const section = document.getElementById('settings-game-mode-section');
        expect(section!.hidden).toBe(true);
    });
});

describe('syncGameModeUI', () => {
    test('selects the correct radio button for a given mode', () => {
        syncGameModeUI('duet');
        const radio = document.querySelector('input[name="gameMode"][value="duet"]') as HTMLInputElement;
        expect(radio.checked).toBe(true);
    });

    test('does not throw for empty gameMode', () => {
        expect(() => syncGameModeUI('')).not.toThrow();
    });

    test('handles non-existent game mode gracefully', () => {
        expect(() => syncGameModeUI('nonexistent')).not.toThrow();
    });
});

describe('syncTurnTimerUI', () => {
    test('enables toggle and shows slider when timer > 0', () => {
        syncTurnTimerUI(90);
        const toggle = document.getElementById('turn-timer-toggle') as HTMLInputElement;
        const slider = document.getElementById('turn-timer-slider');
        const range = document.getElementById('turn-timer-range') as HTMLInputElement;
        const value = document.getElementById('turn-timer-value');
        expect(toggle.checked).toBe(true);
        expect(slider!.hidden).toBe(false);
        expect(range.value).toBe('90');
        expect(value!.textContent).toBe('90s');
    });

    test('disables toggle and hides slider when timer is null', () => {
        // First enable it
        syncTurnTimerUI(90);
        // Then disable
        syncTurnTimerUI(null);
        const toggle = document.getElementById('turn-timer-toggle') as HTMLInputElement;
        const slider = document.getElementById('turn-timer-slider');
        expect(toggle.checked).toBe(false);
        expect(slider!.hidden).toBe(true);
    });

    test('disables toggle when timer is 0', () => {
        syncTurnTimerUI(0);
        const toggle = document.getElementById('turn-timer-toggle') as HTMLInputElement;
        expect(toggle.checked).toBe(false);
    });
});

describe('confirmForfeit', () => {
    test('opens modal when valid (multiplayer, host, game active)', () => {
        confirmForfeit();
        expect(openModal).toHaveBeenCalledWith('confirm-forfeit-modal');
    });

    test('shows toast when not multiplayer', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        confirmForfeit();
        expect(showToast).toHaveBeenCalledWith('forfeit.multiplayerOnly', 'warning');
        expect(openModal).not.toHaveBeenCalled();
    });

    test('shows toast when not connected', () => {
        mockIsClientConnected.mockReturnValue(false);
        confirmForfeit();
        expect(showToast).toHaveBeenCalledWith('forfeit.multiplayerOnly', 'warning');
    });

    test('shows toast when not host', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', isHost: false },
            forfeit: mockForfeit,
        };
        confirmForfeit();
        expect(showToast).toHaveBeenCalledWith('forfeit.hostOnly', 'warning');
    });

    test('shows toast when game is already over', () => {
        (state.gameState as Record<string, unknown>).gameOver = true;
        confirmForfeit();
        expect(showToast).toHaveBeenCalledWith('forfeit.gameAlreadyOver', 'info');
    });
});

describe('closeForfeitConfirm', () => {
    test('calls closeModal with correct ID', () => {
        closeForfeitConfirm();
        expect(closeModal).toHaveBeenCalledWith('confirm-forfeit-modal');
    });
});

describe('forfeitGame', () => {
    test('calls EigennamenClient.forfeit with team when valid', () => {
        forfeitGame('red');
        expect(mockForfeit).toHaveBeenCalledWith('red');
    });

    test('does not forfeit when not multiplayer', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        forfeitGame('red');
        expect(mockForfeit).not.toHaveBeenCalled();
    });

    test('does not forfeit when not connected', () => {
        mockIsClientConnected.mockReturnValue(false);
        forfeitGame('red');
        expect(mockForfeit).not.toHaveBeenCalled();
    });

    test('shows toast when not host', () => {
        (globalThis as Record<string, unknown>).EigennamenClient = {
            player: { sessionId: 's1', isHost: false },
            forfeit: mockForfeit,
        };
        forfeitGame('red');
        expect(showToast).toHaveBeenCalledWith('forfeit.hostOnly', 'warning');
        expect(mockForfeit).not.toHaveBeenCalled();
    });

    test('does not forfeit when game over', () => {
        (state.gameState as Record<string, unknown>).gameOver = true;
        forfeitGame('blue');
        expect(mockForfeit).not.toHaveBeenCalled();
    });
});

describe('updateForfeitButton', () => {
    test('shows forfeit section when host + multiplayer + game active', () => {
        updateForfeitButton();
        const section = document.getElementById('settings-forfeit-section');
        expect(section!.hidden).toBe(false);
    });

    test('hides forfeit section when game over', () => {
        (state.gameState as Record<string, unknown>).gameOver = true;
        updateForfeitButton();
        const section = document.getElementById('settings-forfeit-section');
        expect(section!.hidden).toBe(true);
    });

    test('hides forfeit section when not multiplayer', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        updateForfeitButton();
        const section = document.getElementById('settings-forfeit-section');
        expect(section!.hidden).toBe(true);
    });

    test('hides forfeit section when not host', () => {
        mockGetClient.mockReturnValue({
            player: { sessionId: 's1', isHost: false },
        });
        updateForfeitButton();
        const section = document.getElementById('settings-forfeit-section');
        expect(section!.hidden).toBe(true);
    });
});
