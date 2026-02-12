// ========== SETTINGS MODULE ==========
// Settings panel and word management

import { state, BOARD_SIZE, DEFAULT_WORDS } from './state.js';
import { updateCharCounter, safeGetItem, safeSetItem, safeRemoveItem } from './utils.js';
import { openModal, closeModal } from './ui.js';
import { updateURL, updateScoreboard, updateTurnIndicator, updateQRCode } from './game.js';

export function openSettings(): void {
    openModal('settings-modal');
    // Reset to Teams panel when opening
    switchSettingsPanel('teams');
    // Refresh QR code with current URL when opening settings
    updateQRCode(window.location.href);
    const redNameInput = document.getElementById('red-name-input') as HTMLInputElement | null;
    const blueNameInput = document.getElementById('blue-name-input') as HTMLInputElement | null;
    const customWordsTextarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;

    if (redNameInput) redNameInput.value = state.teamNames.red;
    if (blueNameInput) blueNameInput.value = state.teamNames.blue;

    // Initialize character counters (32 char limit matches HTML maxlength and server validation)
    updateCharCounter('red-name-input', 'red-char-counter', 32);
    updateCharCounter('blue-name-input', 'blue-char-counter', 32);

    // Load word list mode
    // HIGH FIX: Validate savedMode against allowed values before using in CSS selector
    const rawSavedMode = safeGetItem('codenames-wordlist-mode', 'combined');
    const allowedModes = ['default', 'combined', 'custom'];
    const savedMode = allowedModes.includes(rawSavedMode ?? '') ? rawSavedMode : 'combined';
    const modeRadio = document.querySelector(`input[name="wordlist-mode"][value="${savedMode}"]`) as HTMLInputElement | null;
    if (modeRadio) {
        modeRadio.checked = true;
        // Update selected class for older browsers
        const radios = document.querySelectorAll('input[name="wordlist-mode"]');
        radios.forEach(r => {
            (r as HTMLInputElement).closest('.radio-option')?.classList.toggle('selected', (r as HTMLInputElement).checked);
        });
    }

    const customWords = safeGetItem('codenames-custom-words');
    if (customWordsTextarea) {
        customWordsTextarea.value = customWords || '';
    }
    updateWordCount();
}

export function closeSettings(): void {
    closeModal('settings-modal');
}

// Settings tab navigation
export function switchSettingsPanel(panelId: string): void {
    // Update nav items
    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
        item.classList.toggle('active', (item as HTMLElement).dataset.panel === panelId);
    });

    // Update panels
    const panels = document.querySelectorAll('.settings-panel');
    panels.forEach(panel => {
        panel.classList.toggle('active', panel.id === `panel-${panelId}`);
    });

    // Show/hide context-specific buttons
    const resetWordsBtn = document.getElementById('btn-reset-words');
    if (resetWordsBtn) {
        resetWordsBtn.style.display = panelId === 'words' ? '' : 'none';
    }
}

// Guard: prevent duplicate registration of settings nav listeners
let settingsNavInitialized = false;

// Initialize settings nav listeners (idempotent — safe to call multiple times)
export function initSettingsNav(): void {
    if (settingsNavInitialized) return;
    settingsNavInitialized = true;

    const navItems = document.querySelectorAll('.settings-nav-item');
    navItems.forEach(item => {
        item.addEventListener('click', () => {
            switchSettingsPanel((item as HTMLElement).dataset.panel || '');
        });
    });
}

export function updateWordCount(): void {
    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    const countEl = document.getElementById('word-count');
    const errorEl = document.getElementById('word-error');

    // Guard against null elements
    if (!textarea || !countEl) return;

    const words = parseWords(textarea.value);
    const count = words.length;

    // Get current mode selection
    const modeRadio = document.querySelector('input[name="wordlist-mode"]:checked') as HTMLInputElement | null;
    const mode = modeRadio ? modeRadio.value : 'combined';

    if (mode === 'default') {
        countEl.textContent = `Using ${DEFAULT_WORDS.length} default words`;
        countEl.className = 'word-count';
        if (errorEl) errorEl.classList.remove('visible');
        textarea.classList.remove('invalid');
    } else if (mode === 'combined') {
        if (count === 0) {
            countEl.textContent = `Using ${DEFAULT_WORDS.length} default words`;
        } else {
            const totalUnique = new Set([...DEFAULT_WORDS, ...words]).size;
            countEl.textContent = `${count} custom + ${DEFAULT_WORDS.length} default = ${totalUnique} unique words`;
        }
        countEl.className = 'word-count';
        if (errorEl) errorEl.classList.remove('visible');
        textarea.classList.remove('invalid');
    } else if (mode === 'custom') {
        if (count === 0) {
            countEl.textContent = `0 words (need at least ${BOARD_SIZE})`;
            countEl.className = 'word-count error';
            if (errorEl) errorEl.classList.add('visible');
            textarea.classList.add('invalid');
        } else if (count < BOARD_SIZE) {
            countEl.textContent = `${count} words (need at least ${BOARD_SIZE})`;
            countEl.className = 'word-count error';
            if (errorEl) errorEl.classList.add('visible');
            textarea.classList.add('invalid');
        } else if (count < 50) {
            countEl.textContent = `${count} words (works, but more variety is better)`;
            countEl.className = 'word-count warning';
            if (errorEl) errorEl.classList.remove('visible');
            textarea.classList.remove('invalid');
        } else {
            countEl.textContent = `${count} custom words`;
            countEl.className = 'word-count';
            if (errorEl) errorEl.classList.remove('visible');
            textarea.classList.remove('invalid');
        }
    }
}

const MAX_WORD_LIST_SIZE = 10000;
const MAX_WORD_LENGTH = 50;

export function parseWords(text: string): string[] {
    // FIX: Handle Windows \r\n line endings to prevent empty entries
    const words = text
        .split(/\r?\n/)
        .map(w => w.trim())
        .filter(w => w.length > 0 && !w.startsWith('#'))
        .map(w => w.substring(0, MAX_WORD_LENGTH).toUpperCase());
    // Cap at MAX_WORD_LIST_SIZE to prevent memory issues
    return words.slice(0, MAX_WORD_LIST_SIZE);
}

export function saveSettings(): void {
    const redNameInput = document.getElementById('red-name-input') as HTMLInputElement | null;
    const blueNameInput = document.getElementById('blue-name-input') as HTMLInputElement | null;

    const redName = redNameInput ? redNameInput.value.trim() || 'Red' : 'Red';
    const blueName = blueNameInput ? blueNameInput.value.trim() || 'Blue' : 'Blue';
    state.teamNames.red = redName;
    state.teamNames.blue = blueName;

    // Get word list mode
    const modeRadio = document.querySelector('input[name="wordlist-mode"]:checked') as HTMLInputElement | null;
    const selectedMode = modeRadio ? modeRadio.value : 'combined';
    safeSetItem('codenames-wordlist-mode', selectedMode);
    state.wordListMode = selectedMode;

    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    const customWordsText = textarea ? textarea.value.trim() : '';
    const wordError = document.getElementById('word-error');

    // Parse custom words
    const customWords = customWordsText ? parseWords(customWordsText) : [];

    // Validate based on mode
    if (selectedMode === 'custom' && customWords.length < BOARD_SIZE) {
        // Custom only mode requires at least 25 words
        if (wordError) wordError.classList.add('visible');
        if (textarea) {
            textarea.classList.add('invalid');
            textarea.focus();
        }
        return;
    }

    // Save custom words if any
    if (customWordsText) {
        safeSetItem('codenames-custom-words', customWordsText);
    } else {
        safeRemoveItem('codenames-custom-words');
    }

    // Build active word list based on mode
    if (selectedMode === 'default') {
        state.activeWords = [...DEFAULT_WORDS];
        state.wordSource = 'default';
    } else if (selectedMode === 'combined') {
        // Combine default + custom, removing duplicates
        const combined = new Set([...DEFAULT_WORDS, ...customWords]);
        state.activeWords = [...combined];
        state.wordSource = customWords.length > 0 ? 'combined' : 'default';
    } else if (selectedMode === 'custom') {
        state.activeWords = [...customWords];
        state.wordSource = 'custom';
    }

    // Clear any error state
    if (wordError) wordError.classList.remove('visible');
    if (textarea) textarea.classList.remove('invalid');

    updateURL();
    updateScoreboard();
    updateTurnIndicator();
    closeSettings();
}

export function resetWords(): void {
    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = '';

    // Reset word list mode to 'combined' (default)
    const combinedRadio = document.getElementById('wordlist-mode-combined') as HTMLInputElement | null;
    if (combinedRadio) {
        combinedRadio.checked = true;
        // Update selected class for older browsers
        const radios = document.querySelectorAll('input[name="wordlist-mode"]');
        radios.forEach(r => {
            (r as HTMLInputElement).closest('.radio-option')?.classList.toggle('selected', (r as HTMLInputElement).checked);
        });
    }

    updateWordCount();
}

export function loadLocalSettings(): void {
    // Load word list mode
    state.wordListMode = safeGetItem('codenames-wordlist-mode', 'combined') || '';

    // Load custom words
    const customWordsText = safeGetItem('codenames-custom-words');
    const customWords = customWordsText ? parseWords(customWordsText) : [];

    // Apply word list based on mode
    if (state.wordListMode === 'default') {
        state.activeWords = [...DEFAULT_WORDS];
        state.wordSource = 'default';
    } else if (state.wordListMode === 'combined') {
        if (customWords.length > 0) {
            const combined = new Set([...DEFAULT_WORDS, ...customWords]);
            state.activeWords = [...combined];
            state.wordSource = 'combined';
        } else {
            state.activeWords = [...DEFAULT_WORDS];
            state.wordSource = 'default';
        }
    } else if (state.wordListMode === 'custom' && customWords.length >= BOARD_SIZE) {
        state.activeWords = [...customWords];
        state.wordSource = 'custom';
    } else {
        // Fallback to default if custom mode but not enough words
        state.activeWords = [...DEFAULT_WORDS];
        state.wordSource = 'default';
    }
}

export async function tryLoadWordlistFile(): Promise<void> {
    // Skip if custom words exist or mode is 'default' only
    if (safeGetItem('codenames-custom-words') || state.wordListMode === 'default') {
        return;
    }

    try {
        const response = await fetch('wordlist.txt');
        if (response.ok) {
            const text = await response.text();
            const fileWords = parseWords(text);
            if (fileWords.length >= BOARD_SIZE) {
                // Apply based on current mode
                if (state.wordListMode === 'combined') {
                    const combined = new Set([...DEFAULT_WORDS, ...fileWords]);
                    state.activeWords = [...combined];
                    state.wordSource = 'file';
                } else if (state.wordListMode === 'custom') {
                    state.activeWords = fileWords;
                    state.wordSource = 'file';
                }
            }
        }
        // 404 is expected when file doesn't exist - no need to log
    } catch (e: unknown) {
        // Log unexpected errors (network issues, CORS, etc.) in development
        // TypeError is expected for network errors when file doesn't exist
        const isTypeError = e instanceof Error && e.name === 'TypeError';
        if (!isTypeError && window.location.hostname === 'localhost') {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn('Unexpected error loading wordlist.txt:', msg);
        }
    }
}

// Initialize selected class on page load
export function initRadioOptionStyles(): void {
    const wordlistModeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
    wordlistModeRadios.forEach(r => {
        (r as HTMLInputElement).closest('.radio-option')?.classList.toggle('selected', (r as HTMLInputElement).checked);
    });
}

// Set up event listeners for settings inputs
export function initSettingsListeners(): void {
    const customWordsEl = document.getElementById('custom-words');
    if (customWordsEl) {
        customWordsEl.addEventListener('input', updateWordCount);
    }

    // Add event listeners for word list mode radio buttons
    const wordlistModeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
    wordlistModeRadios.forEach(radio => {
        radio.addEventListener('change', function() {
            // Update selected class for older browser support
            wordlistModeRadios.forEach(r => {
                (r as HTMLInputElement).closest('.radio-option')?.classList.toggle('selected', (r as HTMLInputElement).checked);
            });
            updateWordCount();
        });
    });

    initRadioOptionStyles();
}
