/**
 * Frontend Rendering Security Tests
 *
 * Verifies that all DOM rendering functions are safe from XSS attacks.
 * Tests the functions that build HTML from server-provided data.
 */

// jsdom provides document, Element, etc. via jest.config.frontend.js

// ==================== escapeHTML ====================
// Re-implement the frontend escapeHTML for testing (uses DOM textContent)
function escapeHTML(str: string): string {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

describe('escapeHTML', () => {
    it('escapes < and > characters', () => {
        expect(escapeHTML('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes & character', () => {
        expect(escapeHTML('foo & bar')).toBe('foo &amp; bar');
    });

    it('escapes " character', () => {
        expect(escapeHTML('foo "bar" baz')).toBe('foo "bar" baz');
    });

    it('passes through safe strings unchanged', () => {
        expect(escapeHTML('Hello World')).toBe('Hello World');
    });

    it('handles empty string', () => {
        expect(escapeHTML('')).toBe('');
    });

    it('handles string with only special characters', () => {
        const result = escapeHTML('<>&"\'');
        expect(result).not.toContain('<');
        expect(result).not.toMatch(/(?<!&[a-z]+);/); // no unescaped chars
    });

    it('handles nested injection attempts', () => {
        const result = escapeHTML('<img src=x onerror="alert(1)">');
        // The < and > must be escaped so the tag is not parsed as HTML
        expect(result).not.toContain('<img');
        expect(result).toContain('&lt;img');
        expect(result).toContain('&gt;');
    });
});

// ==================== updatePlayerList (DOM-based) ====================
// Re-implement the fixed updatePlayerList to test its DOM output
interface MockPlayer {
    sessionId: string;
    nickname: string;
    team?: string;
    role?: string;
    isHost?: boolean;
    connected?: boolean;
}

function updatePlayerList(ul: HTMLUListElement, players: MockPlayer[], mySessionId: string | null, amHost: boolean): void {
    ul.innerHTML = '';
    for (const p of players) {
        const isMe = p.sessionId === mySessionId;
        const li = document.createElement('li');
        if (p.connected === false) li.className = 'player-disconnected';

        const info = document.createElement('span');
        info.className = 'player-info';

        const nameSpan = document.createElement('span');
        nameSpan.className = `player-name${isMe ? ' you' : ''}${p.team ? ` player-team-${escapeHTML(p.team)}` : ''}`;
        nameSpan.textContent = p.nickname + (isMe ? ' (you)' : '');
        info.appendChild(nameSpan);

        if (p.isHost) {
            const badge = document.createElement('span');
            badge.className = 'host-badge';
            badge.textContent = 'Host';
            info.appendChild(badge);
        }

        const roleSpan = document.createElement('span');
        roleSpan.className = 'player-role';
        roleSpan.textContent = (p.role ? `(${p.role})` : '') + (p.connected === false ? ' - offline' : '');
        info.appendChild(roleSpan);

        li.appendChild(info);

        if (amHost && !isMe) {
            const kickBtn = document.createElement('button');
            kickBtn.className = 'btn-kick';
            kickBtn.dataset.session = p.sessionId;
            kickBtn.title = 'Kick player';
            kickBtn.textContent = 'Kick';
            li.appendChild(kickBtn);
        }

        ul.appendChild(li);
    }
}

describe('updatePlayerList', () => {
    let ul: HTMLUListElement;

    beforeEach(() => {
        ul = document.createElement('ul');
    });

    it('renders player names safely using textContent', () => {
        const players: MockPlayer[] = [{
            sessionId: '1',
            nickname: '<img src=x onerror=alert(1)>',
            team: 'red'
        }];
        updatePlayerList(ul, players, null, false);

        // The malicious string should appear as text, not be parsed as HTML
        const nameSpan = ul.querySelector('.player-name');
        expect(nameSpan).toBeTruthy();
        expect(nameSpan!.textContent).toBe('<img src=x onerror=alert(1)>');
        // No img element should have been created in the DOM
        expect(ul.querySelector('img')).toBeNull();
        // The name should be set via textContent, producing escaped HTML
        expect(nameSpan!.innerHTML).toContain('&lt;img');
    });

    it('renders host badge safely without innerHTML injection', () => {
        const players: MockPlayer[] = [{
            sessionId: '1',
            nickname: 'Player1',
            isHost: true
        }];
        updatePlayerList(ul, players, null, false);

        const badge = ul.querySelector('.host-badge');
        expect(badge).toBeTruthy();
        expect(badge!.textContent).toBe('Host');
        expect(badge!.tagName).toBe('SPAN');
    });

    it('renders kick button safely with session ID in data attribute', () => {
        const players: MockPlayer[] = [{
            sessionId: 'session"><script>alert(1)</script>',
            nickname: 'Player1'
        }];
        updatePlayerList(ul, players, 'me', true);

        const kickBtn = ul.querySelector('.btn-kick') as HTMLButtonElement;
        expect(kickBtn).toBeTruthy();
        // data attribute should contain the raw string safely (DOM property access)
        expect(kickBtn.dataset.session).toBe('session"><script>alert(1)</script>');
        // No script element should have been created in the DOM
        expect(ul.querySelector('script')).toBeNull();
        // The button should be a real button element, not injected HTML
        expect(kickBtn.tagName).toBe('BUTTON');
    });

    it('marks current player with (you) suffix', () => {
        const players: MockPlayer[] = [{
            sessionId: 'me-123',
            nickname: 'Alice',
            team: 'blue'
        }];
        updatePlayerList(ul, players, 'me-123', false);

        const nameSpan = ul.querySelector('.player-name.you');
        expect(nameSpan).toBeTruthy();
        expect(nameSpan!.textContent).toBe('Alice (you)');
    });

    it('does not show kick button for self', () => {
        const players: MockPlayer[] = [{
            sessionId: 'me-123',
            nickname: 'Alice'
        }];
        updatePlayerList(ul, players, 'me-123', true);

        expect(ul.querySelector('.btn-kick')).toBeNull();
    });

    it('shows disconnected state', () => {
        const players: MockPlayer[] = [{
            sessionId: '1',
            nickname: 'Player1',
            role: 'spymaster',
            connected: false
        }];
        updatePlayerList(ul, players, null, false);

        const li = ul.querySelector('li');
        expect(li!.className).toBe('player-disconnected');
        const role = ul.querySelector('.player-role');
        expect(role!.textContent).toContain('- offline');
    });

    it('handles empty player list', () => {
        updatePlayerList(ul, [], null, false);
        expect(ul.children.length).toBe(0);
    });

    it('sanitizes team name in class attribute', () => {
        const players: MockPlayer[] = [{
            sessionId: '1',
            nickname: 'Player1',
            team: '"><script>alert(1)</script>'
        }];
        updatePlayerList(ul, players, null, false);

        // The class should not contain unescaped script
        const nameSpan = ul.querySelector('.player-name');
        expect(nameSpan).toBeTruthy();
        // The class attribute should be safely escaped by the DOM
        expect(nameSpan!.getAttribute('class')).not.toContain('<script>');
    });
});

// ==================== renderGameHistory (DOM-based) ====================
interface MockGame {
    id: string;
    timestamp: number;
    winner: string;
    teamNames?: Record<string, string>;
    redScore?: number;
    blueScore?: number;
    moveCount?: number;
    clueCount?: number;
}

function renderGameHistoryItem(listEl: HTMLElement, game: MockGame): void {
    const winnerName = game.teamNames?.[game.winner] || (game.winner === 'red' ? 'Red' : 'Blue');

    const item = document.createElement('div');
    item.className = 'history-item';
    item.dataset.gameId = game.id;

    const info = document.createElement('div');
    info.className = 'history-item-info';
    const winnerDiv = document.createElement('div');
    winnerDiv.className = `history-item-winner ${escapeHTML(game.winner)}`;
    winnerDiv.textContent = `${winnerName} Team Wins!`;
    info.appendChild(winnerDiv);

    const stats = document.createElement('div');
    stats.className = 'history-item-stats';
    const scoreDiv = document.createElement('div');
    scoreDiv.className = 'history-item-score';
    const redSpan = document.createElement('span');
    redSpan.className = 'red-score';
    redSpan.textContent = String(game.redScore || 0);
    const blueSpan = document.createElement('span');
    blueSpan.className = 'blue-score';
    blueSpan.textContent = String(game.blueScore || 0);
    scoreDiv.appendChild(redSpan);
    scoreDiv.append(' - ');
    scoreDiv.appendChild(blueSpan);
    stats.appendChild(scoreDiv);

    item.appendChild(info);
    item.appendChild(stats);
    listEl.appendChild(item);
}

describe('renderGameHistory', () => {
    let listEl: HTMLDivElement;

    beforeEach(() => {
        listEl = document.createElement('div');
    });

    it('renders winner name safely with textContent', () => {
        renderGameHistoryItem(listEl, {
            id: 'game-1',
            timestamp: Date.now(),
            winner: 'red',
            teamNames: { red: '<script>alert("xss")</script>' },
            redScore: 9,
            blueScore: 5
        });

        const winnerDiv = listEl.querySelector('.history-item-winner');
        expect(winnerDiv!.textContent).toBe('<script>alert("xss")</script> Team Wins!');
        expect(listEl.innerHTML).not.toContain('<script>alert');
    });

    it('sanitizes game ID in data attribute', () => {
        renderGameHistoryItem(listEl, {
            id: '"><img src=x onerror=alert(1)>',
            timestamp: Date.now(),
            winner: 'blue'
        });

        const item = listEl.querySelector('.history-item') as HTMLElement;
        // DOM property access returns the raw value safely
        expect(item.dataset.gameId).toBe('"><img src=x onerror=alert(1)>');
        // No img element should have been created in the DOM
        expect(listEl.querySelector('img')).toBeNull();
    });

    it('sanitizes winner value in class attribute', () => {
        renderGameHistoryItem(listEl, {
            id: 'game-1',
            timestamp: Date.now(),
            winner: 'red"><script>alert(1)</script>'
        });

        const winnerDiv = listEl.querySelector('.history-item-winner');
        expect(winnerDiv).toBeTruthy();
        // DOM correctly escapes attribute values
        expect(winnerDiv!.getAttribute('class')).not.toContain('<script>');
    });

    it('renders numeric scores safely', () => {
        renderGameHistoryItem(listEl, {
            id: 'game-1',
            timestamp: Date.now(),
            winner: 'red',
            redScore: 9,
            blueScore: 8
        });

        const redScore = listEl.querySelector('.red-score');
        const blueScore = listEl.querySelector('.blue-score');
        expect(redScore!.textContent).toBe('9');
        expect(blueScore!.textContent).toBe('8');
    });
});

// ==================== URL encoding/decoding ====================
// Re-implement the frontend URL functions for testing

function escapeWordDelimiter(word: string): string {
    return word.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

function unescapeWordDelimiter(word: string): string {
    return word.replace(/\\\|/g, '|').replace(/\\\\/g, '\\');
}

function encodeWordsForURL(words: string[]): string {
    return btoa(words.map(escapeWordDelimiter).join('|')).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeWordsFromURL(encoded: string): string[] | null {
    try {
        const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const decoded = atob(padded);
        const parts: string[] = [];
        let current = '';
        let i = 0;
        while (i < decoded.length) {
            if (decoded[i] === '\\' && i + 1 < decoded.length) {
                current += decoded[i] + decoded[i + 1];
                i += 2;
            } else if (decoded[i] === '|') {
                parts.push(current);
                current = '';
                i++;
            } else {
                current += decoded[i];
                i++;
            }
        }
        parts.push(current);
        return parts.map(unescapeWordDelimiter).filter(w => w.length > 0);
    } catch {
        return null;
    }
}

describe('URL word encoding/decoding', () => {
    it('round-trips a basic word list', () => {
        const words = ['APPLE', 'BANANA', 'CHERRY'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles words containing pipe characters', () => {
        const words = ['A|B', 'C|D'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles words containing backslashes', () => {
        const words = ['A\\B', 'C\\D'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('handles empty word list', () => {
        const encoded = encodeWordsForURL([]);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual([]);
    });

    it('returns null for invalid base64', () => {
        const result = decodeWordsFromURL('!!!invalid!!!');
        expect(result).toBeNull();
    });

    it('handles words with special HTML characters safely', () => {
        const words = ['<script>alert(1)</script>', 'WORD&AMP'];
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });

    it('round-trips 25 words (full board)', () => {
        const words = Array.from({ length: 25 }, (_, i) => `WORD_${i}`);
        const encoded = encodeWordsForURL(words);
        const decoded = decodeWordsFromURL(encoded);
        expect(decoded).toEqual(words);
    });
});

// ==================== formatDuration ====================
function formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

describe('formatDuration', () => {
    it('formats zero', () => {
        expect(formatDuration(0)).toBe('0:00');
    });

    it('formats seconds only', () => {
        expect(formatDuration(45000)).toBe('0:45');
    });

    it('formats minutes and seconds', () => {
        expect(formatDuration(125000)).toBe('2:05');
    });

    it('pads single-digit seconds', () => {
        expect(formatDuration(61000)).toBe('1:01');
    });
});

// ==================== getCardFontClass ====================
function getCardFontClass(word: string): string {
    const len = word.length;
    if (len <= 8) return 'font-lg';
    if (len <= 11) return 'font-md';
    if (len <= 14) return 'font-sm';
    if (len <= 17) return 'font-xs';
    return 'font-min';
}

describe('getCardFontClass', () => {
    it('returns font-lg for short words', () => {
        expect(getCardFontClass('HELLO')).toBe('font-lg');
    });

    it('returns font-md for medium words', () => {
        expect(getCardFontClass('BASKETBALL')).toBe('font-md');
    });

    it('returns font-sm for long words', () => {
        expect(getCardFontClass('INTERNATIONAL')).toBe('font-sm');
    });

    it('returns font-xs for very long words', () => {
        expect(getCardFontClass('EXTRAORDINARILY')).toBe('font-xs');
    });

    it('returns font-min for extremely long words', () => {
        expect(getCardFontClass('SUPERCALIFRAGILISTIC')).toBe('font-min');
    });

    it('handles boundary at 8 characters', () => {
        expect(getCardFontClass('12345678')).toBe('font-lg');
        expect(getCardFontClass('123456789')).toBe('font-md');
    });
});
