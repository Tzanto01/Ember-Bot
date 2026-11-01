import { expect, test } from '@playwright/test';
import { createHabit, createWebUser } from './support/accounts';

test('a check-in made offline syncs once the browser is back online', async ({ page, context }) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  const checkIn = page.getByRole('button', { name: 'Check in Stretch for today' });
  await expect(checkIn).toHaveAttribute('aria-pressed', 'false');

  await context.setOffline(true);
  await checkIn.click();
  await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/saved on this device/)).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByText(/saved on this device/)).toBeHidden();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check in Stretch for today' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
