// ========== UTILS MODULE ==========
// Pure utility functions

// Sanitize string to prevent XSS when inserting into HTML
export function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// Format game timestamp with timezone indication
// Uses relative time for recent games, absolute time with timezone for older games
export function formatGameTimestamp(timestamp) {
    if (!timestamp) return 'Unknown';

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    // Use relative time for recent games (more intuitive)
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

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
    if (!input || !counter) return;

    const length = input.value.length;
    counter.textContent = `${length}/${maxLength}`;

    counter.classList.remove('warning', 'limit');
    if (length >= maxLength) {
        counter.classList.add('limit');
    } else if (length >= maxLength * 0.8) {
        counter.classList.add('warning');
    }
}

// Full board render (only called on new game or initial load)
// Get font size class for long words to ensure they fit on cards
export function getCardFontClass(word) {
    const len = word.length;
    if (len <= 8) return 'font-lg';      // Normal size
    if (len <= 11) return 'font-md';     // Slightly smaller
    if (len <= 14) return 'font-sm';     // Smaller
    if (len <= 17) return 'font-xs';     // Much smaller
    return 'font-min';                   // Minimum 8pt
}

// ========== SAFE LOCALSTORAGE WRAPPER ==========
// localStorage can throw in private browsing mode or when quota is exceeded
export function safeGetItem(key, defaultValue = null) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch (e) {
        console.warn('localStorage.getItem failed:', e.message);
        return defaultValue;
    }
}

export function safeSetItem(key, value) {
    try {
        localStorage.setItem(key, value);
        return true;
    } catch (e) {
        console.warn('localStorage.setItem failed:', e.message);
        return false;
    }
}

export function safeRemoveItem(key) {
    try {
        localStorage.removeItem(key);
        return true;
    } catch (e) {
        console.warn('localStorage.removeItem failed:', e.message);
        return false;
    }
}
