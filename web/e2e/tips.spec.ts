import { expect, test, type Page } from '@playwright/test';
import { createHabit, createWebUser, logIn } from './support/accounts';
import { markTipSeen, me, nextDay, turnOnCalmMode } from './support/tips';

const streaksTip = (page: Page) => page.locator('section[data-tip="streaks"]');
const routinesTip = (page: Page) => page.locator('section[data-tip="routines"]');

test('declining the streaks question hides it for good and on a second device', async ({ page, browser }) => {
  const email = await createWebUser(page);
  await createHabit(page, 'Drink water');

  await expect(streaksTip(page)).toBeVisible();
  await expect(streaksTip(page).getByRole('heading', { name: 'Do you want to see streaks?' })).toBeVisible();
  await streaksTip(page).getByRole('button', { name: 'Not for me' }).click();
  await expect(streaksTip(page)).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Drink water', exact: true })).toBeVisible();
  await expect(streaksTip(page)).toHaveCount(0);

  const account = await me(page);
  expect(account.tipsSeen).toContain('streaks');
  expect(account.showStreaks).toBe(false);

  const second = await browser.newContext();
  try {
    const device = await second.newPage();
    await logIn(device, email);
    await expect(device.getByRole('heading', { name: 'Drink water', exact: true })).toBeVisible();
    await expect(device.locator('[data-tip]')).toHaveCount(0);
  } finally {
    await second.close();
  }
});

test('showing streaks from the question turns streaks on', async ({ page }) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await page.getByRole('button', { name: 'Check in Stretch for today' }).click();
  await expect(page.getByText(/\d+-day streak/)).toHaveCount(0);

  await streaksTip(page).getByRole('button', { name: 'Show streaks' }).click();
  await expect(streaksTip(page)).toHaveCount(0);
  await expect(page.getByText(/1-day streak/).first()).toBeVisible();

  const account = await me(page);
  expect(account.showStreaks).toBe(true);
});

test('a dismissed tip stays gone and no other tip follows the same day', async ({ page }) => {
  await createWebUser(page);
  for (const name of ['Water', 'Stretch', 'Read']) await createHabit(page, name);
  await markTipSeen(page, 'streaks');
  await nextDay(page);
  await page.reload();

  await expect(routinesTip(page)).toBeVisible();
  await expect(page.locator('[data-tip]')).toHaveCount(1);
  await routinesTip(page).getByRole('button', { name: 'Dismiss tip' }).click();
  await expect(page.locator('[data-tip]')).toHaveCount(0);

  await page.reload();
  await expect(page.getByRole('heading', { name: 'Water', exact: true })).toBeVisible();
  await expect(page.locator('[data-tip]')).toHaveCount(0);
  expect((await me(page)).tipsSeen).toContain('routines');
});

test('calm mode shows no tip but the streaks question', async ({ page }) => {
  await createWebUser(page);
  for (const name of ['Water', 'Stretch', 'Read']) await createHabit(page, name);
  await markTipSeen(page, 'streaks');
  await nextDay(page);
  await page.reload();
  await expect(routinesTip(page)).toBeVisible();

  await turnOnCalmMode(page);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Water', exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-calm', '');
  await expect(page.locator('[data-tip]')).toHaveCount(0);
});

test('tips do not show on the moment page', async ({ page }) => {
  await createWebUser(page);
  await createHabit(page, 'Drink water');
  await expect(streaksTip(page)).toBeVisible();

  await page.goto('/moment');
  await expect(page.locator('#main')).toBeVisible();
  await expect(page.locator('[data-tip]')).toHaveCount(0);
});
