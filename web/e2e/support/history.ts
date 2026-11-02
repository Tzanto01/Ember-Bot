import { expect, type Page } from '@playwright/test';

export type DayAction = 'Done' | 'Not done' | 'Mark as a low day';
export type DayState = 'done' | 'notdone' | 'lowday';

function shiftMonth(month: string, step: number): string {
  const [year, number] = month.split('-').map(Number);
  const moved = new Date(Date.UTC(year, number - 1 + step, 1));
  return moved.toISOString().slice(0, 7);
}

/** Pages the History calendar until the month containing `date` is shown. */
export async function showMonthOf(page: Page, date: string): Promise<void> {
  const target = date.slice(0, 7);
  const dayButtons = page.locator('button[id^="day-"]');
  await expect(dayButtons.first()).toBeVisible();
  for (let attempt = 0; attempt < 3; attempt++) {
    const shown = (await dayButtons.first().getAttribute('id') ?? '').slice(4, 11);
    if (shown === target) return;
    const step = target < shown ? -1 : 1;
    await page.getByRole('button', { name: step < 0 ? 'Previous month' : 'Next month' }).click();
    await expect(page.locator(`button[id^="day-${shiftMonth(shown, step)}"]`).first()).toBeVisible();
  }
}

export function dayButton(page: Page, date: string) {
  return page.locator(`#day-${date}`);
}

export async function expectDayState(page: Page, date: string, state: DayState): Promise<void> {
  await showMonthOf(page, date);
  await expect(dayButton(page, date)).toHaveAttribute('data-state', state);
}

/** Opens the day panel for `date`, presses `action` and waits for the calendar to show `state`. */
export async function editDay(page: Page, date: string, action: DayAction, state: DayState): Promise<void> {
  await showMonthOf(page, date);
  if ((await dayButton(page, date).getAttribute('aria-expanded')) !== 'true') {
    await dayButton(page, date).click();
  }
  await expect(dayButton(page, date)).toHaveAttribute('aria-expanded', 'true');
  await page.locator('#day-panel').getByRole('button', { name: action, exact: true }).click();
  await expect(dayButton(page, date)).toHaveAttribute('data-state', state);
}
