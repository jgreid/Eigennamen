// @ts-check
const { test, expect } = require('@playwright/test');
const { sel, createRoom, addBot } = require('./helpers');

/**
 * Match-Mode Round Transition E2E Test (docs/HARDENING_PLAN.md P1-13)
 *
 * A match-mode game plays through a full round to game:roundEnded, then
 * game:nextRound to a second round, then all the way to game:matchOver —
 * against a real server + real sockets (this only ever ran against a fully
 * mocked Redis before). Room creation auto-starts round 1 immediately
 * (multiplayer.ts); all 4 seats are bots so rounds play out with no human
 * clue/reveal input, and the host only needs to click "New Game" between
 * rounds — the one action that is not bot-automatable (see game.ts's
 * newGame(), which requires a UI click).
 *
 * The "New Game" button (#btn-new-game) is *always* present/visible in the
 * action row, not conditionally shown on round-over — clicking it while a
 * round is still active opens a "this will end the current game, are you
 * sure?" confirmation instead of advancing (game.ts's confirmNewGame()).
 * The reliable round-over signal is the turn indicator gaining the
 * `game-over` class (the same signal game-modes.spec.js's existing assassin
 * tests already rely on).
 */
test.describe('Match Mode Round Transitions', () => {
    test('plays through multiple rounds to game:matchOver', async ({ page }) => {
        test.setTimeout(180000);
        await createRoom(page, 'MatchHost');
        await page.locator(sel.boardCard).first().waitFor({ state: 'visible', timeout: 10000 });

        // Fully autonomous match: every seat is a bot, host stays spectator.
        await addBot(page, 'red', 'spymaster');
        await addBot(page, 'red', 'clicker');
        await addBot(page, 'blue', 'spymaster');
        await addBot(page, 'blue', 'clicker');

        const turnIndicator = page.locator(sel.turnIndicator);
        const newGameBtn = page.locator(sel.newGameBtn);
        const matchOverToast = page.getByText('Match over!', { exact: false });

        const MAX_ROUNDS = 10;
        let matchOver = false;
        let roundsAdvanced = 0;

        for (let i = 0; i < MAX_ROUNDS && !matchOver; i++) {
            // Bots play out the current round entirely on their own.
            await expect(turnIndicator).toHaveClass(/game-over/, { timeout: 90000 });

            // A round-over might BE the match ending — give the matchOver
            // event (fired alongside/after roundEnded) a brief window to land
            // before assuming this is just an ordinary round transition.
            matchOver = await matchOverToast.isVisible().catch(() => false);
            if (!matchOver) {
                matchOver = await matchOverToast
                    .waitFor({ state: 'visible', timeout: 3000 })
                    .then(() => true)
                    .catch(() => false);
            }
            if (matchOver) break;

            await newGameBtn.click();
            // Confirms game:nextRound actually landed (turn indicator leaves
            // its game-over state once the new round's board is live).
            await expect(turnIndicator).not.toHaveClass(/game-over/, { timeout: 15000 });
            roundsAdvanced++;
        }

        if (!matchOver) {
            matchOver = await matchOverToast
                .waitFor({ state: 'visible', timeout: 15000 })
                .then(() => true)
                .catch(() => false);
        }

        expect(roundsAdvanced).toBeGreaterThanOrEqual(1);
        expect(matchOver).toBe(true);
    });
});
