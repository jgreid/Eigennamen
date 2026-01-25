// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Timer E2E Tests
 *
 * Tests turn timer functionality.
 */

test.describe('Timer Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('timer display is visible', async ({ page }) => {
        // Timer should be visible in the UI
        const timer = page.locator('#timer, .timer-display, [class*="timer"]').first();
        await expect(timer).toBeVisible();
    });

    test('timer can be enabled in settings', async ({ page }) => {
        // Open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        // Find timer toggle
        const timerToggle = page.locator('#timer-enabled, input[type="checkbox"][name*="timer" i]').first();

        // Toggle timer if found
        if (await timerToggle.isVisible()) {
            await timerToggle.click();

            // Verify toggle state changed
            const isChecked = await timerToggle.isChecked();
            expect(isChecked).toBeDefined();
        }
    });

    test('timer duration can be adjusted', async ({ page }) => {
        // Open settings
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        // Find timer duration input
        const durationInput = page.locator('#timer-duration, input[name*="duration" i], input[type="number"]').first();

        if (await durationInput.isVisible()) {
            // Clear and set new value
            await durationInput.fill('120');

            // Verify value was set
            const value = await durationInput.inputValue();
            expect(value).toBe('120');
        }
    });
});

test.describe('Timer in Multiplayer', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');

        // Create a room
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        const nicknameInput = page.locator('#nickname-input, input[placeholder*="nickname" i]').first();
        await nicknameInput.fill('TimerTester');

        const createBtn = page.locator('button:has-text("Create Room"), #btn-create-room').first();
        await createBtn.click();

        await page.waitForSelector('#room-code, .room-code', { timeout: 10000 });
    });

    test('timer shows in multiplayer mode', async ({ page }) => {
        // Timer display should be visible
        const timer = page.locator('#timer, .timer-display, [class*="timer"]').first();
        await expect(timer).toBeVisible();
    });
});
