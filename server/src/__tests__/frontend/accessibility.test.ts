/**
 * Frontend Accessibility Module Tests
 *
 * Tests colorblind mode, keyboard shortcuts, and shortcut overlay.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => {
        const translations: Record<string, string> = {
            'accessibility.keyboardShortcuts': 'Keyboard Shortcuts',
            'accessibility.newGame': 'New Game',
            'accessibility.endTurn': 'End Turn',
            'accessibility.settings': 'Settings',
            'accessibility.playOnline': 'Play Online',
            'accessibility.gameHistory': 'Game History',
            'accessibility.showShortcuts': 'Show Shortcuts',
            'accessibility.closeOverlay': 'Close Overlay',
            'accessibility.navigateBoard': 'Navigate Board',
            'accessibility.revealCard': 'Reveal Card',
            'accessibility.toggleHint': 'Press ? to toggle shortcuts',
        };
        return translations[key] || key;
    },
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    getLocalizedWordList: async () => null,
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

import { initColorBlindMode, initKeyboardShortcuts } from '../../frontend/accessibility';
import { state } from '../../frontend/state';

beforeEach(() => {
    localStorage.clear();
    state.colorBlindMode = false;
    state.activeModal = null;

    document.body.innerHTML = `
        <input id="pref-colorblind" type="checkbox" />
        <button data-action="confirm-new-game">New Game</button>
        <button data-action="confirm-end-turn">End Turn</button>
        <button data-action="open-settings">Settings</button>
        <button data-action="open-multiplayer">Multiplayer</button>
        <button data-action="open-history">History</button>
        <button data-action="show-shortcuts">Shortcuts</button>
    `;
    document.body.className = '';
});

afterEach(() => {
    // Close any open overlays properly via Escape, which clears the module-level
    // overlayElement variable (just removing DOM elements leaves it stale)
    if (document.querySelector('.keyboard-shortcuts-overlay')) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    }
});

// ========== COLORBLIND MODE ==========

describe('initColorBlindMode', () => {
    test('applies colorblind mode from localStorage', () => {
        localStorage.setItem('eigennamen-colorblind', 'true');
        initColorBlindMode();

        expect(document.body.classList.contains('colorblind-mode')).toBe(true);
        expect(state.colorBlindMode).toBe(true);
    });

    test('does not apply when not in localStorage', () => {
        initColorBlindMode();

        expect(document.body.classList.contains('colorblind-mode')).toBe(false);
        expect(state.colorBlindMode).toBe(false);
    });

    test('updates checkbox to match state', () => {
        localStorage.setItem('eigennamen-colorblind', 'true');
        initColorBlindMode();

        const checkbox = document.getElementById('pref-colorblind') as HTMLInputElement;
        expect(checkbox.checked).toBe(true);
    });

    test('checkbox toggles colorblind mode', () => {
        initColorBlindMode();
        const checkbox = document.getElementById('pref-colorblind') as HTMLInputElement;

        checkbox.checked = true;
        checkbox.dispatchEvent(new Event('change'));

        expect(document.body.classList.contains('colorblind-mode')).toBe(true);
        expect(state.colorBlindMode).toBe(true);
        expect(localStorage.getItem('eigennamen-colorblind')).toBe('true');
    });

    test('checkbox disables colorblind mode', () => {
        localStorage.setItem('eigennamen-colorblind', 'true');
        initColorBlindMode();

        const checkbox = document.getElementById('pref-colorblind') as HTMLInputElement;
        checkbox.checked = false;
        checkbox.dispatchEvent(new Event('change'));

        expect(document.body.classList.contains('colorblind-mode')).toBe(false);
        expect(state.colorBlindMode).toBe(false);
    });
});

// ========== KEYBOARD SHORTCUTS ==========

describe('initKeyboardShortcuts', () => {
    test('registers keydown listener', () => {
        const spy = jest.spyOn(document, 'addEventListener');
        initKeyboardShortcuts();
        expect(spy).toHaveBeenCalledWith('keydown', expect.any(Function));
        spy.mockRestore();
    });
});

describe('keyboard shortcut handling', () => {
    beforeAll(() => {
        initKeyboardShortcuts();
    });

    beforeEach(() => {
        // Mock offsetParent on buttons — jsdom doesn't implement CSS layout
        // so offsetParent is always null, but the handler checks it before clicking
        document.querySelectorAll('button').forEach((btn) => {
            Object.defineProperty(btn, 'offsetParent', { value: document.body, configurable: true });
        });
    });

    test('triggers new game button on N key', () => {
        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));

        expect(clickSpy).toHaveBeenCalled();
    });

    test('triggers end turn button on E key', () => {
        const btn = document.querySelector('[data-action="confirm-end-turn"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'e' }));

        expect(clickSpy).toHaveBeenCalled();
    });

    test('triggers settings button on S key', () => {
        const btn = document.querySelector('[data-action="open-settings"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 's' }));

        expect(clickSpy).toHaveBeenCalled();
    });

    test('does not trigger when typing in input', () => {
        const input = document.createElement('input');
        document.body.appendChild(input);
        input.focus();

        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
        Object.defineProperty(event, 'target', { value: input });
        document.dispatchEvent(event);

        expect(clickSpy).not.toHaveBeenCalled();
    });

    test('does not trigger when typing in textarea', () => {
        const textarea = document.createElement('textarea');
        document.body.appendChild(textarea);

        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        const event = new KeyboardEvent('keydown', { key: 'n', bubbles: true });
        Object.defineProperty(event, 'target', { value: textarea });
        document.dispatchEvent(event);

        expect(clickSpy).not.toHaveBeenCalled();
    });

    test('does not trigger when modal is open', () => {
        state.activeModal = document.createElement('div');

        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));

        expect(clickSpy).not.toHaveBeenCalled();
        state.activeModal = null;
    });

    test('does not trigger with modifier keys', () => {
        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', ctrlKey: true }));
        expect(clickSpy).not.toHaveBeenCalled();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', metaKey: true }));
        expect(clickSpy).not.toHaveBeenCalled();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', altKey: true }));
        expect(clickSpy).not.toHaveBeenCalled();
    });

    test('does not trigger on disabled button', () => {
        const btn = document.querySelector('[data-action="confirm-new-game"]') as HTMLButtonElement;
        btn.disabled = true;
        const clickSpy = jest.spyOn(btn, 'click');

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n' }));

        expect(clickSpy).not.toHaveBeenCalled();
    });

    test('? key toggles shortcut overlay', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));

        const overlay = document.querySelector('.keyboard-shortcuts-overlay');
        expect(overlay).not.toBeNull();
        expect(overlay!.getAttribute('role')).toBe('dialog');
    });

    test('shortcut overlay displays all shortcuts', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));

        const overlay = document.querySelector('.keyboard-shortcuts-overlay')!;
        const rows = overlay.querySelectorAll('.shortcut-row');
        // 6 dynamic shortcuts + 3 static (ESC, arrows, ENTER)
        expect(rows.length).toBe(9);
    });

    test('shortcut overlay closes on second ? press', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
        expect(document.querySelector('.keyboard-shortcuts-overlay')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
        expect(document.querySelector('.keyboard-shortcuts-overlay')).toBeNull();
    });

    test('shortcut overlay closes on Escape', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
        expect(document.querySelector('.keyboard-shortcuts-overlay')).not.toBeNull();

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.querySelector('.keyboard-shortcuts-overlay')).toBeNull();
    });

    test('shortcut overlay closes on background click', () => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
        const overlay = document.querySelector('.keyboard-shortcuts-overlay')! as HTMLElement;

        // Click on the overlay background (not the panel inside)
        overlay.click();
        expect(document.querySelector('.keyboard-shortcuts-overlay')).toBeNull();
    });
});
