import { expect, type Page } from '@playwright/test';
import { addDays, localToday } from './accounts';

export interface TipsMe {
  id: string;
  showStreaks: boolean;
  tipsSeen: string[];
}

export async function me(page: Page): Promise<TipsMe> {
  const response = await page.request.get('/api/me');
  expect(response.ok()).toBeTruthy();
  return response.json();
}

async function xsrf(page: Page): Promise<Record<string, string>> {
  await page.request.get('/api/auth/antiforgery');
  const token = (await page.context().cookies()).find((c) => c.name === 'XSRF-TOKEN')?.value ?? '';
  return { 'X-XSRF-TOKEN': decodeURIComponent(token) };
}

export async function markTipSeen(page: Page, id: string): Promise<void> {
  const response = await page.request.put(`/api/me/tips/${id}`, { headers: await xsrf(page) });
  expect(response.ok(), await response.text()).toBeTruthy();
}

export async function turnOnCalmMode(page: Page): Promise<void> {
  const response = await page.request.patch('/api/me', { headers: await xsrf(page), data: { calmMode: true } });
  expect(response.ok(), await response.text()).toBeTruthy();
}

/** Proxy: the account's local day is reported one day later, so the account's first local day is over. */
export async function nextDay(page: Page): Promise<void> {
  const tomorrow = addDays(await localToday(page), 1);
  await page.route('**/api/me', async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), localToday: tomorrow } });
  });
}
