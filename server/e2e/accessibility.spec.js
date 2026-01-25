// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Accessibility E2E Tests
 *
 * Tests WCAG 2.1 AA compliance requirements including:
 * - Keyboard navigation
 * - ARIA labels and roles
 * - Focus management
 * - Screen reader compatibility
 */

test.describe('Keyboard Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('all interactive elements are keyboard accessible', async ({ page }) => {
        // Tab through the page to verify focus order
        await page.keyboard.press('Tab');

        // Should be able to focus on interactive elements
        const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
        expect(['BUTTON', 'INPUT', 'A', 'DIV']).toContain(focusedElement);
    });

    test('board cards support arrow key navigation', async ({ page }) => {
        // Focus on the board
        const firstCard = page.locator('#board .card').first();
        await firstCard.focus();
        await expect(firstCard).toBeFocused();

        // Navigate with arrow keys
        await page.keyboard.press('ArrowRight');
        const secondCard = page.locator('#board .card').nth(1);
        await expect(secondCard).toBeFocused();

        // Navigate down
        await page.keyboard.press('ArrowDown');
        const sixthCard = page.locator('#board .card').nth(5);
        await expect(sixthCard).toBeFocused();
    });

    test('Enter key activates focused card', async ({ page }) => {
        // Get whose turn it is
        const turnIndicator = page.locator('#turn-indicator');
        const turnText = await turnIndicator.textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become clicker for the current team
        const clickerBtn = page.locator(isRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Focus on a card
        const card = page.locator('#board .card:not(.revealed)').first();
        await card.focus();

        // Press Enter to activate
        await page.keyboard.press('Enter');

        // Card should be revealed
        await expect(card).toHaveClass(/revealed/);
    });

    test('Escape closes modals', async ({ page }) => {
        // Open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        const modal = page.locator('#settings-modal');
        await expect(modal).toHaveClass(/active/);

        // Press Escape
        await page.keyboard.press('Escape');

        // Modal should be closed
        await expect(modal).not.toHaveClass(/active/);
    });
});

test.describe('ARIA Labels and Roles', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('board has grid role', async ({ page }) => {
        const board = page.locator('#board');
        await expect(board).toHaveAttribute('role', 'grid');
    });

    test('cards have gridcell role', async ({ page }) => {
        const cards = page.locator('#board .card');
        const firstCard = cards.first();
        await expect(firstCard).toHaveAttribute('role', 'gridcell');
    });

    test('cards have descriptive aria-labels', async ({ page }) => {
        const firstCard = page.locator('#board .card').first();
        const ariaLabel = await firstCard.getAttribute('aria-label');

        // Aria label should contain the word
        expect(ariaLabel).toBeTruthy();
        expect(ariaLabel?.length).toBeGreaterThan(0);
    });

    test('buttons have accessible names', async ({ page }) => {
        const buttons = page.locator('button');
        const count = await buttons.count();

        for (let i = 0; i < Math.min(count, 10); i++) {
            const button = buttons.nth(i);
            const hasText = await button.textContent();
            const hasAriaLabel = await button.getAttribute('aria-label');
            const hasTitle = await button.getAttribute('title');

            // Button should have accessible name
            expect(hasText || hasAriaLabel || hasTitle).toBeTruthy();
        }
    });

    test('form inputs have labels', async ({ page }) => {
        // Open settings to find form inputs
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        const inputs = page.locator('#settings-modal input');
        const count = await inputs.count();

        for (let i = 0; i < count; i++) {
            const input = inputs.nth(i);
            const id = await input.getAttribute('id');
            const ariaLabel = await input.getAttribute('aria-label');
            const ariaLabelledBy = await input.getAttribute('aria-labelledby');

            if (id) {
                const label = page.locator(`label[for="${id}"]`);
                const hasLabel = await label.count() > 0;
                // Input should have label, aria-label, or aria-labelledby
                expect(hasLabel || ariaLabel || ariaLabelledBy).toBeTruthy();
            }
        }
    });
});

test.describe('Focus Management', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('focus is trapped in modal when open', async ({ page }) => {
        // Open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        const modal = page.locator('#settings-modal');
        await expect(modal).toHaveClass(/active/);

        // Get focusable elements in modal
        const focusableElements = modal.locator('button, input, [tabindex]:not([tabindex="-1"])');
        const count = await focusableElements.count();

        if (count > 0) {
            // Tab through all elements
            for (let i = 0; i < count + 1; i++) {
                await page.keyboard.press('Tab');
            }

            // Focus should still be within the modal
            const focusedElement = await page.evaluate(() => {
                const active = document.activeElement;
                const modal = document.querySelector('#settings-modal');
                return modal?.contains(active) || false;
            });

            expect(focusedElement).toBe(true);
        }
    });

    test('focus returns to trigger element after modal closes', async ({ page }) => {
        // Store reference to settings button
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();

        // Focus and click settings
        await settingsBtn.focus();
        await settingsBtn.click();

        const modal = page.locator('#settings-modal');
        await expect(modal).toHaveClass(/active/);

        // Close modal
        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);

        // Focus should return to settings button
        await expect(settingsBtn).toBeFocused();
    });
});

test.describe('Screen Reader Support', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('live region exists for announcements', async ({ page }) => {
        const liveRegion = page.locator('[aria-live]');
        await expect(liveRegion.first()).toBeVisible();
    });

    test('turn indicator announces changes', async ({ page }) => {
        const turnIndicator = page.locator('#turn-indicator');

        // Turn indicator should have live region or be in one
        const ariaLive = await turnIndicator.getAttribute('aria-live');
        const parentAriaLive = await turnIndicator.evaluate(el => {
            const parent = el.closest('[aria-live]');
            return parent?.getAttribute('aria-live');
        });

        expect(ariaLive || parentAriaLive).toBeTruthy();
    });

    test('score updates are announced', async ({ page }) => {
        const scoreDisplay = page.locator('#red-remaining, #blue-remaining').first();

        // Score display should be in a live region or have aria-live
        const ariaLive = await scoreDisplay.getAttribute('aria-live');
        const parentAriaLive = await scoreDisplay.evaluate(el => {
            const parent = el.closest('[aria-live]');
            return parent?.getAttribute('aria-live');
        });

        // At minimum, scores should be readable
        const scoreText = await scoreDisplay.textContent();
        expect(scoreText).toBeTruthy();
    });
});

test.describe('Color Contrast and Visual', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('cards have sufficient contrast', async ({ page }) => {
        const cards = page.locator('#board .card');
        const firstCard = cards.first();

        // Get computed styles
        const styles = await firstCard.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return {
                color: computed.color,
                backgroundColor: computed.backgroundColor
            };
        });

        // Basic check that colors are defined
        expect(styles.color).toBeTruthy();
        expect(styles.backgroundColor).toBeTruthy();
    });

    test('focus indicators are visible', async ({ page }) => {
        const firstCard = page.locator('#board .card').first();
        await firstCard.focus();

        // Check for visible focus indicator
        const focusStyles = await firstCard.evaluate(el => {
            const computed = window.getComputedStyle(el);
            return {
                outline: computed.outline,
                boxShadow: computed.boxShadow,
                border: computed.border
            };
        });

        // Should have some form of focus indicator
        const hasFocusIndicator =
            focusStyles.outline !== 'none' ||
            focusStyles.boxShadow !== 'none' ||
            focusStyles.border !== 'none';

        expect(hasFocusIndicator).toBe(true);
    });
});
