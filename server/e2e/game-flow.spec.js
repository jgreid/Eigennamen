// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, becomeCurrentClicker } = require('./helpers');

/**
 * Game Flow E2E Tests
 *
 * Tests the core gameplay mechanics of Eigennamen.
 */

test.describe('Game Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('can start a new game', async ({ page }) => {
        const initialUrl = page.url();
        const initialSeed = new URL(initialUrl).searchParams.get('game');

        await page.locator(sel.newGameBtn).click();

        await page.waitForURL((url) => {
            const newSeed = url.searchParams.get('game');
            return newSeed !== initialSeed;
        });

        const newUrl = page.url();
        const newSeed = new URL(newUrl).searchParams.get('game');
        expect(newSeed).not.toBe(initialSeed);
    });

    test('can become spymaster and see card colors', async ({ page }) => {
        const board = page.locator(sel.board);
        await expect(board).not.toHaveClass(/spymaster-mode/);

        await page.locator(sel.spymasterBtn).click();
        await expect(board).toHaveClass(/spymaster-mode/);

        const firstCard = page.locator(sel.boardCard).first();
        const classList = await firstCard.getAttribute('class');
        expect(classList).toMatch(/spy-(red|blue|neutral|assassin)/);
    });

    test('can become clicker and click cards', async ({ page }) => {
        await becomeCurrentClicker(page);

        const unrevealedCard = page.locator(sel.boardCardUnrevealed).first();
        await unrevealedCard.click();
        await expect(unrevealedCard).toHaveClass(/revealed/);
    });

    test('end turn button ends the current turn', async ({ page }) => {
        const turnIndicator = page.locator(sel.turnIndicator);
        const initialTurnText = await turnIndicator.textContent();
        const wasRedTurn = initialTurnText?.includes('Red') || false;

        await becomeCurrentClicker(page);

        await page.locator(sel.endTurnBtn).click();

        const newTurnText = await turnIndicator.textContent();
        const isNowRedTurn = newTurnText?.includes('Red') || false;
        expect(isNowRedTurn).not.toBe(wasRedTurn);
    });

    test('URL updates when cards are revealed', async ({ page }) => {
        const initialUrl = page.url();
        const initialRevealed = new URL(initialUrl).searchParams.get('r');

        await becomeCurrentClicker(page);

        const card = page.locator(sel.boardCardUnrevealed).first();
        await card.click();

        await page.waitForFunction((initRevealed) => {
            const params = new URLSearchParams(window.location.search);
            return params.get('r') !== initRevealed;
        }, initialRevealed);

        const newUrl = page.url();
        const newRevealed = new URL(newUrl).searchParams.get('r');
        expect(newRevealed).not.toBe(initialRevealed);
    });
});

test.describe('Role Switching', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('switching from spymaster to clicker hides card colors', async ({ page }) => {
        const board = page.locator(sel.board);

        await page.locator(sel.spymasterBtn).click();
        await expect(board).toHaveClass(/spymaster-mode/);

        await page.locator(sel.clickerBtn).click();
        await expect(board).not.toHaveClass(/spymaster-mode/);
    });

    test('can switch between teams', async ({ page }) => {
        // Click spymaster (sets role for current turn's team)
        await page.locator(sel.spymasterBtn).click();

        const roleBanner = page.locator(sel.roleBanner);
        await expect(roleBanner).toBeVisible();
    });
});

test.describe('Modal Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('can open and close settings modal', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        const modal = page.locator(sel.settingsModal);
        await expect(modal).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
    });

    test('logo opens help modal', async ({ page }) => {
        // The Eigennamen logo in the status bar opens the help overlay
        const logoBtn = page.locator('.game-title-btn');
        await logoBtn.click();

        const modal = page.locator(sel.helpModal);
        await expect(modal).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
    });
});
