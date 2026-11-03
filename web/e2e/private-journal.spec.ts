import { expect, test } from '@playwright/test';
import { logIn, SECRET } from './support/accounts';
import {
  createUserWithHabit,
  dayNotes,
  enableJournal,
  fillNewPassphrase,
  journalSection,
  newPassphrase,
  openPage,
  saveTodayNote,
  signOut,
} from './support/security';

const note = 'Synthetic journal note, walked by the river';

test('private journal: encrypted at rest, lock and unlock, recovery code, change passphrase, turn off', async ({ page }) => {
  await createUserWithHabit(page);
  const first = newPassphrase();
  const recoveryCode = await enableJournal(page, first);

  await saveTodayNote(page, note);
  const stored = await dayNotes(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]?.encrypted).toBeTruthy();
  expect(stored[0]?.text ?? null).toBeNull();
  expect(JSON.stringify(stored)).not.toContain('river');

  await openPage(page, 'Settings');
  const section = journalSection(page);
  await section.getByRole('button', { name: 'Lock on this device' }).click();
  await expect(section.getByText('Your private journal is locked on this device.')).toBeVisible();
  await openPage(page, 'Today');
  await expect(page.getByText('Your private journal is locked on this device.')).toBeVisible();
  await expect(page.getByLabel('A few words')).toHaveCount(0);

  await openPage(page, 'Settings');
  await section.getByLabel('Journal passphrase').fill(first);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Unlocked on this device.' })).toBeVisible();
  await openPage(page, 'Today');
  await expect(page.getByLabel('A few words')).toHaveValue(note);

  await openPage(page, 'Settings');
  await section.getByRole('button', { name: 'Lock on this device' }).click();
  await section.getByRole('button', { name: 'Use my recovery code' }).click();
  await section.getByLabel('Recovery code').fill(recoveryCode);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByText(/Your recovery code worked/)).toBeVisible();
  const second = newPassphrase();
  await fillNewPassphrase(section, 'New passphrase', second);
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByRole('button', { name: 'Save new passphrase' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Your new passphrase is set.' })).toBeVisible();

  await section.getByRole('button', { name: 'Lock on this device' }).click();
  await section.getByLabel('Journal passphrase').fill(first);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByText("That passphrase doesn't open your journal.")).toBeVisible();
  await section.getByLabel('Journal passphrase').fill(second);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Unlocked on this device.' })).toBeVisible();

  const third = newPassphrase();
  await section.getByRole('button', { name: 'Change passphrase' }).click();
  await section.getByLabel('Current passphrase').fill(second);
  await fillNewPassphrase(section, 'New passphrase', third);
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByRole('button', { name: 'Change passphrase', exact: true }).last().click();
  await expect(section.getByRole('status').filter({ hasText: 'Your passphrase is changed.' })).toBeVisible();

  await section.getByRole('button', { name: 'Lock on this device' }).click();
  await section.getByLabel('Journal passphrase').fill(third);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Unlocked on this device.' })).toBeVisible();

  await section.getByRole('button', { name: 'Turn off the private journal' }).click();
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByRole('button', { name: 'Turn off the private journal' }).last().click();
  await expect(section.getByRole('status').filter({ hasText: 'The private journal is off.' })).toBeVisible();

  await expect.poll(async () => (await dayNotes(page))[0]?.text).toBe(note);
  expect((await dayNotes(page))[0]?.encrypted ?? null).toBeNull();
});

test('signing out locks the journal until the passphrase is entered again', async ({ page }) => {
  const email = await createUserWithHabit(page);
  const passphrase = newPassphrase();
  await enableJournal(page, passphrase);
  await saveTodayNote(page, note);

  await signOut(page);
  await logIn(page, email);
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByText('Your private journal is locked on this device.')).toBeVisible();

  await page.getByRole('link', { name: 'Unlock it in Settings' }).click();
  const section = journalSection(page);
  await section.getByLabel('Journal passphrase').fill(passphrase);
  await section.getByRole('button', { name: 'Unlock', exact: true }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Unlocked on this device.' })).toBeVisible();
  await openPage(page, 'Today');
  await expect(page.getByLabel('A few words')).toHaveValue(note);
});

test('losing both passphrase and recovery code can delete the encrypted journal', async ({ page }) => {
  await createUserWithHabit(page);
  await enableJournal(page, newPassphrase());
  await saveTodayNote(page, note);
  expect(await dayNotes(page)).toHaveLength(1);

  await openPage(page, 'Settings');
  const section = journalSection(page);
  await section.getByRole('button', { name: 'Lock on this device' }).click();
  await section.getByRole('button', { name: 'I lost both my passphrase and recovery code' }).click();
  await section.getByLabel('Your login password').fill(SECRET);
  await section.getByLabel('Type DELETE to confirm').fill('DELETE');
  await section.getByRole('button', { name: 'Delete my private journal' }).click();
  await expect(section.getByRole('status').filter({ hasText: 'Your private journal is deleted and turned off.' })).toBeVisible();

  expect(await dayNotes(page)).toHaveLength(0);
  await expect(section.getByRole('button', { name: 'Turn on the private journal' })).toBeVisible();
  await openPage(page, 'Today');
  await expect(page.getByLabel('A few words')).toHaveValue('');
});
