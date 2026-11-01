import { expect, test } from '@playwright/test';
import {
  addDays,
  agreeToConsentIfAsked,
  localToday,
  nextDiscordId,
  seedBotOnlyUserWithStart,
  uniqueDiscordId,
} from './support/accounts';
import { editDay, expectDayState } from './support/history';

test('last week is backfilled in History and survives a reload', async ({ page }) => {
  const discordId = uniqueDiscordId();
  const machineToday = new Date().toISOString().slice(0, 10);
  await seedBotOnlyUserWithStart(page.request, discordId, addDays(machineToday, -21));

  await nextDiscordId(page.request, discordId);
  await page.goto('/login');
  await page.getByRole('link', { name: 'Sign in with Discord' }).click();
  await agreeToConsentIfAsked(page);

  const today = await localToday(page);
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();

  await editDay(page, addDays(today, -1), 'Done', 'done');
  await editDay(page, addDays(today, -2), 'Done', 'done');
  await editDay(page, addDays(today, -3), 'Done', 'done');
  await editDay(page, addDays(today, -4), 'Mark as a low day', 'lowday');
  await editDay(page, addDays(today, -5), 'Done', 'done');
  await editDay(page, addDays(today, -5), 'Not done', 'notdone');
  await editDay(page, addDays(today, -6), 'Done', 'done');

  await page.reload();
  await expectDayState(page, addDays(today, -1), 'done');
  await expectDayState(page, addDays(today, -2), 'done');
  await expectDayState(page, addDays(today, -3), 'done');
  await expectDayState(page, addDays(today, -4), 'lowday');
  await expectDayState(page, addDays(today, -5), 'notdone');
  await expectDayState(page, addDays(today, -6), 'done');

  await page.goto('/today');
  const streak = page.getByText(/\d+-day streak/).first();
  await expect(streak).toBeVisible();
  const text = await streak.textContent();
  const days = Number(text?.match(/(\d+)-day streak/)?.[1]);
  expect(days).toBeGreaterThanOrEqual(3);
});
