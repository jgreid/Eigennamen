/**
 * Frontend Settings Module Tests
 *
 * Tests exports from src/frontend/settings.ts:
 * parseWords, openSettings, closeSettings, switchSettingsPanel,
 * updateWordCount, saveSettings, resetWords, loadLocalSettings,
 * initSettingsNav, initSettingsListeners, initRadioOptionStyles.
 * Test environment: jsdom
 */

// Mock dependencies
const mockOpenModal = jest.fn();
const mockCloseModal = jest.fn();
jest.mock('../../frontend/ui', () => ({
    openModal: mockOpenModal,
    closeModal: mockCloseModal
}));

jest.mock('../../frontend/state', () => ({
    state: {
        teamNames: { red: 'Red', blue: 'Blue' },
        activeWords: [],
        wordSource: 'default',
        wordListMode: 'combined',
        language: 'en',
        gameState: { status: 'waiting' }
    },
    BOARD_SIZE: 25,
    DEFAULT_WORDS: Array.from({ length: 50 }, (_, i) => `WORD${i}`)
}));

jest.mock('../../frontend/i18n', () => ({
    t: jest.fn((key, params) => {
        if (key === 'wordList.usingDefault') return `Using ${params?.count} default words`;
        if (key === 'wordList.customPlusDefault') return `${params?.custom} custom + ${params?.default} default = ${params?.total} total`;
        if (key === 'wordList.zeroWords') return `Need at least ${params?.min} words`;
        if (key === 'wordList.tooFewWords') return `${params?.count} words (need ${params?.min})`;
        if (key === 'wordList.lowVariety') return `${params?.count} words (low variety)`;
        if (key === 'wordList.customWordCount') return `${params?.count} custom words`;
        return key;
    })
}));

jest.mock('../../frontend/game', () => ({
    updateURL: jest.fn(),
    updateScoreboard: jest.fn(),
    updateTurnIndicator: jest.fn()
}));

jest.mock('../../frontend/utils', () => ({
    updateCharCounter: jest.fn(),
    safeGetItem: jest.fn((key, fallback) => {
        try { return localStorage.getItem(key) ?? fallback ?? null; } catch { return fallback ?? null; }
    }),
    safeSetItem: jest.fn((key, value) => {
        try { localStorage.setItem(key, value); } catch { /* ignore */ }
    }),
    safeRemoveItem: jest.fn((key) => {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    })
}));

jest.mock('../../frontend/logger', () => ({
    logger: { warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));

import {
    parseWords, openSettings, closeSettings, switchSettingsPanel,
    updateWordCount, saveSettings, resetWords, loadLocalSettings,
    initSettingsListeners
} from '../../frontend/settings';
import { state, DEFAULT_WORDS } from '../../frontend/state';

describe('settings module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        state.teamNames = { red: 'Red', blue: 'Blue' };
        state.activeWords = [];
        state.wordSource = 'default';
        state.wordListMode = 'combined';
        document.body.innerHTML = '';
        localStorage.clear();
    });

    describe('parseWords', () => {
        test('splits by newlines and uppercases', () => {
            expect(parseWords('apple\nbanana\ncherry')).toEqual(['APPLE', 'BANANA', 'CHERRY']);
        });

        test('handles Windows CRLF line endings', () => {
            expect(parseWords('apple\r\nbanana\r\ncherry')).toEqual(['APPLE', 'BANANA', 'CHERRY']);
        });

        test('filters empty lines', () => {
            expect(parseWords('apple\n\n\nbanana')).toEqual(['APPLE', 'BANANA']);
        });

        test('filters comment lines starting with #', () => {
            expect(parseWords('# comment\napple\n# another\nbanana')).toEqual(['APPLE', 'BANANA']);
        });

        test('trims whitespace', () => {
            expect(parseWords('  apple  \n  banana  ')).toEqual(['APPLE', 'BANANA']);
        });

        test('truncates words longer than 50 characters', () => {
            const longWord = 'A'.repeat(100);
            const result = parseWords(longWord);
            expect(result[0]).toHaveLength(50);
        });

        test('caps at 10000 words', () => {
            const text = Array.from({ length: 15000 }, (_, i) => `WORD${i}`).join('\n');
            expect(parseWords(text)).toHaveLength(10000);
        });

        test('returns empty array for empty input', () => {
            expect(parseWords('')).toEqual([]);
        });
    });

    describe('openSettings', () => {
        test('calls openModal with settings-modal', () => {
            setupSettingsDOM();
            openSettings();
            expect(mockOpenModal).toHaveBeenCalledWith('settings-modal');
        });

        test('fills team name inputs from state', () => {
            setupSettingsDOM();
            state.teamNames = { red: 'Fire', blue: 'Ice' };
            openSettings();

            expect((document.getElementById('red-name-input') as HTMLInputElement).value).toBe('Fire');
            expect((document.getElementById('blue-name-input') as HTMLInputElement).value).toBe('Ice');
        });
    });

    describe('closeSettings', () => {
        test('calls closeModal with settings-modal', () => {
            closeSettings();
            expect(mockCloseModal).toHaveBeenCalledWith('settings-modal');
        });
    });

    describe('switchSettingsPanel', () => {
        test('activates correct panel and nav item', () => {
            document.body.innerHTML = `
                <div class="settings-nav-item active" data-panel="teams"></div>
                <div class="settings-nav-item" data-panel="words"></div>
                <div class="settings-panel active" id="panel-teams"></div>
                <div class="settings-panel" id="panel-words"></div>
                <button id="btn-reset-words" style="display: none"></button>
            `;

            switchSettingsPanel('words');

            expect(document.querySelector('[data-panel="words"]')!.classList.contains('active')).toBe(true);
            expect(document.querySelector('[data-panel="teams"]')!.classList.contains('active')).toBe(false);
            expect(document.getElementById('panel-words')!.classList.contains('active')).toBe(true);
            expect(document.getElementById('panel-teams')!.classList.contains('active')).toBe(false);
        });

        test('shows reset words button on words panel', () => {
            document.body.innerHTML = `
                <button id="btn-reset-words" style="display: none"></button>
            `;
            switchSettingsPanel('words');
            expect(document.getElementById('btn-reset-words')!.style.display).toBe('');
        });

        test('hides reset words button on other panels', () => {
            document.body.innerHTML = `
                <button id="btn-reset-words" style="display: block"></button>
            `;
            switchSettingsPanel('teams');
            expect(document.getElementById('btn-reset-words')!.style.display).toBe('none');
        });
    });

    describe('updateWordCount', () => {
        test('shows default word count in default mode', () => {
            setupWordCountDOM('default', '');
            updateWordCount();
            expect(document.getElementById('word-count')!.textContent).toContain('default');
        });

        test('shows combined count in combined mode with custom words', () => {
            setupWordCountDOM('combined', 'apple\nbanana\ncherry');
            updateWordCount();
            expect(document.getElementById('word-count')!.textContent).toContain('custom');
        });

        test('shows error for zero words in custom mode', () => {
            setupWordCountDOM('custom', '');
            updateWordCount();
            expect(document.getElementById('word-count')!.className).toContain('error');
        });

        test('shows error for too few words in custom mode', () => {
            setupWordCountDOM('custom', Array(10).fill('WORD').join('\n'));
            updateWordCount();
            expect(document.getElementById('word-count')!.className).toContain('error');
        });

        test('shows warning for low variety in custom mode', () => {
            setupWordCountDOM('custom', Array(30).fill(0).map((_, i) => `WORD${i}`).join('\n'));
            updateWordCount();
            expect(document.getElementById('word-count')!.className).toContain('warning');
        });

        test('shows normal count for sufficient custom words', () => {
            setupWordCountDOM('custom', Array(60).fill(0).map((_, i) => `WORD${i}`).join('\n'));
            updateWordCount();
            expect(document.getElementById('word-count')!.className).toBe('word-count');
        });
    });

    describe('saveSettings', () => {
        test('saves team names to state', () => {
            setupSaveSettingsDOM('TeamA', 'TeamB', 'combined', '');
            saveSettings();
            expect(state.teamNames.red).toBe('TeamA');
            expect(state.teamNames.blue).toBe('TeamB');
        });

        test('defaults team names to Red/Blue when empty', () => {
            setupSaveSettingsDOM('', '', 'combined', '');
            saveSettings();
            expect(state.teamNames.red).toBe('Red');
            expect(state.teamNames.blue).toBe('Blue');
        });

        test('sets active words for default mode', () => {
            setupSaveSettingsDOM('Red', 'Blue', 'default', '');
            saveSettings();
            expect(state.wordSource).toBe('default');
            expect(state.activeWords).toEqual([...DEFAULT_WORDS]);
        });

        test('combines default and custom words in combined mode', () => {
            const customWords = 'UNIQUE1\nUNIQUE2';
            setupSaveSettingsDOM('Red', 'Blue', 'combined', customWords);
            saveSettings();
            expect(state.wordSource).toBe('combined');
            expect(state.activeWords).toContain('UNIQUE1');
            expect(state.activeWords).toContain('UNIQUE2');
        });

        test('uses only custom words in custom mode', () => {
            const words = Array.from({ length: 30 }, (_, i) => `CUSTOM${i}`).join('\n');
            setupSaveSettingsDOM('Red', 'Blue', 'custom', words);
            saveSettings();
            expect(state.wordSource).toBe('custom');
            expect(state.activeWords.every(w => w.startsWith('CUSTOM'))).toBe(true);
        });

        test('rejects custom mode with too few words', () => {
            setupSaveSettingsDOM('Red', 'Blue', 'custom', 'ONE\nTWO');
            saveSettings();
            // Should not close settings - validation failed
            expect(mockCloseModal).not.toHaveBeenCalled();
        });

        test('closes settings on successful save', () => {
            setupSaveSettingsDOM('Red', 'Blue', 'default', '');
            saveSettings();
            expect(mockCloseModal).toHaveBeenCalledWith('settings-modal');
        });
    });

    describe('resetWords', () => {
        test('clears custom words textarea', () => {
            document.body.innerHTML = `
                <textarea id="custom-words">some words</textarea>
                <div id="word-count"></div>
            `;
            resetWords();
            expect((document.getElementById('custom-words') as HTMLTextAreaElement).value).toBe('');
        });

        test('resets radio to combined mode', () => {
            document.body.innerHTML = `
                <textarea id="custom-words">words</textarea>
                <div id="word-count"></div>
                <input type="radio" name="wordlist-mode" id="wordlist-mode-combined" value="combined">
                <input type="radio" name="wordlist-mode" id="wordlist-mode-custom" value="custom" checked>
            `;
            resetWords();
            expect((document.getElementById('wordlist-mode-combined') as HTMLInputElement).checked).toBe(true);
        });
    });

    describe('loadLocalSettings', () => {
        test('loads default mode from storage', () => {
            localStorage.setItem('eigennamen-wordlist-mode', 'default');
            loadLocalSettings();
            expect(state.wordSource).toBe('default');
            expect(state.activeWords).toEqual([...DEFAULT_WORDS]);
        });

        test('loads combined mode with custom words', () => {
            localStorage.setItem('eigennamen-wordlist-mode', 'combined');
            localStorage.setItem('eigennamen-custom-words', 'EXTRA1\nEXTRA2');
            loadLocalSettings();
            expect(state.wordSource).toBe('combined');
            expect(state.activeWords).toContain('EXTRA1');
        });

        test('loads custom mode with sufficient words', () => {
            localStorage.setItem('eigennamen-wordlist-mode', 'custom');
            const words = Array.from({ length: 30 }, (_, i) => `WORD${i}`).join('\n');
            localStorage.setItem('eigennamen-custom-words', words);
            loadLocalSettings();
            expect(state.wordSource).toBe('custom');
        });

        test('falls back to default when custom mode has too few words', () => {
            localStorage.setItem('eigennamen-wordlist-mode', 'custom');
            localStorage.setItem('eigennamen-custom-words', 'ONE\nTWO');
            loadLocalSettings();
            expect(state.wordSource).toBe('default');
        });
    });

    describe('initSettingsListeners', () => {
        test('attaches input event listener to custom-words textarea', () => {
            document.body.innerHTML = `
                <textarea id="custom-words"></textarea>
                <div id="word-count"></div>
            `;
            const addEventSpy = jest.spyOn(document.getElementById('custom-words')!, 'addEventListener');
            initSettingsListeners();
            expect(addEventSpy).toHaveBeenCalledWith('input', expect.any(Function));
        });
    });
});

// Helper: set up full settings DOM
function setupSettingsDOM(): void {
    document.body.innerHTML = `
        <input id="red-name-input" value="" />
        <input id="blue-name-input" value="" />
        <span id="red-char-counter"></span>
        <span id="blue-char-counter"></span>
        <textarea id="custom-words"></textarea>
        <input type="radio" name="wordlist-mode" value="combined" checked>
        <input type="radio" name="wordlist-mode" value="custom">
        <input type="radio" name="wordlist-mode" value="default">
        <div id="word-count"></div>
        <div id="word-error"></div>
        <div class="settings-nav-item" data-panel="teams"></div>
        <div class="settings-nav-item" data-panel="words"></div>
        <div class="settings-panel" id="panel-teams"></div>
        <div class="settings-panel" id="panel-words"></div>
    `;
}

// Helper: set up word count DOM
function setupWordCountDOM(mode: string, text: string): void {
    document.body.innerHTML = `
        <textarea id="custom-words">${text}</textarea>
        <div id="word-count"></div>
        <div id="word-error"></div>
        <input type="radio" name="wordlist-mode" value="${mode}" checked>
    `;
}

// Helper: set up save settings DOM
function setupSaveSettingsDOM(redName: string, blueName: string, mode: string, customWords: string): void {
    document.body.innerHTML = `
        <input id="red-name-input" value="${redName}" />
        <input id="blue-name-input" value="${blueName}" />
        <textarea id="custom-words">${customWords}</textarea>
        <input type="radio" name="wordlist-mode" value="${mode}" checked>
        <div id="word-error"></div>
    `;
}
