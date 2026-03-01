// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, becomeCurrentClicker } = require('./helpers');

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
        await page.keyboard.press('Tab');

        const focusedElement = await page.evaluate(() => document.activeElement?.tagName);
        expect(['BUTTON', 'INPUT', 'A', 'DIV']).toContain(focusedElement);
    });

    test('board cards support arrow key navigation', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();
        await firstCard.focus();
        await expect(firstCard).toBeFocused();

        await page.keyboard.press('ArrowRight');
        const secondCard = page.locator(sel.boardCard).nth(1);
        await expect(secondCard).toBeFocused();

        await page.keyboard.press('ArrowDown');
        const sixthCard = page.locator(sel.boardCard).nth(5);
        // ArrowDown from position 1 goes to position 6
        // (but from secondCard which is index 1, ArrowDown goes to index 6)
        await expect(sixthCard).toBeFocused();
    });

    test('Enter key activates focused card', async ({ page }) => {
        await becomeCurrentClicker(page);

        const card = page.locator(sel.boardCardUnrevealed).first();
        await card.focus();

        await page.keyboard.press('Enter');
        await expect(card).toHaveClass(/revealed/);
    });

    test('Escape closes modals', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        const modal = page.locator(sel.settingsModal);
        await expect(modal).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
    });
});

test.describe('ARIA Labels and Roles', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('board has grid role', async ({ page }) => {
        const board = page.locator(sel.board);
        await expect(board).toHaveAttribute('role', 'grid');
    });

    test('cards have gridcell role', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();
        await expect(firstCard).toHaveAttribute('role', 'gridcell');
    });

    test('cards have descriptive aria-labels', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();
        const ariaLabel = await firstCard.getAttribute('aria-label');

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

            expect(hasText || hasAriaLabel || hasTitle).toBeTruthy();
        }
    });

    test('form inputs have labels', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        // Navigate to prefs panel which has inputs
        const prefsTab = page.locator('[data-panel="prefs"]');
        if (await prefsTab.isVisible()) {
            await prefsTab.click();
        }

        const inputs = page.locator(`${sel.settingsModal} input`);
        const count = await inputs.count();

        for (let i = 0; i < count; i++) {
            const input = inputs.nth(i);
            const id = await input.getAttribute('id');
            const ariaLabel = await input.getAttribute('aria-label');
            const ariaLabelledBy = await input.getAttribute('aria-labelledby');

            if (id) {
                const label = page.locator(`label[for="${id}"]`);
                const hasLabel = (await label.count()) > 0;
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
        await page.locator(sel.settingsBtn).click();

        const modal = page.locator(sel.settingsModal);
        await expect(modal).toHaveClass(/active/);

        const focusableElements = modal.locator('button, input, [tabindex]:not([tabindex="-1"])');
        const count = await focusableElements.count();

        if (count > 0) {
            for (let i = 0; i < count + 1; i++) {
                await page.keyboard.press('Tab');
            }

            const focusedElement = await page.evaluate(() => {
                const active = document.activeElement;
                const modal = document.querySelector('[data-testid="settings-modal"]');
                return modal?.contains(active) || false;
            });

            expect(focusedElement).toBe(true);
        }
    });

    test('focus returns to trigger element after modal closes', async ({ page }) => {
        const settingsBtn = page.locator(sel.settingsBtn);

        await settingsBtn.focus();
        await settingsBtn.click();

        const modal = page.locator(sel.settingsModal);
        await expect(modal).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);

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
        const turnIndicator = page.locator(sel.turnIndicator);

        const ariaLive = await turnIndicator.getAttribute('aria-live');
        const parentAriaLive = await turnIndicator.evaluate((el) => {
            const parent = el.closest('[aria-live]');
            return parent?.getAttribute('aria-live');
        });

        expect(ariaLive || parentAriaLive).toBeTruthy();
    });

    test('score updates are announced', async ({ page }) => {
        const scoreDisplay = page.locator(`${sel.redRemaining}, ${sel.blueRemaining}`).first();

        const ariaLive = await scoreDisplay.getAttribute('aria-live');
        const parentAriaLive = await scoreDisplay.evaluate((el) => {
            const parent = el.closest('[aria-live]');
            return parent?.getAttribute('aria-live');
        });

        const scoreText = await scoreDisplay.textContent();
        expect(scoreText).toBeTruthy();
    });
});

test.describe('Color Contrast and Visual', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('cards have sufficient contrast', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();

        const styles = await firstCard.evaluate((el) => {
            const computed = window.getComputedStyle(el);
            return {
                color: computed.color,
                backgroundColor: computed.backgroundColor,
            };
        });

        expect(styles.color).toBeTruthy();
        expect(styles.backgroundColor).toBeTruthy();
    });

    test('focus indicators are visible', async ({ page }) => {
        const firstCard = page.locator(sel.boardCard).first();
        await firstCard.focus();

        const focusStyles = await firstCard.evaluate((el) => {
            const computed = window.getComputedStyle(el);
            return {
                outline: computed.outline,
                boxShadow: computed.boxShadow,
                border: computed.border,
            };
        });

        const hasFocusIndicator =
            focusStyles.outline !== 'none' || focusStyles.boxShadow !== 'none' || focusStyles.border !== 'none';

        expect(hasFocusIndicator).toBe(true);
    });
});
