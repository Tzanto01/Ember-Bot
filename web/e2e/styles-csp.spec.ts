import { expect, test } from '@playwright/test';

test('the production build applies its full stylesheet under the API CSP without violations', async ({
  page,
}) => {
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

  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();

  const unapplied = await page.evaluate(() =>
    [...document.querySelectorAll('head link[rel="stylesheet"]')]
      .map((link) => link.getAttribute('media'))
      .filter((media) => media && media !== 'all'),
  );
  expect(unapplied).toEqual([]);
  expect(violations).toEqual([]);
});
