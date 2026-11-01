import { expect, test } from '@playwright/test';
import { createHabit, createWebUser } from './support/accounts';

test('the built index.html has no inline scripts, event handlers or style attributes', async ({
  request,
}) => {
  const html = await (await request.get('/')).text();
  const inlineScripts = html.match(/<script(?![^>]*\ssrc=)[^>]*>/gi) ?? [];
  expect(inlineScripts).toEqual([]);
  expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  expect(html).not.toMatch(/\sstyle\s*=/i);
});

test('Today, History and Settings load without CSP violations', async ({ page }) => {
  const violations = [];
  page.on('console', (message) => {
    if (/Content Security Policy/i.test(message.text())) violations.push(message.text());
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) =>
      console.error(
        `Content Security Policy violation: ${event.violatedDirective} ${event.blockedURI}`,
      ),
    );
  });

  await createWebUser(page);
  await createHabit(page, 'Stretch');
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  await page.goto('/history');
  await expect(page.getByRole('heading', { name: 'History', exact: true })).toBeVisible();
  await page.goto('/settings');
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();

  await page.getByRole('radio', { name: 'Marigold' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'marigold');
  await page.reload();
  await expect(page.getByRole('radio', { name: 'Marigold' })).toBeChecked();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'marigold');

  expect(violations).toEqual([]);
});
