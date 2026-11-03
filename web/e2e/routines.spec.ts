import { expect, test } from '@playwright/test';
import { createHabit, createWebUser } from './support/accounts';

test('a routine groups its habits on Today in order, overrides their reminder, and ungroups on delete', async ({ page }) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await createHabit(page, 'Journal');

  await page.goto('/today');
  await page.getByRole('link', { name: 'Edit Stretch' }).click();
  await page.getByLabel('Reminder time').fill('08:00');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/routines/new');
  await page.getByLabel('Name', { exact: true }).fill('Morning');
  await page.getByRole('button', { name: 'Add Journal' }).click();
  await page.getByRole('button', { name: 'Add Stretch' }).click();
  await page.getByRole('button', { name: 'Create routine' }).click();
  await expect(page).toHaveURL(/\/routines$/);
  await expect(page.getByRole('list', { name: 'Habits in Morning' }).getByRole('listitem')).toHaveText([
    'Journal',
    'Stretch',
  ]);

  const group = page.getByRole('region', { name: 'Morning', exact: true });
  await page.goto('/today');
  await expect(group.getByRole('heading', { level: 3 })).toHaveText(['Journal', 'Stretch']);

  await page.getByRole('link', { name: 'Edit Morning routine' }).first().click();
  await page.getByRole('button', { name: 'Move Stretch up' }).click();
  await page.getByLabel('Reminder time').fill('07:30');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  await page.goto('/today');
  await expect(group.getByRole('heading', { level: 3 })).toHaveText(['Stretch', 'Journal']);
  await page.reload();
  await expect(group.getByRole('heading', { level: 3 })).toHaveText(['Stretch', 'Journal']);

  await page.getByRole('link', { name: 'Edit Stretch' }).click();
  await expect(page.getByLabel('Reminder time')).toHaveValue('08:00');
  await expect(
    page.getByText('Your Morning routine reminds you at 07:30 instead, while this habit is part of it.'),
  ).toBeVisible();

  await page.goto('/routines');
  await page.getByRole('link', { name: 'Edit Morning routine' }).click();
  await page.getByRole('button', { name: 'Delete routine' }).click();
  await page.getByRole('button', { name: 'Yes, delete it' }).click();
  await expect(page).toHaveURL(/\/routines$/);
  await expect(page.getByText('No routines yet')).toBeVisible();

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Stretch', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Journal', level: 2 })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Morning' })).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 3 })).toHaveCount(0);

  await page.getByRole('link', { name: 'Edit Stretch' }).click();
  await expect(page.getByText(/reminds you at/)).toHaveCount(0);
  await expect(page.getByLabel('Reminder time')).toHaveValue('08:00');
});
