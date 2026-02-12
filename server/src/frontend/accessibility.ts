// ========== ACCESSIBILITY MODULE ==========
// Color blind mode, keyboard shortcuts, and screen reader helpers

import { state } from './state.js';
import { safeGetItem, safeSetItem } from './utils.js';
import { t } from './i18n.js';

const CB_STORAGE_KEY = 'codenames-colorblind';

// ========== COLOR BLIND MODE ==========

export function initColorBlindMode(): void {
    const enabled = safeGetItem(CB_STORAGE_KEY) === 'true';
    applyColorBlindMode(enabled);

    const checkbox = document.getElementById('pref-colorblind') as HTMLInputElement | null;
    if (checkbox) {
        checkbox.checked = enabled;
        checkbox.addEventListener('change', () => {
            applyColorBlindMode(checkbox.checked);
            safeSetItem(CB_STORAGE_KEY, checkbox.checked.toString());
        });
    }
}

function applyColorBlindMode(enabled: boolean): void {
    document.body.classList.toggle('colorblind-mode', enabled);
    state.colorBlindMode = enabled;
}

// ========== KEYBOARD SHORTCUTS ==========

const SHORTCUTS: Record<string, { action: string; descKey: string }> = {
    'n': { action: 'confirm-new-game', descKey: 'accessibility.newGame' },
    'e': { action: 'confirm-end-turn', descKey: 'accessibility.endTurn' },
    's': { action: 'open-settings', descKey: 'accessibility.settings' },
    'm': { action: 'open-multiplayer', descKey: 'accessibility.playOnline' },
    'h': { action: 'open-history', descKey: 'accessibility.gameHistory' },
    '?': { action: 'show-shortcuts', descKey: 'accessibility.showShortcuts' }
};

const shortcutsEnabled = true;

export function initKeyboardShortcuts(): void {
    document.addEventListener('keydown', handleKeyboardShortcut);
}

function handleKeyboardShortcut(e: KeyboardEvent): void {
    // Don't trigger when typing in inputs, textareas, or selects
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
        return;
    }

    // Don't trigger when a modal is open (except Escape to close)
    if (state.activeModal && e.key !== 'Escape') {
        return;
    }

    // Escape closes active modal
    if (e.key === 'Escape' && state.activeModal) {
        return; // Already handled by modal system
    }

    // Don't trigger with modifier keys (allow Ctrl+C etc.)
    if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
    }

    const key = e.key.toLowerCase();
    const shortcut = SHORTCUTS[key] || SHORTCUTS[e.key]; // e.key for '?' which needs shift

    if (!shortcut || !shortcutsEnabled) return;

    if (shortcut.action === 'show-shortcuts') {
        e.preventDefault();
        toggleShortcutOverlay();
        return;
    }

    // Find the button with the matching data-action and click it
    const button = document.querySelector(`[data-action="${shortcut.action}"]`) as HTMLButtonElement | null;
    if (button && !button.disabled && button.offsetParent !== null) {
        e.preventDefault();
        button.click();
    }
}

// ========== SHORTCUT HELP OVERLAY ==========

let overlayElement: HTMLElement | null = null;
let overlayEscListener: ((e: KeyboardEvent) => void) | null = null;

function closeOverlay(): void {
    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
    }
    if (overlayEscListener) {
        document.removeEventListener('keydown', overlayEscListener);
        overlayEscListener = null;
    }
}

function toggleShortcutOverlay(): void {
    if (overlayElement) {
        closeOverlay();
        return;
    }

    overlayElement = document.createElement('div');
    overlayElement.className = 'keyboard-shortcuts-overlay';
    overlayElement.setAttribute('role', 'dialog');
    overlayElement.setAttribute('aria-label', t('accessibility.keyboardShortcuts'));

    const panel = document.createElement('div');
    panel.className = 'shortcuts-panel';

    const heading = document.createElement('h3');
    heading.textContent = t('accessibility.keyboardShortcuts');
    panel.appendChild(heading);

    // Dynamic shortcuts from SHORTCUTS config
    for (const [key, { descKey }] of Object.entries(SHORTCUTS)) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const kbd = document.createElement('kbd');
        kbd.textContent = key === '?' ? '?' : key.toUpperCase();
        const span = document.createElement('span');
        span.textContent = t(descKey);
        row.appendChild(kbd);
        row.appendChild(span);
        panel.appendChild(row);
    }

    // Static shortcut entries
    const staticShortcuts: [string, string][] = [
        ['ESC', t('accessibility.closeOverlay')],
        ['↑↓←→', t('accessibility.navigateBoard')],
        ['ENTER', t('accessibility.revealCard')]
    ];
    for (const [keyText, desc] of staticShortcuts) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const kbd = document.createElement('kbd');
        kbd.textContent = keyText;
        const span = document.createElement('span');
        span.textContent = desc;
        row.appendChild(kbd);
        row.appendChild(span);
        panel.appendChild(row);
    }

    const hint = document.createElement('p');
    hint.className = 'shortcuts-hint';
    hint.textContent = t('accessibility.toggleHint');
    panel.appendChild(hint);

    overlayElement.appendChild(panel);

    overlayElement.addEventListener('click', (e: MouseEvent) => {
        if (e.target === overlayElement) {
            closeOverlay();
        }
    });

    overlayEscListener = function(e: KeyboardEvent) {
        if (e.key === 'Escape') {
            closeOverlay();
        }
    };
    document.addEventListener('keydown', overlayEscListener);

    document.body.appendChild(overlayElement);
}

// ========== SCREEN READER HELPERS ==========

export function announceToScreenReader(message: string, priority: string = 'polite'): void {
    const el = document.getElementById('sr-announcements');
    if (!el) return;

    el.setAttribute('aria-live', priority);
    // Clear and re-set to force announcement
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = message;
    });
}
