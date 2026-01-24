// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Home Page E2E Tests
 *
 * Basic tests to verify the application loads correctly.
 */

test.describe('Home Page', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('page loads successfully', async ({ page }) => {
        // Check page title
        await expect(page).toHaveTitle(/Codenames/i);
    });

    test('displays game board', async ({ page }) => {
        // Wait for the board to load
        const board = page.locator('#board');
        await expect(board).toBeVisible();

        // Board should have 25 cards
        const cards = page.locator('#board .card');
        await expect(cards).toHaveCount(25);
    });

    test('displays scoreboard', async ({ page }) => {
        // Check for red and blue team scores
        await expect(page.locator('#red-remaining')).toBeVisible();
        await expect(page.locator('#blue-remaining')).toBeVisible();
    });

    test('displays turn indicator', async ({ page }) => {
        const turnIndicator = page.locator('#turn-indicator');
        await expect(turnIndicator).toBeVisible();

        // Should show which team's turn
        await expect(turnIndicator).toContainText(/Turn/i);
    });

    test('has role selection buttons', async ({ page }) => {
        // Spymaster buttons
        await expect(page.locator('#btn-spymaster-red')).toBeVisible();
        await expect(page.locator('#btn-spymaster-blue')).toBeVisible();

        // Clicker buttons
        await expect(page.locator('#btn-clicker-red')).toBeVisible();
        await expect(page.locator('#btn-clicker-blue')).toBeVisible();
    });

    test('has new game button', async ({ page }) => {
        const newGameBtn = page.locator('button:has-text("New Game")');
        await expect(newGameBtn).toBeVisible();
    });

    test('has settings button', async ({ page }) => {
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await expect(settingsBtn).toBeVisible();
    });

    test('has share link input', async ({ page }) => {
        const shareLink = page.locator('#share-link');
        await expect(shareLink).toBeVisible();

        // Should contain current URL
        const url = await shareLink.inputValue();
        expect(url).toContain('game=');
    });
});

test.describe('Accessibility', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('cards have aria labels', async ({ page }) => {
        const cards = page.locator('#board .card');
        const firstCard = cards.first();

        // Cards should have role and aria-label
        await expect(firstCard).toHaveAttribute('role', 'gridcell');
        await expect(firstCard).toHaveAttribute('aria-label');
    });

    test('cards are keyboard navigable', async ({ page }) => {
        const cards = page.locator('#board .card');
        const firstCard = cards.first();

        // First card should be focusable
        await expect(firstCard).toHaveAttribute('tabindex', '0');

        // Focus on first card
        await firstCard.focus();
        await expect(firstCard).toBeFocused();

        // Arrow key navigation
        await page.keyboard.press('ArrowRight');

        // Second card should now be focused
        const secondCard = cards.nth(1);
        await expect(secondCard).toBeFocused();
    });
});
