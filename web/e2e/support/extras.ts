import { expect, type Page } from '@playwright/test';
import { createWebUser, SECRET, uniqueEmail } from './accounts';
import { findOutboxLink } from './outbox';
import { fillNewPassphrase, journalSection, newPassphrase, openPage } from './security';

export const reflectionTrigger = 'Synthetic trigger: a long meeting';

/** Turns the private journal on from Settings and keeps it unlocked across reloads (Remember on this device). */
export async function enableRememberedJournal(
  page: Page,
  passphrase = newPassphrase(),
): Promise<string> {
  await page.goto('/settings/privacy');
  const section = journalSection(page);
  await fillNewPassphrase(section, 'Journal passphrase', passphrase);
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByLabel('Remember on this device').check();
  await section.getByRole('button', { name: 'Turn on the private journal' }).click();
  await section.getByLabel("I've saved my recovery code").check();
  await section.getByRole('button', { name: 'Finish' }).click();
  await expect(
    section.getByRole('status').filter({ hasText: 'Your private journal is ready.' }),
  ).toBeVisible();
  return passphrase;
}

/** From Today (English): do a named moment through to Reflect and save it; ends on the saved confirmation. */
export async function saveMomentReflection(page: Page, trigger = reflectionTrigger): Promise<void> {
  await openPage(page, 'Today');
  await page.getByRole('link', { name: 'I need a moment' }).click();
  await page.getByRole('button', { name: "Name what's happening" }).click();
  await page.getByRole('button', { name: 'Too much / overloaded' }).click();
  await page.getByRole('radio', { name: 'Strong' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Reflect on it' }).click();
  await page.getByLabel('What set it off').fill(trigger);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText("Saved to today's private note.")).toBeVisible();
}

/** A signed-in account with the journal on and remembered, one saved moment and "Slow breathing" in What helps me. */
export async function createMomentsAccount(page: Page): Promise<string> {
  const email = await createWebUser(page);
  await enableRememberedJournal(page);
  await saveMomentReflection(page);
  await page.getByRole('link', { name: 'See your moments' }).click();
  await expect(page).toHaveURL(/\/moments$/);
  await page.getByRole('button', { name: 'Add to What helps me: “Slow breathing”' }).click();
  await expect(page.getByText('In What helps me')).toBeVisible();
  return email;
}

/** Signs up in the language of `tr` (the device language drives the sign-up language) and confirms by email; ends on consent. */
export async function signUpAndConfirmLocalized(
  page: Page,
  tr: (key: string) => string,
  email = uniqueEmail(),
): Promise<string> {
  await page.goto('/signup');
  await page.getByLabel(tr('auth.email'), { exact: true }).fill(email);
  await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: tr('signup.submit') }).click();
  await expect(page.getByRole('heading', { name: tr('signup.sent.title') })).toBeVisible();
  const link = await findOutboxLink(page.request, email, '/confirm-email?');
  await page.goto(link);
  const consent = page.getByRole('heading', { name: tr('consent.title') });
  const password = page.getByLabel(tr('auth.password'), { exact: true });
  await expect(password.or(consent)).toBeVisible();
  if (await password.isVisible()) {
    await password.fill(SECRET);
    await page.getByRole('button', { name: tr('confirm.submit') }).click();
  }
  await expect(consent).toBeVisible();
  return email;
}
