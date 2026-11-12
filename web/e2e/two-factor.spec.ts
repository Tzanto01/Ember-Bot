import { expect, test } from '@playwright/test';
import {
  agreeToConsentIfAsked,
  createWebUser,
  logIn,
  nextDiscordId,
  SECRET,
  uniqueDiscordId,
} from './support/accounts';
import { enableTwoFactor, freshTotp, signOut, twoFactorSection } from './support/security';

test.setTimeout(150_000);

test('two-step sign-in: set up, authenticator code, recovery code, turn off', async ({ page }) => {
  const email = await createWebUser(page);
  const { usedCode, recoveryCodes } = await enableTwoFactor(page, email);
  await expect(twoFactorSection(page).getByText(`You have ${recoveryCodes.length} recovery codes left.`)).toBeVisible();

  await signOut(page);
  await logIn(page, email);
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel('Authenticator code').fill('000000');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(/That code didn't work/)).toBeVisible();

  await page.getByLabel('Authenticator code').fill(await freshTotp(page.request, email, usedCode));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  await signOut(page);
  await logIn(page, email);
  await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
  await page.getByLabel('Recovery code').fill(recoveryCodes[0] ?? '');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();

  await page.goto('/settings/account');
  const section = twoFactorSection(page);
  await expect(section.getByText(`You have ${recoveryCodes.length - 1} recovery codes left.`)).toBeVisible();
  await section.getByRole('button', { name: 'Turn off two-step sign-in' }).click();
  await section.getByLabel('Your password', { exact: true }).fill(SECRET);
  await section.getByRole('button', { name: 'Turn off two-step sign-in' }).last().click();
  await expect(section.getByRole('status').filter({ hasText: 'Two-step sign-in is off.' })).toBeVisible();

  await signOut(page);
  await logIn(page, email);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('a Discord sign-in for an account with two-step sign-in asks for the code', async ({ page }) => {
  const email = await createWebUser(page);
  const discordId = uniqueDiscordId();
  const { usedCode } = await enableTwoFactor(page, email);

  await nextDiscordId(page.request, discordId);
  await page.getByRole('button', { name: 'Link Discord' }).click();
  await page.getByLabel('Your password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Continue to Discord' }).click();
  await expect(page.getByRole('button', { name: 'Unlink Discord' })).toBeVisible();

  await signOut(page);
  await nextDiscordId(page.request, discordId);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with Discord' }).click();
  await expect(page).toHaveURL(/\/login\?step=2fa(&|$)/);
  await expect(page.getByRole('heading', { name: 'Two-step sign-in' })).toBeVisible();

  await page.getByLabel('Authenticator code').fill(await freshTotp(page.request, email, usedCode));
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await agreeToConsentIfAsked(page);
});
