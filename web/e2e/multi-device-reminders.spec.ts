import { expect, test, type Page } from '@playwright/test';
import { createWebUser } from './support/accounts';

interface Targets {
  discord: boolean;
  pushSubscriptionIds: number[];
}

const FIREFOX_LINUX = 'Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0';
const EDGE_WINDOWS =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 Edg/130.0';

function randomBase64Url(bytes: number): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(bytes))).toString('base64url');
}

async function xsrfHeaders(page: Page, userAgent: string): Promise<Record<string, string>> {
  await page.request.get('/api/auth/antiforgery');
  const cookie = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN');
  expect(cookie).toBeDefined();
  return { 'X-XSRF-TOKEN': decodeURIComponent(cookie!.value), 'User-Agent': userAgent };
}

async function subscribeBrowser(page: Page, userAgent: string): Promise<void> {
  const response = await page.request.post('/api/me/push-subscriptions', {
    headers: await xsrfHeaders(page, userAgent),
    data: {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomBase64Url(24)}`,
      keys: { p256dh: randomBase64Url(65), auth: randomBase64Url(16) },
    },
  });
  expect(response.status()).toBe(204);
}

async function targets(page: Page, habitId: string): Promise<Targets> {
  const response = await page.request.get(`/test/reminders/targets?habitId=${habitId}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function destinationIds(page: Page): Promise<Record<string, number>> {
  const response = await page.request.get('/api/me/reminder-destinations');
  expect(response.ok()).toBeTruthy();
  const list: { id: string; label: string }[] = await response.json();
  return Object.fromEntries(
    list.filter((d) => d.id.startsWith('browser-')).map((d) => [d.label, Number(d.id.slice('browser-'.length))]),
  );
}

test('a browser switched off in Settings is disabled on the habit, and exclusions decide where the reminder goes', async ({
  page,
}) => {
  const habit = 'Evening stretch';
  await createWebUser(page);

  await page.goto('/habits/new');
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await page.getByLabel('Name', { exact: true }).fill(habit);
  await page.getByLabel('Reminder time').fill('20:00');
  await page.getByRole('button', { name: 'Create habit' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: habit, exact: true })).toBeVisible();

  await subscribeBrowser(page, FIREFOX_LINUX);
  await subscribeBrowser(page, EDGE_WINDOWS);
  const ids = await destinationIds(page);
  const browserA = ids['Firefox on Linux'];
  const browserB = ids['Edge on Windows'];
  expect(browserA).toBeDefined();
  expect(browserB).toBeDefined();

  await page.getByRole('link', { name: `Edit ${habit}` }).click();
  await expect(page).toHaveURL(/\/habits\/(\d+)/);
  const habitId = /\/habits\/(\d+)/.exec(page.url())![1]!;
  const edit = page.url();

  await expect.poll(async () => (await targets(page, habitId)).pushSubscriptionIds.sort()).toEqual(
    [browserA, browserB].sort(),
  );

  await page.goto('/settings/reminders');
  const settings = page.getByRole('region', { name: 'Where Ember reminds you' });
  const switchA = settings.getByRole('switch', { name: 'Firefox on Linux' });
  await expect(switchA).toBeChecked();
  await expect(settings.getByRole('switch', { name: 'Edge on Windows' })).toBeChecked();
  await switchA.click();
  await expect(switchA).not.toBeChecked();

  await page.goto(edit);
  const remindOn = page.getByRole('region', { name: 'Remind me on' });
  const checkboxA = remindOn.getByRole('checkbox', { name: 'Firefox on Linux' });
  const checkboxB = remindOn.getByRole('checkbox', { name: 'Edge on Windows' });
  await expect(checkboxA).toBeDisabled();
  await expect(checkboxA).not.toBeChecked();
  await expect(checkboxA).toHaveAccessibleDescription('Turned off in Settings.');
  await expect(checkboxB).toBeChecked();

  await checkboxB.click();
  await expect(remindOn.getByText('Saved.')).toBeVisible();
  await expect(checkboxB).not.toBeChecked();

  await expect.poll(() => targets(page, habitId)).toEqual({ discord: false, pushSubscriptionIds: [] });

  await page.goto('/settings/reminders');
  await settings.getByRole('switch', { name: 'Firefox on Linux' }).click();
  await expect(settings.getByRole('switch', { name: 'Firefox on Linux' })).toBeChecked();

  await expect.poll(() => targets(page, habitId)).toEqual({ discord: false, pushSubscriptionIds: [browserA] });

  await page.goto(edit);
  await expect(remindOn.getByRole('checkbox', { name: 'Firefox on Linux' })).toBeChecked();
  await expect(remindOn.getByRole('checkbox', { name: 'Firefox on Linux' })).toBeEnabled();
  await expect(remindOn.getByRole('checkbox', { name: 'Edge on Windows' })).not.toBeChecked();
});
