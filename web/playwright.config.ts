import { defineConfig, devices } from '@playwright/test';

/**
 * Journeys run against `tests/Ember.Api.TestHost` on port 5081 (start it first:
 * `dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:5081`), through the
 * Angular dev server on port 4200, which proxies `/api`, `/health` and `/test` to it.
 * Set `E2E_WEB_COMMAND` to start the dev server with a different runtime; an already running one is reused.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env['E2E_BASE_URL'] ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: process.env['E2E_WEB_COMMAND'] ?? 'npx ng serve --port 4200',
    url: 'http://localhost:4200',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
