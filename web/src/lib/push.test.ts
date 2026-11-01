import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { ApiClient } from './api-client';
import { DeviceStore } from './device-store';
import { Http } from './http';
import { OfflineQueue } from './offline-queue';
import { PushService } from './push';
import { type FetchMock, mockFetch } from './test-support';

const endpoint = 'https://push.example.test/send/a b&c=1';
const removal = `/api/me/push-subscriptions?endpoint=${encodeURIComponent(endpoint)}`;
/** Base64url VAPID key whose bytes are 01 02 03 FB FF. */
const vapidKey = 'AQID-_8';

describe('PushService', () => {
  let mock: FetchMock;
  let current: PushSubscription | null;
  let unsubscribe: Mock;
  let subscribe: Mock;

  function browserSubscription(): PushSubscription {
    return {
      endpoint,
      unsubscribe,
      toJSON: () => ({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } }),
    } as unknown as PushSubscription;
  }

  function setup(initial: 'subscribed' | 'none' = 'none') {
    mock = mockFetch();
    unsubscribe = vi.fn().mockResolvedValue(true);
    current = initial === 'subscribed' ? browserSubscription() : null;
    subscribe = vi.fn(async () => browserSubscription());
    const registration = {
      pushManager: { getSubscription: async () => current, subscribe },
    } as unknown as ServiceWorkerRegistration;
    const api = new ApiClient(
      new Http({ native: false, apiBase: '' }),
      new OfflineQueue(new DeviceStore()),
    );
    return new PushService(api, async () => registration);
  }

  async function checked(service: PushService) {
    const done = service.check();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(200, { key: vapidKey });
    await done;
  }

  afterEach(() => vi.unstubAllGlobals());

  it('stays unavailable when the server answers 501', async () => {
    const service = setup();
    const done = service.check();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(501);
    await done;

    expect(service.available.get()).toBe(false);
  });

  it('becomes available once the server returns a key', async () => {
    const service = setup();
    await checked(service);

    expect(service.available.get()).toBe(true);
  });

  it('stays unavailable and asks the server nothing without a service worker', async () => {
    mock = mockFetch();
    const api = new ApiClient(
      new Http({ native: false, apiBase: '' }),
      new OfflineQueue(new DeviceStore()),
    );
    const service = new PushService(api, async () => null);

    await service.check();
    await service.claim();

    expect(service.available.get()).toBe(false);
    expect(mock.all).toEqual([]);
  });

  it('registers the browser subscription with endpoint and keys', async () => {
    const service = setup();
    await checked(service);

    const done = service.subscribe();
    const request = await mock.next('POST', '/api/me/push-subscriptions');
    expect(request.body).toEqual({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } });
    expect(subscribe).toHaveBeenCalledWith({
      userVisibleOnly: true,
      applicationServerKey: new Uint8Array([1, 2, 3, 251, 255]),
    });
    request.respond(204);
    await done;

    expect(unsubscribe).not.toHaveBeenCalled();
    expect(service.subscribed.get()).toBe(true);
  });

  it('rolls back the browser subscription when the server rejects it', async () => {
    const service = setup();
    await checked(service);

    const outcome = service.subscribe().then(
      () => 'resolved',
      () => 'rejected',
    );
    (await mock.next('POST', '/api/me/push-subscriptions')).respond(500);

    expect(await outcome).toBe('rejected');
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('claim re-registers the existing browser subscription once', async () => {
    const service = setup('subscribed');

    const done = service.claim();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(200, { key: vapidKey });
    const request = await mock.next('POST', '/api/me/push-subscriptions');
    expect(request.body).toEqual({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } });
    request.respond(204);
    await done;

    expect(mock.all.filter((c) => c.method === 'POST')).toHaveLength(1);
  });

  it('claim makes no call without a browser subscription', async () => {
    const service = setup();

    const done = service.claim();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(200, { key: vapidKey });
    await done;

    expect(mock.all.some((c) => c.url.includes('push-subscriptions'))).toBe(false);
  });

  it('claim makes no call and does not throw when the server offers no push', async () => {
    const service = setup('subscribed');

    const done = service.claim();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(501);

    await expect(done).resolves.toBeUndefined();
    expect(mock.all.some((c) => c.url.includes('push-subscriptions'))).toBe(false);
  });

  it('claim does not throw when the server rejects the registration', async () => {
    const service = setup('subscribed');

    const done = service.claim();
    (await mock.next('GET', '/api/push/vapid-public-key')).respond(200, { key: vapidKey });
    (await mock.next('POST', '/api/me/push-subscriptions')).respond(500);

    await expect(done).resolves.toBeUndefined();
  });

  it('removes the server subscription by endpoint before unsubscribing the browser', async () => {
    const service = setup('subscribed');
    const order: string[] = [];
    unsubscribe.mockImplementation(async () => {
      order.push('browser');
      return true;
    });

    const done = service.unsubscribe();
    const request = await mock.next('DELETE', removal);
    expect(unsubscribe).not.toHaveBeenCalled();
    order.push('server');
    request.respond(204);
    await done;

    expect(order).toEqual(['server', 'browser']);
  });

  it('keeps the browser subscription when the server removal fails', async () => {
    const service = setup('subscribed');

    const outcome = service.unsubscribe().then(
      () => 'resolved',
      () => 'rejected',
    );
    (await mock.next('DELETE', removal)).respond(500);

    expect(await outcome).toBe('rejected');
    expect(unsubscribe).not.toHaveBeenCalled();
  });
});
