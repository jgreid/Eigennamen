/**
 * Internationalization (i18n) Module
 *
 * Lightweight i18n for the Eigennamen frontend.
 * - Loads JSON translation files from /locales/
 * - Provides t() function for string lookups with interpolation
 * - Supports data-i18n attributes for automatic DOM translation
 * - Persists language preference in localStorage
 */

import { state } from './state.js';
import { logger } from './logger.js';

/** Supported languages with display names */
export const LANGUAGES: Record<string, { name: string; flag: string }> = {
    en: { name: 'English', flag: 'EN' },
    de: { name: 'Deutsch', flag: 'DE' },
    es: { name: 'Español', flag: 'ES' },
    fr: { name: 'Français', flag: 'FR' }
};

export const DEFAULT_LANGUAGE = 'en';
const STORAGE_KEY = 'eigennamen-language';

/** Loaded translation data keyed by language code */
const translations: Record<string, Record<string, any>> = {};

/** Current active language */
let currentLanguage = DEFAULT_LANGUAGE;

/**
 * Initialize the i18n system
 * Detects language from stored preference or browser, loads translations
 */
export async function initI18n(): Promise<void> {
    let stored: string | null = null;
    try {
        stored = localStorage.getItem(STORAGE_KEY);
    } catch {
        // localStorage unavailable (private browsing, storage quota, etc.)
    }
    const browserLang = navigator.language?.split('-')[0];
    const detected = stored || (browserLang in LANGUAGES ? browserLang : DEFAULT_LANGUAGE);

    await setLanguage(detected, false);
}

/**
 * Set the active language and translate the page
 * @param lang - Language code (en, de, es, fr)
 * @param persist - Whether to save preference
 */
export async function setLanguage(lang: string, persist: boolean = true): Promise<void> {
    if (!(lang in LANGUAGES)) {
        logger.warn(`Unsupported language: ${lang}, falling back to ${DEFAULT_LANGUAGE}`);
        lang = DEFAULT_LANGUAGE;
    }

    // Load translations if not cached
    if (!translations[lang]) {
        try {
            const response = await fetch(`/locales/${lang}.json`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            translations[lang] = await response.json();
        } catch (err) {
            logger.error(`Failed to load translations for ${lang}:`, err);
            // Fall back to English
            if (lang !== DEFAULT_LANGUAGE) {
                return setLanguage(DEFAULT_LANGUAGE, persist);
            }
            translations[lang] = {};
        }
    }

    currentLanguage = lang;
    document.documentElement.lang = lang;

    if (persist) {
        try {
            localStorage.setItem(STORAGE_KEY, lang);
        } catch {
            // localStorage unavailable (private browsing, storage quota, etc.)
        }
    }

    // Update state for other modules
    state.language = lang;

    // Load localized word list if using default words
    if (state.wordSource === 'default' || state.wordSource === 'combined') {
        const localWords = await getLocalizedWordList(lang);
        if (localWords && localWords.length >= 25) {
            state.localizedDefaultWords = localWords;
        } else {
            state.localizedDefaultWords = null;
        }
    }

    // Translate all data-i18n elements
    translatePage();
}

/**
 * Get current language code
 */
export function getLanguage(): string {
    return currentLanguage;
}

/**
 * Translate a key with optional interpolation
 * @param key - Dot-separated key (e.g., 'game.redTurn')
 * @param params - Interpolation parameters (e.g., {team: 'Red'})
 * @returns Translated string or key as fallback
 */
export function t(key: string, params: Record<string, string | number> = {}): string {
    const value = getNestedValue(translations[currentLanguage], key)
        || getNestedValue(translations[DEFAULT_LANGUAGE], key)
        || key;

    if (typeof value !== 'string') return key;

    // Interpolate {{param}} placeholders
    return value.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) =>
        params[name] !== undefined ? String(params[name]) : `{{${name}}}`
    );
}

/**
 * Translate all elements with data-i18n attributes
 */
export function translatePage(): void {
    const elements = document.querySelectorAll('[data-i18n]');
    elements.forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (!key) return;

        const translated = t(key);
        if (translated !== key) {
            el.textContent = translated;
        }
    });

    // Handle data-i18n-placeholder for input elements
    const placeholders = document.querySelectorAll('[data-i18n-placeholder]');
    placeholders.forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder');
        if (!key) return;

        const translated = t(key);
        if (translated !== key) {
            (el as HTMLInputElement).placeholder = translated;
        }
    });

    // Handle data-i18n-title for title attributes
    const titles = document.querySelectorAll('[data-i18n-title]');
    titles.forEach(el => {
        const key = el.getAttribute('data-i18n-title');
        if (!key) return;

        const translated = t(key);
        if (translated !== key) {
            (el as HTMLElement).title = translated;
        }
    });
}

/**
 * Load localized word list for the given language
 * Returns an array of uppercase words, or null if not available
 * @param lang - Language code
 */
export async function getLocalizedWordList(lang: string = currentLanguage): Promise<string[] | null> {
    if (lang === DEFAULT_LANGUAGE) return null; // English uses built-in DEFAULT_WORDS

    try {
        const response = await fetch(`/locales/wordlist-${lang}.txt`);
        if (!response.ok) return null;

        const text = await response.text();
        return text
            .split('\n')
            .map(w => w.trim())
            .filter(w => w.length > 0 && !w.startsWith('#'))
            .map(w => w.toUpperCase());
    } catch {
        return null;
    }
}

/**
 * Get a nested value from an object using dot notation
 * @param obj
 * @param path - e.g., 'game.turn.red'
 */
function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
    if (!obj || !path) return undefined;
    return path.split('.').reduce((curr: Record<string, unknown> | undefined, key: string) =>
        (curr && typeof curr === 'object') ? (curr[key] as Record<string, unknown> | undefined) : undefined, obj as Record<string, unknown> | undefined);
}
