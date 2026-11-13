import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHabit, createWebUser, localToday } from './support/accounts';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'desktop', width: 1280, height: 800 },
];
const schemes = ['light', 'dark'] as const;
const settingsGroups = ['account', 'reminders', 'habits', 'appearance', 'privacy', 'feedback'];

async function scan(page: Page, where: string, found: string[]): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  for (const v of violations) {
    found.push(`${where} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  }
}

async function visit(
  page: Page,
  path: string,
  ready: RegExp | string,
  found: string[],
): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
  await scan(page, path, found);
}

for (const { name, width, height } of viewports) {
  for (const scheme of schemes) {
    test.describe(`${name} ${scheme}`, () => {
      test.use({ viewport: { width, height }, colorScheme: scheme });

      test.beforeEach(async ({ page }) => {
        await page.addInitScript(
          (value) => localStorage.setItem('ember.colorScheme', value),
          scheme,
        );
      });

      test('signed-out pages have no WCAG A/AA violations', async ({ page }) => {
        const found: string[] = [];
        await visit(page, '/', /./, found);
        await visit(page, '/login', 'Welcome back', found);
        await visit(page, '/signup', 'Create your account', found);
        await visit(page, '/forgot-password', /./, found);
        await visit(page, '/feedback', 'Send feedback', found);
        await visit(page, '/download', /./, found);
        await visit(page, '/legal/privacy', /./, found);
        await visit(page, '/no-such-page', 'This page wandered off', found);
        expect(found).toEqual([]);
      });

      test('no-account mode Today has no WCAG A/AA violations', async ({ page }) => {
        const found: string[] = [];
        await page.goto('/local');
        await page.getByRole('button', { name: 'Start without an account' }).click();
        await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
        await scan(page, '/today (no account)', found);
        expect(found).toEqual([]);
      });

      test('signed-in pages have no WCAG A/AA violations', async ({ page }) => {
        test.setTimeout(180_000);
        const found: string[] = [];
        await createWebUser(page);
        await createHabit(page, 'Stretch');
        await createHabit(page, 'Journal');

        await page.goto('/routines/new');
        await page.getByLabel('Name', { exact: true }).fill('Morning');
        await page.getByRole('button', { name: 'Add Stretch' }).click();
        await page.getByRole('button', { name: 'Create routine' }).click();
        await expect(page).toHaveURL(/\/routines$/);

        await visit(page, '/today', 'Today', found);
        const checkIn = page.getByRole('button', { name: 'Check in Journal for today' });
        await checkIn.click();
        await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
        await scan(page, '/today (checked)', found);
        await checkIn.click();
        await expect(checkIn).toHaveAttribute('aria-pressed', 'false');
        await scan(page, '/today (unchecked)', found);

        await visit(page, '/habits/new', /./, found);
        await page.getByRole('button', { name: 'Start from scratch' }).click();
        await expect(page.getByLabel('Name', { exact: true })).toBeVisible();
        await scan(page, '/habits/new (form)', found);
        await page.goto('/today');
        await page.getByRole('link', { name: 'Edit Stretch' }).first().click();
        await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Stretch');
        await scan(page, 'habit edit', found);

        await visit(page, '/routines', 'Routines', found);
        await page.getByRole('link', { name: 'Edit Morning routine' }).click();
        await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Morning');
        await scan(page, 'routine edit', found);

        await visit(page, '/history', 'History', found);
        const today = await localToday(page);
        await page.locator(`#day-${today}`).click();
        await expect(page.locator('#day-panel')).toHaveCSS('opacity', '1');
        await scan(page, '/history (day panel)', found);
        await visit(page, '/history/year', /./, found);

        await visit(page, '/feedback', 'Send feedback', found);
        for (const group of settingsGroups) await visit(page, `/settings/${group}`, /./, found);
        await visit(page, '/whats-new', /./, found);
        expect(found).toEqual([]);
      });
    });
  }
}

test('History month and Year cells are named with date and state, and the year grid moves by arrow keys', async ({
  page,
}) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  const today = await localToday(page);
  const date = new Date(`${today}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  await page.goto('/history');
  await expect(page.locator(`#day-${today}`)).toHaveAccessibleName(new RegExp(`^${date}, today, `));
  await expect(page.getByRole('table')).toHaveAccessibleName(/\d{4}$/);

  await page.goto('/history/year');
  const cell = page.locator(`[data-date="${today}"]`);
  await expect(cell).toHaveAccessibleName(new RegExp(`^${date}, \\d{4}: `));
  await cell.focus();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.locator(
      `[data-date="${new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)}"]`,
    ),
  ).toBeFocused();
});
