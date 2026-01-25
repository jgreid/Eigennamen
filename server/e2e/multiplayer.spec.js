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
