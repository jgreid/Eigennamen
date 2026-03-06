// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, goToGame } = require('./helpers');

/**
 * Home Page E2E Tests
 *
 * Basic tests to verify the application loads correctly.
 * Tests first dismiss the setup screen via goToGame() to reach the game board.
 */

test.describe('Home Page', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('page loads successfully', async ({ page }) => {
        await expect(page).toHaveTitle(/Eigennamen/i);
    });

    test('displays game board', async ({ page }) => {
        const board = page.locator(sel.board);
        await expect(board).toBeVisible();

        const cards = page.locator(sel.boardCard);
        await expect(cards).toHaveCount(25);
    });

    test('displays scoreboard', async ({ page }) => {
        await expect(page.locator(sel.redRemaining)).toBeVisible();
        await expect(page.locator(sel.blueRemaining)).toBeVisible();
    });

    test('displays turn indicator', async ({ page }) => {
        const turnIndicator = page.locator(sel.turnIndicator);
        await expect(turnIndicator).toBeVisible();
        await expect(turnIndicator).toContainText(/Turn/i);
    });

    test('has role selection buttons', async ({ page }) => {
        await expect(page.locator(sel.spymasterBtn)).toBeVisible();
        await expect(page.locator(sel.clickerBtn)).toBeVisible();
    });

    test('has new game button', async ({ page }) => {
        await expect(page.locator(sel.newGameBtn)).toBeVisible();
    });

    test('has settings button', async ({ page }) => {
        await expect(page.locator(sel.settingsBtn)).toBeVisible();
    });

    test('has share link input', async ({ page }) => {
        const shareLink = page.locator(sel.shareLink);
        await expect(shareLink).toBeVisible();

        const url = await shareLink.inputValue();
        expect(url).toContain('game=');
    });
});

test.describe('Accessibility', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('cards have aria labels', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();
        await expect(firstCard).toHaveAttribute('role', 'gridcell');
        await expect(firstCard).toHaveAttribute('aria-label');
    });

    test('cards are keyboard navigable', async ({ page }) => {
        const cards = page.locator(sel.boardCard);
        const firstCard = cards.first();

        await expect(firstCard).toHaveAttribute('tabindex', '0');
        await firstCard.focus();
        await expect(firstCard).toBeFocused();

        await page.keyboard.press('ArrowRight');
        const secondCard = cards.nth(1);
        await expect(secondCard).toBeFocused();
    });
});
