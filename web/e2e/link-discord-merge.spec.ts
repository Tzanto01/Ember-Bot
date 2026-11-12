import { expect, test } from '@playwright/test';
import {
  createWebUser,
  nextDiscordId,
  SECRET,
  seedBotOnlyUser,
  uniqueDiscordId,
} from './support/accounts';

test('linking a bot-only Discord account merges its habit into the web account', async ({ page }) => {
  const discordId = uniqueDiscordId();
  await seedBotOnlyUser(page.request, discordId);
  await createWebUser(page);

  await page.goto('/settings/account');
  await nextDiscordId(page.request, discordId);
  await page.getByRole('button', { name: 'Link Discord' }).click();
  await page.getByLabel('Your password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Continue to Discord' }).click();

  await expect(page).toHaveURL(/\/link\/merge$/);
  await expect(page.getByRole('heading', { name: 'Bring your Discord habits over' })).toBeVisible();
  const habitNames = page.getByRole('list', { name: 'Habits to move' }).getByRole('listitem');
  await expect(habitNames).toHaveCount(1);
  const habitName = (await habitNames.first().textContent() ?? '').trim();
  expect(habitName).not.toBe('');
  await expect(page.getByText(/Your settings stay as they are/)).toBeVisible();

  await page.getByRole('button', { name: 'Move everything here' }).click();

  await expect(page).toHaveURL(/\/settings/);
  await expect(page.getByRole('status').filter({ hasText: /Discord is linked/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlink Discord' })).toBeVisible();

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: habitName, exact: true })).toBeVisible();
});

test('linking a Discord account nobody has used goes straight to linked', async ({ page }) => {
  await createWebUser(page);

  await page.goto('/settings/account');
  await nextDiscordId(page.request, uniqueDiscordId());
  await page.getByRole('button', { name: 'Link Discord' }).click();
  await page.getByLabel('Your password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Continue to Discord' }).click();

  await expect(page).toHaveURL(/\/settings/);
  await expect(page).not.toHaveURL(/\/link\/merge/);
  await expect(page.getByRole('status').filter({ hasText: /Discord is linked/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Unlink Discord' })).toBeVisible();
});
