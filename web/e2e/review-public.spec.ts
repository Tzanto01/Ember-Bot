import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import {
  createHabit,
  createWebUser,
  setAccountLanguage,
  SECRET,
  uniqueEmail,
} from './support/accounts';
import { signUpAndConfirmLocalized } from './support/extras';
import { languages, translator } from './support/locales';
import { findOutboxLink } from './support/outbox';
import { capture, reviewFull, reviewVerdict } from './support/review';
import { enableJournal, enableTwoFactor, newPassphrase, signOut } from './support/security';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

interface PracticeStep {
  kind: 'text' | 'breath' | 'timer';
}
interface PracticeContent {
  id: string;
  title: string;
  steps: PracticeStep[];
}

function practicesIn(code: string): PracticeContent[] {
  return JSON.parse(
    readFileSync(new URL(`../src/content/practices.${code}.json`, import.meta.url), 'utf8'),
  );
}

const timeout = reviewFull ? 3_600_000 : 300_000;
const big = { big: true };

for (const { code, locale, strings } of languages) {
  const tr = translator(strings);
  const practices = practicesIn(code);

  async function visit(
    page: Page,
    path: string,
    ready: RegExp | string | null,
    state: string,
    found: string[],
  ): Promise<void> {
    await page.goto(path);
    await expect(
      ready ? page.getByRole('heading', { name: ready }).first() : page.locator('#main'),
    ).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await capture(page, path.split('?')[0]!, state, code, found);
  }

  const heading = (page: Page, name: RegExp | string) =>
    page.getByRole('heading', { name }).first();
  const press = (page: Page, name: string) =>
    page.getByRole('button', { name, exact: true }).click();

  /** The "Too much / overloaded" tile, named with a comma (current build) or a slash (older build). */
  const tile = (page: Page) =>
    page
      .getByRole('button', {
        name: new RegExp(
          `^${tr('moment.tile.overloaded')
            .split(' / ')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('(?:, | / )')}$`,
        ),
      })
      .click();

  /** From Catch: name a state, pick an intensity and skip the practice, to land on Reflect. */
  async function walkToReflect(page: Page): Promise<void> {
    await press(page, tr('moment.catch.name'));
    await tile(page);
    await page.getByRole('radio', { name: tr('moment.intensity.4'), exact: true }).check();
    await press(page, tr('moment.continue'));
    await press(page, tr('moment.skipPractice'));
    await press(page, tr('moment.skip'));
    await press(page, tr('moment.reflect'));
    await expect(heading(page, tr('moment.reflect.heading'))).toBeVisible();
  }

  test.describe(`review public ${code}, signed out`, () => {
    test.use({ locale });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('ember.language', value), code);
    });

    test('public pages and their states', async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];

      await visit(page, '/', /./, 'landing', found);
      await visit(page, '/login', tr('login.title'), 'form', found);
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(uniqueEmail());
      await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('login.submit'), exact: true }).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await capture(page, '/login', 'wrong password', code, found);

      await visit(
        page,
        '/login?reason=offline',
        tr('login.offline.title'),
        'offline notice',
        found,
      );
      await visit(page, '/login?reason=session', tr('login.title'), 'session ended', found);

      await visit(page, '/signup', tr('signup.title'), 'form', found);
      const email = uniqueEmail();
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(email);
      await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('signup.submit') }).click();
      await expect(heading(page, tr('signup.sent.title'))).toBeVisible();
      await capture(page, '/signup', 'check your inbox', code, found);

      await page.goto('/confirm-email');
      await expect(heading(page, tr('confirm.code.title'))).toBeVisible();
      await capture(page, '/confirm-email', 'code entry', code, found);
      await page.getByLabel(tr('auth.code.label')).fill('000000');
      await expect(page.getByRole('alert').first()).toBeVisible();
      await capture(page, '/confirm-email', 'code rejected', code, found);

      await visit(page, '/forgot-password', tr('forgot.title'), 'form', found);
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(uniqueEmail());
      await page.route('**/api/auth/forgotPassword', (route) =>
        route.fulfill({
          status: 500,
          contentType: 'application/problem+json',
          body: JSON.stringify({ status: 500, title: 'Server error' }),
        }),
      );
      await page.getByRole('button', { name: tr('forgot.submit') }).click();
      await expect(page.getByText(tr('errors.server'))).toBeVisible();
      await capture(page, '/forgot-password', 'server error notice (stubbed 500)', code, found);
      await page.unroute('**/api/auth/forgotPassword');
      await page.getByRole('button', { name: tr('forgot.submit') }).click();
      await expect(heading(page, tr('forgot.sent.title'))).toBeVisible();
      await capture(page, '/forgot-password', 'sent', code, found);

      await visit(page, '/reset-password', tr('reset.incomplete.title'), 'incomplete link', found);
      await visit(
        page,
        '/reset-password?email=dummy%40example.test&code=000000',
        tr('reset.title'),
        'form',
        found,
      );
      await page.getByLabel(tr('reset.newPassword'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('reset.submit') }).click();
      await expect(
        page
          .getByRole('alert')
          .or(page.getByRole('status').filter({ hasText: /./ }))
          .first(),
      ).toBeVisible();
      await capture(page, '/reset-password', 'rejected code', code, found);

      await visit(page, '/local', tr('local.start.title'), 'start', found);
      await visit(page, '/about', tr('title.about'), 'page', found);
      await visit(page, '/feedback', tr('title.feedback'), 'empty', found);
      await page.getByLabel(tr('feedback.title.label'), { exact: true }).fill('Synthetic');
      await page
        .getByLabel(tr('feedback.description.label'), { exact: true })
        .fill('Synthetic feedback from the visual review.');
      await page.getByRole('button', { name: tr('feedback.send'), exact: true }).click();
      const outcome = page
        .getByText(tr('feedback.sent.heading'))
        .or(page.getByText(tr('feedback.tooMany')));
      await expect(outcome).toBeVisible();
      await capture(
        page,
        '/feedback',
        (await page.getByText(tr('feedback.sent.heading')).isVisible()) ? 'sent' : 'rate limited',
        code,
        found,
      );
      await visit(page, '/download', /./, 'page', found);
      await visit(page, '/legal/privacy', /./, 'page', found);
      await visit(page, '/legal/terms', /./, 'page', found);
      await visit(page, '/legal/imprint', /./, 'page', found);
      await visit(page, '/help', tr('title.help'), 'page', found);
      await visit(page, '/no-such-page', tr('notFound.title'), '404', found);

      expect(reviewVerdict(found)).toEqual([]);
    });

    test('consent before agreeing, and Reflect without consent', async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      await signUpAndConfirmLocalized(page, tr);
      await expect(page.locator('html')).toHaveAttribute('lang', code);
      await capture(page, '/consent', 'before consent', code, found);
      await page.goto('/moment');
      await expect(heading(page, tr('moment.catch.heading'))).toBeVisible();
      await walkToReflect(page);
      await expect(page.getByText(tr('moment.reflect.needsConsent'))).toBeVisible();
      await capture(page, '/moment', 'reflect consent not given', code, found, big);
      expect(reviewVerdict(found)).toEqual([]);
    });

    test('the moment flow', async ({ page }) => {
      test.setTimeout(timeout);
      const found: string[] = [];
      const lines = page.getByRole('list', { name: tr('crisis.list') });
      const urgent = async (state: string) => {
        await press(page, tr('moment.urgentHelp'));
        await expect(lines).toBeVisible();
        await capture(page, '/moment', state, code, found, big);
        await press(page, tr('moment.urgentHelp'));
      };
      const step = async (practice: PracticeContent, index: number) =>
        expect(
          page.getByText(
            tr('moment.stepOf', {
              title: practice.title,
              step: String(index + 1),
              total: String(practice.steps.length),
            }),
          ),
        ).toBeVisible();

      await page.goto('/moment');
      await expect(heading(page, tr('moment.catch.heading'))).toBeVisible();
      await capture(page, '/moment', 'catch', code, found, { themes: true, big: true });
      await urgent('catch urgent help open');

      await press(page, tr('moment.catch.name'));
      await expect(heading(page, tr('moment.name.heading'))).toBeVisible();
      await capture(page, '/moment', 'name', code, found, big);
      await tile(page);
      await expect(heading(page, tr('moment.intensity.heading'))).toBeVisible();
      await page.getByRole('radio', { name: tr('moment.intensity.4'), exact: true }).check();
      await capture(page, '/moment', 'intensity', code, found, big);
      await press(page, tr('moment.continue'));

      const seen: string[] = [];
      for (let round = 0; round < practices.length; round++) {
        const current = () =>
          page
            .locator('#moment-heading')
            .innerText()
            .then((text) => practices.find((p) => text.includes(p.title))?.title ?? '');
        await expect.poll(current, { message: 'a practice step is showing' }).not.toBe('');
        const title = await current();
        const practice = practices.find((p) => p.title === title)!;
        expect(seen).not.toContain(practice.id);
        seen.push(practice.id);
        await step(practice, 0);
        await capture(page, '/moment', `practice ${practice.id} step 1`, code, found, big);
        if (round === 0) await urgent('practice step urgent help open');

        for (let index = 1; index < practice.steps.length; index++) {
          await page
            .getByRole('button', { name: tr('moment.next'), exact: true })
            .last()
            .click();
          await step(practice, index);
          const kind = practice.steps[index]!.kind;
          if (kind === 'text') continue;
          await capture(page, '/moment', `${practice.id} ${kind} idle`, code, found, big);
          await press(page, tr('moment.start'));
          await expect(
            page.getByRole('button', { name: tr('moment.pause'), exact: true }),
          ).toBeVisible();
          await capture(page, '/moment', `${practice.id} ${kind} running`, code, found, big);
          await press(page, tr('moment.pause'));
        }
        if (round < practices.length - 1) {
          await press(page, tr('moment.tryAnother'));
          await expect(page.locator('#moment-heading')).not.toContainText(title);
        }
      }
      expect(seen.sort()).toEqual(practices.map((p) => p.id).sort());

      await press(page, tr('moment.finish'));
      await expect(heading(page, tr('moment.after.heading'))).toBeVisible();
      await page.getByRole('radio', { name: tr('moment.intensity.2'), exact: true }).check();
      await capture(page, '/moment', 'how is it now', code, found, big);
      await press(page, tr('moment.continue'));
      await expect(heading(page, tr('moment.end.heading'))).toBeVisible();
      await capture(page, '/moment', 'end', code, found, big);
      await press(page, tr('moment.reflect'));
      await expect(heading(page, tr('moment.reflect.heading'))).toBeVisible();
      await expect(page.getByText(tr('moment.reflect.notSaved'))).toBeVisible();
      await capture(page, '/moment', 'reflect signed out', code, found, big);
      await urgent('reflect urgent help open');
      await page.getByLabel(tr('moment.reflect.setItOff')).fill('Synthetic');
      await press(page, tr('moment.leave'));
      await expect(page.getByRole('group', { name: tr('moment.leaveDraft') })).toBeVisible();
      await capture(page, '/moment', 'reflect leave confirm', code, found, big);
      expect(reviewVerdict(found)).toEqual([]);
    });
  });

  test.describe(`review public ${code}, account`, () => {
    test('login two-step code step', async ({ page }) => {
      test.setTimeout(reviewFull ? timeout : 90_000);
      const found: string[] = [];
      const account = await createWebUser(page);
      await setAccountLanguage(page, 'en');
      await enableTwoFactor(page, account);
      await signOut(page);
      await page.evaluate((value) => localStorage.setItem('ember.language', value), code);
      await page.goto('/login');
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(account);
      await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('login.submit'), exact: true }).click();
      await expect(heading(page, tr('login.twoFactor.title'))).toBeVisible();
      await capture(page, '/login', 'two-step code', code, found);
      await page.getByLabel(tr('login.twoFactor.codeLabel')).fill('000000');
      await page.getByRole('button', { name: tr('login.submit'), exact: true }).click();
      await expect(page.getByRole('alert').first()).toBeVisible();
      await capture(page, '/login', 'two-step code rejected', code, found);
      await page.getByRole('button', { name: tr('login.twoFactor.useRecovery') }).click();
      await expect(page.getByLabel(tr('login.twoFactor.recoveryLabel'))).toBeVisible();
      await capture(page, '/login', 'two-step recovery code', code, found);
      expect(reviewVerdict(found)).toEqual([]);
    });

    test('Reflect with an account, feedback with pictures and an offline check-in', async ({
      page,
      context,
    }) => {
      test.setTimeout(reviewFull ? timeout : 90_000);
      const found: string[] = [];
      await createWebUser(page);
      await createHabit(page, 'Stretch');
      await setAccountLanguage(page, code);

      await page.goto('/moment');
      await expect(heading(page, tr('moment.catch.heading'))).toBeVisible();
      await walkToReflect(page);
      await expect(page.getByText(tr('moment.reflect.needsPrivate'))).toBeVisible();
      await capture(page, '/moment', 'reflect plain journal', code, found, big);

      await setAccountLanguage(page, 'en');
      const passphrase = newPassphrase();
      await enableJournal(page, passphrase);
      await setAccountLanguage(page, code);
      await page.goto('/moment');
      await expect(heading(page, tr('moment.catch.heading'))).toBeVisible();
      await walkToReflect(page);
      await expect(page.getByText(tr('moment.reflect.savesAfterUnlock'))).toBeVisible();
      await capture(page, '/moment', 'reflect journal locked', code, found, big);
      await page
        .getByLabel(tr('journalSettings.passphrase.label'), { exact: true })
        .fill('wrong passphrase');
      await press(page, tr('journalSettings.unlock.submit'));
      await expect(page.getByText(tr('journalSettings.passphrase.wrong'))).toBeVisible();
      await capture(page, '/moment', 'reflect unlock rejected', code, found, big);
      await page
        .getByLabel(tr('journalSettings.passphrase.label'), { exact: true })
        .fill(passphrase);
      await press(page, tr('journalSettings.unlock.submit'));
      await expect(
        page.getByRole('button', { name: tr('moment.reflect.save'), exact: true }),
      ).toBeVisible();
      await capture(page, '/moment', 'reflect journal unlocked', code, found, big);
      await page
        .getByLabel(tr('moment.reflect.setItOff'))
        .fill('Synthetic trigger: a long meeting');
      await press(page, tr('moment.reflect.save'));
      await expect(page.getByText(tr('moment.reflect.saved'))).toBeVisible();
      await capture(page, '/moment', 'reflect saved', code, found, big);

      await page.goto('/settings/feedback');
      await expect(heading(page, /./)).toBeVisible();
      await capture(page, '/settings/feedback', 'signed in empty', code, found);
      await page.locator('input[type=file]').setInputFiles([
        { name: 'one.png', mimeType: 'image/png', buffer: png },
        { name: 'two.png', mimeType: 'image/png', buffer: png },
      ]);
      const thumbnails = page
        .getByRole('list', { name: tr('feedback.pictures.list') })
        .locator('img');
      await expect(thumbnails).toHaveCount(2);
      for (const thumbnail of await thumbnails.all())
        await expect
          .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
          .toBeGreaterThan(0);
      await page.getByLabel(tr('feedback.title.label'), { exact: true }).fill('Synthetic pictures');
      await page
        .getByLabel(tr('feedback.description.label'), { exact: true })
        .fill('Synthetic feedback with pictures from the visual review.');
      await capture(page, '/settings/feedback', 'with 2 pictures', code, found);
      await page.getByRole('button', { name: tr('feedback.send'), exact: true }).click();
      const outcome = page
        .getByText(tr('feedback.sent.heading'))
        .or(page.getByText(tr('feedback.tooManyPictures')));
      await expect(outcome).toBeVisible();
      await capture(
        page,
        '/settings/feedback',
        (await page.getByText(tr('feedback.sent.heading')).isVisible())
          ? 'signed in sent'
          : 'signed in rate limited',
        code,
        found,
      );

      await page.goto('/today');
      const checkIn = page.getByRole('button', { name: tr('today.checkIn', { name: 'Stretch' }) });
      await expect(checkIn).toBeVisible();
      await context.setOffline(true);
      await checkIn.click();
      await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
      await expect(page.getByText(tr('shell.pending_one'))).toBeVisible();
      await capture(page, '/today', 'offline notice (change saved on device)', code, found);
      await context.setOffline(false);
      await expect(page.getByText(tr('shell.pending_one'))).toBeHidden();
      expect(reviewVerdict(found)).toEqual([]);
    });
  });

  test.describe(`review public ${code}, no-account mode`, () => {
    test.use({ locale });
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('ember.language', value), code);
    });

    test('Today, Settings, Your moments and Keep your data', async ({ page }) => {
      test.setTimeout(reviewFull ? timeout : 90_000);
      const found: string[] = [];
      const addHabit = async (name: string) => {
        await page.goto('/habits/new');
        await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
        await page.getByLabel(tr('habitFields.name'), { exact: true }).fill(name);
        await page.getByRole('button', { name: tr('habitNew.create') }).click();
        await expect(page).toHaveURL(/\/today$/);
        await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
      };

      await page.goto('/local');
      await page.getByRole('button', { name: tr('local.start.button') }).click();
      await expect(
        page.getByRole('heading', { name: tr('today.title'), exact: true }),
      ).toBeVisible();
      await capture(page, '/today', 'no account empty', code, found);

      await addHabit('Stretch');
      await capture(page, '/today', 'no account one habit', code, found);
      await addHabit('Journal');
      const checkIn = page.getByRole('button', { name: tr('today.checkIn', { name: 'Stretch' }) });
      await checkIn.click();
      await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
      await capture(page, '/today', 'no account two habits one checked', code, found);

      await page.getByLabel(tr('journal.fewWords')).fill('Synthetic note');
      await page.getByRole('button', { name: tr('journal.save'), exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: /./ }).first()).toBeVisible();

      await page.goto('/settings');
      await expect(page.locator('#main')).toBeVisible();
      await capture(page, '/settings', 'no account groups', code, found);
      const hrefs = await page
        .locator('#main a[href^="/settings/"]')
        .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));
      expect(hrefs.length).toBeGreaterThan(0);
      for (const href of [...new Set(hrefs)]) await visit(page, href, /./, 'no account', found);

      await visit(page, '/moments', tr('title.moments'), 'no account', found);

      await page.goto('/settings/account');
      await page.getByRole('button', { name: tr('local.upgrade.button') }).click();
      await expect(page).toHaveURL(/\/signup$/);
      await expect(page.getByText(tr('upgrade.notice'))).toBeVisible();
      await capture(page, '/signup', 'keeping device data', code, found);
      const email = uniqueEmail();
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(email);
      await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('signup.submit') }).click();
      await expect(heading(page, tr('signup.sent.title'))).toBeVisible();
      await page.goto(await findOutboxLink(page.request, email, '/confirm-email?'));
      const consent = page.getByRole('heading', { name: tr('consent.title') });
      const password = page.getByLabel(tr('auth.password'), { exact: true });
      await expect(password.or(consent)).toBeVisible();
      if (await password.isVisible()) {
        await password.fill(SECRET);
        await page.getByRole('button', { name: tr('confirm.submit') }).click();
      }
      await expect(consent).toBeVisible();
      await page.getByRole('button', { name: tr('consent.agree') }).click();
      await expect(page).toHaveURL(/\/keep-data$/);
      await expect(heading(page, tr('keepData.title'))).toBeVisible();
      await expect(page.getByRole('button', { name: tr('keepData.move') })).toBeVisible();
      await capture(page, '/keep-data', 'form', code, found);
      const keepPrivate = page.getByLabel(tr('keepData.private.label'));
      if (await keepPrivate.isVisible()) {
        await keepPrivate.check();
        await expect(
          page.getByLabel(tr('keepData.passphrase.label'), { exact: true }),
        ).toBeVisible();
        await capture(page, '/keep-data', 'private journal chosen', code, found);
        await page.getByRole('button', { name: tr('keepData.move') }).click();
        await expect(page.getByText(tr('keepData.passphrase.required'))).toBeVisible();
        await capture(page, '/keep-data', 'passphrase missing', code, found);
      }
      expect(reviewVerdict(found)).toEqual([]);
    });
  });
}
