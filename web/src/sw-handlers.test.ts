import { describe, expect, it, type Mock, vi } from 'vitest';
import { handleNotificationClick, handlePush } from './sw-handlers';

/** Exactly what `WebPushReminderChannel` sends (contract v1.3, web push). */
const botPayload =
  '{"notification":{"title":"Ember","body":"A gentle nudge from Ember","data":{"onActionClick":{"default":{"operation":"navigateLastFocusedOrOpen","url":"/today"}}}}}';

const origin = 'https://ember.example';

function registration() {
  return { showNotification: vi.fn(async () => undefined) };
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
