import { expect, test, type Page } from '@playwright/test';
import { createWebUser } from './support/accounts';
import {
  createUserWithHabit,
  dayNotes,
  enableJournal,
  newPassphrase,
  openPage,
} from './support/security';

const savedText = "Saved to today's private note.";

function momentDoor(page: Page) {
  return page.getByRole('link', { name: 'I need a moment' });
}

async function storageSnapshot(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const local = Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, i) => {
        const key = localStorage.key(i)!;
        return [key, localStorage.getItem(key)];
      }),
    );
    const databases: Record<string, unknown> = {};
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      databases[name] = await new Promise((resolve) => {
        const open = indexedDB.open(name);
        open.onerror = () => resolve('unreadable');
        open.onsuccess = () => {
          const db = open.result;
          const stores = Array.from(db.objectStoreNames);
          const contents: Record<string, unknown> = {};
          if (stores.length === 0) {
            db.close();
            resolve(contents);
            return;
          }
          const tx = db.transaction(stores, 'readonly');
          let pending = stores.length;
          for (const store of stores) {
            const request = tx.objectStore(store).getAll();
            request.onsuccess = () => {
              contents[store] = JSON.parse(JSON.stringify(request.result));
              pending -= 1;
              if (pending === 0) {
                db.close();
                resolve(contents);
              }
            };
          }
        };
      });
    }
    return JSON.stringify({ local, databases });
  });
}

/** Catch, straight to breathing, skip the practice and the "how is it now" question, then open Reflect. */
async function reachReflect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Just breathe with me' }).click();
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Reflect on it' }).click();
  await expect(page.getByRole('heading', { name: 'Reflect, if you like' })).toBeVisible();
}

/** Name the moment, pick an intensity, run the practice to its last step, then open Reflect. */
async function reachReflectNamed(page: Page): Promise<void> {
  await page.getByRole('button', { name: "Name what's happening" }).click();
  await page.getByRole('button', { name: 'Too much / overloaded' }).click();
  await page.getByRole('radio', { name: 'Strong' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByRole('button', { name: 'Skip to the end' }).click();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await page.getByRole('button', { name: 'Reflect on it' }).click();
  await expect(page.getByRole('heading', { name: 'Reflect, if you like' })).toBeVisible();
}

async function expectNoSave(page: Page): Promise<void> {
  await expect(page.getByLabel('What set it off')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
}

function watchDayNotePuts(page: Page): { bodies: unknown[] } {
  const seen: { bodies: unknown[] } = { bodies: [] };
  page.on('request', (request) => {
    if (request.method() === 'PUT' && /\/api\/day-notes\/\d{4}-\d{2}-\d{2}$/.test(request.url())) {
      seen.bodies.push(request.postDataJSON());
    }
  });
  return seen;
}

test('the moment flow works offline, signed out, without any API call or stored data', async ({
  page,
  context,
}) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(async () => {
      await page.reload();
      return page.evaluate(() => navigator.serviceWorker.controller !== null);
    })
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();

  const before = await storageSnapshot(page);
  const apiRequests: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname.startsWith('/api')) apiRequests.push(request.url());
  });

  await page.getByRole('link', { name: 'I need a moment' }).click();
  await expect(page).toHaveURL(/\/moment$/);
  await expect(
    page.getByRole('heading', { name: "You're here. That's enough for now." }),
  ).toBeVisible();
  await page.getByRole('button', { name: "Name what's happening" }).click();
  await page.getByRole('button', { name: 'Too much / overloaded' }).click();
  await page.getByRole('radio', { name: 'Strong' }).check();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: /Sit or stand/ })).toBeVisible();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(
    page.getByRole('heading', { name: 'Breathe along. Start when you are ready.' }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await expect(page.getByText('Breathe in, 4').first()).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused').first()).toBeVisible();

  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Next' }).click();
  await page.getByRole('button', { name: 'Finish' }).click();
  await expect(page.getByRole('heading', { name: 'How is it now?' })).toBeVisible();
  await page.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(page.getByRole('heading', { name: "That's it for now." })).toBeVisible();

  await page.getByRole('button', { name: 'Urgent help' }).click();
  const lines = page.getByRole('list', { name: 'Crisis lines' });
  await expect(lines).toBeVisible();
  const phone = lines.locator('a[href^="tel:"]');
  expect(await phone.count()).toBeGreaterThan(0);
  await expect(phone.first()).toHaveAttribute('href', /^tel:\d+$/);

  expect(apiRequests).toEqual([]);
  expect(await storageSnapshot(page)).toBe(before);

  await page.getByRole('button', { name: 'Leave' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(await storageSnapshot(page)).toBe(before);
  await context.setOffline(false);
});

async function saveReflectionAndCheckBody(page: Page): Promise<void> {
  const puts = watchDayNotePuts(page);
  await reachReflectNamed(page);
  await expect(page.getByText("Saving adds this to today's private note.")).toBeVisible();
  await page.getByLabel('What set it off').fill('Synthetic trigger: a long meeting');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(savedText)).toBeVisible();
  expect(puts.bodies).toHaveLength(1);
  expect(Object.keys(puts.bodies[0] as object)).toEqual(['encrypted']);
}

test.fixme('unlocked private journal and no habits: saving a reflection sends only the encrypted body (needs Companion v1.16 day-notes rule from v2/companion-server)', async ({
  page,
}) => {
  await createWebUser(page);
  await enableJournal(page, newPassphrase());
  await openPage(page, 'Today');
  await momentDoor(page).click();
  await saveReflectionAndCheckBody(page);
  const stored = await dayNotes(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]?.text ?? null).toBeNull();
});

test('unlocked private journal: the reflection is saved encrypted and shows in Today after unlocking', async ({
  page,
}) => {
  await createUserWithHabit(page);
  const passphrase = newPassphrase();
  await enableJournal(page, passphrase);
  await openPage(page, 'Today');
  await momentDoor(page).click();
  await saveReflectionAndCheckBody(page);

  const stored = await dayNotes(page);
  expect(stored).toHaveLength(1);
  expect(stored[0]?.encrypted).toBeTruthy();
  expect(stored[0]?.text ?? null).toBeNull();
  expect(JSON.stringify(stored)).not.toContain('meeting');

  await page.goto('/today');
  await expect(page.getByText('Your private journal is locked on this device.')).toBeVisible();
  await page.getByLabel('Journal passphrase').fill(passphrase);
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const journal = page.getByLabel('A few words');
  await expect(journal).toHaveValue(/^Moment \d{2}:\d{2} · Too much \/ overloaded · Strong/);
  await expect(journal).toHaveValue(/What set it off: Synthetic trigger: a long meeting/);
  await expect(journal).toHaveValue(/What helped: Slow breathing/);
});

test('a plain-journal account reaches Reflect with no Save and a way to Privacy & data', async ({
  page,
}) => {
  await createUserWithHabit(page);
  await openPage(page, 'Today');
  await momentDoor(page).click();
  await reachReflect(page);
  await expectNoSave(page);
  await expect(page.getByText(/needs the private journal/)).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open Privacy & data' })).toBeVisible();
});

test('a no-account profile reaches Reflect with no Save', async ({ page }) => {
  await page.goto('/local');
  await page.getByRole('button', { name: 'Start without an account' }).click();
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await momentDoor(page).click();
  await reachReflect(page);
  await expectNoSave(page);
  await expect(page.getByText('Nothing from this moment was saved.')).toBeVisible();
});
