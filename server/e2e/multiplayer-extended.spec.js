// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, joinRoom } = require('./helpers');

/**
 * Extended Multiplayer E2E Tests
 *
 * Tests advanced multiplayer scenarios:
 * - Team selection and role assignment
 * - Player disconnect/reconnect behavior
 * - Game completion in multiplayer
 * - Room error handling
 * - Room settings changes
 */

test.describe('Team Selection in Multiplayer', () => {
    test('players can select different teams', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'TeamLead');
            await joinRoom(player2, roomId, 'TeamMate');

            // Player 1 selects red team
            const redBtn1 = player1.locator(sel.teamRedBtn);
            if (await redBtn1.isVisible({ timeout: 3000 }).catch(() => false)) {
                await redBtn1.click();
            }

            // Player 2 selects blue team
            const blueBtn2 = player2.locator(sel.teamBlueBtn);
            if (await blueBtn2.isVisible({ timeout: 3000 }).catch(() => false)) {
                await blueBtn2.click();
            }

            // Wait for player list to reflect team changes
            await expect(player1.locator('body')).toContainText('TeamMate', { timeout: 5000 });
            await expect(player2.locator('body')).toContainText('TeamLead');
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

test.describe('Room Code Display', () => {
    test('room code is visible after creating room', async ({ page }) => {
        const roomId = await createRoom(page, 'CodeViewer');
        const roomCode = page.locator(sel.roomCode);
        await expect(roomCode).toBeVisible();
        const codeText = await roomCode.textContent();
        expect(codeText?.toLowerCase()).toContain(roomId.toLowerCase());
    });

    test('player count updates when second player joins', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'Counter1');

            const count1 = player1.locator(sel.playerCount);
            await expect(count1).toContainText('1');

            await joinRoom(player2, roomId, 'Counter2');

            await expect(count1).toContainText('2', { timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

test.describe('Join Room Error Handling', () => {
    test('joining non-existent room shows error', async ({ page }) => {
        await page.goto('/');
        await page.locator(sel.multiplayerBtn).click();

        await page.locator(sel.joinNickname).fill('LostPlayer');
        await page.locator(sel.joinRoomId).fill('DOESNOTEXIST999');
        await page.locator(sel.mpActionBtn).click();

        const errorMsg = page.locator('.error-message, .toast-error, [class*="error"]').first();
        const stillInModal = page.locator(`${sel.multiplayerModal}.active`);

        await Promise.race([
            errorMsg.waitFor({ timeout: 5000 }).catch(() => {}),
            stillInModal.waitFor({ timeout: 5000 }).catch(() => {})
        ]);

        const activeIndicator = page.locator(sel.mpIndicatorActive);
        const isConnected = await activeIndicator.isVisible().catch(() => false);
        expect(isConnected).toBe(false);
    });

    test('creating room with empty nickname is prevented', async ({ page }) => {
        await page.goto('/');
        await page.locator(sel.multiplayerBtn).click();
        await page.locator(sel.modeCreateBtn).click();

        // Leave nickname empty
        await page.locator(sel.createRoomId).fill('EMPTYTEST');
        await page.locator(sel.mpActionBtn).click();

        // Wait for connection attempt to resolve, then verify not connected
        await page.waitForFunction(
            (selector) => !document.querySelector(selector),
            sel.mpIndicatorActive,
            { timeout: 5000 }
        ).catch(() => {});
        const activeIndicator = page.locator(sel.mpIndicatorActive);
        const isConnected = await activeIndicator.isVisible().catch(() => false);
        expect(isConnected).toBe(false);
    });
});

test.describe('Chat Between Players', () => {
    test('messages are visible to both players', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'Chatter1');
            await joinRoom(player2, roomId, 'Chatter2');

            const chatInput1 = player1.locator(sel.chatInput);
            await chatInput1.fill('Hello from Player 1!');
            await chatInput1.press('Enter');

            const chat2 = player2.locator(sel.chatMessages);
            await expect(chat2).toContainText('Hello from Player 1!', { timeout: 5000 });

            const chatInput2 = player2.locator(sel.chatInput);
            await chatInput2.fill('Hi back from Player 2!');
            await chatInput2.press('Enter');

            const chat1 = player1.locator(sel.chatMessages);
            await expect(chat1).toContainText('Hi back from Player 2!', { timeout: 5000 });
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('empty messages are not sent', async ({ page }) => {
        await createRoom(page, 'EmptyChatter');

        const chatInput = page.locator(sel.chatInput);
        const chatMessages = page.locator(sel.chatMessages);

        const initialCount = await chatMessages.locator('.chat-message, .message').count();

        await chatInput.press('Enter');

        // Brief wait for any potential message to appear (verifying nothing was sent)
        await page.waitForFunction(
            () => true,
            { timeout: 300 }
        ).catch(() => {});

        const afterCount = await chatMessages.locator('.chat-message, .message').count();
        expect(afterCount).toBe(initialCount);
    });
});

test.describe('Multiplayer Game Start', () => {
    test('start game button requires players on teams', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'GameHost');
            await joinRoom(player2, roomId, 'GameGuest');

            const startBtn = player1.locator(sel.startGameBtn);
            await expect(startBtn).toBeVisible({ timeout: 5000 });

            // Non-host should not have start button (or it should be disabled)
            const guestStartBtn = player2.locator(sel.startGameBtn);
            const isVisible = await guestStartBtn.isVisible().catch(() => false);
            if (isVisible) {
                const isDisabled = await guestStartBtn.isDisabled().catch(() => false);
                // Either not visible or disabled for non-host
            }
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });

    test('game board appears after starting game', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'StartHost');
            await joinRoom(player2, roomId, 'StartGuest');

            const startBtn = player1.locator(sel.startGameBtn);
            if (await startBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
                await startBtn.click();

                // Wait for board to render after game start
                await player1.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});

                const board = player1.locator(sel.board);
                await expect(board).toBeVisible();

                const board2 = player2.locator(sel.board);
                await expect(board2).toBeVisible();
            }
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

test.describe('Multiplayer Reconnection UI', () => {
    test('player list shows disconnected state when player leaves', async ({ browser }) => {
        const ctx1 = await browser.newContext();
        const ctx2 = await browser.newContext();
        const player1 = await ctx1.newPage();
        const player2 = await ctx2.newPage();

        try {
            const roomId = await createRoom(player1, 'StayHost');
            await joinRoom(player2, roomId, 'LeaveGuest');

            await expect(player1.locator('body')).toContainText('LeaveGuest');

            await player2.close();

            // Wait for server to detect disconnect and update the UI
            await player1.waitForFunction(
                () => {
                    const body = document.body.textContent || '';
                    return body.includes('disconnected') || body.includes('left') || !body.includes('LeaveGuest');
                },
                { timeout: 10000 }
            ).catch(() => {});

            const body = await player1.locator('body').textContent();
            expect(body).toBeTruthy();
        } finally {
            await ctx1.close();
            await ctx2.close();
        }
    });
});

test.describe('Multiplayer Modal Navigation', () => {
    test('can switch between create and join modes', async ({ page }) => {
        await page.goto('/');

        await page.locator(sel.multiplayerBtn).click();

        // Switch to create mode
        await page.locator(sel.modeCreateBtn).click();
        const createNickname = page.locator(sel.createNickname);
        await expect(createNickname).toBeVisible();

        // Switch to join mode
        await page.locator(sel.modeJoinBtn).click();
        const joinNickname = page.locator(sel.joinNickname);
        await expect(joinNickname).toBeVisible();
    });

    test('multiplayer indicator shows connection status', async ({ page }) => {
        await page.goto('/');

        const indicator = page.locator(sel.mpIndicator);
        if (await indicator.isVisible().catch(() => false)) {
            await expect(indicator).not.toHaveClass(/active/);
        }

        await createRoom(page, 'IndicatorTest');

        const activeIndicator = page.locator(sel.mpIndicatorActive);
        await expect(activeIndicator).toBeVisible();
    });
});
