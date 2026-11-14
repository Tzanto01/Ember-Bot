import { expect, test, type Locator, type Page } from '@playwright/test';
import {
  addDays,
  agreeToConsentIfAsked,
  createWebUser,
  localToday,
  nextDiscordId,
  SECRET,
  seedBotOnlyUser,
  seedBotOnlyUserWithStart,
  setAccountLanguage,
  uniqueDiscordId,
} from './support/accounts';
import { enableRememberedJournal, reflectionTrigger } from './support/extras';
import { languages, translator } from './support/locales';
import { capture, reviewFull, reviewVerdict } from './support/review';
import { freshTotp, newPassphrase } from './support/security';

const longHabit = 'Wasser trinken und Donaudampfschifffahrtsgesellschaft';
const longRoutine = 'Morgenroutine mit Donaudampfschifffahrtsdehnen';
const longHelp = 'Ein langer Spaziergang an der Donaudampfschifffahrtsgesellschaft vorbei';
const timeout = reviewFull ? 3_600_000 : 400_000;

/** English-only: `saveMomentReflection` with the tile matched with or without the slash, so it works on either wording. */
async function saveMoment(page: Page): Promise<void> {
  await page.getByRole('banner').getByRole('link', { name: 'Today' }).click();
  await page.getByRole('link', { name: 'I need a moment' }).click();
  await page.getByRole('button', { name: "Name what's happening" }).click();
  await page.getByRole('button', { name: /^Too much.{1,3}overloaded$/ }).click();
  await page.getByRole('radio', { name: 'Strong', exact: true }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Reflect on it' }).click();
  await page.getByLabel('What set it off').fill(reflectionTrigger);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText("Saved to today's private note.")).toBeVisible();
}

interface HabitOptions {
  weekly?: number;
  perDay?: number;
}

for (const { code, strings } of languages) {
  const tr = translator(strings);

  test.describe(`review app ${code}`, () => {
    async function ready(page: Page, heading: RegExp | string | null = null): Promise<void> {
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await expect(
        heading ? page.getByRole('heading', { name: heading }).first() : page.locator('#main'),
      ).toBeVisible();
    }

    async function go(
      page: Page,
      path: string,
      heading: RegExp | string | null = null,
    ): Promise<void> {
      await page.goto(path);
      await ready(page, heading);
    }

    async function begin(page: Page): Promise<void> {
      await createWebUser(page);
      await setAccountLanguage(page, code);
      await go(page, '/today', tr('today.title'));
    }

    async function makeHabit(page: Page, name: string, options: HabitOptions = {}): Promise<void> {
      await go(page, '/habits/new', tr('habitNew.title'));
      await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
      await page.getByLabel(tr('habitFields.name'), { exact: true }).fill(name);
      if (options.weekly) {
        await page.getByRole('radio', { name: tr('habitFields.frequency.weekly') }).click();
        await page.getByLabel(tr('habitFields.timesPerWeek')).selectOption(String(options.weekly));
      }
      if (options.perDay)
        await page.getByLabel(tr('habitFields.timesPerDay')).selectOption(String(options.perDay));
      await page.getByRole('button', { name: tr('habitNew.create') }).click();
      await expect(page).toHaveURL(/\/today$/);
      await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
    }

    const checkButton = (page: Page, name: string): Locator =>
      page.getByRole('button', { name: tr('today.checkIn', { name }) });

    async function addMood(page: Page, label: string, emoji: string): Promise<void> {
      const form = page.getByRole('form', { name: tr('moods.addForm') });
      await form.getByLabel(tr('moods.name'), { exact: true }).fill(label);
      await form.getByLabel(tr('moods.emoji')).fill(emoji);
      await form.getByRole('button', { name: tr('moods.add') }).click();
      await expect(
        page.getByRole('button', { name: tr('moods.archiveLabel', { label }) }),
      ).toBeVisible();
    }

    async function showMonthOf(page: Page, date: string): Promise<void> {
      const target = date.slice(0, 7);
      const days = page.locator('button[id^="day-"]');
      await expect(days.first()).toBeVisible();
      for (let attempt = 0; attempt < 3; attempt++) {
        const shown = ((await days.first().getAttribute('id')) ?? '').slice(4, 11);
        if (shown === target) return;
        const step = target < shown ? -1 : 1;
        await page
          .getByRole('button', {
            name: tr(step < 0 ? 'calendar.previousMonth' : 'calendar.nextMonth'),
          })
          .click();
        await expect(days.first()).not.toHaveAttribute('id', new RegExp(`^day-${shown}`));
      }
    }

    async function openDay(page: Page, date: string): Promise<void> {
      await showMonthOf(page, date);
      const cell = page.locator(`#day-${date}`);
      if ((await cell.getAttribute('aria-expanded')) !== 'true') await cell.click();
      await expect(cell).toHaveAttribute('aria-expanded', 'true');
      await expect(page.locator('#day-panel')).toHaveCSS('opacity', '1');
    }

    async function setDay(
      page: Page,
      date: string,
      key: 'day.done' | 'day.notDone' | 'day.lowDayOn',
      state: string,
    ): Promise<void> {
      await openDay(page, date);
      await page
        .locator('#day-panel')
        .getByRole('button', { name: tr(key), exact: true })
        .click();
      await expect(page.locator(`#day-${date}`)).toHaveAttribute('data-state', state);
    }

    test(`Today states ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (state: string, extras = { big: true }) =>
        capture(page, '/today', state, code, found, extras);
      await begin(page);
      await capture(page, '/today', 'empty', code, found, { themes: true, big: true });

      await makeHabit(page, longHabit);
      await makeHabit(page, 'Stretch');
      await makeHabit(page, 'Laufen', { weekly: 3 });
      await makeHabit(page, 'Wasser', { perDay: 3 });
      await makeHabit(page, 'Pause');
      await go(page, '/today', tr('today.title'));
      await expect(
        page.getByText(tr('today.ember.none')).locator('visible=true').first(),
      ).toBeVisible();
      await snap('habits, none checked');

      await go(page, '/settings/habits');
      await addMood(page, 'Cozy', '🧸');
      await addMood(page, 'Zufrieden und gelassen', '😌');
      await capture(page, '/settings/habits', 'two own moods', code, found);

      await go(page, '/today', tr('today.title'));
      await checkButton(page, 'Stretch').click();
      await expect(checkButton(page, 'Stretch')).toHaveAttribute('aria-pressed', 'true');
      await checkButton(page, 'Wasser').click();
      await expect(checkButton(page, 'Wasser')).toHaveText('1/3');
      await snap('partly done');

      const words = page.getByLabel(tr('journal.fewWords'));
      await expect(page.getByRole('heading', { name: tr('journal.headingToday') })).toBeVisible();
      await page.getByRole('radio', { name: /Zufrieden und gelassen/ }).click();
      await expect(
        page.getByRole('status').filter({ hasText: tr('journal.status.mood') }),
      ).toBeVisible();
      await snap('mood chosen, toast: mood saved');
      await words.fill(
        'Ein langer Tag mit Donaudampfschifffahrtsgesellschaft-Gedanken. '.repeat(4),
      );
      await page.getByRole('button', { name: tr('journal.save'), exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: tr('journal.status.saved') }),
      ).toBeVisible();
      await snap('note and mood, saved');

      await page.getByRole('button', { name: tr('today.lowDay.mark') }).click();
      await expect(page.getByText(tr('today.lowDay.heading'), { exact: true })).toBeVisible();
      await snap('low day');
      await page.getByRole('button', { name: tr('today.lowDay.clear') }).click();
      await expect(page.getByRole('button', { name: tr('today.lowDay.mark') })).toBeVisible();

      await page.evaluate(() => localStorage.setItem('ember.seenReleaseNotes', '0.0.1'));
      await page.reload();
      await expect(page.getByRole('link', { name: tr('whatsNew.card.link') })).toBeVisible();
      await snap("What's new card");
      await page.getByRole('button', { name: tr('whatsNew.card.dismiss') }).click();

      await page.getByRole('link', { name: tr('today.edit', { name: 'Pause' }) }).click();
      const today = await page.evaluate(() => new Date().toLocaleDateString('sv'));
      await page.getByLabel(tr('habitEdit.pauseUntil')).fill(addDays(today, 5));
      await page.getByRole('button', { name: tr('habitEdit.pauseHabit') }).click();
      await expect(page.getByRole('button', { name: tr('habitEdit.resume') })).toBeVisible();
      await go(page, '/today', tr('today.title'));
      await expect(
        page.getByText(strings['today.pausedUntil'].split('{{date}}')[0]).first(),
      ).toBeVisible();
      await snap('a paused habit');

      await go(page, '/settings/habits', /./);
      const streaks = page.getByRole('switch', { name: tr('settings.streaks.label') });
      await streaks.click();
      await expect(streaks).toBeChecked();
      await expect(page.getByText(tr('settings.saved')).first()).toBeVisible();
      await capture(page, '/settings/habits', 'streaks on', code, found);
      await go(page, '/today', tr('today.title'));
      await expect(
        page.getByText(strings['today.streak_one'].split('</num>')[1]).first(),
      ).toBeVisible();
      await snap('streaks on');

      await page.context().setOffline(true);
      await checkButton(page, 'Stretch').click();
      await expect(page.getByText(tr('shell.pending_one'))).toBeVisible();
      await snap('offline, change saved on this device');
      await page.context().setOffline(false);
      await expect(page.getByText(tr('shell.pending_one'))).toHaveCount(0, { timeout: 30_000 });

      const water = checkButton(page, 'Wasser');
      for (const habit of [longHabit, 'Stretch', 'Laufen']) {
        const button = checkButton(page, habit);
        if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
        await expect(button).toHaveAttribute('aria-pressed', 'true');
      }
      await water.click();
      await expect(water).toHaveText('2/3');
      await water.click();
      await expect(water).toHaveAttribute('aria-pressed', 'true');
      await expect(
        page.getByText(tr('today.ember.allDone')).locator('visible=true').first(),
      ).toBeVisible();
      await snap('all checked, that is everything');

      await go(page, '/settings/appearance', /./);
      const calm = page.getByRole('switch', { name: tr('settings.calm.label') });
      await calm.click();
      await expect(page.locator('html')).toHaveAttribute('data-calm', '');
      await go(page, '/today', tr('today.title'));
      await expect
        .soft(page.getByText(tr('today.ember.allDone')).locator('visible=true').first())
        .toBeVisible();
      await snap('calm mode on, all checked');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`Habits and routines ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (route: string, state: string, extras = {}) =>
        capture(page, route, state, code, found, extras);
      const name = page.getByLabel(tr('habitFields.name'), { exact: true });
      await begin(page);

      await go(page, '/habits/new', tr('habitNew.title'));
      await expect(page.getByText(tr('habitNew.loading'))).toHaveCount(0);
      await expect(page.getByRole('button', { name: tr('habitNew.scratch') })).toBeVisible();
      await snap('/habits/new', 'template picker');
      await page.getByRole('button', { name: tr('templates.hydration.name') }).click();
      await expect(name).toBeVisible();
      await snap('/habits/new', 'from a template');
      await page.getByRole('button', { name: tr('habitNew.back') }).click();
      await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
      await expect(name).toHaveValue('');
      await snap('/habits/new', 'from scratch');
      await page.getByRole('button', { name: tr('habitNew.create') }).click();
      await expect(page.getByText(tr('habitFields.nameMissing'))).toBeVisible();
      await snap('/habits/new', 'name missing');

      await name.fill(longHabit);
      await page.getByRole('radio', { name: tr('habitFields.frequency.weekly') }).click();
      await page.getByLabel(tr('habitFields.timesPerWeek')).selectOption('3');
      await page.getByLabel(tr('habitFields.reminderTime')).fill('08:30');
      await snap('/habits/new', 'weekly target with reminder');
      await page.getByRole('radio', { name: tr('habitFields.frequency.weekdays') }).click();
      await expect(page.getByText(tr('habitFields.whichDays'))).toBeVisible();
      await snap('/habits/new', 'set days');
      await page.getByRole('radio', { name: tr('habitFields.frequency.daily') }).click();
      await page.getByLabel(tr('habitFields.timesPerDay')).selectOption('3');
      await page.locator('input[type="time"]').first().fill('08:00');
      await page.getByRole('button', { name: tr('habitFields.addTime') }).click();
      await snap('/habits/new', 'times a day with reminder times');
      await page.getByRole('button', { name: tr('habitNew.create') }).click();
      await expect(page).toHaveURL(/\/today$/);
      await makeHabit(page, 'Stretch');

      await page
        .getByRole('link', { name: tr('today.edit', { name: longHabit }) })
        .first()
        .click();
      await expect(name).toHaveValue(longHabit);
      await snap('/habits/:id/edit', 'normal, with pause controls');
      await name.fill(`${longHabit}!`);
      await page.getByRole('button', { name: tr('habitEdit.save') }).click();
      await expect(page.getByText(tr('habitEdit.saved')).first()).toBeVisible();
      await snap('/habits/:id/edit', 'saved');
      const today = await localToday(page);
      await page.getByLabel(tr('habitEdit.pauseUntil')).fill(addDays(today, 4));
      await page.getByRole('button', { name: tr('habitEdit.pauseHabit') }).click();
      await expect(page.getByRole('button', { name: tr('habitEdit.resume') })).toBeVisible();
      await snap('/habits/:id/edit', 'paused');
      await page.getByRole('button', { name: tr('habitEdit.resume') }).click();
      await expect(page.getByRole('button', { name: tr('habitEdit.pauseHabit') })).toBeVisible();
      await page.getByRole('button', { name: tr('habitEdit.delete') }).click();
      await expect(
        page.getByText(tr('habitEdit.deleteQuestion', { name: `${longHabit}!` })),
      ).toBeVisible();
      await snap('/habits/:id/edit', 'delete confirm');

      await go(page, '/routines', tr('routines.title'));
      await expect(page.getByText(tr('routines.empty.title'))).toBeVisible();
      await snap('/routines', 'empty');
      await go(page, '/routines/new');
      await page.getByRole('button', { name: tr('routine.create') }).click();
      await expect(page.getByText(tr('routine.nameMissing'))).toBeVisible();
      await name.fill(longRoutine);
      await page
        .getByRole('button', { name: tr('routine.habits.addOne', { name: 'Stretch' }) })
        .click();
      await page
        .getByRole('button', { name: tr('routine.habits.addOne', { name: `${longHabit}!` }) })
        .click();
      await page.locator('input[type="time"]').first().fill('07:15');
      await snap('/routines/new', 'filled');
      await page.getByRole('button', { name: tr('routine.create') }).click();
      await expect(page).toHaveURL(/\/routines$/);
      await expect(page.getByRole('heading', { name: longRoutine })).toBeVisible();
      await snap('/routines', 'with a routine');
      await go(page, '/today', tr('today.title'));
      await snap('/today', 'with a routine group', { big: true });

      await go(page, '/routines');
      await page
        .getByRole('link', {
          name: tr('today.edit', { name: tr('routine.title', { name: longRoutine }) }),
        })
        .click();
      await expect(name).toHaveValue(longRoutine);
      await snap('/routines/:id/edit', 'edit');
      await page.getByRole('button', { name: tr('routine.delete') }).click();
      await expect(
        page.getByText(tr('routine.deleteQuestion', { name: longRoutine })),
      ).toBeVisible();
      await snap('/routines/:id/edit', 'delete confirm');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`History, year and Your moments ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (route: string, state: string, extras = {}) =>
        capture(page, route, state, code, found, extras);
      await createWebUser(page);
      await setAccountLanguage(page, code);
      await makeHabit(page, longHabit);

      await go(page, '/moments', tr('title.moments'));
      await expect(page.getByText(tr('moments.needsPrivate'))).toBeVisible();
      await snap('/moments', 'no private journal');

      await setAccountLanguage(page, 'en');
      await enableRememberedJournal(page);
      await setAccountLanguage(page, code);
      await go(page, '/moments', tr('title.moments'));
      await expect(page.getByText(tr('moments.empty.title'))).toBeVisible();
      await snap('/moments', 'unlocked, none');

      await setAccountLanguage(page, 'en');
      await page.goto('/today');
      await saveMoment(page);
      await page.getByRole('link', { name: 'See your moments' }).click();
      await page.getByRole('button', { name: 'Add to What helps me: “Slow breathing”' }).click();
      await expect(page.getByText('In What helps me')).toBeVisible();
      await setAccountLanguage(page, code);
      await go(page, '/moments', tr('title.moments'));
      await expect(page.getByText(reflectionTrigger)).toBeVisible();
      await snap('/moments', 'one moment');

      await makeHabit(page, 'Stretch');
      await page.getByRole('radio', { name: tr('moods.good') }).click();
      await expect(
        page.getByRole('status').filter({ hasText: tr('journal.status.mood') }),
      ).toBeVisible();
      await go(page, '/today', tr('today.title'));
      await snap('/today', 'moment note and mood', { big: true });

      await go(page, '/history', tr('history.title'));
      await expect(page.locator('#habit-picker')).toBeVisible();
      await snap('/history', 'month, all habits');
      const today = await localToday(page);
      await page.locator(`#day-${today}`).click();
      await expect(page.locator('#day-panel')).toHaveCSS('opacity', '1');
      await expect(page.getByRole('link', { name: tr('journal.yourMoments') })).toBeVisible();
      await snap('/history', 'day panel with note, mood and Your moments link', { big: true });

      await go(page, '/history/year', tr('year.title'));
      await snap('/history/year', 'all habits');
      await page.locator('#year-habit').selectOption({ label: 'Stretch' });
      await expect(page.getByText(tr('year.lede'))).toBeVisible();
      await snap('/history/year', 'one habit');

      await page
        .getByRole('banner')
        .getByRole('link', { name: tr('nav.settings') })
        .click();
      await page
        .getByRole('link', { name: new RegExp(`^${tr('settings.group.privacy')}`) })
        .first()
        .click();
      await page.getByRole('button', { name: tr('journalSettings.lock') }).click();
      await expect(page.getByText(tr('journalSettings.locked'))).toBeVisible();
      await go(page, '/moments', tr('title.moments'));
      await expect(page.getByText(tr('moments.locked'))).toBeVisible();
      await snap('/moments', 'locked');
      await go(page, '/today', tr('today.title'));
      await expect(page.getByText(tr('journal.locked'))).toBeVisible();
      await snap('/today', 'journal locked');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`History backfill and paused days ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (route: string, state: string, extras = {}) =>
        capture(page, route, state, code, found, extras);
      const discordId = uniqueDiscordId();
      const machineToday = new Date().toISOString().slice(0, 10);
      await seedBotOnlyUserWithStart(page.request, discordId, addDays(machineToday, -40));
      await nextDiscordId(page.request, discordId);
      await page.goto('/login');
      await page.getByRole('link', { name: 'Sign in with Discord' }).click();
      await agreeToConsentIfAsked(page);
      await setAccountLanguage(page, code);
      await makeHabit(page, longHabit);

      const today = await localToday(page);
      await go(page, '/history', tr('history.title'));
      await snap('/history', 'month, open days');
      await setDay(page, addDays(today, -1), 'day.done', 'done');
      await setDay(page, addDays(today, -2), 'day.lowDayOn', 'lowday');
      await setDay(page, addDays(today, -3), 'day.notDone', 'notdone');
      await setDay(page, addDays(today, -4), 'day.done', 'done');
      await openDay(page, addDays(today, -1));
      await page.getByRole('radio', { name: tr('moods.great') }).click();
      await page
        .getByLabel(tr('journal.fewWords'))
        .fill('Ein ruhiger Tag, nachgetragen am nächsten Morgen.');
      await page.getByRole('button', { name: tr('journal.save'), exact: true }).click();
      await expect(
        page.getByRole('status').filter({ hasText: tr('journal.status.saved') }),
      ).toBeVisible();
      await snap('/history', 'day panel with note and mood', { big: true });

      await openDay(page, addDays(today, -10));
      await snap('/history', 'backfilling an older day', { big: true });
      await setDay(page, addDays(today, -10), 'day.done', 'done');
      await page.reload();
      await ready(page, tr('history.title'));
      await snap('/history', 'month, all habits with done, low and open days');

      const options = await page.locator('#habit-picker option').evaluateAll((list) =>
        list.map((option) => ({
          value: (option as HTMLOptionElement).value,
          label: option.textContent ?? '',
        })),
      );
      const seeded = options.find((option) => option.label !== longHabit);
      if (seeded) await page.locator('#habit-picker').selectOption(seeded.value);
      await expect(page.locator('#habit-picker')).toHaveValue(seeded?.value ?? options[0].value);
      await snap('/history', 'month, one habit');

      await go(page, '/today', tr('today.title'));
      await page
        .getByRole('link', { name: tr('today.edit', { name: seeded?.label ?? longHabit }) })
        .click();
      await page.getByLabel(tr('habitEdit.pauseUntil')).fill(addDays(today, 3));
      await page.getByRole('button', { name: tr('habitEdit.pauseHabit') }).click();
      await expect(page.getByRole('button', { name: tr('habitEdit.resume') })).toBeVisible();
      await go(page, '/history', tr('history.title'));
      if (seeded) await page.locator('#habit-picker').selectOption(seeded.value);
      await snap('/history', 'month, one habit, paused');
      await go(page, '/history/year', tr('year.title'));
      await snap('/history/year', 'all habits');
      if (seeded) await page.locator('#year-habit').selectOption(seeded.value);
      await snap('/history/year', 'one habit');
      await page.locator('[data-date]').first().click();
      await snap('/history/year', 'a day open');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`Settings account, reminders, habits, appearance ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (route: string, state: string, extras = {}) =>
        capture(page, route, state, code, found, extras);
      const email = await createWebUser(page);
      await setAccountLanguage(page, code);
      await makeHabit(page, 'Stretch');

      await go(page, '/settings');
      await snap('/settings', 'index');

      await go(page, '/settings/account', /./);
      await snap('/settings/account', 'cards');
      await page.getByRole('button', { name: tr('settings.account.changePassword') }).click();
      await expect(page.getByText(tr('settings.account.passwordSent', { email }))).toBeVisible();
      await snap('/settings/account', 'password link sent');
      await page.getByRole('button', { name: tr('settings.account.everywhere') }).click();
      await expect(page.getByText(tr('settings.account.everywhereConfirm'))).toBeVisible();
      await snap('/settings/account', 'sign out everywhere confirm');
      await page
        .getByRole('button', { name: tr('settings.cancel') })
        .first()
        .click();
      await page.getByRole('button', { name: tr('settings.discord.link') }).click();
      await expect(page.getByText(tr('settings.discord.passwordHint'))).toBeVisible();
      await snap('/settings/account', 'link Discord password step');
      await page
        .getByRole('button', { name: tr('settings.cancel') })
        .first()
        .click();

      const two = page.getByRole('region', { name: tr('settings.card.twoFactor') });
      await two.getByRole('button', { name: tr('twoFactor.setUp') }).click();
      await expect(two.getByRole('img', { name: tr('twoFactor.setup.qrLabel') })).toBeVisible();
      await snap('/settings/account', 'two-step setup, QR and code entry');
      await two.getByLabel(tr('twoFactor.code.label')).fill('12');
      await two.getByLabel(tr('settings.yourPassword'), { exact: true }).fill(SECRET);
      await two.getByRole('button', { name: tr('twoFactor.turnOn') }).click();
      await expect(two.getByText(tr('twoFactor.code.invalid'))).toBeVisible();
      await snap('/settings/account', 'two-step setup, code error');
      await two.getByLabel(tr('twoFactor.code.label')).fill(await freshTotp(page.request, email));
      await two.getByRole('button', { name: tr('twoFactor.turnOn') }).click();
      const list = two.getByRole('list', { name: tr('twoFactor.codes.listLabel') });
      await expect(list).toBeVisible();
      await snap('/settings/account', 'two-step recovery codes');
      await two.getByRole('button', { name: tr('twoFactor.codes.saved') }).click();
      await expect(two.getByText(tr('twoFactor.on'))).toBeVisible();
      await snap('/settings/account', 'two-step on');

      await go(page, '/settings/reminders', /./);
      await snap('/settings/reminders', 'cards');
      const second = page.getByRole('combobox', { name: tr('settings.card.secondReminder') });
      if (await second.count()) {
        await second.selectOption('30');
        await expect(page.getByText(tr('settings.saved')).first()).toBeVisible();
        await snap('/settings/reminders', 'second reminder on');
      }
      const names = page.getByRole('switch', { name: tr('settings.reminderNames.label') });
      if (await names.count()) {
        await names.click();
        await expect(names).toBeChecked();
        await snap('/settings/reminders', 'habit names in reminders on');
      }

      await go(page, '/settings/habits', /./);
      await snap('/settings/habits', 'cards, streaks off');
      const streaks = page.getByRole('switch', { name: tr('settings.streaks.label') });
      await streaks.click();
      await expect(streaks).toBeChecked();
      await page.getByRole('combobox', { name: tr('settings.grace.label') }).selectOption('2');
      await expect(page.getByText(tr('settings.saved')).first()).toBeVisible();
      await snap('/settings/habits', 'streaks on, two grace days');
      await streaks.click();
      await expect(streaks).not.toBeChecked();
      await snap('/settings/habits', 'streaks off again');

      await go(page, '/settings/appearance', /./);
      await snap('/settings/appearance', 'cards', { themes: true });
      await page.locator('#theme-fieldnotes').click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'fieldnotes');
      await snap('/settings/appearance', 'theme picked: fieldnotes');
      await page.locator('#theme-hearthlight').click();
      await page.locator('#color-scheme-dark').click();
      await expect(page.locator('html')).toHaveClass(/dark/);
      await snap('/settings/appearance', 'colour scheme dark');
      await page.locator('#color-scheme-system').click();
      const calm = page.getByRole('switch', { name: tr('settings.calm.label') });
      await calm.click();
      await expect(page.locator('html')).toHaveAttribute('data-calm', '');
      await snap('/settings/appearance', 'calm mode on');
      await calm.click();
      await expect(page.locator('html')).not.toHaveAttribute('data-calm', '');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`Settings privacy, journal, What helps me ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (state: string, extras = {}) =>
        capture(page, '/settings/privacy', state, code, found, extras);
      await createWebUser(page);
      await setAccountLanguage(page, code);
      await go(page, '/settings/privacy', /./);
      const journal = page.getByRole('region', { name: tr('settings.card.journal') });
      const helps = page.getByRole('region', { name: tr('settings.card.helps') });
      const passphrase = newPassphrase();
      const unlock = () =>
        journal.getByRole('button', { name: tr('journalSettings.unlock.submit'), exact: true });
      const field = (label: string) => journal.getByLabel(tr(label), { exact: true });

      await expect(page.getByText(tr('helps.needsPrivate'))).toBeVisible();
      await snap('journal off, What helps me needs it');
      await field('journalSettings.passphrase.label').fill('short');
      await field('journalSettings.passphrase.again').fill('other');
      await journal.getByRole('button', { name: tr('journalSettings.turnOn') }).click();
      await expect(journal.getByText(tr('journalSettings.passphrase.short'))).toBeVisible();
      await snap('journal setup, validation errors');
      await field('journalSettings.passphrase.label').fill(passphrase);
      await field('journalSettings.passphrase.again').fill(passphrase);
      await field('journalSettings.loginPassword.label').fill(SECRET);
      await journal.getByRole('button', { name: tr('journalSettings.turnOn') }).click();
      await expect(journal.locator('code')).toBeVisible();
      await snap('journal recovery code step');
      await journal.getByLabel(tr('journalSettings.recoveryStep.saved')).check();
      await journal
        .getByRole('button', { name: tr('journalSettings.recoveryStep.finish') })
        .click();
      await expect(
        journal.getByRole('status').filter({ hasText: tr('journalSettings.ready') }),
      ).toBeVisible();
      await snap('journal unlocked, What helps me empty');

      await helps.getByLabel(tr('helps.new')).fill(longHelp);
      await helps.getByRole('button', { name: tr('helps.add'), exact: true }).click();
      await expect(helps.getByText(longHelp, { exact: true })).toBeVisible();
      await snap('What helps me, one long item');
      await helps.getByRole('button', { name: tr('helps.editLabel', { text: longHelp }) }).click();
      await snap('What helps me, editing');
      await helps.getByRole('button', { name: tr('helps.cancel') }).click();
      for (const text of ['Tee kochen', 'Anruf bei einer Freundin']) {
        await helps.getByLabel(tr('helps.new')).fill(text);
        await helps.getByRole('button', { name: tr('helps.add'), exact: true }).click();
        await expect(helps.getByText(text, { exact: true })).toBeVisible();
      }
      await expect(
        helps.getByRole('button', { name: tr('helps.down', { text: longHelp }) }),
      ).toBeVisible();
      await helps.getByRole('button', { name: tr('helps.down', { text: longHelp }) }).click();
      await expect(
        page.getByText(tr('helps.moved', { text: longHelp, position: '2', total: '3' })),
      ).toBeVisible();
      await snap('What helps me, three items with reorder controls');
      for (let n = 4; n <= 20; n++) {
        await helps.getByLabel(tr('helps.new')).fill(`Etwas, das hilft, Nummer ${n}`);
        await helps.getByRole('button', { name: tr('helps.add'), exact: true }).click();
        await expect(
          helps.getByText(`Etwas, das hilft, Nummer ${n}`, { exact: true }),
        ).toBeVisible();
      }
      await expect(helps.getByText(tr('helps.full', { max: '20' }))).toBeVisible();
      await snap('What helps me, the 20th item and the limit message');

      await journal.getByRole('button', { name: tr('journalSettings.changePassphrase') }).click();
      await snap('journal change passphrase form');
      await journal.getByRole('button', { name: tr('settings.cancel') }).click();
      await journal.getByRole('button', { name: tr('journalSettings.lock') }).click();
      await expect(journal.getByText(tr('journalSettings.locked'))).toBeVisible();
      await snap('journal locked, unlock form');
      await field('journalSettings.passphrase.label').fill('falsch falsch falsch');
      await unlock().click();
      await expect(journal.getByText(tr('journalSettings.passphrase.wrong'))).toBeVisible();
      await snap('journal locked, wrong passphrase');
      await journal.getByRole('button', { name: tr('journalSettings.unlock.useRecovery') }).click();
      await snap('journal locked, recovery code form');
      await journal
        .getByRole('button', { name: tr('journalSettings.unlock.usePassphrase') })
        .click();
      await field('journalSettings.passphrase.label').fill(passphrase);
      await unlock().click();
      await expect(
        journal.getByRole('status').filter({ hasText: tr('journalSettings.unlockedDone') }),
      ).toBeVisible();

      await journal.getByRole('button', { name: tr('journalSettings.turnOff') }).click();
      await expect(journal.getByText(tr('journalSettings.disableText'))).toBeVisible();
      await snap('journal turn off confirmation');
      await journal.getByRole('button', { name: tr('settings.cancel') }).click();

      await go(page, '/settings/privacy', /./);
      await snap('journal locked after reload, What helps me locked');
      const exportCard = page.getByRole('region', { name: tr('settings.card.export') });
      await expect(
        exportCard.getByRole('button', { name: tr('export.download', { format: 'JSON' }) }),
      ).toBeVisible();
      await snap('export buttons');
      const remove = page.getByRole('region', { name: tr('settings.card.deleteAccount') });
      await remove.getByLabel(tr('settings.delete.confirmLabel')).fill('DEL');
      await snap('delete account confirmation, typed');
      expect(reviewVerdict(found)).toEqual([]);
    });

    test(`Other pages and dialogs ${code}`, async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const snap = (route: string, state: string, extras = {}) =>
        capture(page, route, state, code, found, extras);
      const discordId = uniqueDiscordId();
      await seedBotOnlyUser(page.request, discordId);
      await begin(page);
      await makeHabit(page, longHabit);

      await go(page, '/feedback', tr('title.feedback'));
      await snap('/feedback', 'signed in');
      await page.getByRole('button', { name: tr('feedback.send'), exact: true }).click();
      await snap('/feedback', 'signed in, empty submit');
      await page.getByLabel(tr('feedback.title.label')).fill('Synthetic title');
      await page
        .getByLabel(tr('feedback.description.label'))
        .fill('Synthetic description, '.repeat(20));
      await snap('/feedback', 'signed in, filled');

      await go(page, '/whats-new', tr('whatsNew.title'));
      await snap('/whats-new', 'list');
      await go(page, '/download', /./);
      await snap('/download', 'signed in');
      await go(page, '/help', tr('title.help'));
      await snap('/help', 'signed in');
      await go(page, '/no-such-page', tr('notFound.title'));
      await snap('/no-such-page', 'signed in');

      await go(page, '/settings/account', /./);
      await nextDiscordId(page.request, discordId);
      await page.getByRole('button', { name: tr('settings.discord.link') }).click();
      await page.getByLabel(tr('settings.yourPassword'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('settings.discord.continue') }).click();
      await expect(page).toHaveURL(/\/link\/merge$/);
      await ready(page, tr('linkMerge.title'));
      await expect(page.getByRole('list', { name: tr('linkMerge.habitsLabel') })).toBeVisible();
      await snap('/link/merge', 'habits to move');
      expect(reviewVerdict(found)).toEqual([]);
    });
  });
}
