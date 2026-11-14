import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Habit, Me } from '@/lib/models';
import { auth } from '@/lib/services';
import { type FetchMock, habit, me, mockFetch } from '@/lib/test-support';
import { readTipMemory } from '@/lib/tips';
import { renderPage } from '@/test-utils';
import { TipSlot } from './tip-slot';

const notes = [{ version: '0.10.0-beta.1', date: '2026-11-14', notes: { en: ['Something new.'] } }];
const three: Habit[] = [1, 2, 3].map((id) => ({ ...habit, id, name: `Habit ${id}` }));

function renderSlot(f: FetchMock, user: Me, slot: ComponentType) {
  auth.setMe(user);
  renderPage('/today', slot, '/today');
  return f.next('GET', '/release-notes.json').then((call) => call.respond(200, notes));
}

describe('TipSlot', () => {
  let f: FetchMock;

  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('ember.seenReleaseNotes', '0.10.0-beta.1');
    f = mockFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    auth.clearSession();
  });

  it('asks about streaks and turns them on with "Show streaks"', async () => {
    await renderSlot(f, { ...me, id: 'streaks-yes', showStreaks: false, tipsSeen: [] }, () => (
      <TipSlot place="top" habits={[habit]} />
    ));

    expect(await screen.findByRole('heading', { name: 'Do you want to see streaks?' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Dismiss tip' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Show streaks' }));
    const patch = await f.next('PATCH', '/api/me');
    expect(patch.body).toEqual({ showStreaks: true });
    patch.respond(200, { ...me, id: 'streaks-yes', showStreaks: true, tipsSeen: ['streaks'] });

    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Do you want to see streaks?' })).toBeNull());
    expect(auth.me.get()?.showStreaks).toBe(true);
  });

  it('keeps streaks off with "Not for me", hiding at once and marking the question seen', async () => {
    await renderSlot(f, { ...me, id: 'streaks-no', showStreaks: false, tipsSeen: [] }, () => (
      <TipSlot place="top" habits={[habit]} />
    ));

    await userEvent.click(await screen.findByRole('button', { name: 'Not for me' }));

    expect(screen.queryByRole('heading', { name: 'Do you want to see streaks?' })).toBeNull();
    (await f.next('PUT', '/api/me/tips/streaks')).respond(204);
    expect(auth.me.get()).toMatchObject({ showStreaks: false, tipsSeen: ['streaks'] });
    expect(f.all.some((c) => c.method === 'PATCH')).toBe(false);
    await waitFor(() => expect(readTipMemory('streaks-no')).toMatchObject({ wait: '2026-11-01', pending: [] }));
  });

  it('dismisses a link tip with the × and sends the mark', async () => {
    await renderSlot(f, { ...me, id: 'dismiss', tipsSeen: ['streaks'] }, () => (
      <TipSlot place="below" habits={three} routines={[]} />
    ));
    (await f.next('GET', '/api/day-notes')).respond(200, []);

    expect(await screen.findByRole('link', { name: 'Make a routine' })).toHaveAttribute('href', '/routines/new');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }));

    expect(screen.queryByRole('link', { name: 'Make a routine' })).toBeNull();
    (await f.next('PUT', '/api/me/tips/routines')).respond(204);
    await waitFor(() => expect(readTipMemory('dismiss').pending).toEqual([]));
  });

  it('keeps a failed mark on the device, stays hidden and sends it again when back online', async () => {
    await renderSlot(f, { ...me, id: 'offline', tipsSeen: ['streaks'] }, () => (
      <TipSlot place="below" habits={three} routines={[]} />
    ));
    (await f.next('GET', '/api/day-notes')).respond(200, []);

    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss tip' }));
    (await f.next('PUT', '/api/me/tips/routines')).fail();

    await waitFor(() => expect(readTipMemory('offline').pending).toEqual(['routines']));
    expect(screen.queryByRole('link', { name: 'Make a routine' })).toBeNull();
    act(() => void window.dispatchEvent(new Event('online')));
    (await f.next('PUT', '/api/me/tips/routines')).respond(204);
    await waitFor(() => expect(readTipMemory('offline').pending).toEqual([]));
  });

  it('sends marks left from an earlier start and keeps those tips hidden meanwhile', async () => {
    localStorage.setItem('ember.tips.restart', JSON.stringify({ first: '2026-10-01', pending: ['routines'] }));
    await renderSlot(f, { ...me, id: 'restart', tipsSeen: ['streaks'] }, () => (
      <TipSlot place="below" habits={three} routines={[]} />
    ));

    (await f.next('PUT', '/api/me/tips/routines')).respond(204);
    (await f.next('GET', '/api/day-notes')).respond(200, []);
    await waitFor(() => expect(readTipMemory('restart').pending).toEqual([]));
    expect(screen.queryByRole('link', { name: 'Make a routine' })).toBeNull();
  });
});
