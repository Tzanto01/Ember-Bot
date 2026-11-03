import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { AuthService } from '../auth';
import { DeviceStore } from '../device-store';
import { Http } from '../http';
import { JournalService } from '../journal/journal';
import { Keyring } from '../journal/keyring';
import type { JournalKey, Me } from '../models';
import { OfflineQueue } from '../offline-queue';
import { Store } from '../store';
import { type FakeCall, type FetchMock, habit, me as baseMe, mockFetch } from '../test-support';
import { newLocalData } from './backend';
import { LocalStore } from './store';
import type { AppMode, LocalData } from './types';
import { UpgradeService } from './upgrade';

const noteText = 'Synthetic walk by the river';
const moodLabel = 'Synthetic calm';

/** The account side: answers import, journal key, moods, notes and habits like the API. */
class FakeServer {
  me: Me = { ...baseMe, id: 'account-1' };
  imports: unknown[] = [];
  habitNames: string[] = [];
  key: JournalKey | null = null;
  moods = new Map<number, unknown>();
  notes = new Map<string, unknown>();
  failMoodPosts = 0;
  loseImportAnswer = false;
  private nextMood = 100;
  private timer = setInterval(() => {
    for (const call of this.mock.pending.splice(0)) this.handle(call);
  }, 1);

  constructor(private readonly mock: FetchMock) {}

  stop(): void {
    clearInterval(this.timer);
  }

  private handle(call: FakeCall): void {
    const path = new URL(call.url, 'http://ember.test').pathname;
    const body = (call.body ?? {}) as Record<string, unknown>;
    const route = `${call.method} ${path}`;
    if (route === 'POST /api/me/import') {
      if (this.habitNames.length) return call.respond(409, { type: 'conflict', detail: 'Has habits' });
      this.imports.push(body);
      this.habitNames = (body['habits'] as { name: string }[]).map((h) => h.name);
      return this.loseImportAnswer ? call.fail() : call.respond(204);
    }
    if (route === 'GET /api/habits') {
      return call.respond(200, this.habitNames.map((name, i) => ({ ...habit, id: i + 1, name })));
    }
    if (route === 'GET /api/me') {
      return call.respond(200, {
        ...this.me,
        journal: { encrypted: !!this.key, turningOff: false, plaintextLeft: 0, encryptedLeft: 0 },
      });
    }
    if (route === 'PUT /api/me/journal-key') {
      this.key = { version: 1, passphrase: body['passphrase'], recovery: body['recovery'] } as JournalKey;
      return call.respond(200, this.key);
    }
    if (route === 'GET /api/me/journal-key') return this.key ? call.respond(200, this.key) : call.respond(404);
    if (route === 'GET /api/moods') return call.respond(200, [...this.moods.values()]);
    if (route === 'POST /api/moods') {
      if (this.failMoodPosts > 0) {
        this.failMoodPosts--;
        return call.respond(500, { type: 'internal' });
      }
      const mood = { id: this.nextMood++, encrypted: body['encrypted'], archived: false };
      this.moods.set(mood.id, mood);
      return call.respond(201, mood);
    }
    const moodPatch = /^PATCH \/api\/moods\/(\d+)$/.exec(route);
    if (moodPatch) {
      const mood = { ...(this.moods.get(Number(moodPatch[1])) as object), archived: body['archived'] };
      this.moods.set(Number(moodPatch[1]), mood);
      return call.respond(200, mood);
    }
    const notePut = /^PUT \/api\/day-notes\/(.+)$/.exec(route);
    if (notePut) {
      const note = { date: decodeURIComponent(notePut[1]), encrypted: body['encrypted'] };
      this.notes.set(note.date, note);
      return call.respond(200, note);
    }
    if (route === 'GET /api/day-notes') return call.respond(200, [...this.notes.values()]);
    call.respond(404, { type: 'not_found' });
  }
}

function deviceData(): LocalData {
  const data = newLocalData({ timezone: 'Europe/Berlin', theme: null }, new Date('2026-10-01T00:00:00Z'));
  data.habits = [
    {
      id: 1,
      name: 'Walk',
      frequency: 'daily',
      weeklyTarget: null,
      days: null,
      timesPerDay: 1,
      reminderTime: null,
      reminderChannels: [],
      pausedFrom: null,
      pausedUntil: null,
      createdAt: '2026-10-01T08:00:00.000Z',
      routineId: null,
      routinePosition: null,
    },
  ];
  data.logs = [{ habitId: 1, date: '2026-10-02', completed: true, count: 1 }];
  data.moods = [
    { id: 1, label: moodLabel, emoji: null, archived: false },
    { id: 2, label: 'Synthetic old', emoji: null, archived: true },
  ];
  data.notes = [
    { date: '2026-10-02', text: noteText, mood: 'custom:1' },
    { date: '2026-10-03', text: 'Synthetic rest day', mood: 'custom:2' },
  ];
  data.profile.nextIds = { habit: 2, routine: 1, mood: 3 };
  return data;
}

describe('UpgradeService', () => {
  let mock: FetchMock;
  let server: FakeServer;
  let store: LocalStore;
  let device: DeviceStore;
  let auth: AuthService;
  let upgrade: UpgradeService;
  let mode: Store<AppMode>;
  let finishUpgrade: ReturnType<typeof vi.fn<() => void>>;

  beforeEach(async () => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    mock = mockFetch();
    server = new FakeServer(mock);
    store = new LocalStore();
    device = new DeviceStore();
    const queue = new OfflineQueue(device);
    const api = new ApiClient(new Http({ native: false, apiBase: '' }), queue);
    auth = new AuthService(api, queue, null, null);
    const journal = new JournalService(api, auth, new Keyring(null), { iterations: 1000 });
    auth.journal = journal;
    await auth.loadMe(true);
    queue.userId.set(server.me.id);
    mode = new Store<AppMode>('upgrading');
    finishUpgrade = vi.fn<() => void>(() => mode.set('account'));
    upgrade = new UpgradeService(store, api, auth, journal, device, { mode, finishUpgrade });
    await store.replace(deviceData());
  });

  afterEach(() => {
    server.stop();
    vi.unstubAllGlobals();
  });

  it('imports a plain journal with everything and then removes the device copy', async () => {
    const local = (await store.load())!;
    await device.saveHabits({ userId: local.profile.userId, timeZone: 'Europe/Berlin', habits: [] });

    const result = await upgrade.run();

    expect(result).toEqual({ ok: true, recoveryCode: null });
    expect(server.imports).toHaveLength(1);
    expect(server.imports[0]).toMatchObject({
      format_version: 2,
      habits: [{ id: 1, name: 'Walk' }],
      logs: [{ habit_id: 1, date: '2026-10-02', completed: true, count: 1 }],
      moods: [{ id: 1, label: moodLabel }, { id: 2, archived: true }],
      day_notes: [{ date: '2026-10-02', text: noteText, mood: 'custom:1' }, { date: '2026-10-03' }],
    });
    expect(await store.exists()).toBe(false);
    expect(await device.habits(local.profile.userId)).toBeNull();
    expect(finishUpgrade).toHaveBeenCalledOnce();
  });

  it('keeps the device data when the account already has habits', async () => {
    server.habitNames = ['Existing'];

    const result = await upgrade.run();

    expect(result).toEqual({
      ok: false,
      reason: 'conflict',
      message: "This account already has habits, so nothing was moved. Your device data is still here.",
    });
    expect((await store.load())?.habits).toHaveLength(1);
    expect(finishUpgrade).not.toHaveBeenCalled();
  });

  it('does not import twice when the answer to the first import was lost', async () => {
    server.loseImportAnswer = true;
    const first = await upgrade.run();
    server.loseImportAnswer = false;

    const second = await upgrade.run();

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(server.imports).toHaveLength(1);
    expect(await store.exists()).toBe(false);
  });

  it('encrypts the private journal on the device and resumes after an interruption without a second import', async () => {
    server.failMoodPosts = 1;
    const secret = { passphrase: 'synthetic harbour lantern', remember: false, password: 'synthetic-pw' };

    const first = await upgrade.run({ privateJournal: secret });

    expect(first.ok).toBe(false);
    expect((await store.load())?.notes).toHaveLength(2);

    const second = await upgrade.run({ privateJournal: secret });

    expect(second.ok).toBe(true);
    expect(second.ok && second.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    expect(server.imports).toHaveLength(1);
    expect(server.imports[0]).toMatchObject({ moods: [], day_notes: [], journal_key: null });
    expect(server.moods.size).toBe(2);
    expect([...server.moods.values()].filter((m) => (m as { archived: boolean }).archived)).toHaveLength(1);
    expect([...server.notes.keys()].sort()).toEqual(['2026-10-02', '2026-10-03']);
    for (const call of mock.all) {
      const sent = JSON.stringify(call.body ?? null);
      expect(sent).not.toContain(noteText);
      expect(sent).not.toContain(moodLabel);
      expect(sent).not.toContain('Synthetic rest day');
      expect(sent).not.toContain('Synthetic old');
    }
    expect(await store.exists()).toBe(false);
  });
});
