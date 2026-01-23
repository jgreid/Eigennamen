import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E Test Configuration for Codenames Online
 * @see https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: './tests/e2e',

  /* Run tests in files in parallel */
  fullyParallel: true,

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env.CI,

  /* Retry on CI only */
  retries: process.env.CI ? 2 : 0,

  /* Limit parallel workers on CI */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter configuration */
  reporter: [
    ['html', { open: 'never' }],
    ['list']
  ],

  /* Shared settings for all projects */
  use: {
    /* Base URL for the frontend */
    baseURL: 'http://localhost:3000',

    /* Collect trace when retrying failed tests */
    trace: 'on-first-retry',

    /* Screenshot on failure */
    screenshot: 'only-on-failure',

    /* Video recording on failure */
    video: 'on-first-retry',
  },

  /* Test timeout */
  timeout: 30000,

  /* Expect timeout for assertions */
  expect: {
    timeout: 5000,
  },

  /* Configure projects for browsers */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    /* Mobile viewport for responsive testing */
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],

  /* Run local dev server before starting tests */
  webServer: {
    command: 'cd server && npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
