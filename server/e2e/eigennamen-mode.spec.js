// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, joinRoom, selectTeam, becomeCurrentClicker } = require('./helpers');

/**
 * Eigennamen (Default) Mode — Comprehensive E2E Tests
 *
 * Covers game-completion scenarios and multiplayer gameplay
 * that are not exercised by other spec files:
 * - Win by finding all team cards
 * - Game-over UI state (board locks, turn indicator, spymaster view)
 * - New game from finished state
 * - Multiplayer card reveal synchronisation
 * - Multiplayer turn switching
 * - End turn in multiplayer
 * - Spectator basics
 */

// ---------------------------------------------------------------------------
// Helpers local to this spec
// ---------------------------------------------------------------------------

/**
 * Collect card indices by spy type while in spymaster view.
 * Returns a map of type -> index array.
 * @param {import('@playwright/test').Page} page
 */
async function getCardTypeMap(page) {
    const cards = page.locator(sel.boardCard);
    const map = { red: [], blue: [], neutral: [], assassin: [] };
    for (let i = 0; i < 25; i++) {
        const cls = (await cards.nth(i).getAttribute('class')) || '';
        if (cls.includes('spy-red')) map.red.push(i);
        else if (cls.includes('spy-blue')) map.blue.push(i);
        else if (cls.includes('spy-neutral')) map.neutral.push(i);
        else if (cls.includes('spy-assassin')) map.assassin.push(i);
    }
    return map;
}

// ---------------------------------------------------------------------------
// 1. Game Completion — Standalone Mode
// ---------------------------------------------------------------------------

test.describe('Eigennamen Win Condition', () => {
    test('revealing all cards of the starting team wins the game', async ({ page }) => {
        await page.goto('/');

        // Determine whose turn it is
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Enter spymaster view to map card types
        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);

        // The starting team always has 9 cards
        const teamCards = isRedTurn ? typeMap.red : typeMap.blue;
        expect(teamCards.length).toBe(9);

        // Switch to clicker for the starting team
        await becomeCurrentClicker(page);

        const cards = page.locator(sel.boardCard);

        // Reveal all 9 cards of the starting team
        for (const idx of teamCards) {
            await cards.nth(idx).click();
            await expect(cards.nth(idx)).toHaveClass(/revealed/, { timeout: 3000 });
        }

        // The game should now be over —
        // turn indicator should reflect game-over state
        await expect(page.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });
    });

    test('board shows spymaster view after game over', async ({ page }) => {
        await page.goto('/');

        // Find the assassin card
        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);
        const assassinIdx = typeMap.assassin[0];

        // Switch to clicker and reveal assassin
        await becomeCurrentClicker(page);
        await page.locator(sel.boardCard).nth(assassinIdx).click();

        // After game over, board should show all card types (spymaster view)
        await expect(page.locator(sel.board)).toHaveClass(/spymaster-mode/, { timeout: 5000 });
    });

    test('cards are not clickable after game over', async ({ page }) => {
        await page.goto('/');

        // Trigger game over via assassin
        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);
        const assassinIdx = typeMap.assassin[0];

        await becomeCurrentClicker(page);
        await page.locator(sel.boardCard).nth(assassinIdx).click();
        await expect(page.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

        // Try to click an unrevealed card — it should NOT become revealed
        const unrevealed = page.locator(sel.boardCardUnrevealed).first();
        if ((await unrevealed.count()) > 0) {
            await unrevealed.click();
            await expect(unrevealed).not.toHaveClass(/revealed/);
        }
    });

    test('can start a new game after game over', async ({ page }) => {
        await page.goto('/');

        // Trigger game over
        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);
        await becomeCurrentClicker(page);
        await page.locator(sel.boardCard).nth(typeMap.assassin[0]).click();
        await expect(page.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

        // Start a new game
        await page.locator(sel.newGameBtn).click();

        // Board should reset — no game-over indicator
        await expect(page.locator(sel.turnIndicator)).not.toHaveClass(/game-over/, { timeout: 5000 });

        // All cards should be unrevealed
        const revealed = page.locator(`${sel.boardCard}.revealed`);
        await expect(revealed).toHaveCount(0);
    });

    test('non-starting team wins by finding all 8 of their cards', async ({ page }) => {
        await page.goto('/');

        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);

        // Non-starting team has 8 cards
        const nonStartingCards = isRedTurn ? typeMap.blue : typeMap.red;
        expect(nonStartingCards.length).toBe(8);

        // End the starting team's turn first so the non-starting team can play
        await becomeCurrentClicker(page);
        await page.locator(sel.endTurnBtn).click();

        // Verify turn switched
        const newTurnText = await page.locator(sel.turnIndicator).textContent();
        const isNowRedTurn = newTurnText?.includes('Red') || false;
        expect(isNowRedTurn).not.toBe(isRedTurn);

        const cards = page.locator(sel.boardCard);

        // Reveal all 8 cards of the non-starting team
        for (const idx of nonStartingCards) {
            await cards.nth(idx).click();
            await expect(cards.nth(idx)).toHaveClass(/revealed/, { timeout: 3000 });
        }

        // Game should be over
        await expect(page.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });
    });
});

// ---------------------------------------------------------------------------
// 2. Turn Indicator & Score Display
// ---------------------------------------------------------------------------

test.describe('Eigennamen Turn Indicator', () => {
    test('turn indicator shows team name on active game', async ({ page }) => {
        await page.goto('/');

        const turnText = await page.locator(sel.turnIndicator).textContent();
        expect(turnText?.includes('Red') || turnText?.includes('Blue')).toBeTruthy();
    });

    test('turn indicator shows winner after game over', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);

        // Starting team has 9 cards — reveal all of them to win
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;
        const teamCards = isRedTurn ? typeMap.red : typeMap.blue;

        await becomeCurrentClicker(page);
        const cards = page.locator(sel.boardCard);
        for (const idx of teamCards) {
            await cards.nth(idx).click();
            await expect(cards.nth(idx)).toHaveClass(/revealed/, { timeout: 3000 });
        }

        await expect(page.locator(sel.turnIndicator)).toHaveClass(/game-over/, { timeout: 5000 });

        // Turn indicator should mention the winning team
        const gameOverText = await page.locator(sel.turnIndicator).textContent();
        expect(gameOverText?.toLowerCase()).toMatch(/win|won/);
    });

    test('score displays update correctly through multiple reveals', async ({ page }) => {
        await page.goto('/');

        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        const scoreEl = page.locator(isRedTurn ? sel.redRemaining : sel.blueRemaining);
        const initialScore = Number(await scoreEl.textContent());

        await page.locator(sel.spymasterBtn).click();
        const typeMap = await getCardTypeMap(page);
        const ownCards = isRedTurn ? typeMap.red : typeMap.blue;

        await becomeCurrentClicker(page);
        const cards = page.locator(sel.boardCard);

        // Reveal 3 own-team cards
        const toReveal = ownCards.slice(0, 3);
        for (const idx of toReveal) {
            await cards.nth(idx).click();
            await expect(cards.nth(idx)).toHaveClass(/revealed/, { timeout: 3000 });
        }

        const updatedScore = Number(await scoreEl.textContent());
        expect(updatedScore).toBe(initialScore - 3);
    });
});

// ---------------------------------------------------------------------------
// 3. Multiplayer Gameplay — Card Reveals & Turns
// ---------------------------------------------------------------------------

test.describe('Eigennamen Multiplayer Gameplay', () => {
    test('card reveal is synchronised between two players', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'RevealHost');
            await joinRoom(guest, roomId, 'RevealGuest');

            await expect(host.locator('body')).toContainText('RevealGuest', { timeout: 5000 });

            // Both players pick a team
            await selectTeam(host, 'red');
            await selectTeam(guest, 'blue');

            // Host starts the game
            const startBtn = host.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });
            await startBtn.click();

            // Wait for board to appear on both pages
            await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

            // Determine whose turn it is
            const turnText = await host.locator(sel.turnIndicator).textContent();
            const isRedTurn = turnText?.includes('Red') || false;

            // The player on the current turn's team becomes clicker
            const activePlayer = isRedTurn ? host : guest;
            await activePlayer.locator(sel.clickerBtn).click();

            // Click the first unrevealed card
            const firstCard = activePlayer.locator(sel.boardCardUnrevealed).first();
            const cardText = await firstCard.textContent();
            await firstCard.click();

            // Card should become revealed on the active player
            await expect(firstCard).toHaveClass(/revealed/, { timeout: 5000 });

            // And also on the other player
            const otherPlayer = isRedTurn ? guest : host;
            const matchingCards = otherPlayer.locator(sel.boardCard);
            // Find the same card by text
            let otherIdx = -1;
            for (let i = 0; i < 25; i++) {
                const txt = await matchingCards.nth(i).textContent();
                if (txt?.trim() === cardText?.trim()) {
                    otherIdx = i;
                    break;
                }
            }
            if (otherIdx >= 0) {
                await expect(matchingCards.nth(otherIdx)).toHaveClass(/revealed/, { timeout: 5000 });
            }
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('both players see the same starting turn', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'TurnHost');
            await joinRoom(guest, roomId, 'TurnGuest');

            await selectTeam(host, 'red');
            await selectTeam(guest, 'blue');

            const startBtn = host.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });
            await startBtn.click();

            await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

            const hostTurn = await host.locator(sel.turnIndicator).textContent();
            const guestTurn = await guest.locator(sel.turnIndicator).textContent();

            const hostRed = hostTurn?.includes('Red') || false;
            const guestRed = guestTurn?.includes('Red') || false;
            expect(hostRed).toBe(guestRed);
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('end turn in multiplayer switches turn for both players', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'EndTurnHost');
            await joinRoom(guest, roomId, 'EndTurnGuest');

            await selectTeam(host, 'red');
            await selectTeam(guest, 'blue');

            const startBtn = host.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });
            await startBtn.click();

            await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

            // Determine whose turn it is
            const turnText = await host.locator(sel.turnIndicator).textContent();
            const wasRedTurn = turnText?.includes('Red') || false;

            // Active player becomes clicker and ends turn
            const activePlayer = wasRedTurn ? host : guest;
            await activePlayer.locator(sel.clickerBtn).click();

            const endTurnBtn = activePlayer.locator(sel.endTurnBtn);
            await expect(endTurnBtn).toBeVisible({ timeout: 5000 });
            await endTurnBtn.click();

            // Turn should switch for the host
            await expect(host.locator(sel.turnIndicator)).not.toContainText(wasRedTurn ? 'Red' : 'Blue', {
                timeout: 5000,
            });

            // And also for the guest
            await expect(guest.locator(sel.turnIndicator)).not.toContainText(wasRedTurn ? 'Red' : 'Blue', {
                timeout: 5000,
            });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('both players see matching boards after game start', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'BoardSyncHost');
            await joinRoom(guest, roomId, 'BoardSyncGuest');

            await selectTeam(host, 'red');
            await selectTeam(guest, 'blue');

            const startBtn = host.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });
            await startBtn.click();

            await host.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });
            await guest.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

            // Both players should see the same 25 words
            const hostWords = await host.locator(sel.boardCard).allTextContents();
            const guestWords = await guest.locator(sel.boardCard).allTextContents();

            expect(hostWords.map((w) => w.trim())).toEqual(guestWords.map((w) => w.trim()));
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

// ---------------------------------------------------------------------------
// 4. Spectator Mode
// ---------------------------------------------------------------------------

test.describe('Eigennamen Spectator Mode', () => {
    test('spectator button is visible in standalone mode', async ({ page }) => {
        await page.goto('/');

        const spectateBtn = page.locator(sel.spectatorBtn);
        await expect(spectateBtn).toBeVisible();
    });

    test('spectator cannot reveal cards', async ({ page }) => {
        await page.goto('/');

        // Click spectator button
        const spectateBtn = page.locator(sel.spectatorBtn);
        await spectateBtn.click();

        // Try to click a card — it should not be revealed
        const card = page.locator(sel.boardCardUnrevealed).first();
        await card.click();
        await expect(card).not.toHaveClass(/revealed/);
    });
});
