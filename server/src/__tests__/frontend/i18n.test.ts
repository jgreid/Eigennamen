/**
 * Frontend i18n Module Tests
 *
 * Tests all exports from src/frontend/i18n.ts:
 * LANGUAGES, DEFAULT_LANGUAGE, initI18n, setLanguage, getLanguage,
 * t, translatePage, getLocalizedWordList.
 * Test environment: jsdom
 *
 * Note: The i18n module caches translations per-language in a module-level
 * object.  Tests that depend on specific translation data use isolateModulesAsync
 * to get a fresh module instance.
 */

// Mock state
jest.mock('../../frontend/state', () => ({
    state: {
        language: 'en',
        wordSource: 'default',
        localizedDefaultWords: null,
    },
}));

jest.mock('../../frontend/logger', () => ({
    logger: {
        warn: jest.fn(),
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
    },
}));

// Mock fetch globally
const mockFetch = jest.fn();
(global as any).fetch = mockFetch;

import {
    LANGUAGES,
    DEFAULT_LANGUAGE,
    initI18n,
    setLanguage,
    getLanguage,
    t,
    translatePage,
    getLocalizedWordList,
} from '../../frontend/i18n';
import { state } from '../../frontend/state';

describe('i18n module', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetch.mockReset();
        state.language = 'en';
        state.wordSource = 'default';
        state.localizedDefaultWords = null;
        document.documentElement.lang = '';
        document.body.innerHTML = '';

        // Default fetch mock
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({}),
        });
    });

    describe('LANGUAGES constant', () => {
        test('includes all four supported languages', () => {
            expect(LANGUAGES.en).toEqual({ name: 'English', flag: 'EN' });
            expect(LANGUAGES.de).toEqual({ name: 'Deutsch', flag: 'DE' });
            expect(LANGUAGES.es).toEqual({ name: 'Español', flag: 'ES' });
            expect(LANGUAGES.fr).toEqual({ name: 'Français', flag: 'FR' });
        });

        test('has exactly 4 languages', () => {
            expect(Object.keys(LANGUAGES)).toHaveLength(4);
        });
    });

    describe('DEFAULT_LANGUAGE', () => {
        test('is English', () => {
            expect(DEFAULT_LANGUAGE).toBe('en');
        });
    });

    describe('getLanguage', () => {
        test('returns current language', () => {
            // Module starts with 'en'
            const lang = getLanguage();
            expect(typeof lang).toBe('string');
            expect(lang in LANGUAGES).toBe(true);
        });
    });

    describe('setLanguage', () => {
        test('fetches translations for new language', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ greeting: 'Hallo' }),
            });

            await setLanguage('de');

            expect(mockFetch).toHaveBeenCalledWith(
                '/locales/de.json',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
            expect(getLanguage()).toBe('de');
        });

        test('sets document.documentElement.lang', async () => {
            await setLanguage('fr');
            expect(document.documentElement.lang).toBe('fr');
        });

        test('updates state.language', async () => {
            await setLanguage('es');
            expect(state.language).toBe('es');
        });

        test('persists to localStorage by default', async () => {
            const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
            await setLanguage('de');
            expect(setItemSpy).toHaveBeenCalledWith('eigennamen-language', 'de');
            setItemSpy.mockRestore();
        });

        test('does not persist when persist=false', async () => {
            const setItemSpy = jest.spyOn(Storage.prototype, 'setItem');
            await setLanguage('de', false);
            expect(setItemSpy).not.toHaveBeenCalled();
            setItemSpy.mockRestore();
        });

        test('falls back to en for unsupported language', async () => {
            await setLanguage('xx');
            expect(getLanguage()).toBe('en');
        });

        test('uses cached translations on repeat call', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ test: 'value' }),
            });
            await setLanguage('fr');
            mockFetch.mockClear();

            await setLanguage('fr');
            expect(mockFetch).not.toHaveBeenCalledWith('/locales/fr.json');
        });
    });

    describe('t - translation function', () => {
        test('returns key when translation not found', () => {
            expect(t('nonexistent.key')).toBe('nonexistent.key');
        });

        test('returns key for nested missing key', () => {
            expect(t('deeply.nested.missing.key')).toBe('deeply.nested.missing.key');
        });

        test('handles empty key', () => {
            expect(t('')).toBe('');
        });

        // Test t() with loaded translations via isolateModulesAsync
        test('looks up and interpolates translations', async () => {
            await jest.isolateModulesAsync(async () => {
                mockFetch.mockReset();
                mockFetch.mockResolvedValue({
                    ok: true,
                    json: async () => ({
                        game: {
                            turn: { red: "Red's turn" },
                            teamsTurn: '{{team}} plays next',
                            score: '{{red}} - {{blue}}',
                        },
                        simple: 'A simple string',
                    }),
                });

                const mod = await import('../../frontend/i18n');
                await mod.setLanguage('en');

                // Simple key lookup
                expect(mod.t('simple')).toBe('A simple string');
                // Nested key lookup
                expect(mod.t('game.turn.red')).toBe("Red's turn");
                // Single parameter interpolation
                expect(mod.t('game.teamsTurn', { team: 'Blue' })).toBe('Blue plays next');
                // Multiple parameter interpolation
                expect(mod.t('game.score', { red: '5', blue: '3' })).toBe('5 - 3');
                // Numeric parameter interpolation
                expect(mod.t('game.score', { red: 9, blue: 8 })).toBe('9 - 8');
                // Unmatched placeholders preserved
                expect(mod.t('game.teamsTurn')).toBe('{{team}} plays next');
                // Missing key returns key
                expect(mod.t('nope')).toBe('nope');
            });
        });
    });

    describe('translatePage', () => {
        test('translates data-i18n elements', async () => {
            await jest.isolateModulesAsync(async () => {
                mockFetch.mockReset();
                mockFetch.mockResolvedValue({
                    ok: true,
                    json: async () => ({
                        nav: { settings: 'Settings' },
                        form: { placeholder: 'Enter name', title: 'Click here' },
                    }),
                });

                const mod = await import('../../frontend/i18n');
                await mod.setLanguage('en');

                document.body.innerHTML = '<span data-i18n="nav.settings">placeholder</span>';
                mod.translatePage();
                expect(document.querySelector('[data-i18n]')!.textContent).toBe('Settings');
            });
        });

        test('translates data-i18n-placeholder attributes', async () => {
            await jest.isolateModulesAsync(async () => {
                mockFetch.mockReset();
                mockFetch.mockResolvedValue({
                    ok: true,
                    json: async () => ({ form: { placeholder: 'Enter name' } }),
                });

                const mod = await import('../../frontend/i18n');
                await mod.setLanguage('en');

                document.body.innerHTML = '<input data-i18n-placeholder="form.placeholder" placeholder="old">';
                mod.translatePage();
                expect((document.querySelector('input')! as HTMLInputElement).placeholder).toBe('Enter name');
            });
        });

        test('translates data-i18n-title attributes', async () => {
            await jest.isolateModulesAsync(async () => {
                mockFetch.mockReset();
                mockFetch.mockResolvedValue({
                    ok: true,
                    json: async () => ({ form: { title: 'Click here' } }),
                });

                const mod = await import('../../frontend/i18n');
                await mod.setLanguage('en');

                document.body.innerHTML = '<button data-i18n-title="form.title" title="old">btn</button>';
                mod.translatePage();
                expect((document.querySelector('button')! as HTMLElement).title).toBe('Click here');
            });
        });

        test('does not change text when key not found', () => {
            document.body.innerHTML = '<span data-i18n="missing.key">Original</span>';
            translatePage();
            expect(document.querySelector('[data-i18n]')!.textContent).toBe('Original');
        });

        test('handles elements without data-i18n value', () => {
            document.body.innerHTML = '<span data-i18n="">Keep this</span>';
            translatePage();
            expect(document.querySelector('[data-i18n]')!.textContent).toBe('Keep this');
        });
    });

    describe('getLocalizedWordList', () => {
        test('returns null for English (default uses built-in words)', async () => {
            const result = await getLocalizedWordList('en');
            expect(result).toBeNull();
        });

        test('fetches word list for non-English language', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () => 'Apfel\nBanane\nKirsche\n' + Array(25).fill('WORT').join('\n'),
            });

            const result = await getLocalizedWordList('de');
            expect(mockFetch).toHaveBeenCalledWith(
                '/locales/wordlist-de.txt',
                expect.objectContaining({ signal: expect.any(AbortSignal) })
            );
            expect(result).not.toBeNull();
            expect(result!.length).toBeGreaterThanOrEqual(25);
            expect(result![0]).toBe('APFEL');
        });

        test('returns null when fetch fails', async () => {
            mockFetch.mockRejectedValueOnce(new Error('Network error'));
            const result = await getLocalizedWordList('de');
            expect(result).toBeNull();
        });

        test('returns null when HTTP status is not ok', async () => {
            mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });
            const result = await getLocalizedWordList('de');
            expect(result).toBeNull();
        });

        test('filters empty lines and comments', async () => {
            mockFetch.mockResolvedValueOnce({
                ok: true,
                text: async () =>
                    '# Comment\n\nApfel\n  \nBanane\n# Another comment\n' + Array(25).fill('WORT').join('\n'),
            });

            const result = await getLocalizedWordList('de');
            expect(result).not.toBeNull();
            expect(result!).not.toContain('');
            expect(result!).not.toContain('# COMMENT');
        });
    });

    describe('initI18n', () => {
        test('uses stored language preference', async () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue('de');
            await initI18n();
            expect(getLanguage()).toBe('de');
            getItemSpy.mockRestore();
        });

        test('uses browser language when no stored preference', async () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
            Object.defineProperty(navigator, 'language', { value: 'fr-FR', configurable: true });
            await initI18n();
            expect(getLanguage()).toBe('fr');
            getItemSpy.mockRestore();
        });

        test('falls back to en for unsupported browser language', async () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockReturnValue(null);
            Object.defineProperty(navigator, 'language', { value: 'zh-CN', configurable: true });
            await initI18n();
            expect(getLanguage()).toBe('en');
            getItemSpy.mockRestore();
        });

        test('handles localStorage errors gracefully', async () => {
            const getItemSpy = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
                throw new Error('SecurityError');
            });
            await initI18n();
            expect(getLanguage()).toBe('en');
            getItemSpy.mockRestore();
        });
    });
});
