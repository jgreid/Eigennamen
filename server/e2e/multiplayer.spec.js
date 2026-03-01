// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom } = require('./helpers');

/**
 * Multiplayer E2E Tests
 *
 * Tests multiplayer room functionality including:
 * - Room creation and joining
 * - Player synchronization
 * - Chat functionality
 */

test.describe('Multiplayer Rooms', () => {
    test('can open multiplayer modal', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();

        const modal = page.locator(sel.multiplayerModal);
        await expect(modal).toHaveClass(/active/);
    });

    test('can create a new room', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();
        await page.locator(sel.modeCreateBtn).click();

        await page.locator(sel.createNickname).fill('TestPlayer');
        const roomId = `ROOM${Date.now()}`;
        await page.locator(sel.createRoomId).fill(roomId);
        await page.locator(sel.mpActionBtn).click();

        await page.waitForSelector(sel.mpIndicatorActive, { timeout: 10000 });

        const roomCode = page.locator(sel.roomCode);
        await expect(roomCode).toBeVisible();
    });

    test('displays player list when in room', async ({ page }) => {
        await createRoom(page, 'HostPlayer');

        // Player list should show the host
        const body = page.locator('body');
        await expect(body).toContainText('HostPlayer');
    });

    test('can close multiplayer modal with escape', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();

        const modal = page.locator(sel.multiplayerModal);
        await expect(modal).toHaveClass(/active/);

        await page.keyboard.press('Escape');
        await expect(modal).not.toHaveClass(/active/);
    });
});

test.describe('Chat Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await createRoom(page, 'ChatTester');
    });

    test('chat input is visible when in room', async ({ page }) => {
        const chatInput = page.locator(sel.chatInput);
        await expect(chatInput).toBeVisible();
    });

    test('can send a chat message', async ({ page }) => {
        const chatInput = page.locator(sel.chatInput);
        await chatInput.fill('Hello, world!');
        await chatInput.press('Enter');

        const chatMessages = page.locator(sel.chatMessages);
        await expect(chatMessages).toContainText('Hello, world!');
    });

    test('chat messages show sender name', async ({ page }) => {
        const chatInput = page.locator(sel.chatInput);
        await chatInput.fill('Test message');
        await chatInput.press('Enter');

        const chatMessages = page.locator(sel.chatMessages);
        await expect(chatMessages).toContainText('ChatTester');
    });
});

test.describe('Room Settings', () => {
    test.beforeEach(async ({ page }) => {
        await createRoom(page, 'SettingsTester');
    });

    test('host can see start game button', async ({ page }) => {
        const startBtn = page.locator(sel.startGameBtn);
        await expect(startBtn).toBeVisible();
    });

    test('host badge is visible for room creator', async ({ page }) => {
        const hostBadge = page.locator('.host-badge');
        await expect(hostBadge).toBeVisible();
    });
});

/**
 * Two-player game flow test
 */
test.describe('Two-Player Game Flow', () => {
    test('two players can join and start a game', async ({ browser }) => {
        const player1Context = await browser.newContext();
        const player2Context = await browser.newContext();

        const player1 = await player1Context.newPage();
        const player2 = await player2Context.newPage();

        try {
            // Player 1: Create room
            await player1.goto('/');
            await player1.locator(sel.multiplayerBtn).click();
            await player1.locator(sel.modeCreateBtn).click();

            await player1.locator(sel.createNickname).fill('Player1');
            const roomId = `E2ETEST${Date.now()}`;
            await player1.locator(sel.createRoomId).fill(roomId);
            await player1.locator(sel.mpActionBtn).click();

            await player1.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });

            // Player 2: Join the room
            await player2.goto('/');
            await player2.locator(sel.multiplayerBtn).click();
            await player2.locator(sel.modeJoinBtn).click();

            await player2.locator(sel.joinNickname).fill('Player2');
            await player2.locator(sel.joinRoomId).fill(roomId);
            await player2.locator(sel.mpActionBtn).click();

            await player2.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });

            // Verify both players see each other
            await expect(player1.locator('body')).toContainText('Player2');
            await expect(player2.locator('body')).toContainText('Player1');

            // Player count should show 2
            const player1Count = player1.locator(sel.playerCount);
            await expect(player1Count).toContainText('2');
        } finally {
            await player1Context.close();
            await player2Context.close();
        }
    });

    test('host can start game with another player', async ({ browser }) => {
        const player1Context = await browser.newContext();
        const player2Context = await browser.newContext();

        const player1 = await player1Context.newPage();
        const player2 = await player2Context.newPage();

        try {
            // Player 1: Create room
            await player1.goto('/');
            await player1.locator(sel.multiplayerBtn).click();
            await player1.locator(sel.modeCreateBtn).click();

            await player1.locator(sel.createNickname).fill('Host');
            const roomId = `STARTTEST${Date.now()}`;
            await player1.locator(sel.createRoomId).fill(roomId);
            await player1.locator(sel.mpActionBtn).click();

            await player1.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });

            // Player 2: Join the room
            await player2.goto('/');
            await player2.locator(sel.multiplayerBtn).click();

            await player2.locator(sel.joinNickname).fill('Guest');
            await player2.locator(sel.joinRoomId).fill(roomId);
            await player2.locator(sel.mpActionBtn).click();

            await player2.waitForSelector(sel.mpIndicatorActive, { timeout: 15000 });

            // Host joins a team
            const redTeamBtn = player1.locator(sel.teamRedBtn);
            if (await redTeamBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await redTeamBtn.click();
            }

            // Start game button should be visible for host
            const startGameBtn = player1.locator(sel.startGameBtn);
            await expect(startGameBtn).toBeVisible({ timeout: 5000 });
        } finally {
            await player1Context.close();
            await player2Context.close();
        }
    });
});
