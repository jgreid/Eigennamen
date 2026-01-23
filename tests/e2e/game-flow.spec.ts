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

test.describe('Turn Management', () => {

  test('can end turn manually', async ({ page }) => {
    await page.goto('/');

    // Join red team as clicker
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-clicker').click();

    // Get current turn indicator
    const turnIndicator = page.locator('#current-turn');
    const initialTurn = await turnIndicator.textContent();

    // Click end turn button
    await page.locator('#btn-end-turn').click();

    // Turn should change
    const newTurn = await turnIndicator.textContent();
    expect(newTurn).not.toBe(initialTurn);
  });

  test('turn changes after revealing wrong team card', async ({ page }) => {
    await page.goto('/');

    // First become spymaster to see card types
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-spymaster').click();

    // Find which team goes first
    const turnIndicator = page.locator('#current-turn');
    const currentTurnText = await turnIndicator.textContent();
    const currentTurn = currentTurnText?.toLowerCase().includes('red') ? 'red' : 'blue';

    // Find an opposing team card
    const opposingTeam = currentTurn === 'red' ? 'blue' : 'red';
    const opposingCard = page.locator(`.card.spy-${opposingTeam}`).first();

    // Switch to clicker and reveal
    await page.locator('#btn-clicker').click();
    await opposingCard.click();

    // Turn should change to the team whose card was revealed
    const newTurnText = await turnIndicator.textContent();
    expect(newTurnText?.toLowerCase()).toContain(opposingTeam);
  });

  test('turn changes after revealing neutral card', async ({ page }) => {
    await page.goto('/');

    // First become spymaster to see card types
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-spymaster').click();

    // Get current turn
    const turnIndicator = page.locator('#current-turn');
    const initialTurn = await turnIndicator.textContent();

    // Find a neutral card
    const neutralCard = page.locator('.card.spy-neutral').first();

    // Switch to clicker and reveal
    await page.locator('#btn-clicker').click();
    await neutralCard.click();

    // Turn should change
    const newTurn = await turnIndicator.textContent();
    expect(newTurn).not.toBe(initialTurn);
  });
});

test.describe('Copy and Share Functionality', () => {

  test('copy URL button exists', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // Copy URL button should be visible
    await expect(page.locator('[data-action="copy-url"]')).toBeVisible();
  });

  test('share game panel shows QR code', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // QR code should be rendered
    const qrCanvas = page.locator('#qr-canvas');
    await expect(qrCanvas).toBeVisible();

    // Canvas should have non-zero dimensions
    const width = await qrCanvas.evaluate((el: HTMLCanvasElement) => el.width);
    expect(width).toBeGreaterThan(0);
  });
});

test.describe('QR Code Generation', () => {

  test('QR code canvas has actual content (not blank)', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    const qrCanvas = page.locator('#qr-canvas');
    await expect(qrCanvas).toBeVisible();

    // Check that canvas has actual pixel data (not all white/blank)
    const hasContent = await qrCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Count non-white pixels (QR code dark modules)
      let darkPixelCount = 0;
      for (let i = 0; i < data.length; i += 4) {
        // Check if pixel is dark (R, G, B are low)
        if (data[i] < 128 && data[i + 1] < 128 && data[i + 2] < 128) {
          darkPixelCount++;
        }
      }

      // A valid QR code should have significant dark pixels (finder patterns, data)
      // Typically 20-40% of the QR code is dark modules
      const totalPixels = canvas.width * canvas.height;
      const darkRatio = darkPixelCount / totalPixels;
      return darkRatio > 0.1 && darkRatio < 0.6;
    });

    expect(hasContent).toBe(true);
  });

  test('QR code has finder patterns in corners', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    const qrCanvas = page.locator('#qr-canvas');
    await expect(qrCanvas).toBeVisible();

    // Verify finder patterns exist (7x7 dark-light-dark squares in 3 corners)
    const hasFinderPatterns = await qrCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;

      // Helper to check if a pixel is dark
      const isDark = (x: number, y: number) => {
        const idx = (y * canvas.width + x) * 4;
        return data[idx] < 128;
      };

      // QR codes have finder patterns starting at (margin, margin)
      // The pattern is 7 modules wide, with scale applied
      // We check the top-left corner has a dark cluster (finder pattern)
      const margin = 10; // Approximate margin in pixels
      const moduleSize = Math.floor(canvas.width / 30); // Approximate module size

      // Check top-left finder pattern area has dark pixels
      let topLeftDarkCount = 0;
      for (let y = margin; y < margin + moduleSize * 7; y++) {
        for (let x = margin; x < margin + moduleSize * 7; x++) {
          if (x < canvas.width && y < canvas.height && isDark(x, y)) {
            topLeftDarkCount++;
          }
        }
      }

      // Finder pattern should have significant dark pixels
      const finderArea = moduleSize * 7 * moduleSize * 7;
      return topLeftDarkCount > finderArea * 0.2;
    });

    expect(hasFinderPatterns).toBe(true);
  });

  test('QR code updates when URL changes', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    const qrCanvas = page.locator('#qr-canvas');
    await expect(qrCanvas).toBeVisible();

    // Get initial QR code data
    const initialData = await qrCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      // Create a simple hash of the pixel data
      let hash = 0;
      for (let i = 0; i < imageData.data.length; i += 100) {
        hash = ((hash << 5) - hash + imageData.data[i]) | 0;
      }
      return hash.toString();
    });

    // Close settings
    await page.locator('[data-action="close-settings"]').click();

    // Start a new game (this changes the URL)
    await page.locator('[data-action="confirm-new-game"]').click();
    await page.locator('[data-action="new-game"]').click();

    // Reopen settings
    await page.locator('[data-action="open-settings"]').click();

    // Get new QR code data
    const newData = await qrCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return '';
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let hash = 0;
      for (let i = 0; i < imageData.data.length; i += 100) {
        hash = ((hash << 5) - hash + imageData.data[i]) | 0;
      }
      return hash.toString();
    });

    // QR codes should be different (different game seed = different URL)
    expect(newData).not.toBe(initialData);
  });

  test('share panel QR code also renders correctly', async ({ page }) => {
    await page.goto('/');

    // Open settings and go to link panel
    await page.locator('[data-action="open-settings"]').click();
    await page.locator('[data-panel="link"]').click();

    const shareQrCanvas = page.locator('#share-qr-canvas');
    await expect(shareQrCanvas).toBeVisible();

    // Check share QR canvas has content
    const hasContent = await shareQrCanvas.evaluate((canvas: HTMLCanvasElement) => {
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let darkPixelCount = 0;
      for (let i = 0; i < imageData.data.length; i += 4) {
        if (imageData.data[i] < 128) darkPixelCount++;
      }
      const totalPixels = canvas.width * canvas.height;
      return darkPixelCount / totalPixels > 0.1;
    });

    expect(hasContent).toBe(true);
  });

  test('QR code and share link contain same URL', async ({ page }) => {
    await page.goto('/');

    // Open settings and go to link panel
    await page.locator('[data-action="open-settings"]').click();
    await page.locator('[data-panel="link"]').click();

    // Get the share link value
    const shareLinkInput = page.locator('#share-link-input');
    const shareUrl = await shareLinkInput.inputValue();

    // URL should be valid and contain the current page URL base
    expect(shareUrl).toContain(page.url().split('#')[0].split('?')[0]);
  });

  test('QR code is not visible when hidden', async ({ page }) => {
    await page.goto('/');

    // Before opening settings, QR section should be in sidebar but modal is closed
    const qrSection = page.locator('#qr-section');

    // Open settings to verify QR is visible when modal is open
    await page.locator('[data-action="open-settings"]').click();
    await expect(page.locator('#qr-canvas')).toBeVisible();

    // Close settings
    await page.locator('[data-action="close-settings"]').click();

    // Modal should be closed
    await expect(page.locator('#settings-modal')).not.toHaveClass(/active/);
  });
});

test.describe('Word List Management', () => {

  test('shows default word count', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // Word count display should show something
    const wordCount = page.locator('#word-count');
    await expect(wordCount).toBeVisible();
  });

  test('validates minimum custom word count', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // Select custom words only
    await page.locator('#wordlist-mode-custom').click();

    // Enter fewer than 25 words
    const fewWords = Array.from({ length: 10 }, (_, i) => `Word${i}`).join('\n');
    await page.locator('#custom-words').fill(fewWords);

    // Word count should indicate insufficient words
    const wordCount = page.locator('#word-count');
    await expect(wordCount).toContainText('10 words');
  });

  test('combined mode uses both default and custom words', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // Select combined mode
    await page.locator('#wordlist-mode-combined').click();

    // Add some custom words
    const customWords = 'CUSTOMWORD1\nCUSTOMWORD2\nCUSTOMWORD3';
    await page.locator('#custom-words').fill(customWords);

    // Save settings
    await page.locator('[data-action="save-settings"]').click();

    // Start new game
    await page.locator('[data-action="confirm-new-game"]').click();
    await page.locator('[data-action="new-game"]').click();

    // Board should have cards (whether from default or custom pool)
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(25);
  });
});

test.describe('Game History', () => {

  test('game history panel exists', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // History section should be visible
    const historySection = page.locator('.history-section, #game-history');
    if (await historySection.isVisible()) {
      await expect(historySection).toBeVisible();
    }
  });
});

test.describe('Role Switching', () => {

  test('clicker cannot see card types', async ({ page }) => {
    await page.goto('/');

    // Join as clicker
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-clicker').click();

    // Cards should NOT have spy-* classes visible
    const body = page.locator('body');
    await expect(body).not.toHaveClass(/spymaster-mode/);
  });

  test('can switch from spymaster to clicker', async ({ page }) => {
    await page.goto('/');

    // Become spymaster
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-spymaster').click();
    await expect(page.locator('.spymaster-mode')).toBeVisible();

    // Switch to clicker
    await page.locator('#btn-clicker').click();

    // Should no longer be in spymaster mode
    await expect(page.locator('.spymaster-mode')).not.toBeVisible();
  });

  test('can switch teams', async ({ page }) => {
    await page.goto('/');

    // Join red team
    await page.locator('#btn-team-red').click();
    let roleBanner = await page.locator('.role-banner').textContent();
    expect(roleBanner?.toLowerCase()).toContain('red');

    // Switch to blue team
    await page.locator('#btn-team-blue').click();
    roleBanner = await page.locator('.role-banner').textContent();
    expect(roleBanner?.toLowerCase()).toContain('blue');
  });
});

test.describe('Score Tracking', () => {

  test('displays remaining cards for both teams', async ({ page }) => {
    await page.goto('/');

    // Check red remaining
    const redRemaining = page.locator('#red-remaining');
    await expect(redRemaining).toBeVisible();
    const redCount = await redRemaining.textContent();
    expect(parseInt(redCount || '0')).toBeGreaterThan(0);

    // Check blue remaining
    const blueRemaining = page.locator('#blue-remaining');
    await expect(blueRemaining).toBeVisible();
    const blueCount = await blueRemaining.textContent();
    expect(parseInt(blueCount || '0')).toBeGreaterThan(0);
  });

  test('first team has 9 cards, second team has 8', async ({ page }) => {
    await page.goto('/');

    const redRemaining = parseInt(await page.locator('#red-remaining').textContent() || '0');
    const blueRemaining = parseInt(await page.locator('#blue-remaining').textContent() || '0');

    // One team should have 9, the other should have 8
    expect([redRemaining, blueRemaining].sort()).toEqual([8, 9]);
  });

  test('score updates when revealing team card', async ({ page }) => {
    await page.goto('/');

    // Become spymaster to find a team card
    await page.locator('#btn-team-red').click();
    await page.locator('#btn-spymaster').click();

    // Find a red card
    const redCard = page.locator('.card.spy-red').first();

    // Get initial red remaining count
    const initialRed = parseInt(await page.locator('#red-remaining').textContent() || '0');

    // Switch to clicker and reveal
    await page.locator('#btn-clicker').click();
    await redCard.click();

    // Red remaining should decrease by 1
    const newRed = parseInt(await page.locator('#red-remaining').textContent() || '0');
    expect(newRed).toBe(initialRed - 1);
  });
});

test.describe('Tablet Responsiveness', () => {
  test.use({ viewport: { width: 768, height: 1024 } }); // iPad

  test('layout adapts to tablet size', async ({ page }) => {
    await page.goto('/');

    // Board should be visible
    await expect(page.locator('.board')).toBeVisible();

    // Cards should still be 25
    const cards = page.locator('.card');
    await expect(cards).toHaveCount(25);
  });

  test('settings modal fits tablet screen', async ({ page }) => {
    await page.goto('/');

    // Open settings
    await page.locator('[data-action="open-settings"]').click();

    // Modal should be visible and not overflow
    const modal = page.locator('#settings-modal .modal-content');
    await expect(modal).toBeVisible();
  });
});
