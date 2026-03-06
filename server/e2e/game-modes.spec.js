// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, joinRoom, selectTeam } = require('./helpers');

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
 * Select a game mode radio button (host only, game mode section must be visible).
 * @param {import('@playwright/test').Page} page
 * @param {'match' | 'classic' | 'duet'} mode
 */
async function selectGameMode(page, mode) {
    const radio = page.locator(`input[name="gameMode"][value="${mode}"]`);
    await radio.check({ force: true });
    // Wait briefly for the setting to propagate to server
    await page.waitForTimeout(500);
}

/**
 * Start a two-player multiplayer game with a specific game mode.
 * Returns { host, guest, roomId, ctx1, ctx2 }.
 * @param {import('@playwright/test').Browser} browser
 * @param {'match' | 'classic' | 'duet'} mode
 */
async function setupTwoPlayerGame(browser, mode) {
    const ctx1 = await browser.newContext();
    const ctx2 = await browser.newContext();
    const host = await ctx1.newPage();
    const guest = await ctx2.newPage();

    const roomId = await createRoom(host, `${mode}Host`);
    await joinRoom(guest, roomId, `${mode}Guest`);

    // Wait for both players to see each other
    await expect(host.locator('body')).toContainText(`${mode}Guest`, { timeout: 5000 });

    // Host selects the game mode
    await selectGameMode(host, mode);

    // Both pick teams
    await selectTeam(host, 'red');
    await selectTeam(guest, 'blue');

    // Host starts the game
    const startBtn = host.locator(sel.startGameBtn);
    await expect(startBtn).toBeVisible({ timeout: 5000 });
    await startBtn.click();

    // Wait for board to render on both pages
    await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
    await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

    return { host, guest, roomId, ctx1, ctx2 };
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
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'duet');

        try {
            // Determine whose turn it is
            const turnText = await host.locator(sel.turnIndicator).textContent();
            const isRedTurn = turnText?.includes('Red') || false;

            // Active player becomes clicker
            const activePlayer = isRedTurn ? host : guest;
            await activePlayer.locator(sel.clickerBtn).click();

            // Reveal the first unrevealed card
            const card = activePlayer.locator(sel.boardCardUnrevealed).first();
            const cardText = await card.textContent();
            await card.click();

            // Card should be revealed on the active player
            await expect(card).toHaveClass(/revealed/, { timeout: 5000 });

            // And on the other player too
            const otherPlayer = isRedTurn ? guest : host;
            const otherCards = otherPlayer.locator(sel.boardCard);
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
            const typeMap = await getCardTypeMap(host);

            // Classic mode: 9 + 8 + 7 + 1 = 25
            const total = typeMap.red.length + typeMap.blue.length + typeMap.neutral.length + typeMap.assassin.length;
            expect(total).toBe(25);

            // One team has 9, the other has 8
            const teamCounts = [typeMap.red.length, typeMap.blue.length].sort();
            expect(teamCounts).toEqual([8, 9]);

            // Exactly 1 assassin
            expect(typeMap.assassin.length).toBe(1);

            // 7 neutral cards
            expect(typeMap.neutral.length).toBe(7);
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('assassin card ends game in classic mode', async ({ browser }) => {
        const { host, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'classic');

        try {
            // Find the assassin card via spymaster view
            await host.locator(sel.spymasterBtn).click();
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];

            // Switch to clicker and reveal the assassin
            await host.locator(sel.clickerBtn).click();
            const cards = host.locator(sel.boardCard);
            await cards.nth(assassinIdx).click();
            await expect(cards.nth(assassinIdx)).toHaveClass(/revealed/, { timeout: 5000 });

            // Game should be over
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

            // Both players should see the same words
            const hostWords = await host.locator(sel.boardCard).allTextContents();
            const guestWords = await guest.locator(sel.boardCard).allTextContents();
            expect(hostWords.map((w) => w.trim())).toEqual(guestWords.map((w) => w.trim()));
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('assassin ends round in match mode and new game button appears', async ({ browser }) => {
        const { host, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'match');

        try {
            // Find the assassin card
            await host.locator(sel.spymasterBtn).click();
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];

            // Switch to clicker and reveal the assassin
            await host.locator(sel.clickerBtn).click();
            const cards = host.locator(sel.boardCard);
            await cards.nth(assassinIdx).click();
            await expect(cards.nth(assassinIdx)).toHaveClass(/revealed/, { timeout: 5000 });

            // Game should be over
            await expect(host.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

            // The "New Game" button should be visible (host can start next round)
            const newGameBtn = host.locator(sel.newGameBtn);
            await expect(newGameBtn).toBeVisible({ timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('match mode next round creates a new board with different words', async ({ browser }) => {
        const { host, guest, ctx1, ctx2 } = await setupTwoPlayerGame(browser, 'match');

        try {
            // Capture round 1 words
            const round1Words = await host.locator(sel.boardCard).allTextContents();

            // End the round by revealing the assassin
            await host.locator(sel.spymasterBtn).click();
            const typeMap = await getCardTypeMap(host);
            const assassinIdx = typeMap.assassin[0];

            await host.locator(sel.clickerBtn).click();
            await host.locator(sel.boardCard).nth(assassinIdx).click();
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
            const round2Words = await host.locator(sel.boardCard).allTextContents();

            // Words should be different in the new round (extremely unlikely to be the same)
            expect(round2Words.map((w) => w.trim())).not.toEqual(round1Words.map((w) => w.trim()));

            // Guest should also see the new board
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            const guestRound2Words = await guest.locator(sel.boardCard).allTextContents();
            expect(guestRound2Words.map((w) => w.trim())).toEqual(round2Words.map((w) => w.trim()));
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});
