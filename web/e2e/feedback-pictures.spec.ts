import { expect, test, type Page } from '@playwright/test';
import { createWebUser } from './support/accounts';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEElEQVR4nGP4z8AARAwQCgAf7gP9i18U1AAAAABJRU5ErkJggg==',
  'base64',
);

interface Stored {
  title: string;
  userId: string | null;
  pictureCount: number;
}

async function storedFeedback(page: Page, title: string): Promise<Stored> {
  let stored: Stored | undefined;
  await expect
    .poll(async () => {
      const response = await page.request.get('/test/feedback/latest');
      stored = response.ok() ? await response.json() : undefined;
      return stored?.title;
    })
    .toBe(title);
  return stored as Stored;
}

async function fillReport(page: Page, title: string): Promise<void> {
  await page.goto('/settings/feedback');
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Description', { exact: true }).fill('Synthetic feedback from an end-to-end test.');
}

async function userId(page: Page): Promise<string> {
  const response = await page.request.get('/api/me');
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
}

test('a signed-in user sends feedback with one of two pictures kept', async ({ page }) => {
  await createWebUser(page);
  await fillReport(page, 'Pictures kept');
  await page.locator('input[type=file]').setInputFiles([
    { name: 'one.png', mimeType: 'image/png', buffer: png },
    { name: 'two.png', mimeType: 'image/png', buffer: png },
  ]);

  const thumbnails = page.getByRole('list', { name: 'Pictures to send' }).locator('img');
  await expect(thumbnails).toHaveCount(2);
  for (const thumbnail of await thumbnails.all())
    await expect.poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Remove picture 2' }).click();
  await expect(thumbnails).toHaveCount(1);
  await expect(page.getByText(/^1 of 5 pictures/)).toBeVisible();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Thank you, that really helps.')).toBeVisible();

  const stored = await storedFeedback(page, 'Pictures kept');
  expect(stored.pictureCount).toBe(1);
  expect(stored.userId).toBe(await userId(page));
});

test('anonymous feedback from a signed-in user is stored without the account', async ({ page }) => {
  await createWebUser(page);
  await fillReport(page, 'Sent anonymously');
  await page.locator('input[type=file]').setInputFiles({ name: 'one.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText(/^1 of 5 pictures/)).toBeVisible();
  await page.getByRole('switch', { name: 'Send feedback anonymously' }).click();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Thank you, that really helps.')).toBeVisible();

  const stored = await storedFeedback(page, 'Sent anonymously');
  expect(stored.userId).toBeNull();
  expect(stored.pictureCount).toBe(1);
});
