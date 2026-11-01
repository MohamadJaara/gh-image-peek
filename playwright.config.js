import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/build-extensions.js',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'list',
  use: {
    viewport: { width: 1280, height: 900 },
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'firefox',
      testIgnore: ['**/extension.spec.js', '**/mobile.spec.js'],
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'chromium',
      testIgnore: ['**/extension.spec.js', '**/mobile.spec.js'],
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-extension',
      testMatch: '**/extension.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox-touch',
      testMatch: '**/mobile.spec.js',
      // Desktop Firefox supports touch input, but not isMobile emulation.
      use: { browserName: 'firefox', hasTouch: true, viewport: { width: 390, height: 844 } },
    },
    {
      name: 'chromium-touch',
      testMatch: '**/mobile.spec.js',
      use: { browserName: 'chromium', hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } },
    },
  ],
});
