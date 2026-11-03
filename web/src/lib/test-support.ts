import { vi } from 'vitest';
import type { Habit, Me } from './models';
import type { SecureStore } from './native/token-store';

/** One request seen by {@link mockFetch}, answered by the test. */
export interface FakeCall {
  method: string;
  /** The URL exactly as passed to `fetch`, query included. */
  url: string;
  headers: Headers;
  /** The parsed JSON body, or undefined when none was sent. */
  body: unknown;
  credentials: RequestCredentials | undefined;
  /** Answers with `status` and a JSON body (no body when null or undefined). */
  respond(status: number, body?: unknown, headers?: Record<string, string>): void;
  /** Rejects the way a lost network does (`TypeError`). */
  fail(): void;
}

export interface FetchMock {
  /** Requests no test has taken with `next` yet, oldest first. */
  pending: FakeCall[];
  /** Every request made, oldest first. */
  all: FakeCall[];
  /** Waits for the oldest untaken request with this method and exact URL and takes it. */
  next(method: string, url: string): Promise<FakeCall>;
}

/** Replaces `globalThis.fetch` with a fake whose requests the test answers. Undo with `vi.unstubAllGlobals()`. */
export function mockFetch(): FetchMock {
  const pending: FakeCall[] = [];
  const all: FakeCall[] = [];
  vi.stubGlobal(
    'fetch',
    (input: RequestInfo | URL, init: RequestInit = {}) =>
      new Promise<Response>((resolve, reject) => {
        const call: FakeCall = {
          method: init.method ?? 'GET',
          url: String(input),
          headers: new Headers(init.headers),
          body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
          credentials: init.credentials,
          respond: (status, body, headers = {}) =>
            resolve(
              new Response(body === undefined || body === null ? null : JSON.stringify(body), {
                status,
                headers: { 'Content-Type': 'application/json', ...headers },
              }),
            ),
          fail: () => reject(new TypeError('Failed to fetch')),
        };
        pending.push(call);
        all.push(call);
      }),
  );
  return {
    pending,
    all,
    async next(method, url) {
      let index = -1;
      await vi.waitFor(
        () => {
          index = pending.findIndex((c) => c.method === method && c.url === url);
          if (index < 0) {
            const open = pending.map((c) => `${c.method} ${c.url}`).join(', ');
            throw new Error(`No request ${method} ${url}; pending: ${open || 'none'}`);
          }
        },
        { interval: 1 },
      );
      return pending.splice(index, 1)[0];
    },
  };
}

/** A {@link SecureStore} backed by a Map the test can read. */
export function memorySecureStore(): { secure: Map<string, string>; store: SecureStore } {
  const secure = new Map<string, string>();
  return {
    secure,
    store: {
      get: async (key) => secure.get(key) ?? null,
      set: async (key, value) => void secure.set(key, value),
      remove: async (key) => void secure.delete(key),
    },
  };
}

/**
 * Behaves like a Capacitor plugin proxy on Android: every property it doesn't implement, `then` included, is a
 * native call that rejects as unimplemented. Resolving a promise with it never settles.
 */
export function capacitorPlugin<T extends object>(methods: T): T {
  return new Proxy(methods, {
    get: (target, prop) =>
      prop in target
        ? target[prop as keyof T]
        : () => Promise.reject(new Error(`"${String(prop)}()" is not implemented on android`)),
  });
}

/** Synthetic signed-in user. */
export const me: Me = {
  id: 'u1',
  email: 'a@example.test',
  emailConfirmed: true,
  hasPassword: true,
  discord: { linked: false, id: null },
  timezone: 'Europe/Berlin',
  timezoneSet: true,
  localToday: '2026-11-01',
  graceDaysPerWeek: 1,
  theme: null,
  consent: { given: true, policyVersion: '1', currentPolicyVersion: '1' },
  dmReminders: { paused: false },
  journal: { encrypted: false, turningOff: false, plaintextLeft: 0, encryptedLeft: 0 },
};

/** Synthetic habit, pending today (2026-11-01). */
export const habit: Habit = {
  id: 1,
  name: 'Walk',
  frequency: 'daily',
  weeklyTarget: null,
  days: null,
  timesPerDay: 1,
  routineId: null,
  reminderTime: null,
  pausedFrom: null,
  pausedUntil: null,
  pausedToday: false,
  createdAt: '2026-01-01T00:00:00Z',
  startDate: '2026-01-01',
  today: { date: '2026-11-01', state: 'pending', completed: null, count: 0 },
  stats: { streak: 0, graceUsed: 0, bestStreak: 0, last7: 0, week: null },
};
