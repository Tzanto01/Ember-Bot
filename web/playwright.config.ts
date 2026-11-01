import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env['E2E_BASE_URL'];

/**
 * Journeys run against `tests/Ember.Api.TestHost` on port 5081 (start it first:
 * `dotnet run --project tests/Ember.Api.TestHost -- --urls http://localhost:5081`).
 * Same origin: build the app, start the host with `--webroot <abs path>/web/dist/ember-web/browser`
 * `--Ember:RateLimits:AuthPerIpPerMinute=600` (the full suite exceeds the default 30 auth requests per
 * minute from one IP) and set `E2E_BASE_URL=http://localhost:5081`. Otherwise the Angular dev server on port 4200 proxies
 * `/api`, `/health` and `/test` to the host (set `Ember__WebOrigin=http://localhost:4200` on the host);
 * `E2E_WEB_COMMAND` starts it with a different runtime, and an already running one is reused.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: baseURL ?? 'http://localhost:4200',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: baseURL
    ? undefined
    : {
        command: process.env['E2E_WEB_COMMAND'] ?? 'npx ng serve --port 4200',
        url: 'http://localhost:4200',
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
