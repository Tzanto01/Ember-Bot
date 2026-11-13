import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import {
  addDays,
  confirmEmail,
  createHabit,
  createWebUser,
  localToday,
  SECRET,
  signUp,
  uniqueEmail,
} from './support/accounts';
import { enableRememberedJournal } from './support/extras';
import { findOutboxLink } from './support/outbox';
import { openSettingsGroup, saveTodayNote, signOut } from './support/security';

test('password reset: new password signs in, old one fails', async ({ page }) => {
  const email = await createWebUser(page);
  await signOut(page);
  const next = `Reset-${Date.now()}-synthetic`;

  await page.goto('/forgot-password');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send the link' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();

  const link = await findOutboxLink(page.request, email, '/reset-password?');
  await page.goto(link);
  await page.getByLabel('New password', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Save new password' }).click();
  await expect(page.getByRole('heading', { name: 'Your password is updated' })).toBeVisible();

  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText(/That email and password don't match/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel('Password', { exact: true }).fill(next);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
});

test('sign out from the header sends protected routes to sign-in', async ({ page }) => {
  await createWebUser(page);
  await signOut(page);
  for (const path of ['/today', '/settings', '/history', '/habits/new']) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  }
  expect((await page.request.get('/api/me')).status()).toBe(401);
});

test('habit edit, delete, pause until a date and resume', async ({ page }) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await createHabit(page, 'Read');

  await page.getByRole('link', { name: 'Edit Stretch' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Stretch more');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.').first()).toBeVisible();
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Stretch more', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Stretch', exact: true })).toHaveCount(0);

  await page.getByRole('link', { name: 'Edit Read' }).click();
  await page.getByLabel('Pause until').fill(addDays(await localToday(page), 3));
  await page.getByRole('button', { name: 'Pause habit' }).click();
  await expect(
    page.getByText(/^Paused until .*Pick it up again whenever you like\./),
  ).toBeVisible();
  await page.goto('/today');
  await expect(
    page.getByText(/^Paused until .*You can resume it any time under Edit\./),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check in Read for today' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check in Stretch more for today' })).toBeVisible();

  await page.getByRole('link', { name: 'Edit Read' }).click();
  await page.getByRole('button', { name: 'Resume now' }).click();
  await expect(page.getByText('Welcome back. This habit is active again.')).toBeVisible();
  await page.goto('/today');
  await expect(page.getByRole('button', { name: 'Check in Read for today' })).toBeVisible();
  await expect(page.getByText(/^Paused/)).toHaveCount(0);

  await page.getByRole('link', { name: 'Edit Stretch more' }).click();
  await page.getByRole('button', { name: 'Delete habit' }).click();
  await page.getByRole('button', { name: 'Yes, delete it' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'Stretch more', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Read', exact: true })).toBeVisible();
  const habits: { name: string }[] = await (await page.request.get('/api/habits')).json();
  expect(habits.map((habit) => habit.name)).toEqual(['Read']);
});

test('the plain JSON export keeps a private journal encrypted', async ({ page }) => {
  test.setTimeout(240_000);
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await enableRememberedJournal(page);
  const note = 'Synthetic private note about a calm morning';
  await saveTodayNote(page, note);

  await openSettingsGroup(page, 'Privacy & data');
  const plainDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download JSON' }).click();
  const plainFile = await (await plainDownload).path();
  const plainText = readFileSync(plainFile, 'utf8');
  const plain = JSON.parse(plainText);
  expect(plain.format_version).toBe(2);
  expect(plain.habits.map((habit: { name: string }) => habit.name)).toContain('Stretch');
  expect(plainText).not.toContain(note);
  expect(plain.day_notes.length).toBeGreaterThan(0);
  expect(plain.day_notes[0].encrypted).toBeTruthy();
});

test('no-account mode moves device data into a new account', async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto('/local');
  await page.getByRole('button', { name: 'Start without an account' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await createHabit(page, 'Local stretch');
  const checkIn = page.getByRole('button', { name: 'Check in Local stretch for today' });
  await checkIn.click();
  await expect(checkIn).toHaveAttribute('aria-pressed', 'true');

  await openSettingsGroup(page, 'Account & security');
  await page.getByRole('button', { name: 'Create an account and keep my data' }).click();
  await expect(page).toHaveURL(/\/signup/);
  const email = uniqueEmail();
  await signUp(page, email);
  await confirmEmail(page, email);
  await page.getByRole('button', { name: 'I agree' }).click();
  await expect(page).toHaveURL(/\/keep-data/);
  await expect(page.getByRole('heading', { name: 'Keep your data' })).toBeVisible();
  await page.getByRole('button', { name: 'Move my data' }).click();
  await expect(page).toHaveURL(/\/today$/);
  const moved = page.getByRole('button', { name: 'Check in Local stretch for today' });
  await expect(moved).toHaveAttribute('aria-pressed', 'true');

  const me = await (await page.request.get('/api/me')).json();
  expect(me.email).toBe(email);
  const habits: { name: string }[] = await (await page.request.get('/api/habits')).json();
  expect(habits.map((habit) => habit.name)).toEqual(['Local stretch']);
});
