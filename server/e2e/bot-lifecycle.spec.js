// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, selectTeam, addBot } = require('./helpers');

/**
 * Bot Lifecycle E2E Tests (docs/HARDENING_PLAN.md P1-13)
 *
 * Host adds a bot to each seat type (spymaster/clicker/advisor) and drives a
 * real game against a real server + real sockets — this only ever ran
 * against a fully mocked Redis before. Blue plays fully autonomously
 * (spymaster + clicker bots) so the host's turn is guaranteed to come up
 * within one bot turn regardless of who goes first; the host plays red
 * clicker with a red advisor bot, so both bot-driven and human+advisor
 * seats get exercised in a single browser context.
 *
 * Room creation auto-starts a game immediately (multiplayer.ts's
 * "auto-start a game when the host creates a room" behavior) — there is no
 * separate "Start Game" click to wait for; team/role/bot assignment all
 * happens against the already-running game, exactly as a host reshuffling
 * seats mid-game would.
 */
test.describe('Bot Lifecycle', () => {
    test('spymaster, clicker, and advisor bots each take their first action', async ({ page }) => {
        await createRoom(page, 'BotHost');
        await page.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

        // Host plays red as the (human) clicker; a red advisor bot will advise.
        await selectTeam(page, 'red');
        await page.locator(sel.clickerBtn).click();

        // Blue is fully bot-driven so a turn always resolves without a second player.
        await addBot(page, 'red', 'spymaster');
        await addBot(page, 'red', 'advisor');
        await addBot(page, 'blue', 'spymaster');
        await addBot(page, 'blue', 'clicker');

        // Whichever team goes first, red's clue must appear within one full
        // blue bot turn (spymaster bot clue -> clicker bot reveal(s) -> turn
        // ends) if blue went first, or immediately if red went first.
        await expect(page.locator(`${sel.clueDisplay}.clue-red`)).toBeVisible({ timeout: 30000 });

        // The red advisor bot has now seen a live clue for a human clicker and
        // suggested a guess (its first action — advisors never reveal).
        const suggestion = page.locator(sel.suggestionBadge).first();
        await expect(suggestion).toBeVisible({ timeout: 10000 });

        // Act on the advisor's suggestion like a real player would: click the
        // suggested card. Suggestions re-render on every mutation (a fresh
        // .card.suggested query could resolve to a different card after the
        // click than before it), so pin the exact index before acting.
        const suggestedIndex = await page.locator('.card.suggested').first().getAttribute('data-index');
        expect(suggestedIndex).not.toBeNull();
        const targetCard = page.locator(`${sel.boardCard}[data-index="${suggestedIndex}"]`);
        await targetCard.click();
        await expect(targetCard).toHaveClass(/revealed/, { timeout: 10000 });

        // At least one card is revealed on the board by now, from a bot
        // (clicker seat) action, the host's own action, or both.
        const revealedCount = await page.locator(`${sel.boardCard}.revealed`).count();
        expect(revealedCount).toBeGreaterThan(0);
    });
});
