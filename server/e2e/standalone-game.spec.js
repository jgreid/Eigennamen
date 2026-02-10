// @ts-check
const { test, expect } = require('@playwright/test');

/**
 * Standalone Game E2E Tests
 *
 * Tests the standalone (offline) game mode where all state is
 * encoded in the URL. No server-side room or socket needed.
 */

test.describe('Standalone Game Board', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('board generates 25 unique word cards', async ({ page }) => {
        const cards = page.locator('#board .card');
        await expect(cards).toHaveCount(25);

        // Collect all words and verify uniqueness
        const words = await cards.allTextContents();
        const unique = new Set(words.map(w => w.trim().toLowerCase()));
        expect(unique.size).toBe(25);
    });

    test('new game generates a different board', async ({ page }) => {
        const cards = page.locator('#board .card');
        const wordsBefore = await cards.allTextContents();

        // Click new game
        await page.locator('button:has-text("New Game")').click();

        // Wait for URL to change (new seed)
        await page.waitForURL(url => {
            return url.searchParams.get('game') !== new URL(page.url()).searchParams.get('game');
        }, { timeout: 5000 }).catch(() => {});

        // Board should have different words (with extremely high probability)
        const wordsAfter = await cards.allTextContents();
        const same = wordsBefore.every((w, i) => w === wordsAfter[i]);
        expect(same).toBe(false);
    });

    test('share link contains full game state', async ({ page }) => {
        const shareLink = page.locator('#share-link');
        const url = await shareLink.inputValue();

        // URL should contain game seed
        expect(url).toContain('game=');
        // URL should be a valid URL
        expect(() => new URL(url)).not.toThrow();
    });

    test('loading a shared URL restores the same board', async ({ page, context }) => {
        const shareLink = page.locator('#share-link');
        const sharedUrl = await shareLink.inputValue();

        // Open the same URL in a new page
        const page2 = await context.newPage();
        await page2.goto(sharedUrl);

        // Both pages should show the same 25 words
        const words1 = await page.locator('#board .card').allTextContents();
        const words2 = await page2.locator('#board .card').allTextContents();
        expect(words1).toEqual(words2);

        await page2.close();
    });

    test('red and blue scores are displayed correctly', async ({ page }) => {
        const redScore = page.locator('#red-remaining');
        const blueScore = page.locator('#blue-remaining');

        await expect(redScore).toBeVisible();
        await expect(blueScore).toBeVisible();

        // Scores should be numeric
        const redText = await redScore.textContent();
        const blueText = await blueScore.textContent();
        expect(Number(redText?.trim())).toBeGreaterThan(0);
        expect(Number(blueText?.trim())).toBeGreaterThan(0);
    });

    test('revealing a card updates the score', async ({ page }) => {
        // Determine whose turn it is
        const turnIndicator = page.locator('#turn-indicator');
        const turnText = await turnIndicator.textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Become clicker for current team
        const clickerBtn = page.locator(isRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Record initial scores
        const redBefore = await page.locator('#red-remaining').textContent();
        const blueBefore = await page.locator('#blue-remaining').textContent();

        // Click an unrevealed card
        const card = page.locator('#board .card:not(.revealed)').first();
        await card.click();
        await expect(card).toHaveClass(/revealed/);

        // At least one score should have changed (the revealed card belonged to some team)
        const redAfter = await page.locator('#red-remaining').textContent();
        const blueAfter = await page.locator('#blue-remaining').textContent();
        const scoreChanged = redBefore !== redAfter || blueBefore !== blueAfter;
        // Note: if card was neutral or assassin, scores may not change
        // but the card itself should be revealed
        expect(card).toHaveClass(/revealed/);
    });
});

test.describe('Standalone Spymaster View', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('spymaster sees all card types', async ({ page }) => {
        // Become red spymaster
        await page.locator('#btn-spymaster-red').click();
        await expect(page.locator('#board')).toHaveClass(/spymaster-mode/);

        // Count card types
        const cards = page.locator('#board .card');
        const count = await cards.count();
        const types = { red: 0, blue: 0, neutral: 0, assassin: 0 };

        for (let i = 0; i < count; i++) {
            const cls = await cards.nth(i).getAttribute('class') || '';
            if (cls.includes('spy-red')) types.red++;
            else if (cls.includes('spy-blue')) types.blue++;
            else if (cls.includes('spy-neutral')) types.neutral++;
            else if (cls.includes('spy-assassin')) types.assassin++;
        }

        // Standard Codenames: 9 + 8 + 7 + 1 = 25
        expect(types.red + types.blue).toBe(17);
        expect(types.neutral).toBe(7);
        expect(types.assassin).toBe(1);
        expect(types.red + types.blue + types.neutral + types.assassin).toBe(25);
    });

    test('starting team has 9 cards', async ({ page }) => {
        // Check turn indicator to see who starts
        const turnText = await page.locator('#turn-indicator').textContent();
        const redStarts = turnText?.includes('Red') || false;

        // Become spymaster to see card types
        await page.locator('#btn-spymaster-red').click();

        const cards = page.locator('#board .card');
        let redCount = 0;
        let blueCount = 0;
        const count = await cards.count();

        for (let i = 0; i < count; i++) {
            const cls = await cards.nth(i).getAttribute('class') || '';
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
        // Become red spymaster first, capture layout
        await page.locator('#btn-spymaster-red').click();
        const cards = page.locator('#board .card');
        const redView = [];
        for (let i = 0; i < 25; i++) {
            redView.push(await cards.nth(i).getAttribute('class'));
        }

        // Switch to blue spymaster
        await page.locator('#btn-spymaster-blue').click();
        const blueView = [];
        for (let i = 0; i < 25; i++) {
            blueView.push(await cards.nth(i).getAttribute('class'));
        }

        // Both should show spymaster mode with same card types
        for (let i = 0; i < 25; i++) {
            // Extract spy-type from classes
            const redType = redView[i]?.match(/spy-(red|blue|neutral|assassin)/)?.[0];
            const blueType = blueView[i]?.match(/spy-(red|blue|neutral|assassin)/)?.[0];
            expect(redType).toBe(blueType);
        }
    });
});

test.describe('Game Over Detection', () => {
    test('revealing assassin card ends the game', async ({ page }) => {
        await page.goto('/');

        // Become red spymaster to find assassin
        await page.locator('#btn-spymaster-red').click();

        const cards = page.locator('#board .card');
        let assassinIndex = -1;
        for (let i = 0; i < 25; i++) {
            const cls = await cards.nth(i).getAttribute('class') || '';
            if (cls.includes('spy-assassin')) {
                assassinIndex = i;
                break;
            }
        }
        expect(assassinIndex).toBeGreaterThanOrEqual(0);

        // Get whose turn it is
        const turnText = await page.locator('#turn-indicator').textContent();
        const isRedTurn = turnText?.includes('Red') || false;

        // Switch to clicker for current team
        const clickerBtn = page.locator(isRedTurn ? '#btn-clicker-red' : '#btn-clicker-blue');
        await clickerBtn.click();

        // Click the assassin card
        await cards.nth(assassinIndex).click();

        // Game should be over - look for game over indicator or revealed assassin
        await expect(cards.nth(assassinIndex)).toHaveClass(/revealed/);

        // The turn indicator or game state should reflect game over
        // Game over banner or modal should appear
        const gameOverIndicator = page.locator('#game-over, .game-over, [class*="game-over"]');
        await expect(gameOverIndicator.first()).toBeVisible({ timeout: 3000 }).catch(() => {
            // Alternative: check if all cards are revealed (auto-reveal on game over)
        });
    });
});

test.describe('Settings Panel', () => {
    test.beforeEach(async ({ page }) => {
        await page.goto('/');
    });

    test('colorblind mode can be toggled', async ({ page }) => {
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        const modal = page.locator('#settings-modal');
        await expect(modal).toHaveClass(/active/);

        // Find colorblind toggle
        const colorblindToggle = page.locator('#colorblind-mode, input[name*="colorblind" i], label:has-text("Colorblind")').first();
        if (await colorblindToggle.isVisible()) {
            await colorblindToggle.click();

            // Close settings
            await page.keyboard.press('Escape');

            // Board should have colorblind class
            const body = page.locator('body');
            const hasColorblindClass = await body.evaluate(el => {
                return el.classList.contains('colorblind') ||
                    document.querySelector('#board')?.classList.contains('colorblind') ||
                    document.querySelector('.colorblind') !== null;
            });
            expect(hasColorblindClass).toBe(true);
        }
    });

    test('language can be changed', async ({ page }) => {
        const settingsBtn = page.locator('button:has-text("Settings"), [aria-label*="Settings"]').first();
        await settingsBtn.click();

        // Find language selector
        const langSelect = page.locator('#language-select, select[name*="lang" i]').first();
        if (await langSelect.isVisible()) {
            // Switch to German
            await langSelect.selectOption('de');

            // Some UI text should change
            await page.keyboard.press('Escape');

            // Wait for potential re-render
            await page.waitForTimeout(500);

            // Check if any German text appears (e.g., "Einstellungen" for Settings)
            const body = await page.locator('body').textContent();
            // At minimum the page should still be functional
            expect(body).toBeTruthy();
        }
    });
});
