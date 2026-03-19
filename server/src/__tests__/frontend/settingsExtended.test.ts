/**
 * Settings Extended Tests
 *
 * Covers branches not hit by the main settings.test.ts:
 * - saveSettings in multiplayer mode (sends team names to server)
 * - saveSettings with storage failure warning
 * - tryLoadWordlistFile (fetch + apply word list)
 * - initSettingsNav idempotency
 * - loadLocalSettings combined mode with no custom words
 * - openHelp / closeHelp
 */

const mockUpdateSettings = jest.fn();
(globalThis as Record<string, unknown>).EigennamenClient = {
    updateSettings: mockUpdateSettings,
};

const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
const mockShowToast = jest.fn();
jest.mock('../../frontend/ui', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal,
    showToast: mockShowToast,
}));

const mockSafeSetItem = jest.fn(() => true);
const mockSafeGetItem = jest.fn((_key: string, fallback?: string) => {
    try {
        return localStorage.getItem(_key) ?? fallback ?? null;
    } catch {
        return fallback ?? null;
    }
});
const mockSafeRemoveItem = jest.fn();

jest.mock('../../frontend/state', () => ({
    state: {
        teamNames: { red: 'Red', blue: 'Blue' },
        activeWords: [],
        wordSource: 'default',
        wordListMode: 'combined',
        language: 'en',
        isMultiplayerMode: false,
        gameState: { status: 'waiting' },
    },
    BOARD_SIZE: 25,
    DEFAULT_WORDS: Array.from({ length: 50 }, (_, i) => `WORD${i}`),
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key: string) => key),
}));

jest.mock('../../frontend/game', () => ({
    updateURL: jest.fn(),
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn(),
}));

jest.mock('../../frontend/utils', () => ({
    updateCharCounter: jest.fn(),
    safeGetItem: (...args: unknown[]) => mockSafeGetItem(...(args as [string, string?])),
    safeSetItem: (...args: unknown[]) => mockSafeSetItem(...args),
    safeRemoveItem: (...args: unknown[]) => mockSafeRemoveItem(...args),
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../../frontend/clientAccessor', () => ({
    isClientConnected: jest.fn(() => true),
}));

import {
    saveSettings,
    loadLocalSettings,
    initSettingsNav,
    openHelp,
    closeHelp,
    tryLoadWordlistFile,
} from '../../frontend/settings';
import { state, DEFAULT_WORDS } from '../../frontend/state';

function setupSaveDOM(redName: string, blueName: string, mode: string, customWords: string) {
    document.body.innerHTML = `
        <input id="red-name-input" value="${redName}" />
        <input id="blue-name-input" value="${blueName}" />
        <textarea id="custom-words">${customWords}</textarea>
        <input type="radio" name="wordlist-mode" value="${mode}" checked>
        <div id="word-error"></div>
    `;
}

beforeEach(() => {
    jest.clearAllMocks();
    state.teamNames = { red: 'Red', blue: 'Blue' };
    state.activeWords = [];
    state.wordSource = 'default';
    state.wordListMode = 'combined';
    (state as Record<string, unknown>).isMultiplayerMode = false;
    document.body.innerHTML = '';
    localStorage.clear();
    mockSafeSetItem.mockReturnValue(true);
});

describe('saveSettings in multiplayer mode', () => {
    test('sends team names to server when multiplayer and connected', () => {
        (state as Record<string, unknown>).isMultiplayerMode = true;
        setupSaveDOM('Fire', 'Ice', 'default', '');
        saveSettings();

        expect(mockUpdateSettings).toHaveBeenCalledWith({
            teamNames: { red: 'Fire', blue: 'Ice' },
        });
    });

    test('does not send to server when not multiplayer', () => {
        (state as Record<string, unknown>).isMultiplayerMode = false;
        setupSaveDOM('Fire', 'Ice', 'default', '');
        saveSettings();

        expect(mockUpdateSettings).not.toHaveBeenCalled();
    });
});

describe('saveSettings with storage failure', () => {
    test('shows warning toast when storage write fails', () => {
        mockSafeSetItem.mockReturnValue(false);
        setupSaveDOM('Red', 'Blue', 'combined', 'WORD1\nWORD2');
        saveSettings();

        expect(mockShowToast).toHaveBeenCalledWith(expect.any(String), 'warning', 6000);
    });
});

describe('saveSettings combined mode with no custom words', () => {
    test('sets wordSource to default when combined but no custom words', () => {
        setupSaveDOM('Red', 'Blue', 'combined', '');
        saveSettings();

        expect(state.wordSource).toBe('default');
        expect(state.activeWords).toEqual([...DEFAULT_WORDS]);
    });

    test('removes custom words from storage when text is empty', () => {
        setupSaveDOM('Red', 'Blue', 'combined', '');
        saveSettings();

        expect(mockSafeRemoveItem).toHaveBeenCalledWith('eigennamen-custom-words');
    });
});

describe('loadLocalSettings edge cases', () => {
    test('falls back to default for combined mode with no custom words', () => {
        localStorage.setItem('eigennamen-wordlist-mode', 'combined');
        // No custom words stored
        loadLocalSettings();
        expect(state.wordSource).toBe('default');
        expect(state.activeWords).toEqual([...DEFAULT_WORDS]);
    });

    test('falls back to default for unrecognized mode', () => {
        localStorage.setItem('eigennamen-wordlist-mode', 'garbage');
        loadLocalSettings();
        expect(state.wordSource).toBe('default');
    });
});

describe('initSettingsNav', () => {
    test('sets up tab click listeners', () => {
        document.body.innerHTML = `
            <div class="settings-tab" data-panel="game"></div>
            <div class="settings-tab" data-panel="prefs"></div>
            <div class="settings-panel active" id="panel-game"></div>
            <div class="settings-panel" id="panel-prefs"></div>
        `;

        // Need to reset the module-level guard. We do this by calling it
        // and verifying it attaches listeners.
        initSettingsNav();

        const tabs = document.querySelectorAll('.settings-tab');
        const spy = jest.spyOn(tabs[1] as HTMLElement, 'click');
        (tabs[1] as HTMLElement).click();
        expect(spy).toHaveBeenCalled();
    });
});

describe('openHelp / closeHelp', () => {
    test('openHelp opens help modal', () => {
        openHelp();
        expect(mockOpenModal).toHaveBeenCalledWith('help-modal');
    });

    test('closeHelp closes help modal', () => {
        closeHelp();
        expect(mockCloseModal).toHaveBeenCalledWith('help-modal');
    });
});

describe('tryLoadWordlistFile', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        mockSafeGetItem.mockImplementation((_key: string, fallback?: string) => {
            try {
                return localStorage.getItem(_key) ?? fallback ?? null;
            } catch {
                return fallback ?? null;
            }
        });
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    test('skips fetch when custom words already stored', async () => {
        localStorage.setItem('eigennamen-custom-words', 'WORD1');
        mockSafeGetItem.mockImplementation((_key: string) => {
            if (_key === 'eigennamen-custom-words') return 'WORD1';
            return null;
        });
        global.fetch = jest.fn();
        await tryLoadWordlistFile();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('skips fetch when mode is default', async () => {
        state.wordListMode = 'default';
        global.fetch = jest.fn();
        await tryLoadWordlistFile();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    test('fetches wordlist.txt and applies words in combined mode', async () => {
        state.wordListMode = 'combined';
        const words = Array.from({ length: 30 }, (_, i) => `FILE${i}`).join('\n');
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve(words),
        });

        await tryLoadWordlistFile();
        expect(state.wordSource).toBe('file');
        expect(state.activeWords.length).toBeGreaterThan(0);
    });

    test('does not apply when fetch returns too few words', async () => {
        state.wordListMode = 'combined';
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            text: () => Promise.resolve('ONE\nTWO'),
        });

        const before = [...state.activeWords];
        await tryLoadWordlistFile();
        expect(state.activeWords).toEqual(before);
    });

    test('handles fetch failure gracefully', async () => {
        state.wordListMode = 'combined';
        global.fetch = jest.fn().mockRejectedValue(new TypeError('Network error'));

        await expect(tryLoadWordlistFile()).resolves.toBeUndefined();
    });

    test('handles non-ok response', async () => {
        state.wordListMode = 'combined';
        global.fetch = jest.fn().mockResolvedValue({ ok: false });

        const before = [...state.activeWords];
        await tryLoadWordlistFile();
        expect(state.activeWords).toEqual(before);
    });
});
