// @ts-check
const { test, expect } = require('@playwright/test');
const { sel } = require('./helpers');

/**
 * Setup Screen E2E Tests
 *
 * Tests the game setup / quickstart screen shown on initial load.
 * Covers: visibility, board grid, action cards, form navigation,
 * solo mode entry, and form validation.
 */

test.describe('Setup Screen Visibility', () => {
    test('setup screen is shown on initial load', async ({ page }) => {
        await page.goto('/');

        const setupScreen = page.locator(sel.setupScreen);
        await expect(setupScreen).toBeVisible();
    });

    test('app layout is hidden while setup screen is showing', async ({ page }) => {
        await page.goto('/');

        const appLayout = page.locator('#app-layout');
        await expect(appLayout).toBeHidden();
    });

    test('setup screen is not shown when game param is in URL', async ({ page }) => {
        // Navigate with a game param — should skip setup screen
        await page.goto('/?game=test123');

        const setupScreen = page.locator(sel.setupScreen);
        await expect(setupScreen).toBeHidden();

        const appLayout = page.locator('#app-layout');
        await expect(appLayout).toBeVisible();
    });
});

test.describe('Setup Board Grid', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('setup board is visible with card grid', async ({ page }) => {
        const board = page.locator(sel.setupBoard);
        await expect(board).toBeVisible();

        // Board should have cards (blank + action cards)
        const cards = board.locator('.setup-card');
        const count = await cards.count();
        expect(count).toBeGreaterThan(0);
    });

    test('Host action card is visible', async ({ page }) => {
        const hostBtn = page.locator(sel.setupHostBtn);
        await expect(hostBtn).toBeVisible();
    });

    test('Join action card is visible', async ({ page }) => {
        const joinBtn = page.locator(sel.setupJoinBtn);
        await expect(joinBtn).toBeVisible();
    });

    test('Local action card is visible', async ({ page }) => {
        const localBtn = page.locator(sel.setupLocalBtn);
        await expect(localBtn).toBeVisible();
    });
});

test.describe('Setup Screen Navigation', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('clicking Host shows the host form', async ({ page }) => {
        await page.locator(sel.setupHostBtn).click();

        const hostForm = page.locator(sel.setupHostForm);
        await expect(hostForm).toBeVisible();

        // Board should be hidden
        const board = page.locator(sel.setupBoard);
        await expect(board).toBeHidden();
    });

    test('clicking Join shows the join form', async ({ page }) => {
        await page.locator(sel.setupJoinBtn).click();

        const joinForm = page.locator(sel.setupJoinForm);
        await expect(joinForm).toBeVisible();

        // Board should be hidden
        const board = page.locator(sel.setupBoard);
        await expect(board).toBeHidden();
    });

    test('back button returns to the board grid', async ({ page }) => {
        await page.locator(sel.setupJoinBtn).click();
        await expect(page.locator(sel.setupJoinForm)).toBeVisible();

        await page.locator(sel.setupBackBtn).click();

        await expect(page.locator(sel.setupBoard)).toBeVisible();
        await expect(page.locator(sel.setupJoinForm)).toBeHidden();
    });

    test('back button works from host form too', async ({ page }) => {
        await page.locator(sel.setupHostBtn).click();
        await expect(page.locator(sel.setupHostForm)).toBeVisible();

        await page.locator(sel.setupBackBtn).click();

        await expect(page.locator(sel.setupBoard)).toBeVisible();
        await expect(page.locator(sel.setupHostForm)).toBeHidden();
    });
});

test.describe('Local Mode Entry', () => {
    test('clicking Local dismisses setup screen and loads game', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.setupLocalBtn).click();

        // Setup screen should be hidden
        await expect(page.locator(sel.setupScreen)).toBeHidden();

        // App layout should be visible
        await expect(page.locator('#app-layout')).toBeVisible();

        // Game board should be visible with 25 cards
        const board = page.locator(sel.board);
        await expect(board).toBeVisible();

        const cards = page.locator(sel.boardCard);
        await expect(cards).toHaveCount(25);
    });
});

test.describe('Join Form', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.locator(sel.setupJoinBtn).click();
    });

    test('join form has nickname and room ID inputs', async ({ page }) => {
        const nickname = page.locator(sel.setupJoinNickname);
        const roomId = page.locator(sel.setupJoinRoomId);

        await expect(nickname).toBeVisible();
        await expect(roomId).toBeVisible();
    });

    test('nickname input is auto-focused', async ({ page }) => {
        const nickname = page.locator(sel.setupJoinNickname);
        await expect(nickname).toBeFocused({ timeout: 1000 });
    });
});

test.describe('Host Form', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
        await page.locator(sel.setupHostBtn).click();
    });

    test('host form has nickname, room ID, and team name inputs', async ({ page }) => {
        const nickname = page.locator(sel.setupHostNickname);
        const roomId = page.locator(sel.setupHostRoomId);
        const redName = page.locator(sel.setupRedName);
        const blueName = page.locator(sel.setupBlueName);

        await expect(nickname).toBeVisible();
        await expect(roomId).toBeVisible();
        await expect(redName).toBeVisible();
        await expect(blueName).toBeVisible();
    });

    test('nickname input is auto-focused', async ({ page }) => {
        const nickname = page.locator(sel.setupHostNickname);
        await expect(nickname).toBeFocused({ timeout: 1000 });
    });

    test('timer slider is hidden by default', async ({ page }) => {
        const slider = page.locator('#setup-turn-timer-slider');
        await expect(slider).toBeHidden();
    });

    test('toggling timer checkbox shows the timer slider', async ({ page }) => {
        const toggle = page.locator('#setup-turn-timer-toggle');
        const slider = page.locator('#setup-turn-timer-slider');

        await toggle.check();
        await expect(slider).toBeVisible();

        await toggle.uncheck();
        await expect(slider).toBeHidden();
    });
});
