/**
 * Frontend Game Log tests: clue/guess rendering, result classes, reset, the
 * empty placeholder, DOM cap, XSS-safety, and the collapse toggle.
 * Test environment: jsdom
 */

jest.mock('../../frontend/i18n', () => ({
    t: (key: string) => key,
    initI18n: async () => {},
    setLanguage: async () => {},
    getLanguage: () => 'en',
    translatePage: () => {},
    LANGUAGES: { en: { name: 'English', flag: 'EN' } },
    DEFAULT_LANGUAGE: 'en',
}));

import { logClue, logGuess, clearGameLog } from '../../frontend/gameLog';
import { state } from '../../frontend/state';

function setupDOM(): void {
    document.body.innerHTML = `
        <aside id="gamelog-panel">
            <button id="gamelog-toggle" aria-expanded="true"></button>
            <div id="gamelog-body">
                <ol id="gamelog-entries"></ol>
                <p id="gamelog-empty" hidden></p>
            </div>
        </aside>
    `;
}

const entries = () => document.getElementById('gamelog-entries')!;
const empty = () => document.getElementById('gamelog-empty')!;

beforeEach(() => {
    setupDOM();
    state.teamNames = { red: 'Red', blue: 'Blue' };
    clearGameLog();
});

describe('logClue', () => {
    test('renders a clue with team class, word, and number', () => {
        logClue('red', 'OCEAN', 2);
        const li = entries().children[0] as HTMLElement;
        expect(li.classList.contains('gamelog-clue')).toBe(true);
        expect(li.classList.contains('red')).toBe(true);
        expect(li.querySelector('.gamelog-word')!.textContent).toBe('OCEAN');
        expect(li.querySelector('.gamelog-number')!.textContent).toBe('(2)');
    });

    test('omits the number element for an unlimited (0) clue', () => {
        logClue('blue', 'SKY', 0);
        const li = entries().children[0] as HTMLElement;
        expect(li.classList.contains('blue')).toBe(true);
        expect(li.querySelector('.gamelog-number')).toBeNull();
    });

    test('ignores an empty clue word', () => {
        logClue('red', '', 1);
        expect(entries().children.length).toBe(0);
    });
});

describe('logGuess result classes', () => {
    test.each([
        ['red', 'red', 'correct', '✓'],
        ['red', 'blue', 'wrong', '✗'],
        ['blue', 'neutral', 'neutral', '⬜'],
        ['red', 'assassin', 'assassin', '💀'],
    ])('team %s on a %s card => %s', (team, type, cls, icon) => {
        logGuess(team, 'WORD', type);
        const li = entries().children[0] as HTMLElement;
        expect(li.classList.contains('gamelog-guess')).toBe(true);
        expect(li.classList.contains(cls)).toBe(true);
        expect(li.querySelector('.gamelog-icon')!.textContent).toBe(icon);
        expect(li.querySelector('.gamelog-word')!.textContent).toBe('WORD');
    });
});

describe('empty placeholder + reset', () => {
    test('placeholder hides once an entry exists and reappears after clear', () => {
        logGuess('red', 'APPLE', 'red');
        expect(empty().hidden).toBe(true);
        clearGameLog();
        expect(entries().children.length).toBe(0);
        expect(empty().hidden).toBe(false);
    });
});

describe('DOM growth cap', () => {
    test('prunes oldest entries beyond the cap', () => {
        for (let i = 0; i < 250; i++) logGuess('red', `W${i}`, 'red');
        // MAX_GAME_LOG_ENTRIES = 200
        expect(entries().children.length).toBe(200);
        // Oldest pruned, newest retained
        const lastWord = (entries().lastElementChild as HTMLElement).querySelector('.gamelog-word')!.textContent;
        expect(lastWord).toBe('W249');
    });
});

describe('XSS safety', () => {
    test('renders a malicious word as text, not markup', () => {
        logGuess('red', '<img src=x onerror=alert(1)>', 'red');
        const word = entries().querySelector('.gamelog-word')!;
        expect(word.querySelector('img')).toBeNull();
        expect(word.textContent).toBe('<img src=x onerror=alert(1)>');
    });
});

describe('toggle', () => {
    test('collapses and expands the body and flips aria-expanded', () => {
        jest.isolateModules(() => {
            setupDOM();
            const { initGameLog } = require('../../frontend/gameLog');
            initGameLog();
            const toggle = document.getElementById('gamelog-toggle')!;
            const body = document.getElementById('gamelog-body')!;
            toggle.click();
            expect(body.hidden).toBe(true);
            expect(toggle.getAttribute('aria-expanded')).toBe('false');
            toggle.click();
            expect(body.hidden).toBe(false);
            expect(toggle.getAttribute('aria-expanded')).toBe('true');
        });
    });
});
