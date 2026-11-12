import { expect, type APIRequestContext, type Page } from '@playwright/test';
import { findOutboxLink } from './outbox';

let counter = 0;

function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}${counter}${Math.floor(Math.random() * 1000)}`;
}

/** Synthetic credential generated per run, so nothing secret-shaped lives in the repo. */
export const SECRET = `Ember-${uniqueSuffix()}-synthetic`;

export function uniqueEmail(): string {
  return `web-e2e-${uniqueSuffix()}@example.test`;
}

export function uniqueDiscordId(): string {
  return `9${uniqueSuffix()}`.slice(0, 18);
}

export async function signUp(page: Page, email: string): Promise<void> {
  await page.goto('/signup');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your inbox' })).toBeVisible();
}

/** Opens the emailed link; the code confirms and signs in the browser that signed up, which lands on consent. */
export async function confirmEmail(page: Page, email: string): Promise<void> {
  const link = await findOutboxLink(page.request, email, '/confirm-email?');
  await page.goto(link);
  await expect(page.getByRole('heading', { name: 'One quick question' })).toBeVisible();
}

export async function logIn(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill(SECRET);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

export async function agreeToConsent(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'I agree' }).click();
  await expect(page).toHaveURL(/\/today$/);
}

/** Continues after a Discord sign-in, agreeing to consent only when the app asks for it. */
export async function agreeToConsentIfAsked(page: Page): Promise<void> {
  const agree = page.getByRole('button', { name: 'I agree' });
  const today = page.getByRole('heading', { name: 'Today', exact: true });
  await expect(agree.or(today)).toBeVisible();
  if (await agree.isVisible()) await agreeToConsent(page);
  await expect(today).toBeVisible();
}

/** Sign up, confirm by email link (which signs in) and give consent; ends on Today. */
export async function createWebUser(page: Page, email = uniqueEmail()): Promise<string> {
  await signUp(page, email);
  await confirmEmail(page, email);
  await agreeToConsent(page);
  return email;
}

export async function createHabit(page: Page, name: string): Promise<void> {
  await page.goto('/habits/new');
  await page.getByRole('button', { name: 'Start from scratch' }).click();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Create habit' }).click();
  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

export async function nextDiscordId(request: APIRequestContext, discordId: string): Promise<void> {
  const response = await request.get(`/test/discord/next?id=${encodeURIComponent(discordId)}`);
  expect(response.ok()).toBeTruthy();
}

/** Contract v1 hook: a bot-only user (no email, no password) with one habit starting now. */
export async function seedBotOnlyUser(
  request: APIRequestContext,
  discordId: string,
): Promise<void> {
  const response = await request.post('/test/users/bot-only', { data: { discordId } });
  expect(response.ok()).toBeTruthy();
}

/**
 * Proposed test-host hook, not in contract v1: `habitStartDate` (yyyy-MM-dd) backdates the
 * seeded daily habit's start so older days can be backfilled.
 */
export async function seedBotOnlyUserWithStart(
  request: APIRequestContext,
  discordId: string,
  habitStartDate: string,
): Promise<void> {
  const response = await request.post('/test/users/bot-only', {
    data: { discordId, habitStartDate },
  });
  expect(response.ok()).toBeTruthy();
}

export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

export async function localToday(page: Page): Promise<string> {
  const response = await page.request.get('/api/me');
  expect(response.ok()).toBeTruthy();
  const me: { localToday: string } = await response.json();
  return me.localToday;
}
