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
import { UpgradeService, notEmptyDetail } from './upgrade';

const noteText = 'Synthetic walk by the river';
const moodLabel = 'Synthetic calm';

/** The account side: answers import, journal key, moods, notes and habits like the API. */
class FakeServer {
  me: Me = { ...baseMe, id: 'account-1' };
  imports: unknown[] = [];
  habitNames: string[] = [];
  routineNames: string[] = [];
  key: JournalKey | null = null;
  moods = new Map<number, unknown>();
  notes = new Map<string, unknown>();
  failMoodPosts = 0;
  loseImportAnswer = false;
  loseMoodAnswers = 0;
  rateLimitImports = 0;
  failImports = 0;
  importRejection: string | null = null;
  patches: unknown[] = [];
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
    if (route === 'PATCH /api/me') {
      this.patches.push(body);
      return call.respond(200, this.me);
    }
    if (route === 'POST /api/me/import') {
      if (this.failImports > 0) {
        this.failImports--;
        return call.fail();
      }
      if (this.rateLimitImports > 0) {
        this.rateLimitImports--;
        return call.respond(429, { type: 'rate_limited' });
      }
      if (this.importRejection) return call.respond(409, { type: 'conflict', detail: this.importRejection });
      if (this.habitNames.length || this.routineNames.length || this.moods.size) {
        return call.respond(409, { type: 'conflict', detail: notEmptyDetail });
      }
      this.imports.push(body);
      this.habitNames = (body['habits'] as { name: string }[]).map((h) => h.name);
      this.routineNames = ((body['routines'] ?? []) as { name: string }[]).map((r) => r.name);
      for (const mood of (body['moods'] ?? []) as { label: string; emoji: string | null; archived: boolean }[]) {
        const id = this.nextMood++;
        this.moods.set(id, { id, label: mood.label, emoji: mood.emoji, archived: mood.archived });
      }
      return this.loseImportAnswer ? call.fail() : call.respond(204);
    }
    if (route === 'GET /api/habits') {
      return call.respond(200, this.habitNames.map((name, i) => ({ ...habit, id: i + 1, name })));
    }
    if (route === 'GET /api/routines') {
      return call.respond(200, this.routineNames.map((name, i) => ({ id: i + 1, name, reminderTime: null, reminderChannels: [], habitIds: [] })));
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
      const mood = { ...body, id: this.nextMood++, archived: false };
      this.moods.set(mood.id, mood);
      if (this.loseMoodAnswers > 0) {
        this.loseMoodAnswers--;
        return call.fail();
      }
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
      const note = { ...body, date: decodeURIComponent(notePut[1]) };
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
    expect(server.patches).toEqual([]);
    expect(server.imports).toEqual([]);
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

  it('finishes the retry of a device without habits whose import answer was lost', async () => {
    await store.update((d) => ({
      ...d,
      habits: [],
      logs: [],
      routines: [{ id: 1, name: 'Synthetic mornings', reminderTime: null, reminderChannels: [] }],
    }));
    server.loseImportAnswer = true;
    const first = await upgrade.run();
    server.loseImportAnswer = false;

    const second = await upgrade.run();

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: true, recoveryCode: null });
    expect(server.imports).toHaveLength(1);
    expect(await store.exists()).toBe(false);
    expect(finishUpgrade).toHaveBeenCalledOnce();
  });

  it('finishes the retry of a device with only moods whose import answer was lost', async () => {
    await store.update((d) => ({ ...d, habits: [], logs: [] }));
    server.loseImportAnswer = true;
    const first = await upgrade.run();
    server.loseImportAnswer = false;

    const second = await upgrade.run();

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: true, recoveryCode: null });
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
    expect(await store.load()).toMatchObject({ habits: [], logs: [], moods: [], notes: [] });
  });

  const callIndex = (route: string) => mock.all.findIndex((c) => `${c.method} ${new URL(c.url, 'http://ember.test').pathname}` === route);
  const secret = { passphrase: 'synthetic harbour lantern', remember: false, password: 'synthetic-pw' };

  it('sends the device settings to the account before the import, leaving the theme out when unset', async () => {
    await upgrade.run();

    expect(server.patches).toEqual([{ timezone: 'Europe/Berlin', graceDaysPerWeek: 1 }]);
    expect(callIndex('PATCH /api/me')).toBeLessThan(callIndex('POST /api/me/import'));
  });

  it('sends the chosen theme with the device settings', async () => {
    await store.update((d) => ({ ...d, profile: { ...d.profile, theme: 'tidepool', graceDaysPerWeek: 2 } }));

    await upgrade.run();

    expect(server.patches).toEqual([{ timezone: 'Europe/Berlin', graceDaysPerWeek: 2, theme: 'tidepool' }]);
  });

  it('keeps the device data when the account got other habits after a send that never landed', async () => {
    server.failImports = 1;
    await upgrade.run();
    server.habitNames = ['Someone else'];

    const result = await upgrade.run();

    expect(result).toMatchObject({ ok: false, reason: 'conflict' });
    expect(server.imports).toEqual([]);
    expect(server.patches).toHaveLength(1);
    expect(await store.exists()).toBe(true);
    expect(finishUpgrade).not.toHaveBeenCalled();
  });

  it('still moves the journal in plaintext when a retry drops the private journal after a lost import answer', async () => {
    server.loseImportAnswer = true;
    const first = await upgrade.run({ privateJournal: secret });
    server.loseImportAnswer = false;

    const second = await upgrade.run();

    expect(first.ok).toBe(false);
    expect(second).toEqual({ ok: true, recoveryCode: null });
    expect(server.imports).toHaveLength(1);
    expect(server.imports[0]).toMatchObject({ moods: [], day_notes: [] });
    expect([...server.notes.values()].sort((a, b) => (a as { date: string }).date.localeCompare((b as { date: string }).date))).toMatchObject([
      { date: '2026-10-02', text: noteText },
      { date: '2026-10-03', text: 'Synthetic rest day' },
    ]);
    expect([...server.moods.values()].map((m) => (m as { label: string }).label).sort()).toEqual(['Synthetic calm', 'Synthetic old']);
    expect(await store.exists()).toBe(false);
  });

  it('reuses the account mood whose creation answer was lost instead of creating a second one', async () => {
    server.loseMoodAnswers = 1;
    const first = await upgrade.run({ privateJournal: secret });

    const second = await upgrade.run({ privateJournal: secret });

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(server.moods.size).toBe(2);
    expect(await store.load()).toMatchObject({ habits: [], logs: [], moods: [], notes: [] });
  });

  it('reports and leaves out notes and low days dated before the earliest habit start', async () => {
    await store.update((d) => ({
      ...d,
      lowDays: ['2026-09-25', '2026-10-05'],
      notes: [...d.notes, { date: '2026-09-20', text: 'Synthetic early note', mood: null }],
    }));

    expect((await upgrade.summary())?.leftOut).toEqual({ notes: 1, lowDays: 1 });
    await upgrade.run();

    expect(server.imports[0]).toMatchObject({ day_marks: [{ date: '2026-10-05' }] });
    expect((server.imports[0] as { day_notes: { date: string }[] }).day_notes.map((n) => n.date)).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('leaves early notes out of the private journal upload too', async () => {
    await store.update((d) => ({ ...d, notes: [...d.notes, { date: '2026-09-20', text: 'Synthetic early note', mood: null }] }));

    const result = await upgrade.run({ privateJournal: secret });

    expect(result.ok).toBe(true);
    expect([...server.notes.keys()].sort()).toEqual(['2026-10-02', '2026-10-03']);
  });

  it('counts every note and low day as left out when there are no habits', async () => {
    await store.update((d) => ({ ...d, habits: [], logs: [], lowDays: ['2026-10-05'] }));

    expect((await upgrade.summary())?.leftOut).toEqual({ notes: 2, lowDays: 1 });
  });

  it('keeps the import marked as sent after a rate-limited retry, so matching account habits count as imported', async () => {
    server.failImports = 1;
    await upgrade.run();
    server.rateLimitImports = 1;
    const limited = await upgrade.run();
    server.habitNames = ['Walk'];

    const third = await upgrade.run();

    expect(limited.ok).toBe(false);
    expect(third.ok).toBe(true);
    expect(server.imports).toEqual([]);
    expect(await store.exists()).toBe(false);
  });

  it('sends the journal encrypted when a retry picks the private journal after a send that never landed', async () => {
    server.failImports = 1;
    await upgrade.run();
    const firstCalls = mock.all.length;

    const second = await upgrade.run({ privateJournal: secret });

    expect(second.ok).toBe(true);
    expect(server.imports).toHaveLength(1);
    expect(server.imports[0]).toMatchObject({ moods: [], day_notes: [] });
    expect(server.notes.size).toBe(2);
    for (const call of mock.all.slice(firstCalls)) {
      const sent = JSON.stringify(call.body ?? null);
      for (const plain of [noteText, moodLabel, 'Synthetic rest day', 'Synthetic old']) expect(sent).not.toContain(plain);
    }
  });

  it('keeps the recovery code on the device after the move until it is acknowledged', async () => {
    const result = await upgrade.run({ privateJournal: secret });
    const code = result.ok ? result.recoveryCode : null;
    const calls = mock.all.length;

    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
    expect(finishUpgrade).not.toHaveBeenCalled();
    expect(await upgrade.pendingRecoveryCode()).toBe(code);
    expect(await upgrade.run()).toEqual({ ok: true, recoveryCode: code });
    expect(mock.all.length).toBe(calls);

    await upgrade.acknowledge();

    expect(await store.exists()).toBe(false);
    expect(await upgrade.pendingRecoveryCode()).toBeNull();
    expect(finishUpgrade).toHaveBeenCalledOnce();
  });

  it('shows nothing waiting and no recovery code to another account after the move finished', async () => {
    await upgrade.run({ privateJournal: secret });
    auth.setMe({ ...server.me, id: 'account-2' });

    expect(await upgrade.summary()).toBeNull();
    expect(await upgrade.pendingRecoveryCode()).toBeNull();
    expect((await store.load())?.upgrade?.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
  });

  it('keeps device data added after a finished move instead of returning the old recovery code', async () => {
    await upgrade.run({ privateJournal: secret });
    await store.update((d) => ({ ...d, habits: deviceData().habits }));
    const calls = mock.all.length;

    const result = await upgrade.run();

    expect(result).toMatchObject({ ok: false, reason: 'failed' });
    expect(await upgrade.pendingRecoveryCode()).toBeNull();
    expect((await store.load())?.habits).toHaveLength(1);
    expect(mock.all.length).toBe(calls);
  });

  it('clears the device caches of the local user when the recovery code is acknowledged', async () => {
    await upgrade.run({ privateJournal: secret });
    const localUser = (await store.load())!.profile.userId;
    await device.saveHabits({ userId: localUser, timeZone: 'Europe/Berlin', habits: [] });

    await upgrade.acknowledge();

    expect(await device.habits(localUser)).toBeNull();
  });

  it('returns the saved recovery code when a retry without the private journal choice finishes', async () => {
    server.failMoodPosts = 1;
    const first = await upgrade.run({ privateJournal: secret });

    const second = await upgrade.run();

    expect(first.ok).toBe(false);
    expect(second.ok && second.recoveryCode).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{4}){7}$/);
  });
});
