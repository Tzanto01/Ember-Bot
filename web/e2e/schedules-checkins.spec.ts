import { expect, test, type Page } from '@playwright/test';
import {
  addDays,
  agreeToConsentIfAsked,
  createWebUser,
  localToday,
  nextDiscordId,
  seedBotOnlyUserWithStart,
  uniqueDiscordId,
} from './support/accounts';
import { editDay, expectDayState } from './support/history';

const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function weekdayName(date: string): string {
  return dayNames[new Date(`${date}T00:00:00Z`).getUTCDay()];
}

async function createScheduledHabit(
  page: Page,
  name: string,
  options: { days?: string[]; timesPerDay?: number },
): Promise<void> {
  await page.goto('/habits/new');
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  if (options.days) {
    await page.getByText('On set days', { exact: true }).click();
    for (const day of dayNames) {
      const box = page.getByRole('checkbox', { name: day, exact: true });
      if ((await box.getAttribute('aria-checked')) === 'true') await box.click();
    }
    for (const day of options.days) await page.getByRole('checkbox', { name: day, exact: true }).click();
  }
  if (options.timesPerDay) await page.getByLabel('Times a day').selectOption(String(options.timesPerDay));
  await page.getByRole('button', { name: 'Create habit' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

function card(page: Page, name: string) {
  return page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
}

test('a habit on set days shows an off day as rest, never as missed', async ({ page }) => {
  await createWebUser(page);
  const today = await localToday(page);
  await createScheduledHabit(page, 'Gym', { days: [weekdayName(today)] });
  await createScheduledHabit(page, 'Swim', { days: [weekdayName(addDays(today, 1))] });

  await expect(card(page, 'Gym').getByText('Rest day, nothing planned')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Check in Gym for today' })).toHaveAttribute('aria-pressed', 'false');

  const swim = card(page, 'Swim');
  await expect(swim.getByText(/Rest day, nothing planned/)).toBeVisible();
  await expect(page.getByText(/missed/i)).toHaveCount(0);

  await page.getByRole('button', { name: 'Check in Swim for today' }).click();
  await expect(page.getByRole('button', { name: 'Check in Swim for today' })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Check in Swim for today' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(/missed/i)).toHaveCount(0);
});

test('a habit done several times a day steps through partial to done and survives a reload', async ({ page }) => {
  await createWebUser(page);
  await createScheduledHabit(page, 'Water', { timesPerDay: 3 });

  const checkIn = page.getByRole('button', { name: /^Check in Water for today/ });
  const water = card(page, 'Water');
  await expect(checkIn).toHaveAttribute('aria-pressed', 'false');
  await expect(checkIn).toHaveText('0/3');

  await checkIn.click();
  await expect(checkIn).toHaveText('1/3');
  await expect(checkIn).toHaveAttribute('aria-pressed', 'false');
  await expect(water.getByText('1 of 3 today')).toBeVisible();

  await checkIn.click();
  await expect(checkIn).toHaveText('2/3');
  await expect(water.getByText('2 of 3 today')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /^Check in Water for today/ })).toHaveText('2/3');

  await page.getByRole('button', { name: /^Check in Water for today/ }).click();
  await expect(page.getByRole('button', { name: /^Check in Water for today/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(water.getByText('Done today')).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: /^Check in Water for today/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(card(page, 'Water').getByText('Done today')).toBeVisible();
});

test('raising the target keeps a past done day done', async ({ page }) => {
  const discordId = uniqueDiscordId();
  const machineToday = new Date().toISOString().slice(0, 10);
  await seedBotOnlyUserWithStart(page.request, discordId, addDays(machineToday, -5));
  await nextDiscordId(page.request, discordId);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with Discord' }).click();
  await agreeToConsentIfAsked(page);

  const today = await localToday(page);
  const yesterday = addDays(today, -1);
  await page.goto('/history');
  await editDay(page, yesterday, 'Done', 'done');

  await page.goto('/today');
  await page.getByRole('link', { name: /^Edit / }).first().click();
  await page.getByLabel('Times a day').selectOption('3');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/history');
  await expectDayState(page, yesterday, 'done');
  await page.reload();
  await expectDayState(page, yesterday, 'done');
});
