import { expect, test, type Page } from '@playwright/test';
import { confirmEmail, createWebUser, localToday, setAccountLanguage, signUp, SECRET, uniqueEmail } from './support/accounts';
import { enableRememberedJournal, reflectionTrigger, saveMomentReflection, signUpAndConfirmLocalized } from './support/extras';
import { languages, translator } from './support/locales';

const sizes = [
  { width: 320, height: 800 },
  { width: 1280, height: 900 },
  { width: 2560, height: 1080 },
  { width: 3440, height: 1440 },
];
const longHabit = 'Wasser trinken und Donaudampfschifffahrtsgesellschaft';
const settingsGroups = ['account', 'reminders', 'habits', 'appearance', 'privacy', 'feedback', 'help'];

/**
 * Reports what a reader would see broken: the page scrolling sideways, and text running out of its box.
 *
 * Deliberately not reported:
 * - invisible elements, `aria-hidden` subtrees and SVG art, `sr-only` (visually hidden) text;
 * - elements without any text: nothing to clip, and their overflow is a pseudo-element hit area or an indicator inside a control (a radio's tap target);
 * - scroll containers (`overflow-x: auto | scroll`);
 * - text fields, which scroll their own value;
 * - ellipsised text that keeps its full text in `title` or `aria-label`;
 * - boxes whose only overflowing children are absolutely positioned (out of flow: decoration, or a label such as the
 *   year view's month names); such a child is still measured on its own, and the page-scroll check sees it leave the page;
 * - `html` and `body`, which the page-scroll check already covers.
 */
function measure(): { pageScrolls: boolean; offenders: string[] } {
  const root = document.documentElement;
  const path = (element: Element): string => {
    const parts: string[] = [];
    for (let node: Element | null = element; node && node !== document.body && parts.length < 6; node = node.parentElement) {
      const id = node.id ? `#${node.id}` : '';
      const classes = Array.from(node.classList).slice(0, 2).map((name) => `.${name}`).join('');
      parts.unshift(`${node.tagName.toLowerCase()}${id}${classes}`);
    }
    return parts.join(' > ');
  };
  const offenders: string[] = [];
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (element.closest('svg, [aria-hidden="true"], [hidden], .sr-only')) continue;
    if (!element.textContent?.trim()) continue;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName)) continue;
    if (element.getClientRects().length === 0) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'contents') continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    if (style.textOverflow === 'ellipsis' && (element.getAttribute('title') || element.getAttribute('aria-label'))) continue;
    const spilling = Array.from(element.children).filter((child) => {
      const rect = child.getBoundingClientRect();
      return rect.right > box.right + 1 || rect.left < box.left - 1;
    });
    const outOfFlow = (child: Element) => ['absolute', 'fixed'].includes(getComputedStyle(child).position);
    if (spilling.length > 0 && spilling.every(outOfFlow)) continue;
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
    const widest = Array.from(element.querySelectorAll('*')).reduce<Element | null>(
      (best, node) =>
        node.getClientRects().length > 0 && (!best || node.getBoundingClientRect().right > best.getBoundingClientRect().right)
          ? node
          : best,
      null,
    );
    const reach = widest ? ` reaches ${Math.round(widest.getBoundingClientRect().right)}px at ${path(widest)}` : '';
    offenders.push(`${path(element)} (scrollWidth ${element.scrollWidth} > clientWidth ${element.clientWidth}${reach}) "${text}"`);
  }
  return { pageScrolls: root.scrollWidth > root.clientWidth, offenders };
}

async function check(page: Page, where: string, lang: string, found: string[]): Promise<void> {
  const viewport = page.viewportSize();
  try {
    for (const { width, height } of sizes) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        () => document.fonts.ready.then(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))),
      );
      const { pageScrolls, offenders } = await page.evaluate(measure);
      const at = `[${where}] [${lang}] [${width}px]`;
      if (pageScrolls) found.push(`${at} the page scrolls horizontally`);
      for (const offender of offenders) found.push(`${at} ${offender}`);
    }
  } finally {
    if (viewport) await page.setViewportSize(viewport);
  }
}

for (const { code, locale, strings } of languages) {
  const tr = translator(strings);

  async function visit(page: Page, path: string, ready: RegExp | string | null, found: string[]): Promise<void> {
    await page.goto(path);
    await expect(ready ? page.getByRole('heading', { name: ready }).first() : page.locator('#main')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', code);
    await check(page, path, code, found);
  }

  async function createHabitHere(page: Page, name: string): Promise<void> {
    await page.goto('/habits/new');
    await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
    await page.getByLabel(tr('habitFields.name'), { exact: true }).fill(name);
    await page.getByRole('button', { name: tr('habitNew.create') }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  }

  test.describe(`layout ${code}, signed out`, () => {
    test.use({ locale });

    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => localStorage.setItem('ember.language', value), code);
    });

    test('public pages fit at 320, 1280 and 21:9', async ({ page }) => {
      test.setTimeout(180_000);
      const found: string[] = [];
      await visit(page, '/', /./, found);
      await visit(page, '/login', tr('login.title'), found);
      await expect(page.getByText(tr('about.intro'))).toBeVisible();
      await visit(page, '/signup', tr('signup.title'), found);

      await page.getByLabel(tr('auth.email'), { exact: true }).fill(uniqueEmail());
      await page.getByLabel(tr('auth.password'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('signup.submit') }).click();
      await expect(page.getByRole('heading', { name: tr('signup.sent.title') })).toBeVisible();
      await check(page, '/signup (check your inbox)', code, found);

      await visit(page, '/forgot-password', tr('forgot.title'), found);
      await page.getByLabel(tr('auth.email'), { exact: true }).fill(uniqueEmail());
      await page.getByRole('button', { name: tr('forgot.submit') }).click();
      await expect(page.getByRole('heading', { name: tr('forgot.sent.title') })).toBeVisible();
      await check(page, '/forgot-password (sent)', code, found);

      await visit(page, '/reset-password', tr('reset.incomplete.title'), found);
      await visit(page, '/reset-password?email=dummy%40example.test&code=000000', tr('reset.title'), found);
      await page.getByLabel(tr('reset.newPassword'), { exact: true }).fill(SECRET);
      await page.getByRole('button', { name: tr('reset.submit') }).click();
      await expect(page.getByRole('alert').or(page.getByRole('status').filter({ hasText: /./ })).first()).toBeVisible();
      await check(page, '/reset-password (rejected code)', code, found);

      await visit(page, '/local', tr('local.start.title'), found);
      await expect(page.getByText(tr('about.intro'))).toBeVisible();
      await visit(page, '/about', tr('title.about'), found);
      await visit(page, '/feedback', tr('title.feedback'), found);
      await visit(page, '/download', /./, found);
      await visit(page, '/legal/privacy', /./, found);
      await visit(page, '/legal/terms', /./, found);
      await visit(page, '/legal/imprint', /./, found);
      await visit(page, '/no-such-page', tr('notFound.title'), found);
      await visit(page, '/help', tr('title.help'), found);
      expect(found).toEqual([]);
    });

    test('the moment flow fits at 320, 1280 and 21:9', async ({ page }) => {
      test.setTimeout(180_000);
      const found: string[] = [];
      const heading = (name: RegExp | string) => page.getByRole('heading', { name }).first();
      const click = (name: string) => page.getByRole('button', { name, exact: true }).click();
      const lines = page.getByRole('list', { name: tr('crisis.list') });

      await page.goto('/moment');
      await expect(heading(tr('moment.catch.heading'))).toBeVisible();
      await check(page, '/moment catch', code, found);
      await click(tr('moment.urgentHelp'));
      await expect(lines).toBeVisible();
      await check(page, '/moment catch (urgent help open)', code, found);
      await click(tr('moment.urgentHelp'));

      await click(tr('moment.catch.name'));
      await expect(heading(tr('moment.name.heading'))).toBeVisible();
      await check(page, '/moment name', code, found);
      await click(tr('moment.tile.overloaded').replace(' / ', ', '));
      await expect(heading(tr('moment.intensity.heading'))).toBeVisible();
      await page.getByRole('radio', { name: tr('moment.intensity.4'), exact: true }).check();
      await check(page, '/moment intensity', code, found);
      await click(tr('moment.continue'));
      await expect(heading(code === 'en' ? /Sit or stand/ : /Setz oder stell dich/)).toBeVisible();
      await check(page, '/moment practice step', code, found);
      await click(tr('moment.next'));
      await click(tr('moment.next'));
      await expect(heading(tr('moment.breath.heading'))).toBeVisible();
      await check(page, '/moment breathing player', code, found);
      await click(tr('moment.start'));
      await expect(page.getByText(`${tr('moment.breath.in')}, 4`).first()).toBeVisible();
      await check(page, '/moment breathing player (running)', code, found);
      await click(tr('moment.pause'));
      await click(tr('moment.skipPractice'));
      await expect(heading(tr('moment.after.heading'))).toBeVisible();
      await check(page, '/moment after', code, found);
      await click(tr('moment.skip'));
      await expect(heading(tr('moment.end.heading'))).toBeVisible();
      await check(page, '/moment end', code, found);
      await click(tr('moment.reflect'));
      await expect(heading(tr('moment.reflect.heading'))).toBeVisible();
      await check(page, '/moment reflect', code, found);
      await click(tr('moment.urgentHelp'));
      await expect(lines).toBeVisible();
      await check(page, '/moment reflect (urgent help open)', code, found);
      await click(tr('moment.urgentHelp'));

      await page.getByLabel(tr('moment.reflect.setItOff')).fill('Synthetic');
      await click(tr('moment.leave'));
      await expect(page.getByRole('group', { name: tr('moment.leaveDraft') })).toBeVisible();
      await check(page, '/moment reflect (leave confirm)', code, found);
      expect(found).toEqual([]);
    });

    test('no-account mode Today fits at 320, 1280 and 21:9', async ({ page }) => {
      const found: string[] = [];
      await page.goto('/local');
      await page.getByRole('button', { name: tr('local.start.button') }).click();
      await expect(page.getByRole('heading', { name: tr('today.title'), exact: true })).toBeVisible();
      await check(page, '/today (no account, empty)', code, found);
      await visit(page, '/settings/privacy', /./, found);
      expect(found).toEqual([]);
    });
  });

  test.describe(`layout ${code}, signed in`, () => {
    test('app pages fit at 320, 1280 and 21:9', async ({ page }) => {
      test.setTimeout(300_000);
      const found: string[] = [];

      const email = uniqueEmail();
      await signUp(page, email);
      await confirmEmail(page, email);
      await expect(page.locator('html')).toHaveAttribute('lang', 'en');
      await check(page, '/consent (the account language can only change after consent)', 'en', found);
      await page.getByRole('button', { name: 'I agree' }).click();
      await expect(page).toHaveURL(/\/today$/);
      await setAccountLanguage(page, code);
      await page.reload();
      await expect(page.getByRole('heading', { name: tr('today.title'), exact: true })).toBeVisible();
      await check(page, '/today (empty)', code, found);

      await visit(page, '/habits/new', tr('habitNew.title'), found);
      await page.getByRole('button', { name: tr('habitNew.scratch') }).click();
      await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toBeVisible();
      await check(page, '/habits/new (form)', code, found);
      await createHabitHere(page, longHabit);
      await createHabitHere(page, 'Stretch');
      await createHabitHere(page, 'Journal');

      const routineName = 'Morgenroutine mit Dehnen und Atmen';
      await visit(page, '/routines', tr('routines.title'), found);
      await page.goto('/routines/new');
      await page.getByLabel(tr('habitFields.name'), { exact: true }).fill(routineName);
      await page.getByRole('button', { name: tr('routine.habits.addOne', { name: 'Stretch' }) }).click();
      await page.getByRole('button', { name: tr('routine.habits.addOne', { name: longHabit }) }).click();
      await check(page, '/routines/new (filled)', code, found);
      await page.getByRole('button', { name: tr('routine.create') }).click();
      await expect(page).toHaveURL(/\/routines$/);
      await expect(page.getByRole('heading', { name: routineName })).toBeVisible();
      await check(page, '/routines (with a routine)', code, found);

      await visit(page, '/today', tr('today.title'), found);
      const checkIn = page.getByRole('button', { name: tr('today.checkIn', { name: 'Journal' }) });
      await checkIn.click();
      await expect(checkIn).toHaveAttribute('aria-pressed', 'true');
      await expect(checkIn).not.toHaveClass(/ember-reward/);
      await check(page, '/today (checked)', code, found);

      await page.getByRole('button', { name: tr('today.lowDay.mark') }).click();
      await expect(page.getByText(tr('today.lowDay.heading'), { exact: true })).toBeVisible();
      await check(page, '/today (low day)', code, found);

      await page.evaluate(() => localStorage.setItem('ember.seenReleaseNotes', '0.0.1'));
      await page.goto('/today');
      await expect(page.getByRole('link', { name: tr('whatsNew.card.link') })).toBeVisible();
      await check(page, '/today (what is new card)', code, found);

      await page.getByRole('link', { name: tr('today.edit', { name: longHabit }) }).first().click();
      await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toHaveValue(longHabit);
      await check(page, '/habits/:id/edit', code, found);
      await page.getByLabel(tr('habitFields.name'), { exact: true }).fill(`${longHabit}!`);
      await page.getByRole('button', { name: tr('habitEdit.save') }).click();
      await expect(page.getByText(tr('habitEdit.saved')).first()).toBeVisible();
      await check(page, '/habits/:id/edit (saved)', code, found);
      await page.getByRole('button', { name: tr('habitEdit.delete') }).click();
      await expect(page.getByText(tr('habitEdit.deleteQuestion', { name: `${longHabit}!` }))).toBeVisible();
      await check(page, '/habits/:id/edit (delete confirm)', code, found);

      await page.goto('/routines');
      await page.getByRole('link', { name: tr('today.edit', { name: tr('routine.title', { name: routineName }) }) }).click();
      await expect(page.getByLabel(tr('habitFields.name'), { exact: true })).toHaveValue(routineName);
      await check(page, '/routines/:id/edit', code, found);
      await page.getByRole('button', { name: tr('routine.delete') }).click();
      await expect(page.getByText(tr('routine.deleteQuestion', { name: routineName }))).toBeVisible();
      await check(page, '/routines/:id/edit (delete confirm)', code, found);

      await visit(page, '/history', tr('history.title'), found);
      const today = await localToday(page);
      await page.locator(`#day-${today}`).click();
      await expect(page.locator('#day-panel')).toHaveCSS('opacity', '1');
      await check(page, '/history (day panel open)', code, found);
      await visit(page, '/history/year', /./, found);

      await visit(page, '/settings', null, found);
      for (const group of settingsGroups) await visit(page, `/settings/${group}`, /./, found);
      await visit(page, '/feedback', tr('title.feedback'), found);
      await visit(page, '/whats-new', tr('whatsNew.title'), found);
      await visit(page, '/download', /./, found);
      await visit(page, '/help', tr('title.help'), found);
      await visit(page, '/no-such-page', tr('notFound.title'), found);
      expect(found).toEqual([]);
    });

    test('Your moments, What helps me and calm mode fit at 320, 1280 and 21:9', async ({ page }) => {
      test.setTimeout(300_000);
      const found: string[] = [];
      const longHelp = 'Ein langer Spaziergang an der Donaudampfschifffahrtsgesellschaft vorbei';

      await createWebUser(page);
      await setAccountLanguage(page, code);
      await visit(page, '/moments', tr('title.moments'), found);
      await expect(page.getByText(tr('moments.needsPrivate'))).toBeVisible();
      await check(page, '/moments (no private journal)', code, found);
      await visit(page, '/settings/privacy', /./, found);
      await expect(page.getByText(tr('helps.needsPrivate'))).toBeVisible();
      await check(page, '/settings/privacy (What helps me needs the journal)', code, found);

      await setAccountLanguage(page, 'en');
      await enableRememberedJournal(page);
      await saveMomentReflection(page);
      await page.getByRole('link', { name: 'See your moments' }).click();
      await page.getByRole('button', { name: 'Add to What helps me: “Slow breathing”' }).click();
      await expect(page.getByText('In What helps me')).toBeVisible();
      await setAccountLanguage(page, code);

      await visit(page, '/moments', tr('title.moments'), found);
      await expect(page.getByText(reflectionTrigger)).toBeVisible();
      await check(page, '/moments (one moment)', code, found);

      await visit(page, '/settings/privacy', /./, found);
      const card = page.getByRole('region', { name: tr('settings.card.helps') });
      await card.getByLabel(tr('helps.new')).fill(longHelp);
      await card.getByRole('button', { name: tr('helps.add'), exact: true }).click();
      await expect(card.getByText(longHelp, { exact: true })).toBeVisible();
      await check(page, '/settings/privacy (What helps me with a long item)', code, found);
      await card.getByRole('button', { name: tr('helps.editLabel', { text: longHelp }) }).click();
      await check(page, '/settings/privacy (What helps me editing)', code, found);

      await visit(page, '/today', tr('today.title'), found);
      await page.getByRole('link', { name: tr('moment.door.label') }).click();
      await expect(page.getByRole('heading', { name: tr('moment.catch.heading') })).toBeVisible();
      await expect(page.getByRole('button', { name: longHelp })).toBeVisible();
      await check(page, '/moment catch (with What helped before chips)', code, found);

      await visit(page, '/settings/appearance', /./, found);
      await page.getByRole('switch', { name: tr('settings.calm.label') }).click();
      await expect(page.locator('html')).toHaveAttribute('data-calm', '');
      await check(page, '/settings/appearance (calm on)', code, found);
      await visit(page, '/today', tr('today.title'), found);
      await page.getByRole('link', { name: tr('moment.door.label') }).click();
      await expect(page.getByRole('heading', { name: tr('moment.catch.heading') })).toBeVisible();
      await check(page, '/moment catch (calm on)', code, found);
      await page.getByRole('button', { name: tr('moment.catch.breathe') }).click();
      await check(page, '/moment practice (calm on)', code, found);

      await visit(page, '/settings/privacy', /./, found);
      await page.getByRole('button', { name: tr('journalSettings.lock') }).click();
      await expect(page.getByText(tr('journalSettings.lockedDone'))).toBeAttached();
      await visit(page, '/moments', tr('title.moments'), found);
      await expect(page.getByText(tr('moments.locked'))).toBeVisible();
      await check(page, '/moments (locked)', code, found);
      expect(found).toEqual([]);
    });
  });

  if (code === 'de') {
    test.describe('layout de, consent', () => {
      test.use({ locale: 'de-DE' });

      test('the consent page fits at 320, 1280 and 21:9 for a German account before consent', async ({ page }) => {
        const found: string[] = [];
        await signUpAndConfirmLocalized(page, tr);
        await expect(page.locator('html')).toHaveAttribute('lang', 'de');
        await check(page, '/consent (German, before consent)', code, found);
        expect(found).toEqual([]);
      });
    });
  }
}
