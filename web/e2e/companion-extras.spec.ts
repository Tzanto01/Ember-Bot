import { expect, test, type Page, type Request } from '@playwright/test';
import { createHabit, createWebUser } from './support/accounts';
import {
  enableRememberedJournal,
  reflectionTrigger,
  saveMomentReflection,
  signUpAndConfirmLocalized,
} from './support/extras';
import { openPage, openSettingsGroup } from './support/security';
import { languages, translator } from './support/locales';

const apiPath = (request: Request): string => new URL(request.url()).pathname;

function helpsCard(page: Page) {
  return page.getByRole('region', { name: 'What helps me' });
}

async function addHelp(page: Page, text: string): Promise<void> {
  const card = helpsCard(page);
  await card.getByLabel('Add something that helps').fill(text);
  await card.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByText(`Added “${text}” to What helps me.`)).toBeVisible();
}

test('a saved moment goes to What helps me, shows as a Catch chip, and the list never loads inside the moment flow', async ({
  page,
  context,
}) => {
  test.setTimeout(240_000);
  await createWebUser(page);
  await enableRememberedJournal(page);

  const putBodies: unknown[] = [];
  page.on('request', (request) => {
    if (request.method() === 'PUT' && apiPath(request) === '/api/me/helps')
      putBodies.push(request.postDataJSON());
  });

  await saveMomentReflection(page);
  await page.getByRole('link', { name: 'See your moments' }).click();
  await expect(page).toHaveURL(/\/moments$/);
  await expect(page.getByRole('heading', { name: 'Your moments', level: 1 })).toBeVisible();
  await expect(page.getByText(reflectionTrigger)).toBeVisible();
  await page.getByRole('button', { name: 'Add “Slow breathing” to What helps me' }).click();
  await expect(page.getByText('In What helps me')).toBeVisible();

  await openSettingsGroup(page, 'Privacy & data');
  const card = helpsCard(page);
  const items = card.getByRole('list').getByRole('listitem');
  await expect(items).toHaveCount(1);
  await expect(items.first()).toContainText('Slow breathing');
  await expect(items.first()).toContainText('Practice');

  await addHelp(page, 'A walk around the block');
  await addHelp(page, 'Call a friend');
  await addHelp(page, 'Make some tea');
  await expect(items).toHaveCount(4);

  await card.getByRole('button', { name: 'Change “Call a friend”' }).click();
  await page
    .getByRole('form', { name: 'Change “Call a friend”' })
    .getByLabel('What helps')
    .fill('Call a good friend');
  await page
    .getByRole('form', { name: 'Change “Call a friend”' })
    .getByRole('button', { name: 'Save' })
    .click();
  await expect(page.getByText('Saved “Call a good friend”.')).toBeVisible();

  await card.getByRole('button', { name: 'Move “A walk around the block” up' }).click();
  await expect(page.getByText(/“A walk around the block” is now number 1 of 4\./)).toBeVisible();
  await card.getByRole('button', { name: 'Remove “Make some tea”' }).click();
  await expect(page.getByText('Removed “Make some tea”.')).toBeVisible();
  await expect(items).toHaveCount(3);
  await expect(items).toContainText([
    'A walk around the block',
    'Slow breathing',
    'Call a good friend',
  ]);

  expect(putBodies.length).toBeGreaterThanOrEqual(6);
  for (const body of putBodies) {
    const sent = body as { encrypted: string; version: number };
    expect(Object.keys(sent).sort()).toEqual(['encrypted', 'version']);
    expect(typeof sent.version).toBe('number');
    for (const word of ['walk', 'Walk', 'breathing', 'friend', 'tea', 'Slow']) {
      expect(sent.encrypted).not.toContain(word);
    }
    expect(Object.keys(JSON.parse(sent.encrypted) as object).sort()).toEqual(['ct', 'iv', 'v']);
  }

  const loaded = Promise.all(
    ['/api/me/helps', '/api/day-notes', '/api/moods'].map((path) =>
      page.waitForResponse((response) => apiPath(response.request()) === path && response.request().method() === 'GET'),
    ),
  );
  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await loaded;
  const seen: Request[] = [];
  page.on('request', (request) => seen.push(request));
  await page.getByRole('link', { name: 'I need a moment' }).click();
  await expect(
    page.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toBeVisible();
  const chips = page.getByRole('region', { name: 'What helped before' });
  await expect(chips.getByRole('button')).toHaveText([
    'A walk around the block',
    'Slow breathing',
    'Call a good friend',
  ]);
  expect(seen.filter((request) => apiPath(request) === '/api/me/helps').map((r) => `${r.method()} ${r.url()}`)).toEqual([]);
  expect(seen.filter((request) => apiPath(request).startsWith('/api/')).map(apiPath)).toEqual([]);

  await chips.getByRole('button', { name: 'A walk around the block' }).click();
  await expect(page.getByRole('heading', { name: 'A walk around the block' })).toBeVisible();
  await page.getByRole('button', { name: 'Back' }).click();
  await expect(chips).toBeVisible();
  await chips.getByRole('button', { name: 'Slow breathing' }).click();
  await expect(
    page.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toHaveCount(0);

  const cold = await context.newPage();
  const coldSeen: Request[] = [];
  cold.on('request', (request) => coldSeen.push(request));
  await cold.goto('/moment');
  await expect(
    cold.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toBeVisible();
  await cold.waitForLoadState('load');
  await expect(cold.getByRole('region', { name: 'What helped before' })).toHaveCount(0);
  await expect(cold.getByText('What helped before')).toHaveCount(0);
  expect(coldSeen.filter((request) => apiPath(request) === '/api/me/helps')).toEqual([]);
  await cold.close();
});

async function expectCalmStill(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  const moving = await page.evaluate(() =>
    Array.from(document.body.querySelectorAll('*')).flatMap((element) => {
      const style = getComputedStyle(element);
      const durations = style.transitionDuration.split(',').map((value) => parseFloat(value));
      return style.animationName !== 'none' || durations.some((value) => value > 0)
        ? [`${element.tagName.toLowerCase()} ${style.animationName} ${style.transitionDuration}`]
        : [];
    }),
  );
  expect(moving).toEqual([]);
}

test('calm mode: no motion, no What is new card, ember summary or campfire; it persists, and turning it off restores them', async ({
  page,
}) => {
  test.setTimeout(180_000);
  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await page.evaluate(() => localStorage.setItem('ember.seenReleaseNotes', '0.0.1'));
  await page.goto('/today');
  const whatsNew = page.getByRole('link', { name: "See what's new" });
  const summary = page.locator('p:visible', { hasText: 'Nothing checked in yet today' }).first();
  const html = page.locator('html');
  await expect(whatsNew).toBeVisible();
  await expect(summary).toBeVisible();
  await expect(html).not.toHaveAttribute('data-calm', /.*/);

  await openPage(page, 'Settings');
  await page
    .getByRole('link', { name: /^Appearance/ })
    .first()
    .click();
  await page.getByRole('switch', { name: 'Calm mode' }).click();
  await expect(html).toHaveAttribute('data-calm', '');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ember.calm'))).toBe('1');
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/me')).json()) as { calmMode?: boolean }).calmMode,
    )
    .toBe(true);
  await expectCalmStill(page);

  await openPage(page, 'Today');
  await expect(page.getByRole('heading', { name: 'Stretch', exact: true })).toBeVisible();
  await expect(whatsNew).toBeHidden();
  await expect(summary).toBeHidden();
  await expectCalmStill(page);

  await page.getByRole('link', { name: 'I need a moment' }).click();
  await expect(
    page.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toBeVisible();
  await expect(page.locator('[data-calm-hide]:visible')).toHaveCount(0);
  await expectCalmStill(page);

  await page.goto('/today');
  await expect(page.getByRole('heading', { name: 'Stretch', exact: true })).toBeVisible();
  await expect(html).toHaveAttribute('data-calm', '');
  await expect(whatsNew).toBeHidden();

  await page.goto('/settings/appearance');
  await page.getByRole('switch', { name: 'Calm mode' }).click();
  await expect(html).not.toHaveAttribute('data-calm', /.*/);
  await expect
    .poll(
      async () =>
        ((await (await page.request.get('/api/me')).json()) as { calmMode?: boolean }).calmMode,
    )
    .toBe(false);
  await openPage(page, 'Today');
  await expect(whatsNew).toBeVisible();
  await expect(summary).toBeVisible();
  await page.getByRole('link', { name: 'I need a moment' }).click();
  await expect(
    page.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toBeVisible();
  await expect(page.locator('[data-calm-hide]:visible').first()).toBeVisible();
});

test('calm mode in no-account mode is stored on the device only', async ({ page }) => {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Start without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  const html = page.locator('html');
  await page.goto('/settings/appearance');
  const calm = page.getByRole('switch', { name: 'Calm mode' });
  await expect(calm).toBeVisible();

  const requests: string[] = [];
  page.on('request', (request) => {
    if (apiPath(request).startsWith('/api/'))
      requests.push(`${request.method()} ${apiPath(request)}`);
  });
  await calm.click();
  await expect(html).toHaveAttribute('data-calm', '');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ember.calm'))).toBe('1');
  await expectCalmStill(page);

  await page.reload();
  await expect(html).toHaveAttribute('data-calm', '');
  await expect(page.getByRole('switch', { name: 'Calm mode' })).toBeChecked();

  await page.getByRole('switch', { name: 'Calm mode' }).click();
  await expect(html).not.toHaveAttribute('data-calm', /.*/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('ember.calm'))).not.toBe('1');
  expect(requests).toEqual([]);
});

test.describe('sign-up language', () => {
  test.use({ locale: 'de-DE', extraHTTPHeaders: { 'Accept-Language': 'en' } });

  test('signing up with the app in German makes German the account language even when the browser asks for English', async ({
    page,
  }) => {
    const tr = translator(languages[1].strings);
    await signUpAndConfirmLocalized(page, tr);
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await page.getByRole('button', { name: tr('consent.agree') }).click();
    await expect(page).toHaveURL(/\/today$/);
    await expect(page.getByRole('heading', { name: tr('today.title'), exact: true })).toBeVisible();
    const me = (await (await page.request.get('/api/me')).json()) as { language?: string };
    expect(me.language).toBe('de');
  });
});
