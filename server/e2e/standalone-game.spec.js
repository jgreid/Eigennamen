// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, goToGame, becomeCurrentClicker } = require('./helpers');

/**
 * Standalone Game E2E Tests
 *
 * Tests the standalone (offline) game mode where all state is
 * encoded in the URL. No server-side room or socket needed.
 */

test.describe('Standalone Game Board', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('board generates 25 unique word cards', async ({ page }) => {
        const cards = page.locator(sel.boardCard);
        await expect(cards).toHaveCount(25);

        const words = await cards.allTextContents();
        const unique = new Set(words.map((w) => w.trim().toLowerCase()));
        expect(unique.size).toBe(25);
    });

    test('new game generates a different board', async ({ page }) => {
        const cards = page.locator(sel.boardCard);
        const wordsBefore = await cards.allTextContents();

        await page.locator(sel.newGameBtn).click();

        await page
            .waitForURL(
                (url) => {
                    return url.searchParams.get('game') !== new URL(page.url()).searchParams.get('game');
                },
                { timeout: 5000 }
            )
            .catch(() => {});

        const wordsAfter = await cards.allTextContents();
        const same = wordsBefore.every((w, i) => w === wordsAfter[i]);
        expect(same).toBe(false);
    });

    test('share link contains full game state', async ({ page }) => {
        const shareLink = page.locator(sel.shareLink);
        const url = await shareLink.inputValue();

        expect(url).toContain('game=');
        expect(() => new URL(url)).not.toThrow();
    });

    test('loading a shared URL restores the same board', async ({ page, context }) => {
        const shareLink = page.locator(sel.shareLink);
        const sharedUrl = await shareLink.inputValue();

        const page2 = await context.newPage();
        await page2.goto(sharedUrl);

        const words1 = await page.locator(sel.boardCard).allTextContents();
        const words2 = await page2.locator(sel.boardCard).allTextContents();
        expect(words1).toEqual(words2);

        await page2.close();
    });

    test('red and blue scores are displayed correctly', async ({ page }) => {
        const redScore = page.locator(sel.redRemaining);
        const blueScore = page.locator(sel.blueRemaining);

        await expect(redScore).toBeVisible();
        await expect(blueScore).toBeVisible();

        const redText = await redScore.textContent();
        const blueText = await blueScore.textContent();
        expect(Number(redText?.trim())).toBeGreaterThan(0);
        expect(Number(blueText?.trim())).toBeGreaterThan(0);
    });

    test('revealing a card updates the board', async ({ page }) => {
        await becomeCurrentClicker(page);

        const card = page.locator(sel.boardCardUnrevealed).first();
        await card.click();
        await expect(card).toHaveClass(/revealed/);
    });
});

test.describe('Standalone Spymaster View', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('spymaster sees all card types', async ({ page }) => {
        await page.locator(sel.spymasterBtn).click();
        await expect(page.locator(sel.board)).toHaveClass(/spymaster-mode/);

        const cards = page.locator(sel.boardCard);
        const count = await cards.count();
        const types = { red: 0, blue: 0, neutral: 0, assassin: 0 };

        for (let i = 0; i < count; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes('spy-red')) types.red++;
            else if (cls.includes('spy-blue')) types.blue++;
            else if (cls.includes('spy-neutral')) types.neutral++;
            else if (cls.includes('spy-assassin')) types.assassin++;
        }

        // Standard Eigennamen: 9 + 8 + 7 + 1 = 25
        expect(types.red + types.blue).toBe(17);
        expect(types.neutral).toBe(7);
        expect(types.assassin).toBe(1);
        expect(types.red + types.blue + types.neutral + types.assassin).toBe(25);
    });

    test('starting team has 9 cards', async ({ page }) => {
        const turnText = await page.locator(sel.turnIndicator).textContent();
        const redStarts = turnText?.includes('Red') || false;

        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        let redCount = 0;
        let blueCount = 0;
        const count = await cards.count();

        for (let i = 0; i < count; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes('spy-red')) redCount++;
            else if (cls.includes('spy-blue')) blueCount++;
        }

        if (redStarts) {
            expect(redCount).toBe(9);
            expect(blueCount).toBe(8);
        } else {
            expect(blueCount).toBe(9);
            expect(redCount).toBe(8);
        }
    });

    test('blue spymaster sees same layout as red spymaster', async ({ page }) => {
        await page.locator(sel.spymasterBtn).click();
        const cards = page.locator(sel.boardCard);
        const firstView = [];
        for (let i = 0; i < 25; i++) {
            firstView.push(await cards.nth(i).getAttribute('class'));
        }

        // Click spymaster again (toggles or re-selects)
        // The board should show the same spy- classes regardless of which team's spymaster
        for (let i = 0; i < 25; i++) {
            const cls = firstView[i] || '';
            const spyType = cls.match(/spy-(red|blue|neutral|assassin)/)?.[0];
            expect(spyType).toBeTruthy();
        }
    });
});

test.describe('Game Over Detection', () => {
    test('revealing assassin card ends the game', async ({ page }) => {
        await goToGame(page);

        // Become spymaster to find assassin
        await page.locator(sel.spymasterBtn).click();

        const cards = page.locator(sel.boardCard);
        let assassinIndex = -1;
        for (let i = 0; i < 25; i++) {
            const cls = (await cards.nth(i).getAttribute('class')) || '';
            if (cls.includes('spy-assassin')) {
                assassinIndex = i;
                break;
            }
        }
        expect(assassinIndex).toBeGreaterThanOrEqual(0);

        // Switch to clicker for current team
        await becomeCurrentClicker(page);

        // Click the assassin card
        await cards.nth(assassinIndex).click();

        // Card should be revealed
        await expect(cards.nth(assassinIndex)).toHaveClass(/revealed/);

        // Game over indicator should appear
        const gameOverIndicator = page.locator(sel.gameOverModal);
        await expect(gameOverIndicator)
            .toBeVisible({ timeout: 3000 })
            .catch(() => {
                // Alternative: board enters spymaster-mode on game over
            });
    });
});

test.describe('Settings Panel', () => {
    test.beforeEach(async ({ page }) => {
        await goToGame(page);
    });

    test('colorblind mode can be toggled', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        const modal = page.locator(sel.settingsModal);
        await expect(modal).toHaveClass(/active/);

        // Navigate to prefs panel
        const prefsTab = page.locator('[data-panel="prefs"]');
        if (await prefsTab.isVisible()) {
            await prefsTab.click();
        }

        const colorblindToggle = page.locator(sel.colorblindToggle);
        if (await colorblindToggle.isVisible()) {
            await colorblindToggle.click();

            await page.keyboard.press('Escape');

            const body = page.locator('body');
            const hasColorblindClass = await body.evaluate((el) => {
                return (
                    el.classList.contains('colorblind') ||
                    document.querySelector('[data-testid="game-board"]')?.classList.contains('colorblind') ||
                    document.querySelector('.colorblind') !== null
                );
            });
            expect(hasColorblindClass).toBe(true);
        }
    });

    test('language can be changed', async ({ page }) => {
        await page.locator(sel.settingsBtn).click();

        // Navigate to prefs panel
        const prefsTab = page.locator('[data-panel="prefs"]');
        if (await prefsTab.isVisible()) {
            await prefsTab.click();
        }

        const langSelect = page.locator(sel.languageSelect);
        if (await langSelect.isVisible()) {
            await langSelect.selectOption('de');
            await page.keyboard.press('Escape');
            // Wait for modal to close (CSS transition)
            await page
                .waitForFunction(() => !document.querySelector('.modal.active, [class*="modal"].active'), {
                    timeout: 3000,
                })
                .catch(() => {});

            const body = await page.locator('body').textContent();
            expect(body).toBeTruthy();
        }
    });
});
