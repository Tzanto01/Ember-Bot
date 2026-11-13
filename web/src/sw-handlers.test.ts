import { describe, expect, it, type Mock, vi } from 'vitest';
import {
  handleDoneAction,
  handleMessage,
  handleNotificationClick,
  handlePush,
  loggedBody,
} from './sw-handlers';

/** Exactly what `WebPushReminderChannel` sends (contract v1.3, web push). */
const botPayload =
  '{"notification":{"title":"Ember","body":"A gentle nudge from Ember","data":{"onActionClick":{"default":{"operation":"navigateLastFocusedOrOpen","url":"/today"}}}}}';

/** What `WebPushReminderChannel` sends for a single-habit reminder (contract v1.9): the Done action and its token. */
const donePayload =
  '{"notification":{"title":"Ember","body":"A gentle nudge from Ember","actions":[{"action":"done","title":"Done \\u2705"}],"data":{"onActionClick":{"default":{"operation":"navigateLastFocusedOrOpen","url":"/today"}},"doneToken":"tok-123"}}}';

const origin = 'https://ember.example';

function registration(shown: { tag: string; close: Mock }[] = []) {
  return {
    showNotification: vi.fn(async (_title: string, _options?: NotificationOptions) => undefined),
    getNotifications: vi.fn(async (filter?: GetNotificationOptions) =>
      shown.filter((n) => n.tag === filter?.tag) as unknown as Notification[],
    ),
  };
}

describe('handlePush', () => {
  it('shows the bot payload with its title and body and passes the click data through', async () => {
    const reg = registration();

    await handlePush({ json: () => JSON.parse(botPayload) }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith('Ember', {
      body: 'A gentle nudge from Ember',
      data: {
        onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/today' } },
      },
    });
  });

  it('shows the Done action and keeps the token in the data', async () => {
    const reg = registration();

    await handlePush({ json: () => JSON.parse(donePayload) }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith('Ember', {
      body: 'A gentle nudge from Ember',
      actions: [{ action: 'done', title: 'Done ✅' }],
      data: {
        onActionClick: { default: { operation: 'navigateLastFocusedOrOpen', url: '/today' } },
        doneToken: 'tok-123',
      },
    });
  });

  it('drops malformed actions', async () => {
    const reg = registration();

    await handlePush({ json: () => ({ notification: { actions: [{ action: 1 }, 'x', null] } }) }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: 'A gentle nudge from Ember' });
  });

  it.each([
    ['no payload', null],
    ['a body that is not JSON', { json: () => JSON.parse('not json') }],
    ['a payload without a notification', { json: () => ({ hello: 1 }) }],
    ['a notification that is not an object', { json: () => ({ notification: 'x' }) }],
    ['an empty title', { json: () => ({ notification: { title: '' } }) }],
  ])('still shows an "Ember" notification for %s', async (_name, data) => {
    const reg = registration();

    await handlePush(data, reg);

    expect(reg.showNotification).toHaveBeenCalledTimes(1);
    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: 'A gentle nudge from Ember' });
  });
});

describe('handlePush tags and clears (v1.14)', () => {
  const tagged = JSON.parse(botPayload) as { notification: Record<string, unknown> };
  tagged.notification['tag'] = 'habit-7';

  it('shows a tagged reminder under its tag and alerts again, so the second reminder replaces the first audibly', async () => {
    const reg = registration();

    await handlePush({ json: () => tagged }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith(
      'Ember',
      expect.objectContaining({ body: 'A gentle nudge from Ember', tag: 'habit-7', renotify: true }),
    );
  });

  it('closes every notification with the cleared tag after a silent Logged one, and leaves other tags alone', async () => {
    const reminder = { tag: 'habit-7', close: vi.fn() };
    const second = { tag: 'habit-7', close: vi.fn() };
    const other = { tag: 'routine-3', close: vi.fn() };
    const reg = registration([reminder, second, other]);
    const clear = {
      clear: { tag: 'habit-7' },
      notification: { title: 'Ember', body: loggedBody, data: { onActionClick: { default: { url: '/today' } } } },
    };

    await handlePush({ json: () => clear }, reg);

    expect(reg.showNotification).toHaveBeenCalledTimes(1);
    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { tag: 'habit-7', body: loggedBody, silent: true });
    expect(reminder.close).toHaveBeenCalled();
    expect(second.close).toHaveBeenCalled();
    expect(other.close).not.toHaveBeenCalled();
  });

  it.each([
    ['a tag that is not a string', { clear: { tag: 7 } }],
    ['an empty tag', { clear: { tag: '' } }],
    ['a clear that is not an object', { clear: 'habit-7' }],
  ])('treats a clear with %s as a normal push and still shows one', async (_name, payload) => {
    const reminder = { tag: 'habit-7', close: vi.fn() };
    const reg = registration([reminder]);

    await handlePush({ json: () => payload }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: 'A gentle nudge from Ember' });
    expect(reminder.close).not.toHaveBeenCalled();
  });

  it('shows the payload notification when the clear is malformed but a notification came with it', async () => {
    const reg = registration();

    await handlePush({ json: () => ({ clear: { tag: null }, notification: { title: 'Ember', body: loggedBody } }) }, reg);

    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: loggedBody });
  });
});

describe('handleNotificationClick', () => {
  interface FakeWindow {
    url: string;
    focus: Mock;
    navigate: Mock;
  }

  function windowClient(url: string): FakeWindow {
    const client: FakeWindow = { url, focus: vi.fn(), navigate: vi.fn() };
    client.focus.mockResolvedValue(client);
    client.navigate.mockResolvedValue(client);
    return client;
  }

  function clients(windows: FakeWindow[]) {
    return {
      matchAll: vi.fn(async () => windows),
      openWindow: vi.fn(async () => null),
    } as unknown as Clients & { openWindow: Mock };
  }

  const notification = (data: unknown) => ({ close: vi.fn(), data });
  const botData = JSON.parse(botPayload).notification.data;

  it('focuses an open window of this origin and moves it to the target', async () => {
    const elsewhere = windowClient('https://other.example/today');
    const open = windowClient(`${origin}/history?month=2026-10`);
    const note = notification(botData);
    const all = clients([elsewhere, open]);

    await handleNotificationClick(note, all, origin);

    expect(note.close).toHaveBeenCalled();
    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).toHaveBeenCalledWith(`${origin}/today`);
    expect(elsewhere.focus).not.toHaveBeenCalled();
    expect(all.openWindow).not.toHaveBeenCalled();
  });

  it('only focuses a window that already shows the target', async () => {
    const open = windowClient(`${origin}/today`);

    await handleNotificationClick(notification(botData), clients([open]), origin);

    expect(open.focus).toHaveBeenCalled();
    expect(open.navigate).not.toHaveBeenCalled();
  });

  it('opens /today when no window of this origin is open', async () => {
    const note = notification(botData);
    const all = clients([windowClient('https://other.example/')]);

    await handleNotificationClick(note, all, origin);

    expect(note.close).toHaveBeenCalled();
    expect(all.openWindow).toHaveBeenCalledWith('/today');
  });

  it.each(['focus', 'navigate'] as const)(
    'opens the target in a new window when %s of the open window rejects',
    async (failing) => {
      const open = windowClient(`${origin}/history`);
      open[failing].mockRejectedValue(new Error('detached'));
      const all = clients([open]);

      await handleNotificationClick(notification(botData), all, origin);

      expect(all.openWindow).toHaveBeenCalledWith('/today');
    },
  );

  it.each([
    ['an absolute URL', 'https://evil.example/today'],
    ['a protocol-relative URL', '//evil.example/today'],
    ['a missing URL', undefined],
  ])('opens /today instead of %s', async (_name, url) => {
    const all = clients([]);

    await handleNotificationClick(
      notification({ onActionClick: { default: { url } } }),
      all,
      origin,
    );

    expect(all.openWindow).toHaveBeenCalledWith('/today');
  });
});

describe('handleDoneAction', () => {
  const doneData = JSON.parse(donePayload).notification.data;

  function setup(response: () => Promise<Response>) {
    const note = { close: vi.fn(), data: doneData };
    const reg = registration();
    const all = {
      matchAll: vi.fn(async () => []),
      openWindow: vi.fn(async () => null),
    } as unknown as Clients & { openWindow: Mock };
    const post = vi.fn(response);
    return { note, reg, all, post };
  }

  it('posts the token without cookies and confirms without naming a habit, without opening the app', async () => {
    const { note, reg, all, post } = setup(async () => new Response(null, { status: 204 }));

    await handleDoneAction(note, reg, all, origin, post);

    expect(note.close).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/api/reminders/done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'tok-123' }),
      credentials: 'omit',
    });
    expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: loggedBody });
    expect(all.openWindow).not.toHaveBeenCalled();
  });

  it('confirms in German when the page stored German as its language', async () => {
    const match = vi.fn(async () => new Response('de'));
    vi.stubGlobal('caches', { match });
    try {
      const { note, reg, all, post } = setup(async () => new Response(null, { status: 204 }));

      await handleDoneAction(note, reg, all, origin, post);

      expect(match).toHaveBeenCalledWith('/language', { cacheName: 'ember-language' });
      expect(reg.showNotification).toHaveBeenCalledWith('Ember', { body: 'Eingetragen. Schön gemacht. ✅' });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each([
    ['the token is unknown', async () => new Response(null, { status: 404 })],
    ['the token expired', async () => new Response(null, { status: 410 })],
    ['the network fails', () => Promise.reject(new TypeError('offline'))],
  ])('opens /today instead when %s', async (_name, response) => {
    const { note, reg, all, post } = setup(response);

    await handleDoneAction(note, reg, all, origin, post);

    expect(reg.showNotification).not.toHaveBeenCalled();
    expect(all.openWindow).toHaveBeenCalledWith('/today');
  });

  it('opens /today without a request when the notification has no token', async () => {
    const { reg, all, post } = setup(async () => new Response(null, { status: 204 }));

    await handleDoneAction({ close: vi.fn(), data: botPayloadData() }, reg, all, origin, post);

    expect(post).not.toHaveBeenCalled();
    expect(all.openWindow).toHaveBeenCalledWith('/today');
  });
});

function botPayloadData(): unknown {
  return JSON.parse(botPayload).notification.data;
}

describe('handleMessage', () => {
  it('activates the waiting worker on SKIP_WAITING and ignores any other message', async () => {
    const worker = { skipWaiting: vi.fn(async () => undefined) };

    await handleMessage({ type: 'PING' }, worker);
    await handleMessage(null, worker);
    expect(worker.skipWaiting).not.toHaveBeenCalled();

    await handleMessage({ type: 'SKIP_WAITING' }, worker);
    expect(worker.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
