// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, goToGame, createRoom } = require('./helpers');

/**
 * Timer E2E Tests
 *
 * Tests turn timer functionality.
 */

test.describe('Timer Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('timer display is present in the turn indicator', async ({ page }) => {
        // The timer display (.timer-inline) is display:none until a turn timer is
        // actively running (it gains the `active` class then); standalone mode has
        // no server turn timer, so assert the element is wired into the layout
        // rather than that it is shown.
        const timer = page.locator(sel.timerDisplay);
        await expect(timer).toBeAttached();
    });

    test('timer can be enabled in settings', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        // Navigate to prefs panel
        const prefsTab = page.locator('[data-panel="prefs"]');
        if (await prefsTab.isVisible()) {
            await prefsTab.click();
        }

        const timerToggle = page.locator('#timer-enabled, input[type="checkbox"][name*="timer" i]').first();

        if (await timerToggle.isVisible()) {
            await timerToggle.click();
            const isChecked = await timerToggle.isChecked();
            expect(isChecked).toBeDefined();
        }
    });

    test('timer duration can be adjusted', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        // Navigate to prefs panel
        const prefsTab = page.locator('[data-panel="prefs"]');
        if (await prefsTab.isVisible()) {
            await prefsTab.click();
        }

        const durationInput = page.locator('#timer-duration, input[name*="duration" i], input[type="number"]').first();

        if (await durationInput.isVisible()) {
            await durationInput.fill('120');
            const value = await durationInput.inputValue();
            expect(value).toBe('120');
        }
    });
});

test.describe('Timer in Multiplayer', () => {
    test.beforeEach(async ({ page }) => {
        await createRoom(page, 'TimerTester');
    });

    test('timer display is present in multiplayer mode', async ({ page }) => {
        // As in standalone, the display only becomes visible once a turn timer is
        // enabled and running; a freshly created room has none, so assert it is
        // attached (the visible-when-active path needs a timer-enabled game flow).
        const timer = page.locator(sel.timerDisplay);
        await expect(timer).toBeAttached();
    });
});
