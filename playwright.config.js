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
      testIgnore: '**/extension.spec.js',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'chromium',
      testIgnore: '**/extension.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium-extension',
      testMatch: '**/extension.spec.js',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
