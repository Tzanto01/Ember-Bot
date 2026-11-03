import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { createHabit, createWebUser, SECRET } from './accounts';

export function newPassphrase(): string {
  return `Journal-${Date.now()}-${Math.floor(Math.random() * 100000)}-synthetic`;
}

export function journalSection(page: Page) {
  return page.getByRole('region', { name: 'Private journal' });
}

export function twoFactorSection(page: Page) {
  return page.getByRole('region', { name: 'Two-step sign-in' });
}

/** Fills the passphrase pair (and the login password when asked) inside `scope`. */
export async function fillNewPassphrase(
  scope: ReturnType<typeof journalSection>,
  label: string,
  passphrase: string,
): Promise<void> {
  await scope.getByLabel(label, { exact: true }).fill(passphrase);
  await scope.getByLabel('Type it again').fill(passphrase);
}

/** Turns the private journal on from Settings; returns the one-time recovery code. */
export async function enableJournal(page: Page, passphrase: string): Promise<string> {
  await page.goto('/settings');
  const section = journalSection(page);
  await fillNewPassphrase(section, 'Journal passphrase', passphrase);
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByRole('button', { name: 'Turn on the private journal' }).click();
  const code = section.locator('code');
  await expect(code).toBeVisible();
  const recoveryCode = ((await code.textContent()) ?? '').replace(/\s/g, '');
  expect(recoveryCode).not.toBe('');
  await section.getByLabel("I've saved my recovery code").check();
  await section.getByRole('button', { name: 'Finish' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Your private journal is ready.' })).toBeVisible();
  return recoveryCode;
}

/** In-app navigation, so an unlocked journal key survives (a full page load drops it). */
export async function openPage(page: Page, name: 'Today' | 'Settings'): Promise<void> {
  await page.getByRole('banner').getByRole('link', { name }).click();
  await expect(page).toHaveURL(new RegExp(`/${name.toLowerCase()}`));
}

export async function saveTodayNote(page: Page, text: string): Promise<void> {
  await openPage(page, 'Today');
  await page.getByLabel('A few words').fill(text);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
}

export async function dayNotes(page: Page): Promise<{ date: string; text?: string | null; encrypted?: unknown }[]> {
  const response = await page.request.get('/api/day-notes');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function signOut(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login/);
}

/** Polls the test host until the current TOTP differs from `notCode`. */
export async function freshTotp(
  request: APIRequestContext,
  email: string,
  notCode?: string,
): Promise<string> {
  let code = '';
  await expect
    .poll(
      async () => {
        const response = await request.get(`/test/users/totp?email=${encodeURIComponent(email)}`);
        if (!response.ok()) return false;
        code = ((await response.json()) as { code: string }).code;
        return code !== notCode;
      },
      { message: 'a TOTP code different from the last one', timeout: 40_000, intervals: [1_000] },
    )
    .toBe(true);
  return code;
}

/** Sets up and enables two-step sign-in from Settings; returns the code used and the recovery codes. */
export async function enableTwoFactor(
  page: Page,
  email: string,
): Promise<{ usedCode: string; recoveryCodes: string[] }> {
  await page.goto('/settings');
  const section = twoFactorSection(page);
  await section.getByRole('button', { name: 'Set up two-step sign-in' }).click();
  await expect(section.getByRole('img', { name: 'QR code for adding Ember to your authenticator app' })).toBeVisible();
  const usedCode = await freshTotp(page.request, email);
  await section.getByLabel('Code from your authenticator app').fill(usedCode);
  await section.getByLabel('Your password', { exact: true }).fill(SECRET);
  await section.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
  const list = section.getByRole('list', { name: 'Recovery codes' });
  await expect(list).toBeVisible();
  const recoveryCodes = (await list.getByRole('listitem').allTextContents()).map((c) => c.trim());
  expect(recoveryCodes.length).toBeGreaterThan(0);
  await section.getByRole('button', { name: "I've saved them" }).click();
  await expect(section.getByText(/Two-step sign-in is on/)).toBeVisible();
  return { usedCode, recoveryCodes };
}

/** A signed-in user with one habit, so Today shows the journal card. */
export async function createUserWithHabit(page: Page): Promise<string> {
  const email = await createWebUser(page);
  await createHabit(page, 'Stretch');
  return email;
}
