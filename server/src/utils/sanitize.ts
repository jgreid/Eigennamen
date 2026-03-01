function sanitizeHtml(input: unknown): string {
    if (typeof input !== 'string') return '';

    return input
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
}

function removeControlChars(input: unknown): string {
    if (typeof input !== 'string') return '';
    // Remove ASCII control characters (0x00-0x1F) except newline (0x0A) and carriage return (0x0D)
    return input.replace(/[\x00-\x09\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

function isReservedName(nickname: unknown, reservedNames: string[]): boolean {
    if (typeof nickname !== 'string') return false;
    const normalized = toEnglishLowerCase(nickname).trim();
    return reservedNames.some((reserved) => normalized === reserved);
}

function toEnglishLowerCase(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input.toLocaleLowerCase('en-US');
}

function toEnglishUpperCase(input: unknown): string {
    if (typeof input !== 'string') return '';
    return input.toLocaleUpperCase('en-US');
}

function normalizeRoomCode(roomCode: string): string {
    return toEnglishLowerCase(roomCode.trim());
}

export { sanitizeHtml, removeControlChars, isReservedName, toEnglishLowerCase, toEnglishUpperCase, normalizeRoomCode };
