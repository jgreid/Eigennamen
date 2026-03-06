/**
 * Frontend Setup Screen Tests
 *
 * Tests exports from src/frontend/setupScreen.ts:
 * shouldShowSetupScreen, showSetupScreen, hideSetupScreen,
 * initSetupScreen, handleSetupAction.
 * Test environment: jsdom
 */

jest.mock('../../frontend/state', () => ({
    state: {
        currentRoomId: null,
        isMultiplayerMode: false,
        teamNames: { red: 'Red', blue: 'Blue' },
    },
}));

jest.mock('../../frontend/constants', () => ({
    validateNickname: jest.fn((nickname) => {
        if (!nickname || nickname.length < 1) return { valid: false, error: 'Nickname is required' };
        return { valid: true, error: null };
    }),
    validateRoomCode: jest.fn((code) => {
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
    isClientConnected: jest.fn(() => false),
}));

import {
    shouldShowSetupScreen,
    showSetupScreen,
    hideSetupScreen,
    initSetupScreen,
    handleSetupAction,
} from '../../frontend/setupScreen';
import { getRoomCodeFromURL } from '../../frontend/multiplayerSync';
import { loadGameFromURL } from '../../frontend/game';

function setupDOM(): void {
    document.body.innerHTML = `
        <div class="setup-screen" id="setup-screen" hidden>
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

/** Helper to set URL search params in jsdom */
function setURL(search: string): void {
    const url = new URL(`http://localhost/${search}`);
    window.history.replaceState({}, '', url.toString());
}

beforeEach(() => {
    setupDOM();
    jest.clearAllMocks();
    setURL('');
});

describe('shouldShowSetupScreen', () => {
    it('returns true when no URL params', () => {
        (getRoomCodeFromURL as jest.Mock).mockReturnValue(null);
        expect(shouldShowSetupScreen()).toBe(true);
    });

    it('returns false when game param in URL', () => {
        setURL('?game=abc');
        expect(shouldShowSetupScreen()).toBe(false);
    });

    it('returns false when room code in URL', () => {
        setURL('?room=my-room');
        (getRoomCodeFromURL as jest.Mock).mockReturnValue('my-room');
        expect(shouldShowSetupScreen()).toBe(false);
    });

    it('returns false when replay param in URL', () => {
        setURL('?replay=xyz');
        expect(shouldShowSetupScreen()).toBe(false);
    });

    it('returns false when standalone params in URL', () => {
        setURL('?r=abc&t=red&w=hello');
        expect(shouldShowSetupScreen()).toBe(false);
    });
});

describe('showSetupScreen / hideSetupScreen', () => {
    it('shows setup screen and hides app layout', () => {
        showSetupScreen();
        expect(document.getElementById('setup-screen')!.hidden).toBe(false);
        expect(document.getElementById('app-layout')!.hidden).toBe(true);
    });

    it('hides setup screen and shows app layout', () => {
        showSetupScreen();
        hideSetupScreen();
        expect(document.getElementById('setup-screen')!.hidden).toBe(true);
        expect(document.getElementById('app-layout')!.hidden).toBe(false);
    });
});

describe('handleSetupAction', () => {
    it('shows join form when setup-join action', () => {
        handleSetupAction('setup-join');
        expect(document.getElementById('setup-board')!.hidden).toBe(true);
        expect(document.getElementById('setup-join-form')!.hidden).toBe(false);
        expect(document.getElementById('setup-host-form')!.hidden).toBe(true);
    });

    it('shows host form when setup-host action', () => {
        handleSetupAction('setup-host');
        expect(document.getElementById('setup-board')!.hidden).toBe(true);
        expect(document.getElementById('setup-join-form')!.hidden).toBe(true);
        expect(document.getElementById('setup-host-form')!.hidden).toBe(false);
    });

    it('shows board when setup-back action', () => {
        handleSetupAction('setup-join');
        handleSetupAction('setup-back');
        expect(document.getElementById('setup-board')!.hidden).toBe(false);
        expect(document.getElementById('setup-join-form')!.hidden).toBe(true);
        expect(document.getElementById('setup-host-form')!.hidden).toBe(true);
    });

    it('hides setup screen and loads game when setup-offline', () => {
        showSetupScreen();
        handleSetupAction('setup-offline');
        expect(document.getElementById('setup-screen')!.hidden).toBe(true);
        expect(document.getElementById('app-layout')!.hidden).toBe(false);
        expect(loadGameFromURL).toHaveBeenCalled();
    });
});

describe('initSetupScreen', () => {
    it('wires up timer toggle', () => {
        initSetupScreen();
        const toggle = document.getElementById('setup-turn-timer-toggle') as HTMLInputElement;
        const slider = document.getElementById('setup-turn-timer-slider')!;
        expect(slider.hidden).toBe(true);
        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        expect(slider.hidden).toBe(false);
    });

    it('wires up timer range display', () => {
        initSetupScreen();
        const range = document.getElementById('setup-turn-timer-range') as HTMLInputElement;
        const value = document.getElementById('setup-turn-timer-value')!;
        range.value = '60';
        range.dispatchEvent(new Event('input'));
        expect(value.textContent).toBe('60s');
    });
});
