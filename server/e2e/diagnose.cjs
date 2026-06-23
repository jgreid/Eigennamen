// @ts-check
/**
 * E2E flakiness reproduction probe.
 *
 * The full suite shows ~62/170 specs failing with generic "game-board stayed
 * hidden" timeouts, yet a single isolated load+Local-click renders a 25-card
 * board with zero browser errors. That points to environmental degradation
 * under the serial suite rather than an app bug.
 *
 * This probe replays the exact goToGame flow (fresh context -> goto '/' ->
 * click Local -> wait for board) many times against the shared server and
 * reports the first failure and any captured pageerrors, so one fast CI run
 * shows whether (and when) the flow degrades. Temporary investigative tool.
 *
 *   node e2e/diagnose.cjs
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const ITERATIONS = Number(process.env.DIAG_ITERATIONS || 50);

async function runOnce(browser, i) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    /** @type {string[]} */
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    page.on('requestfailed', (r) => errs.push(`reqfail ${r.url()} ${r.failure() && r.failure().errorText}`));
    page.on('response', (r) => {
        if (r.status() >= 400) errs.push(`http ${r.status()} ${r.url()}`);
    });
    const started = Date.now();
    try {
        await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 15000 });
        const localBtn = page.locator('[data-testid="setup-local-btn"]');
        if (await localBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await localBtn.click({ timeout: 3000 });
        }
        await page.locator('[data-testid="game-board"]').waitFor({ state: 'visible', timeout: 5000 });
        const cards = await page.locator('[data-testid="game-board"]').evaluate((el) => el.children.length);
        const ms = Date.now() - started;
        return { ok: true, i, ms, cards, errs };
    } catch (e) {
        const ms = Date.now() - started;
        return { ok: false, i, ms, msg: (e instanceof Error ? e.message : String(e)).split('\n')[0], errs };
    } finally {
        await ctx.close();
    }
}

(async () => {
    const browser = await chromium.launch();
    console.log(`\n=== DIAGNOSE LOOP: ${ITERATIONS} iterations of goToGame against ${BASE} ===`);
    let pass = 0;
    let firstFail = -1;
    let slowest = 0;
    for (let i = 0; i < ITERATIONS; i++) {
        const r = await runOnce(browser, i);
        slowest = Math.max(slowest, r.ms);
        if (r.ok) {
            pass++;
            if (r.errs.length || r.ms > 3000) {
                console.log(
                    `#${i} OK ${r.ms}ms cards=${r.cards}${r.errs.length ? ' errs=' + JSON.stringify(r.errs) : ''}`
                );
            }
        } else {
            if (firstFail < 0) firstFail = i;
            console.log(`#${i} FAIL ${r.ms}ms :: ${r.msg} :: errs=${JSON.stringify(r.errs)}`);
        }
    }
    console.log(`\n=== SUMMARY: ${pass}/${ITERATIONS} passed, firstFail=${firstFail}, slowest=${slowest}ms ===\n`);
    await browser.close();
})().catch((e) => {
    console.error('DIAGNOSE FATAL:', e);
    process.exit(1);
});
