import { expect, test } from '@playwright/test';
import { agreeToConsent, confirmEmail, createHabit, logIn, signUp, uniqueEmail } from './support/accounts';

test('a new user signs up, confirms, creates a first habit and checks in', async ({ page }) => {
  const email = uniqueEmail();
  const habit = 'Drink water';

  await signUp(page, email);
  await confirmEmail(page, email);
  await logIn(page, email);

  await expect(page.getByRole('heading', { name: 'One quick question' })).toBeVisible();
  await agreeToConsent(page);

  await expect(page.getByRole('link', { name: 'Create your first habit' })).toBeVisible();
  await createHabit(page, habit);

  const checkIn = page.getByRole('button', { name: `Check in ${habit} for today` });
  await expect(checkIn).toHaveAttribute('aria-pressed', 'false');
  await checkIn.click();
  await expect(checkIn).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(page.getByRole('button', { name: `Check in ${habit} for today` })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});
