import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { SwPush } from '@angular/service-worker';
import { BehaviorSubject } from 'rxjs';
import { PushService } from './push.service';

const tick = () => new Promise<void>((resolve) => setTimeout(resolve));

const endpoint = 'https://push.example.test/send/a b&c=1';

function browserSubscription() {
  return {
    endpoint,
    toJSON: () => ({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } }),
  } as unknown as PushSubscription;
}

describe('PushService', () => {
  let httpMock: HttpTestingController;
  let current: BehaviorSubject<PushSubscription | null>;
  let swPush: {
    isEnabled: boolean;
    subscription: BehaviorSubject<PushSubscription | null>;
    requestSubscription: ReturnType<typeof vi.fn>;
    unsubscribe: ReturnType<typeof vi.fn>;
  };

  function setup(initial: PushSubscription | null = null) {
    current = new BehaviorSubject<PushSubscription | null>(initial);
    swPush = {
      isEnabled: true,
      subscription: current,
      requestSubscription: vi.fn().mockResolvedValue(browserSubscription()),
      unsubscribe: vi.fn().mockResolvedValue(undefined),
    };
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: SwPush, useValue: swPush }],
    });
    httpMock = TestBed.inject(HttpTestingController);
    return TestBed.inject(PushService);
  }

  async function checked(service: PushService) {
    const done = service.check();
    httpMock.expectOne('/api/push/vapid-public-key').flush({ key: 'vapid-key' });
    await done;
  }

  afterEach(() => httpMock.verify());

  it('stays unavailable when the server answers 501', async () => {
    const service = setup();
    const done = service.check();
    httpMock
      .expectOne('/api/push/vapid-public-key')
      .flush(null, { status: 501, statusText: 'Not Implemented' });
    await done;

    expect(service.available()).toBe(false);
  });

  it('becomes available once the server returns a key', async () => {
    const service = setup();
    await checked(service);

    expect(service.available()).toBe(true);
  });

  it('registers the browser subscription with endpoint and keys', async () => {
    const service = setup();
    await checked(service);

    const done = service.subscribe();
    await tick();
    const req = httpMock.expectOne('/api/me/push-subscriptions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } });
    expect(swPush.requestSubscription).toHaveBeenCalledWith({ serverPublicKey: 'vapid-key' });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(swPush.unsubscribe).not.toHaveBeenCalled();
  });

  it('rolls back the browser subscription when the server rejects it', async () => {
    const service = setup();
    await checked(service);

    const done = service.subscribe();
    const outcome = done.then(
      () => 'resolved',
      () => 'rejected',
    );
    await tick();
    httpMock
      .expectOne('/api/me/push-subscriptions')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(await outcome).toBe('rejected');
    expect(swPush.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('claim re-registers the existing browser subscription once', async () => {
    const service = setup(browserSubscription());

    const done = service.claim();
    httpMock.expectOne('/api/push/vapid-public-key').flush({ key: 'vapid-key' });
    await tick();
    const req = httpMock.expectOne('/api/me/push-subscriptions');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ endpoint, keys: { p256dh: 'p256-key', auth: 'auth-key' } });
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;
  });

  it('claim makes no call without a browser subscription', async () => {
    const service = setup();

    const done = service.claim();
    httpMock.expectOne('/api/push/vapid-public-key').flush({ key: 'vapid-key' });
    await done;

    httpMock.expectNone('/api/me/push-subscriptions');
  });

  it('claim makes no call and does not throw when the server offers no push', async () => {
    const service = setup(browserSubscription());

    const done = service.claim();
    httpMock
      .expectOne('/api/push/vapid-public-key')
      .flush(null, { status: 501, statusText: 'Not Implemented' });

    await expect(done).resolves.toBeUndefined();
    httpMock.expectNone('/api/me/push-subscriptions');
  });

  it('claim does not throw when the server rejects the registration', async () => {
    const service = setup(browserSubscription());

    const done = service.claim();
    httpMock.expectOne('/api/push/vapid-public-key').flush({ key: 'vapid-key' });
    await tick();
    httpMock
      .expectOne('/api/me/push-subscriptions')
      .flush(null, { status: 500, statusText: 'Server Error' });

    await expect(done).resolves.toBeUndefined();
  });

  it('removes the server subscription by endpoint before unsubscribing the browser', async () => {
    const service = setup(browserSubscription());
    const order: string[] = [];
    swPush.unsubscribe.mockImplementation(async () => {
      order.push('browser');
    });

    const done = service.unsubscribe();
    const req = httpMock.expectOne((r) => r.url === '/api/me/push-subscriptions');
    expect(req.request.method).toBe('DELETE');
    expect(req.request.params.get('endpoint')).toBe(endpoint);
    expect(swPush.unsubscribe).not.toHaveBeenCalled();
    order.push('server');
    req.flush(null, { status: 204, statusText: 'No Content' });
    await done;

    expect(order).toEqual(['server', 'browser']);
  });

  it('keeps the browser subscription when the server removal fails', async () => {
    const service = setup(browserSubscription());

    const outcome = service.unsubscribe().then(
      () => 'resolved',
      () => 'rejected',
    );
    httpMock
      .expectOne((r) => r.url === '/api/me/push-subscriptions')
      .flush(null, { status: 500, statusText: 'Server Error' });

    expect(await outcome).toBe('rejected');
    expect(swPush.unsubscribe).not.toHaveBeenCalled();
  });
});
