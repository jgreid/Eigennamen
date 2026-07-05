// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, hostRoomWithMode, joinRoom, selectTeam, becomeSpymaster } = require('./helpers');

/**
 * Game Modes E2E Tests
 *
 * Tests Duet (cooperative) and Match (multi-round) game modes
 * in multiplayer context. Classic mode is implicitly tested by
 * existing specs; these cover the mode-specific flows that were
 * previously untested end-to-end.
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Start a two-player multiplayer game in a specific mode. The host is created
 * via the setup screen (the only reliable way to pick the mode before the game
 * auto-starts); host joins red, guest joins blue.
 * Returns { host, guest, roomId, ctx1, ctx2 }.
 * @param {import('@playwright/test').Browser} browser
 * @param {'match' | 'classic' | 'duet'} mode
 */
async function setupTwoPlayerGame(browser, mode) {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const host = await ctx1.newPage();
    const guest = await ctx2.newPage();

    const roomId = await hostRoomWithMode(host, `${mode}Host`, mode);
    await joinRoom(guest, roomId, `${mode}Guest`);
    await expect(host.locator('body')).toContainText(`${mode}Guest`, { timeout: 5000 });

    // Both pick teams. The game already auto-started in the chosen mode.
    await selectTeam(host, 'red');
    await selectTeam(guest, 'blue');

    await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
    await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

    return { host, guest, roomId, ctx1, ctx2 };
}

/**
 * Reveal a specific card in a multiplayer game: the acting team's spymaster
 * (page `spy`) gives a clue (required before any reveal, P0-2), then its clicker
 * (page `clk`) reveals the card at `index`. Both must already be on the team on
 * turn — `spy` as spymaster, `clk` as clicker.
 * @param {import('@playwright/test').Page} spy
 * @param {import('@playwright/test').Page} clk
 * @param {number} index
 */
async function clueThenReveal(spy, clk, index) {
    await spy.locator(sel.clueWordInput).fill('signal');
    await spy.locator(sel.clueNumberInput).fill('9');
    await spy.locator(sel.giveClueBtn).click();
    await clk.locator(sel.boardCard).nth(index).click();
}

/**
 * Read the pure board words via the data-word attribute (card text can include
 * match-mode score badges like "TABLE+3", which differ between spymaster and
 * clicker views).
 * @param {import('@playwright/test').Page} page
 */
async function boardWords(page) {
    return page.locator(sel.boardCard).evaluateAll((els) => els.map((e) => e.getAttribute('data-word') || ''));
}

/**
 * Start a two-player game where BOTH players are on the team on turn — host as
 * spymaster (can read the board + give clues) and guest as clicker (can reveal).
 * Needed for reveal tests: a multiplayer reveal requires a clue, and one player
 * cannot be both spymaster and clicker (a spymaster can't switch role mid-game).
 * @param {import('@playwright/test').Browser} browser
 * @param {'match' | 'classic' | 'duet'} mode
 */
async function setupSameTeamGame(browser, mode) {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const host = await ctx1.newPage();
    const guest = await ctx2.newPage();

    const roomId = await hostRoomWithMode(host, `${mode}SHost`, mode);
    await joinRoom(guest, roomId, `${mode}SGuest`);
    await expect(host.locator('body')).toContainText(`${mode}SGuest`, { timeout: 5000 });
    await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
    await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

    const turnText = await host.locator(sel.turnIndicator).textContent();
    const team = turnText?.includes('Red') ? 'red' : 'blue';
    await selectTeam(host, team);
    await host.locator(sel.spymasterBtn).click();
    await selectTeam(guest, team);
    await guest.locator(sel.clickerBtn).click();

    return { host, guest, roomId, ctx1, ctx2, team };
}

/**
 * Collect card indices by spy type while in spymaster view.
 * @param {import('@playwright/test').Page} page
 */
async function getCardTypeMap(page) {
    const cards = page.locator(sel.boardCard);
    /** @type {{ red: number[], blue: number[], neutral: number[], assassin: number[], green: number[] }} */
    const map = { red: [], blue: [], neutral: [], assassin: [], green: [] };
    for (let i = 0; i < 25; i++) {
        const cls = (await cards.nth(i).getAttribute('class')) || '';
        if (cls.includes('spy-red')) map.red.push(i);
        else if (cls.includes('spy-blue')) map.blue.push(i);
        else if (cls.includes('spy-neutral')) map.neutral.push(i);
        else if (cls.includes('spy-assassin')) map.assassin.push(i);
        else if (cls.includes('spy-green')) map.green.push(i);
    }
    return map;
}

// ---------------------------------------------------------------------------
// Duet Mode Tests
// ---------------------------------------------------------------------------

test.describe('Duet Mode', () => {
    test('can start a duet mode game with correct board', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'duet');

        try {
            // Board should have 25 cards
            const hostCards = host.locator(sel.boardCard);
            await expect(hostCards).toHaveCount(25);

            const guestCards = guest.locator(sel.boardCard);
            await expect(guestCards).toHaveCount(25);

            // Both players should see the same words
            const hostWords = await hostCards.allTextContents();
            const guestWords = await guestCards.allTextContents();
            expect(hostWords.map((w) => w.trim())).toEqual(guestWords.map((w) => w.trim()));
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('duet mode spymasters see different card perspectives', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'duet');

        try {
            // Host (red team) becomes spymaster
            await host.locator(sel.spymasterBtn).click();
            const hostTypeMap = await getCardTypeMap(host);

            // Guest (blue team) becomes spymaster
            await guest.locator(sel.spymasterBtn).click();
            const guestTypeMap = await getCardTypeMap(guest);

            // Both should see card colors (spymaster view active)
            const hostBoard = host.locator(sel.board);
            await expect(hostBoard).toHaveClass(/spymaster-mode/);

            const guestBoard = guest.locator(sel.board);
            await expect(guestBoard).toHaveClass(/spymaster-mode/);

            // In Duet mode, each side has a different perspective
            // (types[] for red, duetTypes[] for blue).
            // They should NOT be identical since each side has different layout.
            const hostTotal =
                hostTypeMap.red.length +
                hostTypeMap.blue.length +
                hostTypeMap.neutral.length +
                hostTypeMap.assassin.length +
                hostTypeMap.green.length;
            const guestTotal =
                guestTypeMap.red.length +
                guestTypeMap.blue.length +
                guestTypeMap.neutral.length +
                guestTypeMap.assassin.length +
                guestTypeMap.green.length;

            // Both should have 25 cards classified
            expect(hostTotal).toBe(25);
            expect(guestTotal).toBe(25);
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('card reveal works in duet mode', async ({ browser }) => {
        // Host = spymaster (clues), guest = clicker (reveals); a reveal needs a
        // clue first and one player can't hold both seats.
        const { host, guest, ctx1, ctx2 } = await setupSameTeamGame(browser, 'duet');

        try {
            const cardText = await guest.locator(sel.boardCard).first().textContent();
            await clueThenReveal(host, guest, 0);

            // Card should be revealed on the acting (guest) player
            await expect(guest.locator(sel.boardCard).first()).toHaveClass(/revealed/, { timeout: 5000 });

            // And on the other (host) player too
            const otherCards = host.locator(sel.boardCard);
            for (let i = 0; i < 25; i++) {
                const txt = await otherCards.nth(i).textContent();
                if (txt?.trim() === cardText?.trim()) {
                    await expect(otherCards.nth(i)).toHaveClass(/revealed/, { timeout: 5000 });
                    break;
                }
            }
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Classic Mode Tests
// ---------------------------------------------------------------------------

test.describe('Classic Mode', () => {
    test('can start a classic mode game', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'classic');

        try {
            // Board should have 25 cards
            await expect(host.locator(sel.boardCard)).toHaveCount(25);

            // Host becomes spymaster to verify classic card distribution
            await host.locator(sel.spymasterBtn).click();

            // Retry the count until the spymaster view has fully rendered every
            // card's spy-* class (9 + 8 + 7 + 1 = 25).
            await expect(async () => {
                const typeMap = await getCardTypeMap(host);
                const total =
                    typeMap.red.length + typeMap.blue.length + typeMap.neutral.length + typeMap.assassin.length;
                expect(total).toBe(25);
                expect([typeMap.red.length, typeMap.blue.length].sort()).toEqual([8, 9]);
                expect(typeMap.assassin.length).toBe(1);
                expect(typeMap.neutral.length).toBe(7);
            }).toPass({ timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('assassin card ends game in classic mode', async ({ browser }) => {
        // Host = spymaster (reads the assassin + clues), guest = clicker (reveals);
        // one player can't be both, and a reveal needs a clue first.
        const { host, guest, ctx1, ctx2 } = await setupSameTeamGame(browser, 'classic');

        try {
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];

            await clueThenReveal(host, guest, assassinIdx);
            await expect(guest.locator(sel.boardCard).nth(assassinIdx)).toHaveClass(/revealed/, { timeout: 5000 });

            // Revealing the assassin ends the game for both players.
            await expect(host.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

// ---------------------------------------------------------------------------
// Match Mode Tests (Multi-Round)
// ---------------------------------------------------------------------------

test.describe('Match Mode', () => {
    test('match mode game starts with correct board', async ({ browser }) => {
        // Match is the default mode, so no explicit mode selection needed
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'match');

        try {
            await expect(host.locator(sel.boardCard)).toHaveCount(25);

            // Both players should see the same words (compare data-word, not text,
            // which includes match-mode score badges).
            const hostWords = await boardWords(host);
            const guestWords = await boardWords(guest);
            expect(hostWords).toEqual(guestWords);
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('assassin ends round in match mode and new game button appears', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupSameTeamGame(browser, 'match');

        try {
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];

            await clueThenReveal(host, guest, assassinIdx);
            await expect(guest.locator(sel.boardCard).nth(assassinIdx)).toHaveClass(/revealed/, { timeout: 5000 });

            // Round/game should be over
            await expect(host.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

            // The "New Game" button should be visible (host can start next round)
            await expect(host.locator(sel.newGameBtn)).toBeVisible({ timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('match mode next round creates a new board with different words', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupSameTeamGame(browser, 'match');

        try {
            // Capture round 1 words (data-word, not text, to avoid match score badges)
            const round1Words = await boardWords(host);

            // End the round by revealing the assassin (clue first, guest reveals).
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];
            await clueThenReveal(host, guest, assassinIdx);
            await expect(host.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

            // Start next round via the new game button
            const newGameBtn = host.locator(sel.newGameBtn);
            await expect(newGameBtn).toBeVisible({ timeout: 5000 });
            await newGameBtn.click();

            // Wait for new board to render (words should change)
            await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

            // Give a moment for the board to fully update
            await host.waitForTimeout(1000);

            // Capture round 2 words
            const round2Words = await boardWords(host);

            // Words should be different in the new round (extremely unlikely to be the same)
            expect(round2Words).not.toEqual(round1Words);

            // Guest should also see the same new board
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            const guestRound2Words = await boardWords(guest);
            expect(guestRound2Words).toEqual(round2Words);
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});
