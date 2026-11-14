import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createHabit, createWebUser, localToday, setAccountLanguage } from './support/accounts';
import { enableRememberedJournal, reflectionTrigger, saveMomentReflection, signUpAndConfirmLocalized } from './support/extras';
import { languages, translator } from './support/locales';

const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const viewports = [
  { name: 'phone', width: 360, height: 800 },
  { name: 'desktop', width: 1280, height: 800 },
];
const schemes = ['light', 'dark'] as const;
const settingsGroups = ['account', 'reminders', 'habits', 'appearance', 'privacy', 'feedback'];

async function scan(page: Page, where: string, found: string[]): Promise<void> {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => !document.querySelector('main[data-arrive]'));
  const { violations } = await new AxeBuilder({ page }).withTags(tags).analyze();
  for (const v of violations) {
    found.push(`${where} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`);
  }
}

async function visit(
  page: Page,
  path: string,
  ready: RegExp | string,
  found: string[],
  lang: string,
): Promise<void> {
  await page.goto(path);
  await expect(page.getByRole('heading', { name: ready }).first()).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', lang);
  await scan(page, path, found);
}

for (const { code, locale, strings } of languages) {
  const tr = translator(strings);

  for (const { name, width, height } of viewports) {
    for (const scheme of schemes) {
      test.describe(`${code} ${name} ${scheme}`, () => {
        test.use({ viewport: { width, height }, colorScheme: scheme, locale });

        test.beforeEach(async ({ page }) => {
          await page.addInitScript(
            (value) => localStorage.setItem('ember.colorScheme', value),
            scheme,
          );
        });

        async function useLanguage(page: Page): Promise<void> {
          await setAccountLanguage(page, code);
        }

        function visitPage(page: Page, path: string, ready: RegExp | string, found: string[]) {
          return visit(page, path, ready, found, code);
        }

        test('signed-out pages have no WCAG A/AA violations', async ({ page }) => {
          const found: string[] = [];
          await visitPage(page, '/', /./, found);
          await visitPage(page, '/login', tr('login.title'), found);
          await expect(page.getByText(tr('about.intro'))).toBeVisible();
          await visitPage(page, '/signup', tr('signup.title'), found);
          await visitPage(page, '/forgot-password', /./, found);
          await visitPage(page, '/local', tr('local.start.title'), found);
          await expect(page.getByText(tr('about.intro'))).toBeVisible();
          await visitPage(page, '/about', tr('title.about'), found);
          await visitPage(page, '/feedback', tr('title.feedback'), found);
          await visitPage(page, '/download', /./, found);
          await visitPage(page, '/legal/privacy', /./, found);
          await expect(page.locator('#main [lang="de"]').first()).toBeVisible();
          await visitPage(page, '/no-such-page', tr('notFound.title'), found);
          expect(found).toEqual([]);
        });

        test('the moment flow and help page have no WCAG A/AA violations', async ({ page }) => {
          const found: string[] = [];
          const heading = (name: RegExp | string) => page.getByRole('heading', { name }).first();
          const click = (name: string) => page.getByRole('button', { name, exact: true }).click();
          const crisisLines = page.getByRole('list', { name: tr('crisis.list') });

          await visitPage(page, '/help', tr('title.help'), found);
          await page.goto('/moment');
          await expect(heading(tr('moment.catch.heading'))).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('lang', code);
          await scan(page, '/moment catch', found);
          await click(tr('moment.urgentHelp'));
          await expect(crisisLines).toBeVisible();
          await scan(page, '/moment catch (urgent help open)', found);
          await click(tr('moment.urgentHelp'));

          await click(tr('moment.catch.name'));
          await expect(heading(tr('moment.name.heading'))).toBeVisible();
          await scan(page, '/moment name', found);
          await click(tr('moment.tile.overloaded').replace(' / ', ', '));
          await expect(heading(tr('moment.intensity.heading'))).toBeVisible();
          await page.getByRole('radio', { name: tr('moment.intensity.4'), exact: true }).check();
          await scan(page, '/moment intensity', found);
          await click(tr('moment.continue'));
          await expect(heading(code === 'en' ? /Sit or stand/ : /Setz oder stell dich/)).toBeVisible();
          await scan(page, '/moment practice step', found);
          await click(tr('moment.next'));
          await click(tr('moment.next'));
          await expect(heading(tr('moment.breath.heading'))).toBeVisible();
          await scan(page, '/moment breathing player', found);
          await click(tr('moment.start'));
          await expect(page.getByText(`${tr('moment.breath.in')}, 4`).first()).toBeVisible();
          await scan(page, '/moment breathing player (running)', found);
          await click(tr('moment.pause'));
          await click(tr('moment.skipPractice'));
          await expect(heading(tr('moment.after.heading'))).toBeVisible();
          await scan(page, '/moment after', found);
          await click(tr('moment.skip'));
          await expect(heading(tr('moment.end.heading'))).toBeVisible();
          await scan(page, '/moment end', found);
          await click(tr('moment.reflect'));
          await expect(heading(tr('moment.reflect.heading'))).toBeVisible();
          await scan(page, '/moment reflect', found);
          await click(tr('moment.urgentHelp'));
          await expect(crisisLines).toBeVisible();
          await scan(page, '/moment reflect (urgent help open)', found);
          expect(found).toEqual([]);
        });

        test('no-account mode Today has no WCAG A/AA violations', async ({ page }) => {
          const found: string[] = [];
          await page.goto('/local');
          await page.getByRole('button', { name: tr('local.start.button') }).click();
          await expect(page.getByRole('heading', { name: tr('today.title'), exact: true })).toBeVisible();
          await expect(page.locator('html')).toHaveAttribute('lang', code);
          await scan(page, '/today (no account)', found);
          expect(found).toEqual([]);
        });


        if (code === 'de') {
          test('the consent page has no WCAG A/AA violations for a German account before consent', async ({ page }) => {
            const found: string[] = [];
            await signUpAndConfirmLocalized(page, tr);
            await expect(page.locator('html')).toHaveAttribute('lang', 'de');
            await scan(page, '/consent (German, before consent)', found);
            expect(found).toEqual([]);
          });
        }

        test('calm mode has no WCAG A/AA violations in no-account mode', async ({ page }) => {
          const found: string[] = [];
          await page.goto('/local');
          await page.getByRole('button', { name: tr('local.start.button') }).click();
          await expect(page.getByRole('heading', { name: tr('today.title'), exact: true })).toBeVisible();
          await page.goto('/settings/appearance');
          await page.getByRole('switch', { name: tr('settings.calm.label') }).click();
          await expect(page.locator('html')).toHaveAttribute('data-calm', '');
          await scan(page, '/settings/appearance (no account, calm on)', found);
          await visitPage(page, '/today', tr('today.title'), found);
          await page.getByRole('link', { name: tr('moment.door.label') }).click();
          await expect(page.getByRole('heading', { name: tr('moment.catch.heading') })).toBeVisible();
          await scan(page, '/moment catch (no account, calm on)', found);
          expect(found).toEqual([]);
        });

        test.describe('signed in', () => {
          test.use({ locale: 'en-US' });

          test('signed-in pages have no WCAG A/AA violations', async ({ page }) => {
            test.setTimeout(180_000);
            const found: string[] = [];
            await createWebUser(page);
            await createHabit(page, 'Stretch');
            await createHabit(page, 'Journal');

            await page.goto('/routines/new');
            await page.getByLabel('Name', { exact: true }).fill('Morning');
            await page.getByRole('button', { name: 'Add Stretch' }).click();
            await page.getByRole('button', { name: 'Create routine' }).click();
            await expect(page).toHaveURL(/\/routines$/);
            await useLanguage(page);

            await visitPage(page, '/today', tr('today.title'), found);
            const checkIn = page.getByRole('button', { name: tr('today.checkIn', { name: 'Journal' }) });
            await checkIn.click();
            await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
            await scan(page, '/today (checked)', found);
            await checkIn.click();
            await expect(checkIn).toHaveAttribute('aria-pressed', 'false');
            await scan(page, '/today (unchecked)', found);

            await visitPage(page, '/habits/new', /./, found);
            await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
            await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toBeVisible();
            await scan(page, '/habits/new (form)', found);
            await page.goto('/today');
            await page.getByRole('link', { name: tr('today.edit', { name: 'Stretch' }) }).first().click();
            await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toHaveValue('Stretch');
            await scan(page, 'habit edit', found);

            await visitPage(page, '/routines', tr('routines.title'), found);
            await page
              .getByRole('link', { name: tr('today.edit', { name: tr('routine.title', { name: 'Morning' }) }) })
              .click();
            await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toHaveValue('Morning');
            await scan(page, 'routine edit', found);

            await visitPage(page, '/history', tr('history.title'), found);
            const today = await localToday(page);
            await page.locator(`#day-${today}`).click();
            await expect(page.locator('#day-panel')).toHaveCSS('opacity', '1');
            await scan(page, '/history (day panel)', found);
            await visitPage(page, '/history/year', /./, found);

            await visitPage(page, '/feedback', tr('title.feedback'), found);
            for (const group of settingsGroups) await visitPage(page, `/settings/${group}`, /./, found);
            await visitPage(page, '/whats-new', /./, found);
            expect(found).toEqual([]);
          });

          test('Your moments, What helps me and calm mode have no WCAG A/AA violations', async ({ page }) => {
            test.setTimeout(240_000);
            const found: string[] = [];
            await createWebUser(page);
            await setAccountLanguage(page, code);
            await visitPage(page, '/moments', tr('title.moments'), found);
            await expect(page.getByText(tr('moments.needsPrivate'))).toBeVisible();
            await scan(page, '/moments (no private journal)', found);
            await visitPage(page, '/settings/privacy', /./, found);
            await expect(page.getByText(tr('helps.needsPrivate'))).toBeVisible();
            await scan(page, '/settings/privacy (What helps me needs the journal)', found);

            await setAccountLanguage(page, 'en');
            await enableRememberedJournal(page);
            await saveMomentReflection(page);
            await page.getByRole('link', { name: 'See your moments' }).click();
            await page.getByRole('button', { name: 'Add to What helps me: “Slow breathing”' }).click();
            await expect(page.getByText('In What helps me')).toBeVisible();
            await setAccountLanguage(page, code);

            await visitPage(page, '/moments', tr('title.moments'), found);
            await expect(page.getByText(reflectionTrigger)).toBeVisible();
            await scan(page, '/moments (one moment)', found);
            await visitPage(page, '/settings/privacy', /./, found);
            const card = page.getByRole('region', { name: tr('settings.card.helps') });
            await card.getByRole('button', { name: tr('helps.editLabel', { text: 'Slow breathing' }) }).click();
            await scan(page, '/settings/privacy (What helps me editing)', found);

            await visitPage(page, '/today', tr('today.title'), found);
            await page.getByRole('link', { name: tr('moment.door.label') }).click();
            await expect(page.getByRole('heading', { name: tr('moment.catch.heading') })).toBeVisible();
            await expect(page.getByRole('button', { name: 'Slow breathing' })).toBeVisible();
            await scan(page, '/moment catch (with What helped before chips)', found);

            await visitPage(page, '/settings/appearance', /./, found);
            await page.getByRole('switch', { name: tr('settings.calm.label') }).click();
            await expect(page.locator('html')).toHaveAttribute('data-calm', '');
            await scan(page, '/settings/appearance (calm on)', found);
            await visitPage(page, '/today', tr('today.title'), found);
            await scan(page, '/today (calm on)', found);
            await page.getByRole('link', { name: tr('moment.door.label') }).click();
            await expect(page.getByRole('heading', { name: tr('moment.catch.heading') })).toBeVisible();
            await scan(page, '/moment catch (calm on, chips)', found);
            await page.getByRole('button', { name: tr('moment.catch.breathe') }).click();
            await scan(page, '/moment practice (calm on)', found);

            await visitPage(page, '/settings/privacy', /./, found);
            await page.getByRole('button', { name: tr('journalSettings.lock') }).click();
            await visitPage(page, '/moments', tr('title.moments'), found);
            await expect(page.getByText(tr('moments.locked'))).toBeVisible();
            await scan(page, '/moments (locked, calm on)', found);
            expect(found).toEqual([]);
          });
        });
      });
    }
  }
}

test('History month and Year cells are named with date and state, and the year grid moves by arrow keys', async ({
  page,
}) => {
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  const today = await localToday(page);
  const date = new Date(`${today}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

  await page.goto('/history');
  await expect(page.locator(`#day-${today}`)).toHaveAccessibleName(new RegExp(`^${date}, today, `));
  await expect(page.getByRole('table')).toHaveAccessibleName(/\d{4}$/);

  await page.goto('/history/year');
  const cell = page.locator(`[data-date="${today}"]`);
  await expect(cell).toHaveAccessibleName(new RegExp(`^${date}, \\d{4}: `));
  await cell.focus();
  await page.keyboard.press('ArrowUp');
  await expect(
    page.locator(
      `[data-date="${new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10)}"]`,
    ),
  ).toBeFocused();
});
