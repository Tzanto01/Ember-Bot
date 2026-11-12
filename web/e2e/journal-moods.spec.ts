import { expect, test } from '@playwright/test';
import { createHabit, createWebUser } from './support/accounts';

test('a day note keeps its built-in and own mood, an archived mood leaves the picker, and the year view shows the day', async ({ page }) => {
  await createWebUser(page);
  await createHabit(page, 'Walk');

  const words = page.getByLabel('A few words');
  const save = page.getByRole('button', { name: 'Save', exact: true });
  await expect(page.getByRole('heading', { name: 'How was today?' })).toBeVisible();
  await page.getByRole('radio', { name: 'Good' }).click();
  await words.fill('Slept badly, still went for a walk.');
  await save.click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Good' })).toBeChecked();
  await expect(words).toHaveValue('Slept badly, still went for a walk.');

  await page.goto('/settings/habits');
  const addMood = page.getByRole('form', { name: 'Add a mood' });
  await addMood.getByLabel('Name', { exact: true }).fill('Cozy');
  await addMood.getByLabel('Emoji').fill('🧸');
  await addMood.getByRole('button', { name: 'Add mood' }).click();
  await expect(page.getByRole('button', { name: 'Archive Cozy' })).toBeVisible();

  await page.goto('/today');
  await page.getByRole('radio', { name: /Cozy/ }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Mood saved' })).toBeVisible();

  await page.goto('/settings/habits');
  await page.getByRole('button', { name: 'Archive Cozy' }).click();
  await expect(page.getByRole('button', { name: 'Unarchive Cozy' })).toBeVisible();

  await page.goto('/today');
  const cozy = page.getByRole('radio', { name: /Cozy/ });
  await expect(cozy).toBeChecked();
  await expect(page.getByText('(archived)')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: /Cozy/ })).toBeChecked();

  await page.getByRole('radio', { name: 'Great' }).click();
  await expect(page.getByRole('radio', { name: /Cozy/ })).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Mood saved' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Great' })).toBeChecked();
  await expect(page.getByRole('radio', { name: /Cozy/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'Check in Walk for today' }).click();
  await expect(page.getByRole('button', { name: 'Check in Walk for today' })).toHaveAttribute('aria-pressed', 'true');

  await page.goto('/year');
  await expect(page.getByText(/You showed up 1 of the last \d+ days?\./)).toBeVisible();
  await expect(page.getByText(/missed/i)).toHaveCount(0);
});

test('the leaderboard is gone from Settings', async ({ page }) => {
  await createWebUser(page);
  for (const group of ['account', 'reminders', 'habits', 'appearance', 'privacy']) {
    await page.goto(`/settings/${group}`);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByText(/leaderboard/i)).toHaveCount(0);
    await expect(page.getByRole('switch', { name: /leaderboard/i })).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: /leaderboard/i })).toHaveCount(0);
  }
  await page.goto('/settings/habits');
  await expect(page.getByRole('heading', { name: 'Moods' })).toBeVisible();
});

test('a day note written offline is queued, syncs when back online and persists', async ({ page, context }) => {
  await createWebUser(page);
  await createHabit(page, 'Read');

  const words = page.getByLabel('A few words');
  await expect(page.getByRole('radio', { name: 'Okay' })).toBeVisible();
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'Okay' }).click();
  await words.fill('Written on the train.');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(/Saved on this device, it'll sync/)).toBeVisible();

  await context.setOffline(false);
  await expect
    .poll(async () => {
      const me: { localToday: string } = await (await page.request.get('/api/me')).json();
      const response = await page.request.get(`/api/day-notes?from=${me.localToday}&to=${me.localToday}`);
      const notes: { text: string | null }[] = await response.json();
      return notes[0]?.text ?? null;
    })
    .toBe('Written on the train.');

  await page.reload();
  await expect(page.getByRole('radio', { name: 'Okay' })).toBeChecked();
  await expect(page.getByLabel('A few words')).toHaveValue('Written on the train.');
});
