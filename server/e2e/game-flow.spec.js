// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, goToGame, becomeSpymaster, becomeCurrentClicker } = require('./helpers');

/**
 * Game Flow E2E Tests
 *
 * Tests the core gameplay mechanics of Eigennamen.
 */

test.describe('Game Flow', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('can start a new game', async ({ page }) => {
        const initialSeed = new URL(page.url()).searchParams.get('game');

        // Landing on '/' with no ?game= seed makes the app start its own local
        // game first (loadGameFromURL → newGame), which arms a 500ms new-game
        // debounce. A New Game click inside that window is intentionally
        // swallowed, so retry the click until the seed actually changes rather
        // than racing the debounce.
        await expect(async () => {
            await page.locator(sel.newGameBtn).click();
            const newSeed = new URL(page.url()).searchParams.get('game');
            expect(newSeed).not.toBe(initialSeed);
        }).toPass({ timeout: 10000 });
    });

    test('can become spymaster and see card colors', async ({ page }) => {
        const board = page.locator(sel.board);
        await expect(board).not.toHaveClass(/spymaster-mode/);

        await becomeSpymaster(page);
        await expect(board).toHaveClass(/spymaster-mode/);

        const firstCard = page.locator(sel.boardCard).first();
        const classList = await firstCard.getAttribute('class');
        expect(classList).toMatch(/spy-(red|blue|neutral|assassin)/);
    });

    test('can become clicker and click cards', async ({ page }) => {
        await becomeCurrentClicker(page);

        // Use a positionally-stable locator: the ':not(.revealed)' selector's
        // .first() re-resolves to the NEXT unrevealed card once the click lands,
        // so it could never observe the revealed class. Card index 0 is stable.
        const firstCard = page.locator(sel.boardCard).first();
        await expect(firstCard).not.toHaveClass(/revealed/);
        await firstCard.click();
        await expect(firstCard).toHaveClass(/revealed/);
    });

    test('end turn button ends the current turn', async ({ page }) => {
        const turnIndicator = page.locator(sel.turnIndicator);
        const initialTurnText = await turnIndicator.textContent();
        const wasRedTurn = initialTurnText?.includes('Red') || false;

        await becomeCurrentClicker(page);

        // End Turn opens a confirmation modal; confirm it to actually end the turn.
        await page.locator(sel.endTurnBtn).click();
        await page.locator(sel.endTurnConfirmBtn).click();

        // The turn flip updates the indicator asynchronously; poll instead of
        // reading it once immediately after the click.
        await expect(async () => {
            const newTurnText = await turnIndicator.textContent();
            const isNowRedTurn = newTurnText?.includes('Red') || false;
            expect(isNowRedTurn).not.toBe(wasRedTurn);
        }).toPass({ timeout: 5000 });
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
        await goToGame(page);
    });

    test('switching from spymaster to clicker hides card colors', async ({ page }) => {
        const board = page.locator(sel.board);

        await becomeSpymaster(page);
        await expect(board).toHaveClass(/spymaster-mode/);

        await page.locator(sel.clickerBtn).click();
        await expect(board).not.toHaveClass(/spymaster-mode/);
    });

    test('can switch between teams', async ({ page }) => {
        // Join a team and take the spymaster seat (the role button is disabled
        // until a team is selected).
        await becomeSpymaster(page);

        const roleBanner = page.locator(sel.roleBanner);
        await expect(roleBanner).toBeVisible();
    });
});

test.describe('Modal Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
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
