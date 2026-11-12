import { expect, test } from '@playwright/test';
import { createHabit, createWebUser, SECRET } from './support/accounts';

test('deleting the account signs out and the credentials stop working', async ({ page }) => {
  const email = await createWebUser(page);
  await createHabit(page, 'Stretch');

  await page.goto('/settings/privacy');
  await page.getByLabel('Your password', { exact: true }).fill(SECRET);
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).click();

  await expect(page).toHaveURL(/\/login\?reason=deleted$/);
  await expect(page.getByRole('status').filter({ hasText: /deleted/i })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();

  await expect(page.getByRole('alert').filter({ hasText: /match/i })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByText(/session ended/i)).toHaveCount(0);
});
