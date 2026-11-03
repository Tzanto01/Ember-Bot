import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { auth } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import SettingsPage from './settings';

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

async function open() {
  auth.setMe(me);
  const fetch = mockFetch();
  const router = renderPage('/settings', SettingsPage, '/settings');
  (await fetch.next('GET', '/api/me')).respond(200, me);
  await screen.findByRole('heading', { name: 'Grace days' });
  return { fetch, router };
}

function openPatches(fetch: FetchMock) {
  return fetch.pending.filter((call) => call.method === 'PATCH');
}

describe('SettingsPage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (navigator as { serviceWorker?: unknown }).serviceWorker;
    auth.clearSession();
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
  });

  it('sends quick successive grace changes one PATCH at a time, in order', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();
    const select = screen.getByLabelText('Grace days per week');

    await user.selectOptions(select, '2 days a week');
    await user.selectOptions(select, '3 days a week');

    const first = await fetch.next('PATCH', '/api/me');
    expect(first.body).toEqual({ graceDaysPerWeek: 2 });
    await settle();
    expect(openPatches(fetch)).toHaveLength(0);
    first.respond(200, { ...me, graceDaysPerWeek: 2 });

    const second = await fetch.next('PATCH', '/api/me');
    expect(second.body).toEqual({ graceDaysPerWeek: 3 });
    second.respond(200, { ...me, graceDaysPerWeek: 3 });

    await waitFor(() => expect(select).toHaveDisplayValue('3 days a week'));
    expect(screen.getByText('Saved.')).toBeInTheDocument();
  });

  it('waits for the grace PATCH before sending the theme one', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();

    await user.selectOptions(screen.getByLabelText('Grace days per week'), '2 days a week');
    await user.click(screen.getByRole('radio', { name: 'Fieldnotes' }));

    const first = await fetch.next('PATCH', '/api/me');
    expect(first.body).toEqual({ graceDaysPerWeek: 2 });
    await settle();
    expect(openPatches(fetch)).toHaveLength(0);
    first.respond(200, { ...me, graceDaysPerWeek: 2 });

    const second = await fetch.next('PATCH', '/api/me');
    expect(second.body).toEqual({ theme: 'fieldnotes' });
    second.respond(200, { ...me, graceDaysPerWeek: 2, theme: 'fieldnotes' });

    await waitFor(() => expect(screen.getByLabelText('Grace days per week')).toHaveDisplayValue('2 days a week'));
    expect(screen.queryByText(/leaderboard/i)).not.toBeInTheDocument();
  });

  it('applies a chosen theme at once and saves it to the account', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();

    await user.click(screen.getByRole('radio', { name: 'Fieldnotes' }));

    expect(document.documentElement.dataset['theme']).toBe('fieldnotes');
    expect(localStorage.getItem('ember.theme')).toBe('fieldnotes');
    const patch = await fetch.next('PATCH', '/api/me');
    expect(patch.body).toEqual({ theme: 'fieldnotes' });
    patch.respond(200, { ...me, theme: 'fieldnotes' });
    await waitFor(() => expect(auth.me.get()?.theme).toBe('fieldnotes'));
    expect(localStorage.getItem('ember.accountTheme')).toBe('fieldnotes');
    expect(screen.getByRole('radio', { name: 'Fieldnotes' })).toBeChecked();
  });

  it('keeps the chosen theme on this device and says so gently when saving it fails', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();

    await user.click(screen.getByRole('radio', { name: 'Tidepool' }));
    (await fetch.next('PATCH', '/api/me')).fail();

    const status = await screen.findByText(/couldn't save it to your account/);
    expect(status.closest('[role="status"]')).not.toBeNull();
    expect(document.documentElement.dataset['theme']).toBe('tidepool');
    expect(localStorage.getItem('ember.theme')).toBe('tidepool');
    expect(screen.getByRole('radio', { name: 'Tidepool' })).toBeChecked();
  });

  it('deletes the account with the password and lands on /login?reason=deleted', async () => {
    const user = userEvent.setup();
    const { fetch, router } = await open();

    await user.type(screen.getByLabelText('Your password', { exact: true }), 'synthetic-secret-1');
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(screen.getByRole('button', { name: 'Delete my account' }));

    const remove = await fetch.next('POST', '/api/me/delete');
    expect(remove.body).toEqual({ password: 'synthetic-secret-1', confirm: 'DELETE' });
    remove.respond(204);
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);

    await waitFor(() =>
      expect(router.state.location.pathname + router.state.location.search).toBe('/login?reason=deleted'),
    );
    expect(auth.me.get()).toBeNull();
  });

  it('says it could not sign out and stays when the server cannot end the session', async () => {
    const user = userEvent.setup();
    const { fetch, router } = await open();

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    (await fetch.next('POST', '/api/auth/logout')).respond(503);

    expect(
      await screen.findByText("Ember couldn't sign you out. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings');
    expect(auth.me.get()).not.toBeNull();
  });

  it('hides the notifications section when the server answers 501 for the push key', async () => {
    const registration = { pushManager: { getSubscription: async () => null } };
    vi.stubGlobal('PushManager', class {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
    });
    const { fetch } = await open();

    (await fetch.next('GET', '/api/push/vapid-public-key')).respond(501);
    await settle();

    expect(screen.queryByRole('heading', { name: 'Notifications on this device' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeInTheDocument();
  });

  it('shows the Discord linked notice, reloads me and drops the query from the address', async () => {
    auth.setMe(me);
    const fetch = mockFetch();
    const router = renderPage('/settings', SettingsPage, '/settings?discord=linked');

    const notice = await screen.findByText('Discord is linked. You can sign in with it from now on.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);
    (await fetch.next('GET', '/api/me')).respond(200, { ...me, discord: { linked: true, id: '42' } });

    expect(await screen.findByRole('button', { name: 'Unlink Discord' })).toBeInTheDocument();
    expect(router.state.location.search).toBe('');
  });
});
