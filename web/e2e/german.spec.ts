import { expect, test } from '@playwright/test';
import { createWebUser } from './support/accounts';

test.describe('signed out with a German browser', () => {
  test.use({ locale: 'de-DE' });

  test('the landing and login pages and the whole moment flow are in German', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(
      page.getByRole('heading', { name: 'Ein kleines Lagerfeuer für große Momente.' }),
    ).toBeVisible();

    await page.goto('/login');
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();

    await page.getByRole('link', { name: 'Ich brauche einen Moment' }).click();
    await expect(page).toHaveURL(/\/moment$/);
    const heading = (name: RegExp | string) => page.getByRole('heading', { name }).first();
    const click = (name: string) => page.getByRole('button', { name, exact: true }).click();
    const lines = page.getByRole('list', { name: 'Krisentelefone' });

    await expect(heading('Du bist hier. Das reicht fürs Erste.')).toBeVisible();
    await click('Dringende Hilfe');
    await expect(lines).toBeVisible();
    await click('Dringende Hilfe');
    await expect(lines).toHaveCount(0);

    await click('Benennen, was gerade los ist');
    await expect(heading('Was ist gerade los?')).toBeVisible();
    await click('Zu viel / überfordert');
    await expect(heading('Wie stark ist es?')).toBeVisible();
    await page.getByRole('radio', { name: 'Stark', exact: true }).check();
    await click('Weiter');
    await expect(heading(/Setz oder stell dich/)).toBeVisible();
    await click('Zum Ende springen');
    await expect(heading('Wie ist es jetzt?')).toBeVisible();
    await click('Überspringen');
    await expect(heading('Das war’s fürs Erste.').or(heading("Das war's fürs Erste."))).toBeVisible();

    await click('Verarbeiten');
    await expect(heading('Verarbeiten, wenn du magst')).toBeVisible();
    await expect(page.getByText('Nichts aus diesem Moment wurde gespeichert.')).toBeVisible();
    await click('Dringende Hilfe');
    await expect(lines).toBeVisible();

    await page.getByLabel('Was es ausgelöst hat').fill('Synthetischer Auslöser');
    await click('Beenden');
    const confirm = page.getByRole('group', { name: 'Beenden, ohne diese Notiz zu speichern?' });
    await expect(confirm).toBeVisible();
    await confirm.getByRole('button', { name: 'Weiterschreiben' }).click();
    await expect(confirm).toHaveCount(0);
    await click('Beenden');
    await confirm.getByRole('button', { name: 'Beenden', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Willkommen zurück' })).toBeVisible();
  });
});

test('a signed-in user switches to German in Settings and back to English', async ({ page }) => {
  await createWebUser(page);
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');

  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: 'Deutsch' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.getByRole('heading', { name: 'Darstellung', level: 1 })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('ember.language'))).toBe('de');
  await expect
    .poll(async () => ((await (await page.request.get('/api/me')).json()) as { language?: string }).language)
    .toBe('de');

  await page.getByRole('banner').getByRole('link', { name: 'Heute' }).click();
  await expect(page.getByRole('heading', { name: 'Heute', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Ich brauche einen Moment' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Deinen ersten Habit erstellen' })).toBeVisible();

  const habit = 'Wasser trinken';
  await page.goto('/habits/new');
  await expect(page.getByRole('heading', { name: 'Neuer Habit', level: 1 })).toBeVisible();
  await page.getByRole('button', { name: 'Bei null anfangen' }).click();
  await page.getByLabel('Name', { exact: true }).fill(habit);
  await page.getByRole('button', { name: 'Habit erstellen' }).click();
  await expect(page).toHaveURL(/\/today$/);
  const checkIn = page.getByRole('button', { name: `${habit} für heute abhaken` });
  await checkIn.click();
  await expect(checkIn).toHaveAttribute('aria-pressed', 'true');

  await page.getByRole('link', { name: `${habit} bearbeiten` }).first().click();
  await expect(page.getByRole('heading', { name: 'Habit bearbeiten', level: 1 })).toBeVisible();
  const name = page.getByLabel('Name', { exact: true });
  await expect(name).toHaveValue(habit);
  await name.fill('Mehr Wasser trinken');
  await page.getByRole('button', { name: 'Änderungen speichern' }).click();
  await expect(page.getByText('Gespeichert.').first()).toBeVisible();

  await page.goto('/settings');
  const groups = page.getByRole('main').getByRole('navigation');
  for (const group of ['Konto & Sicherheit', 'Erinnerungen', 'Habits & Tage', 'Darstellung', 'Privatsphäre & Daten', 'Feedback senden', 'Hilfe jetzt']) {
    await expect(groups.getByRole('link', { name: new RegExp(`^${group}`) })).toBeVisible();
  }

  await page.goto('/settings/appearance');
  await page.getByRole('radio', { name: 'English' }).check();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Appearance', level: 1 })).toBeVisible();
  await expect
    .poll(async () => ((await (await page.request.get('/api/me')).json()) as { language?: string }).language)
    .toBe('en');
  await page.getByRole('banner').getByRole('link', { name: 'Today' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mehr Wasser trinken', exact: true })).toBeVisible();
});
