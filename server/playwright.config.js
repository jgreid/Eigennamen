// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * Playwright Configuration for Eigennamen E2E Tests
 *
 * Run with:
 *   npm run test:e2e           - Run all E2E tests
 *   npm run test:e2e:ui        - Run with Playwright UI
 *   npm run test:e2e:headed    - Run in headed mode
 *
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
    testDir: './e2e',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    // 'github' adds inline PR annotations; 'list' streams per-test results to the
    // job log so progress/failures are visible even if the job is cut short.
    reporter: process.env.CI ? [['github'], ['list']] : 'html',

    // Global timeout settings
    timeout: 30000,
    expect: {
        timeout: 5000,
    },

    use: {
        // Base URL for all tests
        baseURL: 'http://localhost:3000',

        // Collect trace on first retry
        trace: 'on-first-retry',

        // Take screenshots on failure
        screenshot: 'only-on-failure',

        // Video recording
        video: 'on-first-retry',
    },

    // Configure projects for major browsers
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },

        // Mobile viewports
        {
            name: 'Mobile Chrome',
            use: { ...devices['Pixel 5'] },
        },
        {
            name: 'Mobile Safari',
            use: { ...devices['iPhone 12'] },
        },
    ],

    // Run a dev server before tests when one isn't already running.
    // In CI the workflow starts the built server (node dist/index.js) and waits
    // for health before invoking Playwright, so reuse it rather than trying to
    // bind a second server to the same port (which throws when reuse is off).
    webServer: {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: true,
        timeout: 60000,
    },

    // Output folder for test artifacts
    outputDir: 'test-results/',
});
