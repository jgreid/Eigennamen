// @ts-check
const { test, expect } = require('@playwright/test');

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

        // Click the multiplayer button
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        // Modal should be visible
        const modal = page.locator('#multiplayer-modal');
        await expect(modal).toHaveClass(/active/);
    });

    test('can create a new room', async ({ page }) => {
        await page.goto('/');

        // Open multiplayer modal
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        // Enter nickname
        const nicknameInput = page.locator('#nickname-input, input[placeholder*="nickname" i]').first();
        await nicknameInput.fill('TestPlayer');

        // Click create room button
        const createBtn = page.locator('button:has-text("Create Room"), #btn-create-room').first();
        await createBtn.click();

        // Should show room code or be in a room
        await page.waitForSelector('#room-code, .room-code', { timeout: 10000 });

        const roomCode = page.locator('#room-code, .room-code').first();
        await expect(roomCode).toBeVisible();
    });

    test('displays player list when in room', async ({ page }) => {
        await page.goto('/');

        // Create a room
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        const nicknameInput = page.locator('#nickname-input, input[placeholder*="nickname" i]').first();
        await nicknameInput.fill('HostPlayer');

        const createBtn = page.locator('button:has-text("Create Room"), #btn-create-room').first();
        await createBtn.click();

        // Wait for room to be created
        await page.waitForSelector('#room-code, .room-code', { timeout: 10000 });

        // Player list should show the host
        const playerList = page.locator('#player-list, .player-list');
        await expect(playerList).toContainText('HostPlayer');
    });

    test('can close multiplayer modal with escape', async ({ page }) => {
        await page.goto('/');

        // Open multiplayer modal
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        const modal = page.locator('#multiplayer-modal');
        await expect(modal).toHaveClass(/active/);

        // Press Escape to close
        await page.keyboard.press('Escape');

        // Modal should be closed
        await expect(modal).not.toHaveClass(/active/);
    });
});

test.describe('Chat Functionality', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');

        // Create a room first
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        const nicknameInput = page.locator('#nickname-input, input[placeholder*="nickname" i]').first();
        await nicknameInput.fill('ChatTester');

        const createBtn = page.locator('button:has-text("Create Room"), #btn-create-room').first();
        await createBtn.click();

        // Wait for room
        await page.waitForSelector('#room-code, .room-code', { timeout: 10000 });
    });

    test('chat input is visible when in room', async ({ page }) => {
        const chatInput = page.locator('#chat-input, input[placeholder*="message" i]');
        await expect(chatInput).toBeVisible();
    });

    test('can send a chat message', async ({ page }) => {
        // Find and fill chat input
        const chatInput = page.locator('#chat-input, input[placeholder*="message" i]');
        await chatInput.fill('Hello, world!');

        // Submit message (press Enter or click send button)
        await chatInput.press('Enter');

        // Message should appear in chat
        const chatMessages = page.locator('#chat-messages, .chat-messages');
        await expect(chatMessages).toContainText('Hello, world!');
    });

    test('chat messages show sender name', async ({ page }) => {
        const chatInput = page.locator('#chat-input, input[placeholder*="message" i]');
        await chatInput.fill('Test message');
        await chatInput.press('Enter');

        // Message should show sender name
        const chatMessages = page.locator('#chat-messages, .chat-messages');
        await expect(chatMessages).toContainText('ChatTester');
    });
});

test.describe('Room Settings', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');

        // Create a room
        const multiplayerBtn = page.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
        await multiplayerBtn.click();

        const nicknameInput = page.locator('#nickname-input, input[placeholder*="nickname" i]').first();
        await nicknameInput.fill('SettingsTester');

        const createBtn = page.locator('button:has-text("Create Room"), #btn-create-room').first();
        await createBtn.click();

        await page.waitForSelector('#room-code, .room-code', { timeout: 10000 });
    });

    test('host can see start game button', async ({ page }) => {
        const startBtn = page.locator('button:has-text("Start Game"), #btn-start-game');
        await expect(startBtn).toBeVisible();
    });

    test('host badge is visible for room creator', async ({ page }) => {
        const hostBadge = page.locator('.host-badge, [class*="host"]');
        await expect(hostBadge).toBeVisible();
    });
});

/**
 * Phase 3.5: Two-player game flow test
 * Tests the complete flow of two players joining and playing a game
 */
test.describe('Two-Player Game Flow', () => {
    test('two players can join and start a game', async ({ browser }) => {
        // Create two separate browser contexts for independent sessions
        const player1Context = await browser.newContext();
        const player2Context = await browser.newContext();

        const player1 = await player1Context.newPage();
        const player2 = await player2Context.newPage();

        try {
            // Player 1: Create room
            await player1.goto('/');
            const mp1Btn = player1.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
            await mp1Btn.click();

            // Switch to create mode
            const createModeBtn = player1.locator('button:has-text("Create"), .mode-btn[data-mode="create"]').first();
            await createModeBtn.click();

            // Enter nickname and room ID
            const createNickname = player1.locator('#create-nickname');
            await createNickname.fill('Player1');

            const createRoomId = player1.locator('#create-room-id');
            const roomId = `E2ETEST${Date.now()}`;
            await createRoomId.fill(roomId);

            // Click create/join action button
            const actionBtn = player1.locator('#btn-mp-action');
            await actionBtn.click();

            // Wait for room to be created
            await player1.waitForSelector('.mp-indicator.active, #mp-indicator.active', { timeout: 15000 });

            // Player 2: Join the room
            await player2.goto('/');
            const mp2Btn = player2.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
            await mp2Btn.click();

            // Should be in join mode by default
            const joinNickname = player2.locator('#join-nickname');
            await joinNickname.fill('Player2');

            const joinRoomId = player2.locator('#join-room-id');
            await joinRoomId.fill(roomId);

            // Click join action button
            const join2ActionBtn = player2.locator('#btn-mp-action');
            await join2ActionBtn.click();

            // Wait for player 2 to join
            await player2.waitForSelector('.mp-indicator.active, #mp-indicator.active', { timeout: 15000 });

            // Verify both players see each other
            // Player 1 should see Player 2 joined
            await expect(player1.locator('body')).toContainText('Player2');
            await expect(player2.locator('body')).toContainText('Player1');

            // Player count should show 2 players
            const player1Count = player1.locator('#mp-player-count');
            await expect(player1Count).toContainText('2');

        } finally {
            // Clean up contexts
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
            const mp1Btn = player1.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
            await mp1Btn.click();

            const createModeBtn = player1.locator('button:has-text("Create"), .mode-btn[data-mode="create"]').first();
            await createModeBtn.click();

            const createNickname = player1.locator('#create-nickname');
            await createNickname.fill('Host');

            const createRoomId = player1.locator('#create-room-id');
            const roomId = `STARTTEST${Date.now()}`;
            await createRoomId.fill(roomId);

            const actionBtn = player1.locator('#btn-mp-action');
            await actionBtn.click();

            await player1.waitForSelector('.mp-indicator.active, #mp-indicator.active', { timeout: 15000 });

            // Player 2: Join the room
            await player2.goto('/');
            const mp2Btn = player2.locator('button:has-text("Multiplayer"), #btn-multiplayer').first();
            await mp2Btn.click();

            const joinNickname = player2.locator('#join-nickname');
            await joinNickname.fill('Guest');

            const joinRoomId = player2.locator('#join-room-id');
            await joinRoomId.fill(roomId);

            const join2ActionBtn = player2.locator('#btn-mp-action');
            await join2ActionBtn.click();

            await player2.waitForSelector('.mp-indicator.active, #mp-indicator.active', { timeout: 15000 });

            // Player 1 (host) starts the game
            // First, both players need to join teams
            // Open sidebar/settings to select team
            const settingsNav = player1.locator('#nav-settings, button:has-text("Settings")').first();
            if (await settingsNav.isVisible()) {
                await settingsNav.click();
            }

            // Look for team selection buttons
            const redTeamBtn = player1.locator('button:has-text("Red Team"), .team-btn[data-team="red"]').first();
            if (await redTeamBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
                await redTeamBtn.click();
            }

            // Start game button
            const startGameBtn = player1.locator('#btn-start-game, button:has-text("Start Game")').first();
            await expect(startGameBtn).toBeVisible({ timeout: 5000 });

            // Note: Starting game may require minimum players on teams
            // This test just verifies the button is visible for the host

        } finally {
            await player1Context.close();
            await player2Context.close();
        }
    });
});
