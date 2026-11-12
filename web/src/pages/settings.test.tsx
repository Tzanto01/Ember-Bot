import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import { env } from '@/lib/env';
import { reminderNames } from '@/lib/native/reminder-names';
import type { ReminderDestination } from '@/lib/models';
import { auth, deviceSync, localMode, push } from '@/lib/services';
import { type FetchMock, me, mockFetch } from '@/lib/test-support';
import SettingsPage from './settings';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));
const exactAlarms = vi.hoisted(() => ({ beta: false, allowed: false, allowExact: vi.fn() }));
const enablePhone = vi.hoisted(() => vi.fn());
vi.mock('@/lib/native/updater', async (original) => ({
  ...(await original<typeof import('@/lib/native/updater')>()),
  updaterAvailable: () => exactAlarms.beta,
}));
vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('account'), evicted: new Store(false) },
    reminders: {
      exactAllowed: async () => exactAlarms.allowed,
      allowExact: (...args: unknown[]) => exactAlarms.allowExact(...args),
      enablePhone: () => enablePhone(),
    },
  };
});

const loadPage = vi.hoisted(() => vi.fn());
vi.mock('@/lib/navigation', async (original) => ({ ...(await original<typeof import('@/lib/navigation')>()), loadPage }));

const notificationPermission = vi.hoisted(() => ({ display: 'granted' }));
vi.mock('@capacitor/local-notifications', () => ({
  LocalNotifications: { checkPermissions: async () => ({ ...notificationPermission }) },
}));

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 20));

let wide = false;

async function open(url: string) {
  auth.setMe(me);
  const fetch = mockFetch();
  const router = renderPage('/settings/:group?', SettingsPage, url);
  (await fetch.next('GET', '/api/me')).respond(200, me);
  await screen.findByRole('heading', { level: 1 });
  return { fetch, router };
}

function path(router: ReturnType<typeof renderPage>) {
  return router.state.location.pathname + router.state.location.search + router.state.location.hash;
}

function openPatches(fetch: FetchMock) {
  return fetch.pending.filter((call) => call.method === 'PATCH');
}

describe('SettingsPage', { timeout: 15_000 }, () => {
  beforeEach(() => {
    wide = false;
    window.matchMedia = (query: string) =>
      ({
        matches: query === '(min-width: 48rem)' && wide,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }) as unknown as MediaQueryList;
  });

  afterEach(() => {
    exactAlarms.beta = false;
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

  it('Account & security starts with who is signed in, then Discord and two-step, and sends a change-password link', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/account');

    const cards = document.querySelectorAll('section');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Account & security');
    expect([...cards].map((card) => card.getAttribute('id'))).toEqual(['account', 'discord', 'two-factor']);
    expect(cards[0]).toHaveAccessibleName('Account');
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
    renderPage('/settings/:group?', SettingsPage, '/settings/account');
    (await fetch.next('GET', '/api/me')).respond(200, discordOnly);

    expect(await screen.findByText('Signed in with Discord')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change password' })).toBeNull();
  });

  it('opens the group of an older /settings#push link, scrolls to that card and focuses its heading', async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const frames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.set(frames.size + 1, callback).size);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    push.available.set(true);
    auth.setMe(me);
    const fetch = mockFetch();
    const router = renderPage('/settings/:group?', SettingsPage, '/settings#push');
    const heading = await screen.findByRole('heading', { name: 'Where Ember reminds you' });
    (await fetch.next('GET', '/api/me')).respond(200, { ...me });
    await settle();

    expect(path(router)).toBe('/settings/reminders#push');
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reminders');
    expect(screen.queryByRole('heading', { name: 'Grace days' })).toBeNull();
    frames.forEach((callback) => callback(0));
    expect(heading).toHaveFocus();
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('push'));
  });

  it('opens the group holding the card in the hash, even from another group', async () => {
    const { router } = await open('/settings/habits#journal');

    await waitFor(() => expect(path(router)).toBe('/settings/privacy#journal'));
    expect(screen.getByRole('region', { name: 'Private journal' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Grace days' })).toBeNull();
  });

  it('on a phone, lists the groups, opens one, and goes back to the list through history', async () => {
    const user = userEvent.setup();
    const { router } = await open('/settings');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Settings');
    expect(document.querySelectorAll('section')).toHaveLength(0);
    expect(screen.queryByRole('link', { name: 'Back to Settings' })).toBeNull();
    const list = within(screen.getByRole('navigation', { name: 'Settings groups' }));
    expect(list.getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Account & security'),
      expect.stringContaining('Reminders'),
      expect.stringContaining('Habits & days'),
      expect.stringContaining('Appearance'),
      expect.stringContaining('Privacy & data'),
      expect.stringContaining('Send feedback'),
    ]);
    const reminders = list.getByRole('link', { name: 'Reminders' });
    expect(reminders).toHaveAccessibleDescription('Where Ember reminds you, Second reminder');

    await user.click(reminders);
    expect(router.state.location.pathname).toBe('/settings/reminders');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Reminders');
    expect(screen.getByRole('combobox', { name: 'Second reminder' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Grace days' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Settings' })).toBeNull();

    await user.click(screen.getByRole('link', { name: 'Back to Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(router.state.historyAction).toBe('POP');
    expect(screen.getByRole('navigation', { name: 'Settings groups' })).toBeInTheDocument();
  });

  it('on a phone, a group opened directly goes back to the list without leaving Settings', async () => {
    const user = userEvent.setup();
    const { router } = await open('/settings/habits');

    await user.click(screen.getByRole('link', { name: 'Back to Settings' }));
    expect(router.state.location.pathname).toBe('/settings');
    expect(router.state.historyAction).toBe('PUSH');
  });

  it('from md, docks the groups in a side rail, opens the first one and marks the current group', async () => {
    wide = true;
    const user = userEvent.setup();
    const { router } = await open('/settings');

    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/account'));
    const rail = within(screen.getByRole('navigation', { name: 'Settings' }));
    expect(rail.getAllByRole('link').map((link) => link.textContent)).toEqual([
      'Account & security',
      'Reminders',
      'Habits & days',
      'Appearance',
      'Privacy & data',
      'Send feedback',
    ]);
    expect(rail.getByRole('link', { name: 'Account & security' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Account' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to Settings' })).toBeNull();

    await user.click(rail.getByRole('link', { name: 'Privacy & data' }));
    expect(router.state.location.pathname).toBe('/settings/privacy');
    expect(rail.getByRole('link', { name: 'Privacy & data' })).toHaveAttribute('aria-current', 'page');
    expect(rail.getByRole('link', { name: 'Account & security' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Privacy & data');
    expect([...document.querySelectorAll('section')].map((card) => card.getAttribute('id'))).toEqual([
      'journal',
      'export',
      'delete',
    ]);
  });

  it('without an account, leaves out the Reminders group and sends its address back to the list', async () => {
    localMode.mode.set('local');
    const { router } = await open('/settings');

    const list = within(screen.getByRole('navigation', { name: 'Settings groups' }));
    expect(list.getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual([
      '/settings/account',
      '/settings/habits',
      '/settings/appearance',
      '/settings/privacy',
      '/settings/feedback',
    ]);
    expect(list.getByRole('link', { name: 'Account & security' })).toHaveAccessibleDescription('On this device');

    await act(() => router.navigate('/settings/reminders'));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
    expect(screen.queryByRole('combobox', { name: 'Second reminder' })).toBeNull();
  });

  it('switches between light, dark and the system setting on this device', async () => {
    const user = userEvent.setup();
    await open('/settings/appearance');

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
    await open('/settings/reminders');

    expect(
      await screen.findByText("Notifications are off for Ember on this phone. You can turn them on in your phone's settings."),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Allow on-time reminders' })).toBeNull();
  });

  it('in the beta app, offers on-time reminders while exact alarms are off, and hides the offer once allowed', async () => {
    env.native = true;
    exactAlarms.beta = true;
    exactAlarms.allowed = false;
    exactAlarms.allowExact.mockResolvedValue(true);
    const user = userEvent.setup();
    await open('/settings/reminders');

    await user.click(await screen.findByRole('button', { name: 'Allow on-time reminders' }));

    expect(exactAlarms.allowExact).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Allow on-time reminders' })).toBeNull());
  });

  it('on the phone, the reminder names switch is off by default and turns the per-device setting on', async () => {
    env.native = true;
    const user = userEvent.setup();
    await open('/settings/reminders');

    const names = screen.getByRole('switch', { name: 'Show habit names in reminders' });
    expect(names).not.toBeChecked();
    expect(names).toHaveAccessibleDescription(/lock screen/);
    await user.click(names);

    expect(reminderNames.get()).toBe(true);
    expect(localStorage.getItem('ember.reminderNames')).toBe('1');
    expect(names).toBeChecked();
  });

  it('sends quick successive grace changes one PATCH at a time, in order', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/habits');
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

  describe('where Ember reminds you', () => {
    const discord: ReminderDestination = { id: 'discord', kind: 'discord', label: 'Discord DMs', enabled: true, current: false };
    const laptop: ReminderDestination = {
      id: 'browser-3',
      kind: 'browser',
      label: 'Firefox on Linux',
      enabled: true,
      current: true,
    };
    const phone: ReminderDestination = { id: 'phone-5', kind: 'phone', label: 'Pixel 8', enabled: false, current: false };

    afterEach(() => {
      vi.restoreAllMocks();
      enablePhone.mockReset();
    });

    it('lists every destination with its switch, marks this browser, and turns one off', async () => {
      const user = userEvent.setup();
      const { fetch } = await open('/settings/reminders');
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord, laptop, phone]);

      const here = await screen.findByRole('switch', { name: 'Firefox on Linux This browser' });
      expect(here).toBeChecked();
      expect(screen.getByRole('switch', { name: 'Discord DMs' })).toBeChecked();
      expect(screen.getByRole('switch', { name: 'Pixel 8' })).not.toBeChecked();

      await user.click(here);
      const patch = await fetch.next('PATCH', '/api/me/reminder-destinations/browser-3');
      expect(patch.body).toEqual({ enabled: false });
      expect(here).not.toBeChecked();
      patch.respond(200, { ...laptop, enabled: false });

      expect(await screen.findByText('Saved.')).toBeInTheDocument();
      expect(here).not.toBeChecked();
      expect(screen.queryByRole('button', { name: 'Turn on reminders in this browser' })).toBeNull();
    });

    it('puts the switch back and says so gently when the change fails', async () => {
      const user = userEvent.setup();
      const { fetch } = await open('/settings/reminders');
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord]);

      await user.click(await screen.findByRole('switch', { name: 'Discord DMs' }));
      (await fetch.next('PATCH', '/api/me/reminder-destinations/discord')).respond(500, { type: 'internal' });

      expect(await screen.findByRole('switch', { name: 'Discord DMs' })).toBeChecked();
      expect(await within(screen.getByRole('region', { name: 'Where Ember reminds you' })).findByRole('alert')).toBeVisible();
    });

    it('turns reminders on in this browser when it is not listed yet, then shows its row', async () => {
      push.available.set(true);
      vi.spyOn(push, 'check').mockResolvedValue();
      const subscribe = vi.spyOn(push, 'subscribe').mockResolvedValue();
      const user = userEvent.setup();
      const { fetch } = await open('/settings/reminders');
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord]);

      await user.click(await screen.findByRole('button', { name: 'Turn on reminders in this browser' }));
      expect(subscribe).toHaveBeenCalledTimes(1);
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord, laptop]);

      expect(await screen.findByRole('switch', { name: 'Firefox on Linux This browser' })).toBeChecked();
      expect(screen.queryByRole('button', { name: 'Turn on reminders in this browser' })).toBeNull();
    });

    it('in the app, turns this phone on and rebuilds its reminders, or says notifications are off when refused', async () => {
      env.native = true;
      const rebuild = vi.spyOn(deviceSync, 'rebuildReminders').mockImplementation(() => undefined);
      enablePhone.mockResolvedValueOnce(null);
      const user = userEvent.setup();
      const { fetch } = await open('/settings/reminders');
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord]);

      await user.click(await screen.findByRole('button', { name: 'Turn on reminders on this phone' }));
      expect(
        await screen.findByText("Notifications are off for Ember on this phone. You can turn them on in your phone's settings."),
      ).toBeInTheDocument();
      rebuild.mockClear();

      const mine = { ...phone, enabled: true, current: true };
      enablePhone.mockResolvedValueOnce(mine);
      await user.click(screen.getByRole('button', { name: 'Turn on reminders on this phone' }));
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [discord, mine]);

      expect(await screen.findByRole('switch', { name: 'Pixel 8 This phone' })).toBeChecked();
      expect(rebuild).toHaveBeenCalled();
    });

    it('in the app, switching this phone off rebuilds its reminders', async () => {
      env.native = true;
      const rebuild = vi.spyOn(deviceSync, 'rebuildReminders').mockImplementation(() => undefined);
      const mine = { ...phone, enabled: true, current: true };
      const user = userEvent.setup();
      const { fetch } = await open('/settings/reminders');
      (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, [mine]);

      await user.click(await screen.findByRole('switch', { name: 'Pixel 8 This phone' }));
      rebuild.mockClear();
      (await fetch.next('PATCH', '/api/me/reminder-destinations/phone-5')).respond(200, { ...mine, enabled: false });

      await waitFor(() => expect(rebuild).toHaveBeenCalled());
      expect(screen.getByRole('switch', { name: 'Pixel 8 This phone' })).not.toBeChecked();
    });
  });

  it('saves the second reminder choice to the account', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/reminders');
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

  it('waits for the grace PATCH before sending the theme one, across groups', async () => {
    wide = true;
    const user = userEvent.setup();
    const { fetch } = await open('/settings/habits');

    await user.selectOptions(screen.getByLabelText('Grace days per week'), '2 days a week');
    await user.click(screen.getByRole('link', { name: 'Appearance' }));
    await user.click(screen.getByRole('radio', { name: 'Fieldnotes' }));

    const first = await fetch.next('PATCH', '/api/me');
    expect(first.body).toEqual({ graceDaysPerWeek: 2 });
    await settle();
    expect(openPatches(fetch)).toHaveLength(0);
    first.respond(200, { ...me, graceDaysPerWeek: 2 });

    const second = await fetch.next('PATCH', '/api/me');
    expect(second.body).toEqual({ theme: 'fieldnotes' });
    second.respond(200, { ...me, graceDaysPerWeek: 2, theme: 'fieldnotes' });

    await waitFor(() => expect(auth.me.get()?.theme).toBe('fieldnotes'));
    await user.click(screen.getByRole('link', { name: 'Habits & days' }));
    expect(screen.getByLabelText('Grace days per week')).toHaveDisplayValue('2 days a week');
    expect(screen.queryByText(/leaderboard/i)).not.toBeInTheDocument();
  });

  it('applies a chosen theme at once and saves it to the account', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/appearance');

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
    const { fetch } = await open('/settings/appearance');

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
    const { fetch, router } = await open('/settings/privacy');

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

  it('signs out everywhere only after the confirmation, and ends signed out', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/account');

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    expect(screen.getByText('This signs you out on every device, including this one.')).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Yes, sign out everywhere' }));
    (await fetch.next('POST', '/api/auth/logout-everywhere')).respond(204);
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);

    await waitFor(() => expect(auth.me.get()).toBeNull());
    expect(fetch.all.some((call) => call.url === '/api/auth/logout')).toBe(false);
  });

  it('cancelling sign out everywhere sends nothing and keeps the session', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/account');

    await user.click(screen.getByRole('button', { name: 'Sign out everywhere' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByText('This signs you out on every device, including this one.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out everywhere' })).toHaveFocus();
    await settle();
    expect(fetch.all.some((call) => call.url.startsWith('/api/auth/logout'))).toBe(false);
    expect(auth.me.get()).not.toBeNull();
  });

  it('says it could not sign out and stays when the server cannot end the session', async () => {
    const user = userEvent.setup();
    const { fetch, router } = await open('/settings/account');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    (await fetch.next('POST', '/api/auth/logout')).respond(503);

    expect(
      await screen.findByText("Ember couldn't sign you out. Check your connection and try again."),
    ).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/settings/account');
    expect(auth.me.get()).not.toBeNull();
  });

  it('offers no browser reminders when the server answers 501 for the push key', async () => {
    const registration = { pushManager: { getSubscription: async () => null } };
    vi.stubGlobal('PushManager', class {});
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: async () => registration, ready: Promise.resolve(registration) },
    });
    const { fetch } = await open('/settings/reminders');

    (await fetch.next('GET', '/api/push/vapid-public-key')).respond(501);
    (await fetch.next('GET', '/api/me/reminder-destinations')).respond(200, []);
    await settle();

    expect(await screen.findByText(/Nothing can remind you yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Turn on reminders in this browser' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Second reminder' })).toBeInTheDocument();
  });

  it('shows the Discord linked notice in its group, reloads me and drops the query from the address', async () => {
    auth.setMe(me);
    const fetch = mockFetch();
    const router = renderPage('/settings/:group?', SettingsPage, '/settings?discord=linked');

    const notice = await screen.findByText('Discord is linked. You can sign in with it from now on.');
    expect(notice.closest('[role="status"]')).not.toBeNull();
    (await fetch.next('GET', '/api/auth/antiforgery')).respond(204);
    (await fetch.next('GET', '/api/me')).respond(200, { ...me, discord: { linked: true, id: '42' } });

    expect(await screen.findByRole('button', { name: 'Unlink Discord' })).toBeInTheDocument();
    expect(path(router)).toBe('/settings/account');
    expect(notice).toBeInTheDocument();
  });

  it('links Discord only after the password: a wrong one is an inline error, the right one goes to Discord', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/account');
    const card = within(screen.getByRole('region', { name: 'Discord' }));

    await user.click(card.getByRole('button', { name: 'Link Discord' }));
    const field = card.getByLabelText('Your password', { exact: true });
    expect(field).toHaveFocus();

    await user.type(field, 'wrong-synthetic-1');
    await user.click(card.getByRole('button', { name: 'Continue to Discord' }));
    const wrong = await fetch.next('POST', '/api/auth/discord/link/start');
    expect(wrong.body).toEqual({ password: 'wrong-synthetic-1' });
    wrong.respond(400, { status: 400, errors: { password: ['The password is not correct.'] } });

    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(field).toHaveAccessibleDescription(expect.stringContaining("That password doesn't match. Try again."));
    expect(field).toHaveFocus();
    expect(loadPage).not.toHaveBeenCalled();

    await user.clear(field);
    await user.type(field, 'synthetic-secret-1');
    await user.click(card.getByRole('button', { name: 'Continue to Discord' }));
    (await fetch.next('POST', '/api/auth/discord/link/start')).respond(204);
    await waitFor(() => expect(loadPage).toHaveBeenCalledWith('/api/auth/discord/link'));
  });

  it('without an account, shows the device card first and no sign-out, Discord, two-step or private journal', async () => {
    localMode.mode.set('local');
    const { router } = await open('/settings/account');

    const cards = document.querySelectorAll('section');
    expect(cards).toHaveLength(1);
    expect(cards[0]).toHaveAccessibleName('On this device');
    expect(within(cards[0] as HTMLElement).getByText(/Browsers can delete site data/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export backup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create an account and keep my data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Sign out' })).toBeNull();

    await act(() => router.navigate('/settings/privacy'));
    expect(screen.getByRole('button', { name: 'Delete everything on this device' })).toBeInTheDocument();
    for (const name of ['Discord', 'Two-step sign-in', 'Private journal', 'Your data', 'Delete your account']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    expect(screen.queryByRole('button', { name: 'Delete my account' })).toBeNull();

    await act(() => router.navigate('/settings/habits'));
    expect(screen.getByRole('heading', { name: 'Timezone' })).toBeInTheDocument();
  });

  it('sends feedback from its own Settings group with an account', async () => {
    const user = userEvent.setup();
    const { fetch } = await open('/settings/feedback');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Send feedback');
    await user.type(screen.getByRole('textbox', { name: /Your feedback/ }), 'Hello');
    await user.click(screen.getByRole('button', { name: 'Send' }));
    (await fetch.next('POST', '/api/feedback')).respond(204);
    await screen.findByText('Thank you, that really helps.');
  });

  it('shows the feedback form without an account too', async () => {
    localMode.mode.set('local');
    await open('/settings/feedback');

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Send feedback');
    expect(screen.getByRole('textbox', { name: /Your feedback/ })).toBeInTheDocument();
  });

  it('links to routines', async () => {
    const user = userEvent.setup();
    const { router } = await open('/settings/habits');

    await user.click(screen.getByRole('link', { name: 'Your routines' }));
    expect(router.state.location.pathname).toBe('/routines');
  });
});
