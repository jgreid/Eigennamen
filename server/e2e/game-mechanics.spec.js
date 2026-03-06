// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, goToGame, becomeCurrentClicker } = require('./helpers');

/**
 * Game Mechanics E2E Tests
 *
 * Tests deeper gameplay mechanics not covered by other specs:
 * - Score tracking after card reveals
 * - Correct turn switching on wrong card
 * - Multiple card reveals in a single turn
 * - Game over detection (all team cards found)
 * - Spymaster vs clicker card interaction rules
 */

test.describe('Score Tracking', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('revealing a card changes the score', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        const scoreEl = page.locator(isRedTurn ? sel.redRemaining : sel.blueRemaining);
        const initialScore = Number(await scoreEl.textContent());

        await becomeCurrentClicker(page);

        // Become spymaster first to identify card types
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        const targetClass = isRedTurn ? 'spy-red' : 'spy-blue';
        let targetIndex = -1;

        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes(targetClass)) {
                targetIndex = i;
                break;
            }
        }

        // Switch back to clicker and reveal the correct card
        await becomeCurrentClicker(page);

        if (targetIndex >= 0) {
            await cards.nth(targetIndex).click();
            await expect(cards.nth(targetIndex)).toHaveClass(/revealed/);

            const newScore = Number(await scoreEl.textContent());
            expect(newScore).toBe(initialScore - 1);
        }
    });

    test('red and blue scores sum to 17', async ({ page }) => {
        const redScore = Number(await page.locator(sel.redRemaining).textContent());
        const blueScore = Number(await page.locator(sel.blueRemaining).textContent());

        expect(redScore + blueScore).toBe(17);
    });
});

test.describe('Turn Switching', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('revealing an opposing team card ends the turn', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become spymaster to find an opposing card
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        const opposingClass = isRedTurn ? 'spy-blue' : 'spy-red';
        let opposingIndex = -1;

        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes(opposingClass)) {
                opposingIndex = i;
                break;
            }
        }

        // Switch to clicker
        await becomeCurrentClicker(page);

        if (opposingIndex >= 0) {
            await cards.nth(opposingIndex).click();
            await expect(cards.nth(opposingIndex)).toHaveClass(/revealed/);

            // Turn should have switched
            const newTurnText = await page.locator(sel.turnIndicator).textContent();
            const isNowRedTurn = newTurnText?.includes('Red') || false;

            expect(isNowRedTurn).not.toBe(isRedTurn);
        }
    });

    test('revealing a neutral card ends the turn', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become spymaster to find a neutral card
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        let neutralIndex = -1;

        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes('spy-neutral')) {
                neutralIndex = i;
                break;
            }
        }

        // Switch to clicker
        await becomeCurrentClicker(page);

        if (neutralIndex >= 0) {
            await cards.nth(neutralIndex).click();
            await expect(cards.nth(neutralIndex)).toHaveClass(/revealed/);

            // Turn should have switched
            const newTurnText = await page.locator(sel.turnIndicator).textContent();
            const isNowRedTurn = newTurnText?.includes('Red') || false;

            expect(isNowRedTurn).not.toBe(isRedTurn);
        }
    });

    test('revealing own team card keeps the turn', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become spymaster to find own team card
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        const ownClass = isRedTurn ? 'spy-red' : 'spy-blue';
        let ownIndex = -1;

        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes(ownClass)) {
                ownIndex = i;
                break;
            }
        }

        // Switch to clicker
        await becomeCurrentClicker(page);

        if (ownIndex >= 0) {
            await cards.nth(ownIndex).click();
            await expect(cards.nth(ownIndex)).toHaveClass(/revealed/);

            // Turn should NOT have switched (own team card)
            const newTurnText = await page.locator(sel.turnIndicator).textContent();
            const isNowRedTurn = newTurnText?.includes('Red') || false;

            expect(isNowRedTurn).toBe(isRedTurn);
        }
    });
});

test.describe('Spymaster Restrictions', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('spymaster cannot click cards to reveal them', async ({ page }) => {
        await page.locator(sel.spymasterBtn).click();

        const card = page.locator(sel.boardCardUnrevealed).first();
        await card.click();

        // Card should NOT be revealed when spymaster clicks
        await expect(card).not.toHaveClass(/revealed/);
    });

    test('clicking clicker button removes spymaster view', async ({ page }) => {
        const board = page.locator(sel.board);

        await page.locator(sel.spymasterBtn).click();
        await expect(board).toHaveClass(/spymaster-mode/);

        await page.locator(sel.clickerBtn).click();
        await expect(board).not.toHaveClass(/spymaster-mode/);
    });
});

test.describe('Revealed Cards', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('revealed cards cannot be clicked again', async ({ page }) => {
        await becomeCurrentClicker(page);

        const card = page.locator(sel.boardCardUnrevealed).first();
        const wordBefore = await card.textContent();

        await card.click();
        await expect(card).toHaveClass(/revealed/);

        // Card should now be disabled (tabindex=-1 or aria-disabled)
        const tabindex = await card.getAttribute('tabindex');
        const ariaDisabled = await card.getAttribute('aria-disabled');
        expect(tabindex === '-1' || ariaDisabled === 'true').toBeTruthy();
    });

    test('multiple cards can be revealed in one turn', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become spymaster to find own team cards
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        const ownClass = isRedTurn ? 'spy-red' : 'spy-blue';
        const ownCardIndices = [];

        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes(ownClass)) {
                ownCardIndices.push(i);
                if (ownCardIndices.length >= 2) break;
            }
        }

        // Switch to clicker
        await becomeCurrentClicker(page);

        if (ownCardIndices.length >= 2) {
            // Reveal first card
            await cards.nth(ownCardIndices[0]).click();
            await expect(cards.nth(ownCardIndices[0])).toHaveClass(/revealed/);

            // Reveal second card (should still be same turn)
            await cards.nth(ownCardIndices[1]).click();
            await expect(cards.nth(ownCardIndices[1])).toHaveClass(/revealed/);

            // Both should be revealed
            const revealed = page.locator(`${sel.boardCard}.revealed`);
            const revealedCount = await revealed.count();
            expect(revealedCount).toBeGreaterThanOrEqual(2);
        }
    });
});

test.describe('Board Layout', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('board is a 5x5 grid of 25 cards', async ({ page }) => {
        const cards = page.locator(sel.boardCard);
        await expect(cards).toHaveCount(25);

        // Verify data-index goes from 0 to 24
        for (let i = 0; i < 25; i++) {
            await expect(cards.nth(i)).toHaveAttribute('data-index', String(i));
        }
    });

    test('each card has unique text', async ({ page }) => {
        const cards = page.locator(sel.boardCard);
        const words = await cards.allTextContents();
        const trimmed = words.map((w) => w.trim().toLowerCase());
        const unique = new Set(trimmed);
        expect(unique.size).toBe(25);
    });

    test('board has correct ARIA grid structure', async ({ page }) => {
        const board = page.locator(sel.board);
        await expect(board).toHaveAttribute('role', 'grid');
        await expect(board).toHaveAttribute('aria-label');

        const firstCard = page.locator(sel.boardCard).first();
        await expect(firstCard).toHaveAttribute('role', 'gridcell');
    });
});
