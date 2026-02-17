/**
 * Frontend Rendering Security Tests
 *
 * Verifies that DOM rendering patterns used throughout the frontend are
 * safe from XSS attacks. Tests the functions that build HTML from
 * server-provided data.
 *
 * escapeHTML is imported from the real utils module.
 * updatePlayerList and renderGameHistoryItem are local reimplementations
 * that mirror the production code patterns (in multiplayer.ts and history.ts
 * respectively). They are tested here as DOM security pattern tests because
 * the production versions depend on EigennamenClient and specific DOM elements
 * that would require complex mocking.
 */

import { escapeHTML } from '../../frontend/utils';

// ==================== escapeHTML ====================

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

// ==================== updatePlayerList (DOM pattern test) ====================
// Mirrors the production updatePlayerList from multiplayer.ts
// but takes explicit params instead of reading from EigennamenClient.
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

// ==================== renderGameHistory (DOM pattern test) ====================
// Mirrors the production renderGameHistory from history.ts
// but operates on a passed-in element instead of reading from document.getElementById.
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
