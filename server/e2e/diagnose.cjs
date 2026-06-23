// @ts-check
/**
 * One-shot E2E boot diagnostic.
 *
 * Loads the app in a real chromium instance and reports what the headless
 * browser actually sees: page errors, console output, failed requests, and the
 * DOM state before/after clicking the setup-screen "Local" button.
 *
 * This is a temporary investigative tool — it does not assert anything, it just
 * surfaces the browser-side failure that the full Playwright suite hides behind
 * generic "element stayed hidden" timeouts. Run with:
 *   node e2e/diagnose.cjs
 */
const { chromium } = require('@playwright/test');

const BASE = process.env.BASE_URL || 'http://localhost:3000';

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    /** @type {string[]} */
    const logs = [];
    page.on('console', (msg) => logs.push(`[console.${msg.type()}] ${msg.text()}`));
    page.on('pageerror', (err) => logs.push(`[pageerror] ${err.message}\n${err.stack || ''}`));
    page.on('requestfailed', (req) =>
        logs.push(`[requestfailed] ${req.url()} :: ${req.failure() && req.failure().errorText}`)
    );
    page.on('response', (res) => {
        if (res.status() >= 400) logs.push(`[response ${res.status()}] ${res.url()}`);
    });

    console.log(`\n=== DIAGNOSE: navigating to ${BASE}/ ===`);
    const resp = await page.goto(`${BASE}/`, { waitUntil: 'load', timeout: 20000 }).catch((e) => {
        console.log('goto error:', e.message);
        return null;
    });
    console.log('initial status:', resp && resp.status());

    // Give module scripts + async init() a chance to run.
    await page.waitForTimeout(3000);

    const state = await page
        .evaluate(() => ({
            appEventListenersReady: window.__appEventListenersReady,
            setupScreenHidden:
                document.getElementById('setup-screen') && document.getElementById('setup-screen').hidden,
            appLayoutHidden: document.getElementById('app-layout') && document.getElementById('app-layout').hidden,
            boardHidden: document.getElementById('board') && document.getElementById('board').hidden,
            boardChildCount: document.getElementById('board') ? document.getElementById('board').children.length : -1,
            hasLocalBtn: !!document.querySelector('[data-testid="setup-local-btn"]'),
            boardLoadingPresent: !!document.getElementById('board-loading'),
            // Any visible error modal text (showErrorModal)
            errorModalText: (() => {
                const m = document.querySelector('.modal:not([hidden]), [role="dialog"]:not([hidden])');
                return m ? (m.textContent || '').trim().slice(0, 300) : null;
            })(),
        }))
        .catch((e) => ({ evalError: e.message }));
    console.log('\n--- DOM state after load ---');
    console.log(JSON.stringify(state, null, 2));

    // Attempt the interaction the suite relies on.
    const localBtn = page.locator('[data-testid="setup-local-btn"]');
    if (await localBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('\n--- clicking [data-testid="setup-local-btn"] ---');
        await localBtn.click({ timeout: 3000 }).catch((e) => console.log('click error:', e.message));
        await page.waitForTimeout(2000);
        const after = await page
            .evaluate(() => ({
                setupScreenHidden:
                    document.getElementById('setup-screen') && document.getElementById('setup-screen').hidden,
                boardHidden: document.getElementById('board') && document.getElementById('board').hidden,
                boardChildCount: document.getElementById('board')
                    ? document.getElementById('board').children.length
                    : -1,
            }))
            .catch((e) => ({ evalError: e.message }));
        console.log('DOM state after Local click:', JSON.stringify(after, null, 2));
    } else {
        console.log('\n[!] setup-local-btn not visible — cannot attempt game start');
    }

    console.log('\n=== BROWSER EVENTS (console / pageerror / failed requests) ===');
    console.log(logs.length ? logs.join('\n') : '(no console/pageerror/requestfailed events captured)');
    console.log('=== END DIAGNOSE ===\n');

    await browser.close();
})().catch((e) => {
    console.error('DIAGNOSE FATAL:', e);
    process.exit(1);
});
