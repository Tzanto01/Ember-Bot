import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { env } from '@/lib/env';
import { reminderNames } from '@/lib/native/reminder-names';
import { auth, localMode, push } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import SettingsPage from './settings';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('account'), evicted: new Store(false) },
  };
});

const notificationPermission = vi.hoisted(() => ({ display: 'granted' }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { checkPermissions: async () => ({ ...notificationPermission }) },
}));

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
    env.native = false;
    reminderNames.set(false);
    localMode.mode.set('account');
    push.available.set(false);
    document.documentElement.classList.remove('dark');
    notificationPermission.display = 'granted';
  });

  it('starts with the account: who is signed in, then Appearance, and sends a change-password link', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();

    const cards = document.querySelectorAll('section');
    expect(cards[0]).toHaveAccessibleName('Account');
    expect(cards[1]).toHaveAccessibleName('Appearance');
    const account = within(cards[0] as HTMLElement);
    expect(account.getByText(/Signed in as/)).toHaveTextContent('Signed in as a@example.test');
    expect(account.queryByRole('link', { name: 'Privacy' })).toBeNull();

    await user.click(account.getByRole('button', { name: 'Change password' }));
    const sent = await fetch.next('POST', '/api/auth/forgotPassword');
    expect(sent.body).toEqual({ email: 'a@example.test' });
    sent.respond(200);
    expect(await account.findByText(/We sent a link to a@example.test/)).toBeInTheDocument();
  });

  it('for a Discord-only account, says so and offers no password change', async () => {
    const discordOnly = { ...me, email: null, hasPassword: false, discord: { linked: true, id: '42' } };
    auth.setMe(discordOnly);
    const fetch = mockFetch();
    renderPage('/settings', SettingsPage, '/settings');
    (await fetch.next('GET', '/api/me')).respond(200, discordOnly);

    expect(await screen.findByText('Signed in with Discord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('scrolls to the card named in the address and focuses its heading, as /settings#push', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.set(frames.size + 1, callback).size);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    push.available.set(true);
    auth.setMe(me);
    const fetch = mockFetch();
    renderPage('/settings', SettingsPage, '/settings#push');
    const heading = await screen.findByRole('heading', { name: 'Notifications on this device' });
    (await fetch.next('GET', '/api/me')).respond(200, { ...me });
    await settle();

    frames.forEach((callback) => callback(0));
    expect(heading).toHaveFocus();
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('push'));
  });

  it('switches between light, dark and the system setting on this device', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => undefined }));
    const user = userEvent.setup();
    await open();

    expect(screen.getByRole('radio', { name: 'System' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('ember.colorScheme')).toBe('dark');

    await user.click(screen.getByRole('radio', { name: 'System' }));
    expect(document.documentElement).not.toHaveClass('dark');
    expect(localStorage.getItem('ember.colorScheme')).toBeNull();
  });

  it('on the phone, says how to turn notifications back on when they are off for Ember', async () => {
    env.native = true;
    notificationPermission.display = 'denied';
    await open();

    expect(
      await screen.findByText("Notifications are off for Ember on this phone. You can turn them on in your phone's settings."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow exact reminder times' })).toBeNull();
  });

  it('on the phone, the reminder names switch is off by default and turns the per-device setting on', async () => {
    env.native = true;
    const user = userEvent.setup();
    await open();

    const names = screen.getByRole('switch', { name: 'Show habit names in reminders' });
    expect(names).not.toBeChecked();
    expect(names).toHaveAccessibleDescription(/lock screen/);
    await user.click(names);

    expect(reminderNames.get()).toBe(true);
    expect(localStorage.getItem('ember.reminderNames')).toBe('1');
    expect(names).toBeChecked();
  });

  it('lists the two-step sign-in, private journal and moods sections in the side nav', async () => {
    await open();

    const nav = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(nav).getByRole('link', { name: 'Private journal' })).toHaveAttribute('href', '#journal');
    expect(within(nav).getByRole('link', { name: 'Two-step sign-in' })).toHaveAttribute('href', '#two-factor');
    expect(document.getElementById('journal')).toHaveAccessibleName('Private journal');
    expect(screen.getByRole('heading', { name: 'Moods' })).toBeInTheDocument();
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

  it('saves the second reminder choice to the account', async () => {
    const user = userEvent.setup();
    const { fetch } = await open();
    const select = screen.getByRole('combobox', { name: 'Second reminder' });
    expect(select).toHaveDisplayValue('Off');
    expect(select).toHaveAccessibleDescription("If you haven't checked in yet, Ember nudges you once more.");

    await user.selectOptions(select, '1 hour');

    const patch = await fetch.next('PATCH', '/api/me');
    expect(patch.body).toEqual({ secondReminderMinutes: 60 });
    patch.respond(200, { ...me, secondReminderMinutes: 60 });
    await waitFor(() => expect(auth.me.get()?.secondReminderMinutes).toBe(60));
    expect(select).toHaveDisplayValue('1 hour');
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

  it('without an account, shows the device card first and no sign-out, Discord, two-step or private journal', async () => {
    localMode.mode.set('local');
    await open();

    const cards = document.querySelectorAll('section');
    expect(cards[0]).toHaveAccessibleName('On this device');
    expect(within(cards[0] as HTMLElement).getByText(/Browsers can delete site data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create an account and keep my data' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete everything on this device' })).toBeInTheDocument();
    for (const name of ['Discord', 'Two-step sign-in', 'Private journal', 'Your data', 'Delete your account']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Timezone' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Second reminder' })).toHaveDisplayValue('Off');
  });
});
