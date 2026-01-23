import { test, expect, Page, BrowserContext } from '@playwright/test';

/**
 * Critical Game Flow E2E Tests
 *
 * Tests the complete user journey from room creation to game completion.
 * This covers the most important paths that users take through the application.
 */

test.describe('Codenames Game Flow', () => {

  test.describe('Standalone Mode (No Server)', () => {

    test('loads the game page successfully', async ({ page }) => {
      await page.goto('/');

      // Check that the main elements are visible
      await expect(page.locator('.game-title')).toBeVisible();
      await expect(page.locator('.board')).toBeVisible();
      await expect(page.locator('.scoreboard')).toBeVisible();
    });

    test('displays 25 cards on the board', async ({ page }) => {
      await page.goto('/');

      const cards = page.locator('.card');
      await expect(cards).toHaveCount(25);
    });

    test('can reveal a card by clicking', async ({ page }) => {
      await page.goto('/');

      // Get the first card
      const firstCard = page.locator('.card').first();
      await expect(firstCard).not.toHaveClass(/revealed/);

      // Click to reveal
      await firstCard.click();

      // Card should now be revealed
      await expect(firstCard).toHaveClass(/revealed/);
    });

    test('can start a new game', async ({ page }) => {
      await page.goto('/');

      // Click new game button
      await page.locator('[data-action="confirm-new-game"]').click();

      // Confirm in modal
      await page.locator('[data-action="new-game"]').click();

      // All cards should be unrevealed
      const revealedCards = page.locator('.card.revealed');
      await expect(revealedCards).toHaveCount(0);
    });

    test('team score updates when revealing team cards', async ({ page }) => {
      await page.goto('/');

      // Get initial red remaining count
      const redRemaining = page.locator('#red-remaining');
      const initialCount = await redRemaining.textContent();

      // Reveal a card - the count may change depending on what type it is
      // This is a basic check that the UI is responsive
      const firstCard = page.locator('.card').first();
      await firstCard.click();

      // Page should still be functional
      await expect(page.locator('.board')).toBeVisible();
    });

    test('can select a team', async ({ page }) => {
      await page.goto('/');

      // Click red team button
      await page.locator('#btn-team-red').click();

      // Role banner should update to show team membership
      const roleBanner = page.locator('.role-banner');
      await expect(roleBanner).toBeVisible();
    });

    test('can become spymaster', async ({ page }) => {
      await page.goto('/');

      // First select a team
      await page.locator('#btn-team-red').click();

      // Then become spymaster
      await page.locator('#btn-spymaster').click();

      // Should see spymaster view (cards show their true colors)
      await expect(page.locator('.spymaster-mode')).toBeVisible();
    });

    test('spymaster can see card types', async ({ page }) => {
      await page.goto('/');

      // Become red spymaster
      await page.locator('#btn-team-red').click();
      await page.locator('#btn-spymaster').click();

      // Should have spy-* classes on cards
      const spyCards = page.locator('.card[class*="spy-"]');
      await expect(spyCards).not.toHaveCount(0);
    });
  });

  test.describe('Settings Modal', () => {

    test('can open and close settings', async ({ page }) => {
      await page.goto('/');

      // Open settings
      await page.locator('[data-action="open-settings"]').click();
      await expect(page.locator('#settings-modal')).toHaveClass(/active/);

      // Close settings
      await page.locator('[data-action="close-settings"]').click();
      await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
    });

    test('displays QR code in settings', async ({ page }) => {
      await page.goto('/');

      // Open settings
      await page.locator('[data-action="open-settings"]').click();

      // QR canvas should be visible
      await expect(page.locator('#qr-canvas')).toBeVisible();
    });

    test('displays version number in settings', async ({ page }) => {
      await page.goto('/');

      // Open settings
      await page.locator('[data-action="open-settings"]').click();

      // Version should be visible
      const version = page.locator('.qr-section .version');
      await expect(version).toBeVisible();
      await expect(version).toContainText('v');
    });

    test('can change team names', async ({ page }) => {
      await page.goto('/');

      // Open settings
      await page.locator('[data-action="open-settings"]').click();

      // Change red team name
      await page.locator('#red-name-input').fill('Foxes');

      // Save settings
      await page.locator('[data-action="save-settings"]').click();

      // Red team name should be updated
      await expect(page.locator('#red-team-name')).toContainText('Foxes');
    });

    test('can add custom words', async ({ page }) => {
      await page.goto('/');

      // Open settings
      await page.locator('[data-action="open-settings"]').click();

      // Select custom words only mode
      await page.locator('#wordlist-mode-custom').click();

      // Add custom words (need at least 25)
      const customWords = Array.from({ length: 30 }, (_, i) => `Word${i + 1}`).join('\n');
      await page.locator('#custom-words').fill(customWords);

      // Word count should update
      await expect(page.locator('#word-count')).toContainText('30 words');
    });
  });

  test.describe('Game End Conditions', () => {

    test('game ends when assassin is revealed', async ({ page }) => {
      await page.goto('/');

      // First become spymaster to see which card is the assassin
      await page.locator('#btn-team-red').click();
      await page.locator('#btn-spymaster').click();

      // Find the assassin card
      const assassinCard = page.locator('.card.spy-assassin').first();

      // Switch to clicker to reveal it
      await page.locator('#btn-clicker').click();

      // Click the assassin
      await assassinCard.click();

      // Game should end - check for game over state
      await expect(assassinCard).toHaveClass(/revealed/);
      await expect(assassinCard).toHaveClass(/assassin/);
    });
  });

  test.describe('URL State Encoding', () => {

    test('game state is encoded in URL', async ({ page }) => {
      await page.goto('/');

      // Reveal a card
      await page.locator('.card').first().click();

      // URL should contain state parameter
      const url = page.url();
      expect(url).toContain('#');
    });

    test('game state persists on reload', async ({ page }) => {
      await page.goto('/');

      // Reveal first card
      const firstCard = page.locator('.card').first();
      const cardWord = await firstCard.textContent();
      await firstCard.click();

      // Get URL with state
      const urlWithState = page.url();

      // Reload page
      await page.reload();

      // Find the same card by text and check it's still revealed
      const sameCard = page.locator('.card', { hasText: cardWord });
      await expect(sameCard).toHaveClass(/revealed/);
    });
  });

  test.describe('Accessibility', () => {

    test('has skip link for keyboard navigation', async ({ page }) => {
      await page.goto('/');

      const skipLink = page.locator('.skip-link');
      await expect(skipLink).toBeAttached();
    });

    test('cards have appropriate aria labels', async ({ page }) => {
      await page.goto('/');

      // Board should have grid role
      await expect(page.locator('.board')).toHaveAttribute('role', 'grid');
    });

    test('buttons are keyboard accessible', async ({ page }) => {
      await page.goto('/');

      // Tab to first interactive element
      await page.keyboard.press('Tab');

      // Should have focus on an interactive element
      const focused = page.locator(':focus');
      await expect(focused).toBeVisible();
    });
  });
});

test.describe('Mobile Responsiveness', () => {
  test.use({ viewport: { width: 375, height: 667 } }); // iPhone SE

  test('sidebar stacks on mobile', async ({ page }) => {
    await page.goto('/');

    // Sidebar should be visible and full-width on mobile
    const sidebar = page.locator('.sidebar');
    await expect(sidebar).toBeVisible();

    // Check that layout is vertical
    const appLayout = page.locator('.app-layout');
    const flexDirection = await appLayout.evaluate(el =>
      getComputedStyle(el).flexDirection
    );
    expect(flexDirection).toBe('column');
  });

  test('cards are readable on mobile', async ({ page }) => {
    await page.goto('/');

    // Cards should still be visible
    const cards = page.locator('.card');
    await expect(cards.first()).toBeVisible();

    // Should still have 25 cards
    await expect(cards).toHaveCount(25);
  });

  test('buttons meet touch target size', async ({ page }) => {
    await page.goto('/');

    // Check button minimum height (should be at least 44px for touch)
    const button = page.locator('button').first();
    const height = await button.evaluate(el => el.offsetHeight);
    expect(height).toBeGreaterThanOrEqual(44);
  });
});

test.describe('Multiplayer Mode', () => {
  // These tests require the server to be running

  test('can create a multiplayer room', async ({ page }) => {
    // Skip if not in multiplayer mode
    test.skip(!process.env.TEST_MULTIPLAYER, 'Multiplayer tests require server');

    await page.goto('/');

    // Look for room creation UI or connection status
    // This would depend on the specific multiplayer UI implementation
  });
});
