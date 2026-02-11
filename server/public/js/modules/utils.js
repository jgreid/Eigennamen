// ========== UTILS MODULE ==========
// Pure utility functions
/**
 * Copy text to clipboard using the modern Clipboard API with a
 * fallback for older browsers or restricted contexts (e.g. HTTP).
 * @param {string} text - Text to copy
 * @returns {Promise<boolean>} Resolves true on success
 */
export async function copyToClipboard(text) {
    // Prefer modern Clipboard API (requires HTTPS or localhost)
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        try {
            await navigator.clipboard.writeText(text);
            return true;
        }
        catch {
            // Fall through to legacy approach
        }
    }
    // Legacy fallback using a temporary textarea
    try {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        return true;
    }
    catch {
        return false;
    }
}
// Sanitize string to prevent XSS when inserting into HTML
export function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}
// Seeded random number generator using Mulberry32 algorithm
// Provides better distribution than Math.sin-based approach
// Must stay in sync with server-side implementation in gameService.js
export function seededRandom(seed) {
    // Mulberry32 PRNG - better distribution than sin-based approach
    let t = (seed + 0x6D2B79F5) | 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
export function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}
export function shuffleWithSeed(array, seed) {
    const shuffled = [...array];
    let currentSeed = seed;
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(seededRandom(currentSeed++) * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}
export function generateGameSeed() {
    // Feature-detect crypto API with fallback for older browsers / restricted contexts
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
        const array = new Uint32Array(2);
        crypto.getRandomValues(array);
        return array[0].toString(36) + array[1].toString(36).substring(0, 4);
    }
    // Fallback: Math.random (less secure but functional)
    return Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 6);
}
// Compress words for URL (simple encoding)
// Escape delimiter (|) and escape char (\) in words to prevent corruption
export function escapeWordDelimiter(word) {
    return word.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}
export function unescapeWordDelimiter(word) {
    return word.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}
export function encodeWordsForURL(words) {
    return btoa(words.map(escapeWordDelimiter).join('|')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeWordsFromURL(encoded) {
    try {
        const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(padded);
        // Split on unescaped | only (not preceded by odd number of backslashes)
        const parts = [];
        let current = '';
        let i = 0;
        while (i < decoded.length) {
            if (decoded[i] === '\\' && i + 1 < decoded.length) {
                current += decoded[i] + decoded[i + 1];
                i += 2;
            }
            else if (decoded[i] === '|') {
                parts.push(current);
                current = '';
                i++;
            }
            else {
                current += decoded[i];
                i++;
            }
        }
        parts.push(current);
        return parts.map(unescapeWordDelimiter).filter(w => w.length > 0);
    }
    catch (e) {
        return null;
    }
}
// Format game timestamp with timezone indication
// Uses relative time for recent games, absolute time with timezone for older games
export function formatGameTimestamp(timestamp) {
    if (!timestamp)
        return 'Unknown';
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    // Use relative time for recent games (more intuitive)
    if (diffMins < 1)
        return 'Just now';
    if (diffMins < 60)
        return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24)
        return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7)
        return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    // For older games, show date with timezone abbreviation
    // This makes it clear what timezone the time is displayed in
    const dateOptions = { month: 'short', day: 'numeric' };
    const timeOptions = { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' };
    const dateStr = date.toLocaleDateString(undefined, dateOptions);
    const timeStr = date.toLocaleTimeString(undefined, timeOptions);
    return `${dateStr}, ${timeStr}`;
}
export function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}
// ========== CHARACTER COUNTER ==========
export function updateCharCounter(inputId, counterId, maxLength) {
    const input = document.getElementById(inputId);
    const counter = document.getElementById(counterId);
    if (!input || !counter)
        return;
    const length = input.value.length;
    counter.textContent = `${length}/${maxLength}`;
    counter.classList.remove('warning', 'limit');
    if (length >= maxLength) {
        counter.classList.add('limit');
    }
    else if (length >= maxLength * 0.8) {
        counter.classList.add('warning');
    }
}
// Full board render (only called on new game or initial load)
// Get font size class for long words to ensure they fit on cards
export function getCardFontClass(word) {
    const len = word.length;
    if (len <= 8)
        return 'font-lg'; // Normal size
    if (len <= 11)
        return 'font-md'; // Slightly smaller
    if (len <= 14)
        return 'font-sm'; // Smaller
    if (len <= 17)
        return 'font-xs'; // Much smaller
    return 'font-min'; // Minimum 8pt
}
/**
 * After board render, shrink font on single-word cards that overflow.
 * Multi-word cards are allowed to wrap at word boundaries so they're skipped.
 * Uses requestAnimationFrame to measure after layout.
 */
export function fitCardText(board) {
    requestAnimationFrame(() => {
        const cards = board.querySelectorAll('.card:not(.multi-word)');
        const MIN_FONT_SIZE = 8; // px
        // Phase 1: batch-read all measurements to avoid layout thrashing
        const measurements = [];
        for (const card of cards) {
            measurements.push({
                card: card,
                fontSize: parseFloat(getComputedStyle(card).fontSize),
                scrollWidth: card.scrollWidth,
                clientWidth: card.clientWidth
            });
        }
        // Phase 2: batch-write only the cards that need shrinking
        for (const m of measurements) {
            if (m.scrollWidth > m.clientWidth) {
                let fs = m.fontSize;
                // Estimate target size proportionally, then verify
                const ratio = m.clientWidth / m.scrollWidth;
                fs = Math.max(MIN_FONT_SIZE, Math.floor(fs * ratio));
                m.card.style.fontSize = `${fs}px`;
            }
        }
    });
}
// ========== SAFE LOCALSTORAGE WRAPPER ==========
// localStorage can throw in private browsing mode or when quota is exceeded
export function safeGetItem(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('localStorage.getItem failed:', msg);
        return defaultValue;
    }
}
export function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('localStorage.setItem failed:', msg);
        return false;
    }
}
export function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
        return true;
    }
    catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn('localStorage.removeItem failed:', msg);
        return false;
    }
}
//# sourceMappingURL=utils.js.map