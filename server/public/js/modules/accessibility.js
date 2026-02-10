// ========== ACCESSIBILITY MODULE ==========
// Color blind mode, keyboard shortcuts, and screen reader helpers

import { state } from './state.js';
import { safeGetItem, safeSetItem } from './utils.js';

const CB_STORAGE_KEY = 'codenames-colorblind';
const KB_STORAGE_KEY = 'codenames-keyboard-shortcuts';

// ========== COLOR BLIND MODE ==========

export function initColorBlindMode() {
    const enabled = safeGetItem(CB_STORAGE_KEY) === 'true';
    applyColorBlindMode(enabled);

    const checkbox = document.getElementById('pref-colorblind');
    if (checkbox) {
        checkbox.checked = enabled;
        checkbox.addEventListener('change', () => {
            applyColorBlindMode(checkbox.checked);
            safeSetItem(CB_STORAGE_KEY, checkbox.checked.toString());
        });
    }
}

function applyColorBlindMode(enabled) {
    document.body.classList.toggle('colorblind-mode', enabled);
    state.colorBlindMode = enabled;
}

// ========== KEYBOARD SHORTCUTS ==========

const SHORTCUTS = {
    'n': { action: 'confirm-new-game', description: 'New Game' },
    'e': { action: 'confirm-end-turn', description: 'End Turn' },
    's': { action: 'open-settings', description: 'Settings' },
    'm': { action: 'open-multiplayer', description: 'Play Online' },
    'h': { action: 'open-history', description: 'Game History' },
    '?': { action: 'show-shortcuts', description: 'Show Shortcuts' }
};

let shortcutsEnabled = true;

export function initKeyboardShortcuts() {
    document.addEventListener('keydown', handleKeyboardShortcut);
}

function handleKeyboardShortcut(e) {
    // Don't trigger when typing in inputs, textareas, or selects
    const target = e.target;
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
    const button = document.querySelector(`[data-action="${shortcut.action}"]`);
    if (button && !button.disabled && button.offsetParent !== null) {
        e.preventDefault();
        button.click();
    }
}

// ========== SHORTCUT HELP OVERLAY ==========

let overlayElement = null;

function toggleShortcutOverlay() {
    if (overlayElement) {
        overlayElement.remove();
        overlayElement = null;
        return;
    }

    overlayElement = document.createElement('div');
    overlayElement.className = 'keyboard-shortcuts-overlay';
    overlayElement.setAttribute('role', 'dialog');
    overlayElement.setAttribute('aria-label', 'Keyboard shortcuts');

    const panel = document.createElement('div');
    panel.className = 'shortcuts-panel';

    const heading = document.createElement('h3');
    heading.textContent = 'Keyboard Shortcuts';
    panel.appendChild(heading);

    // Dynamic shortcuts from SHORTCUTS config
    for (const [key, { description }] of Object.entries(SHORTCUTS)) {
        const row = document.createElement('div');
        row.className = 'shortcut-row';
        const kbd = document.createElement('kbd');
        kbd.textContent = key === '?' ? '?' : key.toUpperCase();
        const span = document.createElement('span');
        span.textContent = description;
        row.appendChild(kbd);
        row.appendChild(span);
        panel.appendChild(row);
    }

    // Static shortcut entries
    const staticShortcuts = [
        ['ESC', 'Close modal / this overlay'],
        ['↑↓←→', 'Navigate board cards'],
        ['ENTER', 'Reveal selected card']
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
    hint.textContent = 'Press ';
    const hintKbd = document.createElement('kbd');
    hintKbd.textContent = '?';
    hint.appendChild(hintKbd);
    hint.append(' to toggle this overlay');
    panel.appendChild(hint);

    overlayElement.appendChild(panel);

    overlayElement.addEventListener('click', (e) => {
        if (e.target === overlayElement) {
            overlayElement.remove();
            overlayElement = null;
        }
    });

    document.addEventListener('keydown', function closeOnEsc(e) {
        if (e.key === 'Escape' && overlayElement) {
            overlayElement.remove();
            overlayElement = null;
            document.removeEventListener('keydown', closeOnEsc);
        }
    });

    document.body.appendChild(overlayElement);
}

// ========== SCREEN READER HELPERS ==========

export function announceToScreenReader(message, priority = 'polite') {
    const el = document.getElementById('sr-announcements');
    if (!el) return;

    el.setAttribute('aria-live', priority);
    // Clear and re-set to force announcement
    el.textContent = '';
    requestAnimationFrame(() => {
        el.textContent = message;
    });
}
