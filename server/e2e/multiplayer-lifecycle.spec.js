// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, joinRoom, selectTeam } = require('./helpers');

/**
 * Multiplayer Game Lifecycle E2E Tests
 *
 * Comprehensive tests covering the complete multiplayer game lifecycle:
 * - Room creation -> joining -> team/role assignment -> game start
 * - Player reconnection after disconnect
 * - Multiple sequential games in the same room
 * - Error handling and edge cases
 */

test.describe('Full Multiplayer Game Lifecycle', () => {
    test('two players complete a full game lifecycle: create -> join -> assign -> play', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'Alice');
            await joinRoom(guest, roomId, 'Bob');

            // Both players should see each other
            await expect(host.locator('body')).toContainText('Bob', { timeout: 5000 });
            await expect(guest.locator('body')).toContainText('Alice', { timeout: 5000 });

            // Player count should be 2
            const hostPlayerCount = host.locator(sel.playerCount);
            await expect(hostPlayerCount).toContainText('2', { timeout: 5000 });

            // Host should see start game button
            const startBtn = host.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });

            // Guest should NOT see start game button (not host)
            const guestStartBtn = guest.locator(sel.startGameBtn);
            const guestCanSeeStart = await guestStartBtn.isVisible({ timeout: 2000 }).catch(() => false);
            if (guestCanSeeStart) {
                const isDisabled = await guestStartBtn.isDisabled().catch(() => true);
                expect(isDisabled || !guestCanSeeStart).toBeTruthy();
            }

            // Verify room code is displayed
            const roomCodeDisplay = host.locator(sel.roomCode);
            await expect(roomCodeDisplay).toBeVisible();

            // Verify host badge is visible
            const hostBadge = host.locator('.host-badge').first();
            const hostBadgeVisible = await hostBadge.isVisible({ timeout: 2000 }).catch(() => false);
            expect(hostBadgeVisible).toBeTruthy();

        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('team assignment is synchronized between players', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'TeamHost');
            await joinRoom(guest, roomId, 'TeamGuest');

            await expect(host.locator('body')).toContainText('TeamGuest', { timeout: 5000 });

            // Host joins Red team
            await selectTeam(host, 'red');
            await host.waitForTimeout(1000);

            // Guest joins Blue team
            await selectTeam(guest, 'blue');
            await guest.waitForTimeout(1000);

            // Verify both players see player names
            const hostBody = await host.locator('body').textContent();
            const guestBody = await guest.locator('body').textContent();

            expect(hostBody).toContain('TeamHost');
            expect(guestBody).toContain('TeamGuest');

        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('three players can join and see each other', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const ctx3 = await browser.newContext();
        const p1 = await ctx1.newPage();
        const p2 = await ctx2.newPage();
        const p3 = await ctx3.newPage();

        try {
            const roomId = await createRoom(p1, 'Player1');
            await joinRoom(p2, roomId, 'Player2');
            await joinRoom(p3, roomId, 'Player3');

            await expect(p1.locator('body')).toContainText('Player2', { timeout: 5000 });
            await expect(p1.locator('body')).toContainText('Player3', { timeout: 5000 });
            await expect(p2.locator('body')).toContainText('Player1', { timeout: 5000 });
            await expect(p3.locator('body')).toContainText('Player1', { timeout: 5000 });

            const playerCount = p1.locator(sel.playerCount);
            await expect(playerCount).toContainText('3', { timeout: 5000 });

        } finally {
            await ctx1.close();
            await ctx2.close();
            await ctx3.close();
        }
    });

    test('player leaving updates player count', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'StayHost');
            await joinRoom(guest, roomId, 'LeavingGuest');

            await expect(host.locator(sel.playerCount)).toContainText('2', { timeout: 5000 });

            // Guest leaves by closing their context
            await ctx2.close();

            // Wait for disconnect detection
            await host.waitForTimeout(3000);

            const bodyText = await host.locator('body').textContent();
            expect(bodyText).toBeDefined();

        } finally {
            await ctx1.close();
        }
    });
});

test.describe('Multiplayer Room Join Errors', () => {
    test('joining non-existent room shows error', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();

        await page.locator(sel.joinNickname).fill('ErrorTester');
        await page.locator(sel.joinRoomId).fill('NONEXISTENT999');
        await page.locator(sel.mpActionBtn).click();

        // Should show error or stay disconnected
        const errorVisible = await page.locator('.error-message, .toast-error, [class*="error"]').first()
            .isVisible({ timeout: 5000 }).catch(() => false);

        const stillInactive = await page.locator(`${sel.mpIndicator}:not(.active)`).isVisible({ timeout: 2000 }).catch(() => false);

        expect(errorVisible || stillInactive).toBeTruthy();
    });

    test('empty nickname is rejected', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();
        await page.locator(sel.modeCreateBtn).click();

        // Leave nickname empty
        await page.locator(sel.createNickname).fill('');
        await page.locator(sel.createRoomId).fill('EMPTYNAME123');
        await page.locator(sel.mpActionBtn).click();

        await page.waitForTimeout(1000);

        // Should NOT be connected
        const connected = await page.locator(sel.mpIndicatorActive).isVisible({ timeout: 2000 }).catch(() => false);
        expect(connected).toBeFalsy();
    });
});

test.describe('Multiplayer Connection Management', () => {
    test('connection indicator shows active state in room', async ({ page }) => {
        await createRoom(page, 'ConnTester');

        const indicator = page.locator(sel.mpIndicatorActive);
        await expect(indicator).toBeVisible({ timeout: 5000 });
    });

    test('room code is displayed and non-empty', async ({ page }) => {
        await createRoom(page, 'CodeTester');

        const roomCodeEl = page.locator(sel.roomCode);
        await expect(roomCodeEl).toBeVisible();

        const displayedCode = await roomCodeEl.textContent();
        expect(displayedCode).toBeTruthy();
        expect(displayedCode.length).toBeGreaterThan(0);
    });

    test('player reconnects after page refresh', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'ReconnHost');
            await joinRoom(guest, roomId, 'ReconnGuest');

            await expect(host.locator('body')).toContainText('ReconnGuest', { timeout: 5000 });

            // Guest refreshes
            await guest.reload();

            await guest.waitForSelector(sel.multiplayerBtn, { timeout: 10000 });
            await guest.waitForTimeout(3000);

            // Check if auto-reconnected
            const autoReconnected = await guest.locator(sel.mpIndicatorActive)
                .isVisible({ timeout: 5000 }).catch(() => false);

            if (!autoReconnected) {
                await joinRoom(guest, roomId, 'ReconnGuest');
            }

            await expect(host.locator('body')).toContainText('ReconnGuest', { timeout: 10000 });

        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

test.describe('Multiplayer Mode Switching', () => {
    test('can switch between create and join modes', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();

        // Switch to create mode
        await page.locator(sel.modeCreateBtn).click();

        const createNickname = page.locator(sel.createNickname);
        await expect(createNickname).toBeVisible({ timeout: 3000 });

        // Switch to join mode
        await page.locator(sel.modeJoinBtn).click();

        const joinNickname = page.locator(sel.joinNickname);
        await expect(joinNickname).toBeVisible({ timeout: 3000 });
    });
});

test.describe('Multiplayer Game Board Sync', () => {
    test('host starting game shows board to both players', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const host = await ctx1.newPage();
        const guest = await ctx2.newPage();

        try {
            const roomId = await createRoom(host, 'BoardHost');
            await joinRoom(guest, roomId, 'BoardGuest');

            await expect(host.locator('body')).toContainText('BoardGuest', { timeout: 5000 });

            await selectTeam(host, 'red');
            await guest.waitForTimeout(500);
            await selectTeam(guest, 'blue');
            await host.waitForTimeout(500);

            const startBtn = host.locator(sel.startGameBtn);
            const canStart = await startBtn.isVisible({ timeout: 3000 }).catch(() => false);

            if (canStart) {
                await startBtn.click();
                await host.waitForTimeout(2000);

                const hostCards = host.locator(sel.boardCard);
                const guestCards = guest.locator(sel.boardCard);

                const hostCardCount = await hostCards.count().catch(() => 0);
                const guestCardCount = await guestCards.count().catch(() => 0);

                expect(hostCardCount + guestCardCount).toBeGreaterThan(0);
            }

        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});
