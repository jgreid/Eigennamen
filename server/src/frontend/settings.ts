import { state, BOARD_SIZE, DEFAULT_WORDS, MAX_CUSTOM_WORD_LIST_SIZE } from './state.js';
import { updateCharCounter, safeGetItem, safeSetItem, safeRemoveItem } from './utils.js';
import { openModal, closeModal, showToast } from './ui.js';
import { updateURL, updateScoreboard, updateTurnIndicator } from './game.js';
import { isClientConnected } from './clientAccessor.js';
import { t } from './i18n.js';
import { logger } from './logger.js';
import { getSavedLists, getSavedList, saveList, deleteList, MAX_SAVED_LISTS } from './wordListLibrary.js';

// Saved-list provenance staged by a Load / Save-as click but NOT yet committed.
// It is promoted to the live state.wordListId/Name only when the user actually
// applies the settings ("Save & Apply" -> saveSettings). Binding provenance to
// the commit rather than the click means a Load the user abandons via "Close"
// (which commits nothing) can never mis-credit a later game to a list whose
// words were never applied. Cleared whenever the words diverge from a loaded
// list (clearWordListProvenance) or the settings modal is dismissed.
let pendingProvenance: { id: string; name: string } | null = null;

export function openSettings(): void {
    openModal('settings-modal');
    // Reset to Game panel when opening
    switchSettingsPanel('game');
    const redNameInput = document.getElementById('red-name-input') as HTMLInputElement | null;
    const blueNameInput = document.getElementById('blue-name-input') as HTMLInputElement | null;
    const customWordsTextarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;

    if (redNameInput) redNameInput.value = state.teamNames.red;
    if (blueNameInput) blueNameInput.value = state.teamNames.blue;

    // Initialize character counters (32 char limit matches HTML maxlength and server validation)
    updateCharCounter('red-name-input', 'red-char-counter', 32);
    updateCharCounter('blue-name-input', 'blue-char-counter', 32);

    // Load word list mode
    // Validate savedMode against allowed values before using in CSS selector
    const rawSavedMode = safeGetItem('eigennamen-wordlist-mode', 'combined');
    const allowedModes = ['default', 'combined', 'custom'];
    const savedMode = allowedModes.includes(rawSavedMode ?? '') ? rawSavedMode : 'combined';
    const escapedMode = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(savedMode ?? '') : (savedMode ?? '');
    const modeRadio = document.querySelector(
        `input[name="wordlist-mode"][value="${escapedMode}"]`
    ) as HTMLInputElement | null;
    if (modeRadio) {
        modeRadio.checked = true;
        // Update selected class for older browsers
        const radios = document.querySelectorAll('input[name="wordlist-mode"]');
        radios.forEach((r) => {
            (r as HTMLInputElement)
                .closest('.wordlist-pill')
                ?.classList.toggle('selected', (r as HTMLInputElement).checked);
        });
    }

    const customWords = safeGetItem('eigennamen-custom-words');
    if (customWordsTextarea) {
        customWordsTextarea.value = customWords || '';
    }
    updateWordCount();
    refreshSavedListSelect();
}

export function closeSettings(): void {
    // Discard any provenance staged by a Load/Save-as that was never committed.
    // saveSettings consumes and nulls it before calling this, so a real
    // "Save & Apply" keeps its credit; only a bare dismiss drops the staged id.
    pendingProvenance = null;
    closeModal('settings-modal');
}

export function openHelp(): void {
    openModal('help-modal');
}

export function closeHelp(): void {
    closeModal('help-modal');
}

// Settings tab navigation
export function switchSettingsPanel(panelId: string): void {
    // Update tab buttons
    const tabs = document.querySelectorAll('.settings-tab');
    tabs.forEach((tab) => {
        tab.classList.toggle('active', (tab as HTMLElement).dataset.panel === panelId);
    });

    // Update panels
    const panels = document.querySelectorAll('.settings-panel');
    panels.forEach((panel) => {
        panel.classList.toggle('active', panel.id === `panel-${panelId}`);
    });

    // Show/hide context-specific buttons (reset words visible on game panel)
    const resetWordsBtn = document.getElementById('btn-reset-words');
    if (resetWordsBtn) {
        resetWordsBtn.hidden = panelId !== 'game';
    }
}

// Guard: prevent duplicate registration of settings nav listeners
let settingsNavInitialized = false;

// Initialize settings nav listeners (idempotent — safe to call multiple times)
export function initSettingsNav(): void {
    if (settingsNavInitialized) return;
    settingsNavInitialized = true;

    const navItems = document.querySelectorAll('.settings-tab');
    navItems.forEach((item) => {
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
        countEl.textContent = t('wordList.usingDefault', { count: DEFAULT_WORDS.length });
        countEl.className = 'word-count';
        if (errorEl) errorEl.classList.remove('visible');
        textarea.classList.remove('invalid');
    } else if (mode === 'combined') {
        if (count === 0) {
            countEl.textContent = t('wordList.usingDefault', { count: DEFAULT_WORDS.length });
        } else {
            const totalUnique = new Set([...DEFAULT_WORDS, ...words]).size;
            countEl.textContent = t('wordList.customPlusDefault', {
                custom: count,
                default: DEFAULT_WORDS.length,
                total: totalUnique,
            });
        }
        countEl.className = 'word-count';
        if (errorEl) errorEl.classList.remove('visible');
        textarea.classList.remove('invalid');
    } else if (mode === 'custom') {
        if (count === 0) {
            countEl.textContent = t('wordList.zeroWords', { min: BOARD_SIZE });
            countEl.className = 'word-count error';
            if (errorEl) errorEl.classList.add('visible');
            textarea.classList.add('invalid');
        } else if (count < BOARD_SIZE) {
            countEl.textContent = t('wordList.tooFewWords', { count, min: BOARD_SIZE });
            countEl.className = 'word-count error';
            if (errorEl) errorEl.classList.add('visible');
            textarea.classList.add('invalid');
        } else if (count < 50) {
            countEl.textContent = t('wordList.lowVariety', { count });
            countEl.className = 'word-count warning';
            if (errorEl) errorEl.classList.remove('visible');
            textarea.classList.remove('invalid');
        } else {
            countEl.textContent = t('wordList.customWordCount', { count });
            countEl.className = 'word-count';
            if (errorEl) errorEl.classList.remove('visible');
            textarea.classList.remove('invalid');
        }
    }
}

const MAX_WORD_LENGTH = 50;

export function parseWords(text: string): string[] {
    // FIX: Handle Windows \r\n line endings to prevent empty entries
    const words = text
        .split(/\r?\n/)
        .map((w) => w.trim())
        .filter((w) => w.length > 0 && !w.startsWith('#'))
        .map((w) => w.substring(0, MAX_WORD_LENGTH).toUpperCase());
    // Cap at MAX_CUSTOM_WORD_LIST_SIZE — shared with the server's game:start
    // schema so a list accepted here is never silently rejected once sent
    // over the wire in multiplayer mode.
    return words.slice(0, MAX_CUSTOM_WORD_LIST_SIZE);
}

export function saveSettings(): void {
    const redNameInput = document.getElementById('red-name-input') as HTMLInputElement | null;
    const blueNameInput = document.getElementById('blue-name-input') as HTMLInputElement | null;

    const redName = redNameInput ? redNameInput.value.trim() || 'Red' : 'Red';
    const blueName = blueNameInput ? blueNameInput.value.trim() || 'Blue' : 'Blue';
    state.teamNames.red = redName;
    state.teamNames.blue = blueName;

    // Send team name changes to server in multiplayer mode
    if (state.isMultiplayerMode && isClientConnected()) {
        EigennamenClient.updateSettings({
            teamNames: { red: redName, blue: blueName },
        });
    }

    // Get word list mode
    const modeRadio = document.querySelector('input[name="wordlist-mode"]:checked') as HTMLInputElement | null;
    const selectedMode = modeRadio ? modeRadio.value : 'combined';
    safeSetItem('eigennamen-wordlist-mode', selectedMode);
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

    // Save custom words if any — warn user if storage write fails (M5 from audit)
    let storageFailed = false;
    if (customWordsText) {
        if (!safeSetItem('eigennamen-custom-words', customWordsText)) {
            storageFailed = true;
        }
    } else {
        safeRemoveItem('eigennamen-custom-words');
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

    // Provenance only applies when the active list IS a saved list verbatim,
    // i.e. "Custom only" mode. Combined/default mixes or replaces it, so drop
    // any lingering saved-list identity. In custom mode, promote the id staged
    // by a Load/Save-as (if any) now that the words are actually committed; if
    // nothing was staged, leave the existing committed provenance untouched so a
    // no-op re-save of an already-credited list keeps its credit.
    if (selectedMode === 'custom') {
        if (pendingProvenance) {
            state.wordListId = pendingProvenance.id;
            state.wordListName = pendingProvenance.name;
        }
    } else {
        clearWordListProvenance();
    }
    pendingProvenance = null;

    // Clear any error state
    if (wordError) wordError.classList.remove('visible');
    if (textarea) textarea.classList.remove('invalid');

    updateURL();
    updateScoreboard();
    updateTurnIndicator();
    closeSettings();

    if (storageFailed) {
        showToast(
            t('settings.storageFailed') || 'Settings applied but could not be saved. They will be lost on reload.',
            'warning',
            6000
        );
    }
}

export function resetWords(): void {
    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = '';
    clearWordListProvenance();

    // Reset word list mode to 'combined' (default)
    const combinedRadio = document.getElementById('wordlist-mode-combined') as HTMLInputElement | null;
    if (combinedRadio) {
        combinedRadio.checked = true;
        // Update selected class for older browsers
        const radios = document.querySelectorAll('input[name="wordlist-mode"]');
        radios.forEach((r) => {
            (r as HTMLInputElement)
                .closest('.wordlist-pill')
                ?.classList.toggle('selected', (r as HTMLInputElement).checked);
        });
    }

    updateWordCount();
}

/**
 * Repopulate the saved-list dropdown from the library. Names are user content,
 * so options are built with textContent (never innerHTML).
 */
export function refreshSavedListSelect(): void {
    const select = document.getElementById('saved-list-select') as HTMLSelectElement | null;
    if (!select) return;

    const lists = getSavedLists();
    const previous = select.value;
    // Clear existing options
    while (select.firstChild) {
        select.removeChild(select.firstChild);
    }

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = t('wordList.selectSavedList') || '— Saved lists —';
    select.appendChild(placeholder);

    for (const list of lists) {
        const option = document.createElement('option');
        option.value = list.id;
        option.textContent = t('wordList.savedListOption', { name: list.name, count: list.words.length });
        select.appendChild(option);
    }

    // Preserve the current selection if it still exists
    if (previous && lists.some((l) => l.id === previous)) {
        select.value = previous;
    }

    // Disable manage buttons when nothing is selected / no lists exist
    updateSavedListControls();
}

/** Enable/disable the Load/Delete buttons based on the current selection. */
function updateSavedListControls(): void {
    const select = document.getElementById('saved-list-select') as HTMLSelectElement | null;
    const loadBtn = document.getElementById('btn-load-list') as HTMLButtonElement | null;
    const deleteBtn = document.getElementById('btn-delete-list') as HTMLButtonElement | null;
    const hasSelection = !!(select && select.value);
    if (loadBtn) loadBtn.disabled = !hasSelection;
    if (deleteBtn) deleteBtn.disabled = !hasSelection;
}

/** Force the word-list mode radios to `mode` and sync the pill styling. */
function setWordlistMode(mode: string): void {
    const radios = document.querySelectorAll('input[name="wordlist-mode"]');
    radios.forEach((r) => {
        const radio = r as HTMLInputElement;
        radio.checked = radio.value === mode;
        radio.closest('.wordlist-pill')?.classList.toggle('selected', radio.checked);
    });
}

/**
 * Load the selected saved list into the custom-words editor and switch to
 * "Custom only" mode so the list is used exactly as saved. The user still has
 * to Save settings to apply it to a game.
 */
export function loadSavedList(): void {
    const select = document.getElementById('saved-list-select') as HTMLSelectElement | null;
    const id = select?.value;
    if (!id) {
        showToast(t('wordList.selectListFirst') || 'Select a saved list first', 'warning');
        return;
    }
    const list = getSavedList(id);
    if (!list) {
        // Stale option (e.g. deleted in another tab) — resync the dropdown
        refreshSavedListSelect();
        showToast(t('wordList.listNotFound') || 'That list is no longer available', 'warning');
        return;
    }

    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    if (textarea) textarea.value = list.words.join('\n');
    setWordlistMode('custom');
    // Stage provenance: the editor now holds this saved list verbatim, but the
    // words don't reach state.activeWords until the user clicks "Save & Apply".
    // Committing the id here (pre-apply) would mis-credit a game if the user
    // then dismissed via "Close"; saveSettings promotes this on commit instead.
    pendingProvenance = { id: list.id, name: list.name };
    updateWordCount();
    showToast(t('wordList.listLoaded', { name: list.name }) || `Loaded “${list.name}”`, 'success');
}

/**
 * Forget which saved list is active. Called whenever the words diverge from a
 * loaded list (manual edit, mode switch, reset) so stale provenance can't be
 * stamped onto a game that isn't actually that list.
 */
export function clearWordListProvenance(): void {
    state.wordListId = null;
    state.wordListName = null;
    // Words diverged from any loaded list — drop the staged credit too, so a
    // subsequent apply doesn't promote a list the words no longer match.
    pendingProvenance = null;
}

/** Delete the selected saved list from the library. */
export function deleteSavedList(): void {
    const select = document.getElementById('saved-list-select') as HTMLSelectElement | null;
    const id = select?.value;
    if (!id) {
        showToast(t('wordList.selectListFirst') || 'Select a saved list first', 'warning');
        return;
    }
    const list = getSavedList(id);
    const removed = deleteList(id);
    refreshSavedListSelect();
    if (removed) {
        const name = list?.name ?? '';
        showToast(t('wordList.listDeleted', { name }) || `Deleted “${name}”`, 'success');
    } else if (list) {
        // The list existed but the pruned library couldn't be persisted (private
        // mode / quota) — surface the failure instead of a silent no-op.
        showToast(t('settings.storageFailed') || 'Could not delete — storage is unavailable', 'warning');
    }
}

/**
 * Save the words currently in the custom-words editor as a named list, using
 * the name from the save-name input. Re-saving an existing name overwrites it.
 */
export function saveCurrentAsList(): void {
    const nameInput = document.getElementById('save-list-name') as HTMLInputElement | null;
    const textarea = document.getElementById('custom-words') as HTMLTextAreaElement | null;
    const name = nameInput ? nameInput.value.trim() : '';
    const words = textarea ? parseWords(textarea.value) : [];

    const result = saveList(name, words);
    if (!result.ok) {
        const messages: Record<string, string> = {
            name: t('wordList.listNameRequired') || 'Enter a name for the list',
            empty: t('wordList.noWordsToSave') || 'Add some words before saving',
            full: t('wordList.libraryFull', { max: MAX_SAVED_LISTS }) || 'Saved-list limit reached',
            storage: t('settings.storageFailed') || 'Could not save — storage is unavailable',
        };
        showToast(messages[result.reason] ?? '', 'warning');
        if (result.reason === 'name' && nameInput) nameInput.focus();
        return;
    }

    if (nameInput) nameInput.value = '';
    // The editor content now IS this saved list — stage its provenance so a game
    // started after the user applies settings is credited to it. Committed by
    // saveSettings, not here, so an un-applied save can't mis-credit a game.
    pendingProvenance = { id: result.list.id, name: result.list.name };
    refreshSavedListSelect();
    const select = document.getElementById('saved-list-select') as HTMLSelectElement | null;
    if (select) {
        select.value = result.list.id;
        updateSavedListControls();
    }
    const key = result.overwritten ? 'wordList.listUpdated' : 'wordList.listSaved';
    showToast(t(key, { name: result.list.name }) || `Saved “${result.list.name}”`, 'success');
}

export function loadLocalSettings(): void {
    // Load word list mode
    state.wordListMode = safeGetItem('eigennamen-wordlist-mode', 'combined') || '';

    // Load custom words
    const customWordsText = safeGetItem('eigennamen-custom-words');
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
    if (safeGetItem('eigennamen-custom-words') || state.wordListMode === 'default') {
        return;
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        const response = await fetch('wordlist.txt', { signal: controller.signal });
        clearTimeout(timeoutId);
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
            logger.warn('Unexpected error loading wordlist.txt:', msg);
        }
    }
}

// Initialize selected class on page load
export function initRadioOptionStyles(): void {
    const wordlistModeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
    wordlistModeRadios.forEach((r) => {
        (r as HTMLInputElement)
            .closest('.wordlist-pill')
            ?.classList.toggle('selected', (r as HTMLInputElement).checked);
    });
}

// Set up event listeners for settings inputs (idempotent)
let settingsListenersInitialized = false;
export function initSettingsListeners(): void {
    if (settingsListenersInitialized) return;
    settingsListenersInitialized = true;

    const customWordsEl = document.getElementById('custom-words');
    if (customWordsEl) {
        // A manual edit means the words no longer match any loaded saved list.
        customWordsEl.addEventListener('input', () => {
            clearWordListProvenance();
            updateWordCount();
        });
    }

    const savedListSelect = document.getElementById('saved-list-select');
    if (savedListSelect) {
        savedListSelect.addEventListener('change', updateSavedListControls);
    }

    // Add event listeners for word list mode radio buttons
    const wordlistModeRadios = document.querySelectorAll('input[name="wordlist-mode"]');
    wordlistModeRadios.forEach((radio) => {
        radio.addEventListener('change', function () {
            // Update selected class for older browser support
            wordlistModeRadios.forEach((r) => {
                (r as HTMLInputElement)
                    .closest('.wordlist-pill')
                    ?.classList.toggle('selected', (r as HTMLInputElement).checked);
            });
            // A user-driven mode switch diverges from a loaded saved list.
            clearWordListProvenance();
            updateWordCount();
        });
    });

    initRadioOptionStyles();
}
