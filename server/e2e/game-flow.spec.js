// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Game Flow E2E Tests
 *
 * Tests the core gameplay mechanics of Codenames.
 */

test.describe('Game Flow', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('can start a new game', async ({ page }) => {
        // Get initial game seed from URL
        const initialUrl = page.url();
        const initialSeed = new URL(initialUrl).searchParams.get('game');

        // Click new game button
        const newGameBtn = page.locator('button:has-text("New Game")');
        await newGameBtn.click();

        // Wait for URL to update with new seed
        await page.waitForURL((url) => {
            const newSeed = url.searchParams.get('game');
            return newSeed !== initialSeed;
        });

        // Verify new game was created
        const newUrl = page.url();
        const newSeed = new URL(newUrl).searchParams.get('game');
        expect(newSeed).not.toBe(initialSeed);
    });

    test('can become spymaster and see card colors', async ({ page }) => {
        // Initially cards should not show colors
        const board = page.locator('#board');
        await expect(board).not.toHaveClass(/spymaster-mode/);

        // Click red spymaster button
        const redSpyBtn = page.locator('#btn-spymaster-red');
        await redSpyBtn.click();

        // Board should now be in spymaster mode
        await expect(board).toHaveClass(/spymaster-mode/);

        // Cards should have spy- classes
        const cards = page.locator('#board .card');
        const firstCard = cards.first();
        const classList = await firstCard.getAttribute('class');

        // Card should have a spy-type class
        expect(classList).toMatch(/spy-(red|blue|neutral|assassin)/);
    });

    test('can become clicker and click cards', async ({ page }) => {
        // Get whose turn it is
        const turnIndicator = page.locator('#turn-indicator');
        const turnText = await turnIndicator.textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become clicker for the current team
        const clickerBtn = page.locator(isRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Find an unrevealed card and click it
        const unrevealedCard = page.locator('#board .card:not(.revealed)').first();
        const cardWord = await unrevealedCard.textContent();

        await unrevealedCard.click();

        // Card should now be revealed
        await expect(unrevealedCard).toHaveClass(/revealed/);
    });

    test('end turn button ends the current turn', async ({ page }) => {
        // Get whose turn it is initially
        const turnIndicator = page.locator('#turn-indicator');
        const initialTurnText = await turnIndicator.textContent();
        const wasRedTurn = initialTurnText?.includes('Red') || false;

        // Become clicker for current team
        const clickerBtn = page.locator(wasRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Click end turn button
        const endTurnBtn = page.locator('#btn-end-turn');
        await endTurnBtn.click();

        // Turn should have changed
        const newTurnText = await turnIndicator.textContent();
        const isNowRedTurn = newTurnText?.includes('Red') || false;
        expect(isNowRedTurn).not.toBe(wasRedTurn);
    });

    test('URL updates when cards are revealed', async ({ page }) => {
        // Get initial URL
        const initialUrl = page.url();
        const initialRevealed = new URL(initialUrl).searchParams.get('r');

        // Get whose turn it is
        const turnIndicator = page.locator('#turn-indicator');
        const turnText = await turnIndicator.textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become clicker for the current team
        const clickerBtn = page.locator(isRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Click a card
        const card = page.locator('#board .card:not(.revealed)').first();
        await card.click();

        // Wait for URL to update
        await page.waitForFunction((initRevealed) => {
            const params = new URLSearchParams(window.location.search);
            return params.get('r') !== initRevealed;
        }, initialRevealed);

        // Verify revealed state changed in URL
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
        const board = page.locator('#board');

        // Become spymaster first
        await page.locator('#btn-spymaster-red').click();
        await expect(board).toHaveClass(/spymaster-mode/);

        // Switch to clicker
        await page.locator('#btn-clicker-red').click();
        await expect(board).not.toHaveClass(/spymaster-mode/);
    });

    test('can switch between teams', async ({ page }) => {
        // Become red spymaster
        await page.locator('#btn-spymaster-red').click();

        // Role banner should show red spymaster
        const roleBanner = page.locator('#role-banner');
        await expect(roleBanner).toContainText(/Red/i);
        await expect(roleBanner).toHaveClass(/spymaster-red/);

        // Switch to blue spymaster
        await page.locator('#btn-spymaster-blue').click();

        // Role banner should now show blue spymaster
        await expect(roleBanner).toContainText(/Blue/i);
        await expect(roleBanner).toHaveClass(/spymaster-blue/);
    });
});

test.describe('Modal Interactions', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('can open and close settings modal', async ({ page }) => {
        // Open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        // Settings modal should be visible
        const modal = page.locator('#settings-modal');
        await expect(modal).toHaveClass(/active/);

        // Close with Escape key
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
    });

    test('can open and close help modal', async ({ page }) => {
        // Open help
        const helpBtn = page.locator('button:has-text("Help"), [aria-label*="Help"]').first();
        await helpBtn.click();

        // Help modal should be visible
        const modal = page.locator('#help-modal');
        await expect(modal).toHaveClass(/active/);

        // Close by clicking overlay
        await page.locator('#help-modal.modal-overlay').click({ position: { x: 5, y: 5 } });
        await expect(modal).not.toHaveClass(/active/);
    });
});
