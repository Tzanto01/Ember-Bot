import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiClient } from '../api-client';
import { AuthService } from '../auth';
import { DeviceStore, isDayEdit } from '../device-store';
import { Http } from '../http';
import type { EncryptedBlob, JournalKey, Me, StoredDayNote, StoredMood } from '../models';
import type { SecureStore } from '../native/token-store';
import { OfflineQueue } from '../offline-queue';
import {
  type FakeCall,
  type FetchMock,
  habit,
  me as baseMe,
  memorySecureStore,
  mockFetch,
} from '../test-support';
import {
  decryptNote,
  fromBase64,
  importJournalKey,
  toBase64,
  unwrapWithPassphrase,
} from './crypto';
import { JournalService } from './journal';
import { Keyring } from './keyring';
import { JournalLockedError, WrongSecretError } from './types';

const iterations = 1000;
const passphrase = 'quiet harbour lantern';
const loginPassword = 'login-pw-synthetic';

/** An in-memory API for the journal endpoints, answering every request `mockFetch` sees. */
class FakeServer {
  me: Me = { ...baseMe };
  notes = new Map<string, StoredDayNote>();
  moods = new Map<number, StoredMood>();
  key: JournalKey | null = null;
  turningOff = false;
  dayEdits = 0;
  private nextMood = 1;
  private timer: ReturnType<typeof setInterval>;

  constructor(mock: FetchMock) {
    this.timer = setInterval(() => {
      for (const call of mock.pending.splice(0)) this.handle(call);
    }, 1);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  addMood(mood: StoredMood): void {
    this.moods.set(mood.id, mood);
    this.nextMood = Math.max(this.nextMood, mood.id + 1);
  }

  private left(encrypted: boolean): number {
    if (!this.key) return 0;
    const all = [...this.notes.values(), ...this.moods.values()];
    return all.filter((v) => 'encrypted' in v === encrypted).length;
  }

  private handle(call: FakeCall): void {
    const url = new URL(call.url, 'http://ember.test');
    const path = url.pathname;
    const body = (call.body ?? {}) as {
      encrypted?: unknown;
      label?: unknown;
      emoji?: unknown;
      password?: unknown;
      ifVersion?: unknown;
      passphrase?: JournalKey['passphrase'];
      recovery?: JournalKey['recovery'];
      discardEncrypted?: boolean;
      text?: unknown;
      mood?: unknown;
    };
    const route = `${call.method} ${path}`;
    const plainWrite =
      /^(PUT \/api\/day-notes\/|POST \/api\/moods|PATCH \/api\/moods\/)/.test(route) &&
      ('text' in body || 'mood' in body || 'label' in body);
    if (plainWrite && this.key && !this.turningOff)
      return call.respond(400, { type: 'validation' });
    if (route === 'GET /api/me') {
      return call.respond(200, {
        ...this.me,
        journal: {
          encrypted: !!this.key,
          turningOff: this.turningOff,
          plaintextLeft: this.left(false),
          encryptedLeft: this.left(true),
        },
      });
    }
    if (route === 'GET /api/habits') return call.respond(200, [habit]);
    if (/^PUT \/api\/habits\/1\/days\//.test(route)) {
      this.dayEdits++;
      return call.respond(200, habit);
    }
    if (body.text === 'Refused by the server.') return call.respond(400, { type: 'validation' });
    if (route === 'GET /api/day-notes') {
      const from = url.searchParams.get('from')!;
      const to = url.searchParams.get('to')!;
      const notes = [...this.notes.values()]
        .filter((n) => n.date >= from && n.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date));
      return call.respond(200, notes);
    }
    const note = /^\/api\/day-notes\/(.+)$/.exec(path);
    if (note && call.method === 'PUT') {
      const stored = { date: note[1], ...body } as StoredDayNote;
      this.notes.set(note[1], stored);
      return call.respond(200, stored);
    }
    if (note && call.method === 'DELETE') {
      this.notes.delete(note[1]);
      return call.respond(204);
    }
    if (route === 'GET /api/moods') return call.respond(200, [...this.moods.values()]);
    if (route === 'POST /api/moods') {
      const stored = { id: this.nextMood++, archived: false, ...body } as StoredMood;
      this.moods.set(stored.id, stored);
      return call.respond(201, stored);
    }
    const mood = /^\/api\/moods\/(\d+)$/.exec(path);
    if (mood && call.method === 'PATCH') {
      const id = Number(mood[1]);
      const current = this.moods.get(id)!;
      const next: { encrypted?: unknown; label?: unknown; emoji?: unknown } = {
        ...current,
        ...body,
      };
      if (body.encrypted) {
        delete next.label;
        delete next.emoji;
      } else if ('label' in body) {
        delete next.encrypted;
      }
      this.moods.set(id, next as unknown as StoredMood);
      return call.respond(200, next);
    }
    if (route === 'GET /api/me/journal-key') {
      if (!this.key) return call.respond(404);
      return call.respond(200, this.turningOff ? { ...this.key, turningOff: true } : this.key);
    }
    if (route === 'POST /api/me/journal-key/turn-off') {
      if (this.me.hasPassword && body.password !== loginPassword)
        return call.respond(400, { type: 'validation' });
      this.turningOff = !!this.key;
      return this.key ? call.respond(200) : call.respond(404);
    }
    if (route === 'PUT /api/me/journal-key') {
      if (this.me.hasPassword && body.password !== loginPassword)
        return call.respond(400, { type: 'validation' });
      if (this.key && body.ifVersion !== this.key.version)
        return call.respond(409, { type: 'conflict' });
      this.key = {
        version: (this.key?.version ?? 0) + 1,
        passphrase: body.passphrase!,
        recovery: body.recovery!,
      };
      return call.respond(200, this.key);
    }
    if (route === 'DELETE /api/me/journal-key') {
      const encrypted = (v: object) => 'encrypted' in v;
      if (body.discardEncrypted) {
        for (const [date, n] of this.notes) if (encrypted(n)) this.notes.delete(date);
        for (const [id, m] of this.moods) if (encrypted(m)) this.moods.delete(id);
      } else if ([...this.notes.values(), ...this.moods.values()].some(encrypted)) {
        return call.respond(409, { type: 'conflict' });
      }
      this.key = null;
      this.turningOff = false;
      return call.respond(204);
    }
    call.respond(404);
  }
}

describe('JournalService', () => {
  let mock: FetchMock;
  let server: FakeServer;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    mock = mockFetch();
    server = new FakeServer(mock);
  });

  afterEach(() => {
    server.stop();
    vi.unstubAllGlobals();
  });

  /** One device signed in as the server's user; `secure` makes it a native build. */
  async function device(secure: SecureStore | null = null) {
    const http = new Http({ native: false, apiBase: '' });
    const queue = new OfflineQueue(new DeviceStore());
    const api = new ApiClient(http, queue);
    const auth = new AuthService(api, queue, null, null);
    const journal = new JournalService(api, auth, new Keyring(secure), { iterations });
    auth.journal = journal;
    queue.resealNote = (edit) => journal.resealNote(edit);
    journal.onDroppedNote = (note) => queue.droppedNotes.update((notes) => [...notes, note]);
    http.session = auth;
    await auth.loadMe(true);
    queue.userId.set(baseMe.id);
    await journal.restore();
    const replay = () =>
      queue.replay(baseMe.id, (edit) =>
        isDayEdit(edit) ? api.sendDayEdit(edit, true) : api.sendNoteEdit(edit, true),
      );
    return { auth, journal, queue, replay };
  }

  async function rawKey(): Promise<string> {
    return toBase64(await unwrapWithPassphrase(server.key!.passphrase, passphrase, iterations));
  }

  it('enables with the login password, encrypts what was there, and never sends a secret or the raw key', async () => {
    server.notes.set('2026-10-30', {
      date: '2026-10-30',
      text: 'First walk in weeks.',
      mood: 'good',
    });
    server.notes.set('2025-03-02', { date: '2025-03-02', text: 'Snow day.', mood: null });
    server.addMood({ id: 7, label: 'Cosy', emoji: null, archived: false });
    const { journal } = await device();

    const { recoveryCode } = await journal.enable(passphrase, false, loginPassword);

    const put = mock.all.filter((c) => c.method === 'PUT' && c.url === '/api/me/journal-key');
    expect(put).toHaveLength(1);
    expect(put[0].body).toMatchObject({ password: loginPassword });
    expect(journal.state.get()).toBe('unlocked');
    expect(
      [...server.notes.values(), ...server.moods.values()].every((v) => 'encrypted' in v),
    ).toBe(true);
    expect(await journal.notes('2025-01-01', '2025-12-31')).toEqual({
      notes: [{ date: '2025-03-02', text: 'Snow day.', mood: null }],
      hidden: 0,
    });
    expect(await journal.moods()).toEqual([{ id: 7, label: 'Cosy', emoji: null, archived: false }]);

    const raw = await rawKey();
    const sent = JSON.stringify(mock.all.map((c) => [c.url, c.body]));
    for (const secret of [passphrase, recoveryCode, recoveryCode.replace(/-/g, ''), raw]) {
      expect(sent).not.toContain(secret);
    }
    expect(fromBase64(raw)).toHaveLength(32);
  });

  it('finishes an interrupted switch on unlock while plaintext is left, across 366-day windows', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    server.notes.set('2026-10-01', {
      date: '2026-10-01',
      text: 'Written before the switch.',
      mood: null,
    });
    server.notes.set('2024-06-15', { date: '2024-06-15', text: 'Older still.', mood: 'okay' });
    server.addMood({ id: 3, label: 'Foggy', emoji: null, archived: true });

    const { journal } = await device();
    expect(journal.state.get()).toBe('locked');
    await journal.unlock({ passphrase }, false);

    await vi.waitFor(() => {
      for (const note of server.notes.values()) expect(note).toHaveProperty('encrypted');
      expect(server.moods.get(3)).toMatchObject({ archived: true, encrypted: expect.anything() });
    });
    await journal.finishMigration();
    expect(server.key!.version).toBe(1);
    expect((await journal.notes('2024-06-01', '2024-06-30')).notes).toEqual([
      { date: '2024-06-15', text: 'Older still.', mood: 'okay' },
    ]);
  });

  it('refuses to save while locked, without a request', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    const { journal } = await device();
    const before = mock.all.length;

    await expect(journal.save('2026-11-01', { text: 'Hello', mood: null })).rejects.toBeInstanceOf(
      JournalLockedError,
    );
    expect(mock.all.length).toBe(before);
  });

  it('saves only the ciphertext while private, bound to its day', async () => {
    const { journal } = await device();
    await journal.enable(passphrase, false, loginPassword);

    await journal.save('2026-11-01', {
      text: '  Slept badly,\nstill went for a walk.  ',
      mood: 'meh',
    });

    const put = mock.all.filter((c) => c.method === 'PUT' && c.url === '/api/day-notes/2026-11-01');
    expect(put).toHaveLength(1);
    expect(Object.keys(put[0].body as object)).toEqual(['encrypted']);
    expect(JSON.stringify(put[0].body)).not.toContain('walk');
    const stored = server.notes.get('2026-11-01') as unknown as { encrypted: EncryptedBlob };
    const key = await importJournalKey(fromBase64(await rawKey()));
    expect(await decryptNote(key, '2026-11-01', stored.encrypted)).toEqual({
      text: 'Slept badly,\nstill went for a walk.',
      mood: 'meh',
    });
  });

  it('shows readable entries and counts one that fails to decrypt as hidden', async () => {
    const { journal } = await device();
    await journal.enable(passphrase, false, loginPassword);
    await journal.save('2026-10-30', { text: 'Readable', mood: null });
    await journal.save('2026-10-31', { text: 'Moved', mood: null });
    const moved = server.notes.get('2026-10-31') as { encrypted: unknown };
    server.notes.set('2026-10-29', {
      date: '2026-10-29',
      encrypted: moved.encrypted,
    } as StoredDayNote);
    server.notes.set('2026-10-28', { date: '2026-10-28', text: 'Plain leftover', mood: null });

    expect(await journal.notes('2026-10-28', '2026-10-30')).toEqual({
      notes: [
        { date: '2026-10-28', text: 'Plain leftover', mood: null },
        { date: '2026-10-30', text: 'Readable', mood: null },
      ],
      hidden: 1,
    });
  });

  it('rejects a wrong passphrase and stays locked', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    const { journal } = await device();

    await expect(
      journal.unlock({ passphrase: 'quiet harbor lantern' }, true),
    ).rejects.toBeInstanceOf(WrongSecretError);
    expect(journal.state.get()).toBe('locked');
  });

  it('remembers the key in IndexedDB only when asked, and forget() removes it', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);

    const once = await device();
    await once.journal.unlock({ passphrase }, false);
    expect(await new Keyring(null).get(baseMe.id)).toBeNull();
    expect((await device()).journal.state.get()).toBe('locked');

    const remembered = await device();
    await remembered.journal.unlock({ passphrase }, true);
    const stored = await new Keyring(null).get(baseMe.id);
    expect(stored?.key.extractable).toBe(false);
    expect((await device()).journal.state.get()).toBe('unlocked');

    await remembered.journal.forget();
    expect(remembered.journal.state.get()).toBe('locked');
    expect(await new Keyring(null).get(baseMe.id)).toBeNull();
    await remembered.journal.finishMigration();
  });

  it('in the native build keeps the raw key in secure storage only when asked, and forget() removes it', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    const { secure, store } = memorySecureStore();

    const once = await device(store);
    await once.journal.unlock({ passphrase }, false);
    expect(secure.size).toBe(0);

    await once.journal.unlock({ passphrase }, true);
    expect(JSON.parse(secure.get('ember.journalKey')!)).toMatchObject({
      userId: baseMe.id,
      key: await rawKey(),
    });
    expect((await device(store)).journal.state.get()).toBe('unlocked');

    await once.journal.forget();
    expect(secure.size).toBe(0);
  });

  it.each([
    ['web', () => null],
    ['native', () => memorySecureStore().store],
  ])('never uses a key remembered for another user (%s)', async (_, makeStore) => {
    const store = makeStore();
    const first = await device(store);
    await first.journal.enable(passphrase, true, loginPassword);
    expect((await device(store)).journal.state.get()).toBe('unlocked');

    server.me = { ...baseMe, id: 'u2' };
    const other = await device(store);

    expect(other.journal.state.get()).toBe('locked');
    await expect(
      other.journal.save('2026-11-01', { text: 'Hi', mood: null }),
    ).rejects.toBeInstanceOf(JournalLockedError);
  });

  it('forgets a remembered key once the journal key on the server was replaced', async () => {
    const first = await device();
    await first.journal.enable(passphrase, true, loginPassword);
    const replaced = server.key!;
    server.key = {
      version: replaced.version + 1,
      passphrase: replaced.passphrase,
      recovery: { ...replaced.recovery, salt: toBase64(new Uint8Array(16).fill(7)) },
    };

    const { journal } = await device();

    expect(journal.state.get()).toBe('locked');
    expect(await new Keyring(null).get(baseMe.id)).toBeNull();
  });

  it('after a recovery code sets a new passphrase with ifVersion and keeps the recovery part', async () => {
    const first = await device();
    const { recoveryCode } = await first.journal.enable(passphrase, false, loginPassword);
    const recovery = server.key!.recovery;
    const { journal } = await device();

    const result = await journal.unlock({ recoveryCode: recoveryCode.toLowerCase() }, false);
    expect(result).toEqual({ needsNewPassphrase: true });
    await journal.setPassphrase('new lantern words', loginPassword);

    const put = mock.all
      .filter((c) => c.method === 'PUT' && c.url === '/api/me/journal-key')
      .at(-1)!;
    expect(put.body).toMatchObject({ ifVersion: 1, recovery, password: loginPassword });
    const fresh = await device();
    await fresh.journal.unlock({ passphrase: 'new lantern words' }, false);
    expect(fresh.journal.state.get()).toBe('unlocked');
    await journal.finishMigration();
  });

  it('turns the journal back to plain: re-uploads every entry and mood as plaintext, then deletes the key', async () => {
    server.addMood({ id: 2, label: 'Bright', emoji: null, archived: false });
    const { journal } = await device();
    await journal.enable(passphrase, true, loginPassword);
    await journal.save('2026-10-31', { text: 'Pumpkin soup.', mood: 'custom:2' });
    await journal.save('2025-01-04', { text: 'Long ago.', mood: null });

    await journal.disable(loginPassword);

    const turnOff = mock.all.findIndex((c) => c.url === '/api/me/journal-key/turn-off');
    expect(mock.all[turnOff]).toMatchObject({ method: 'POST', body: { password: loginPassword } });
    const deleteIndex = mock.all.findIndex(
      (c) => c.method === 'DELETE' && c.url === '/api/me/journal-key',
    );
    const plainPuts = mock.all
      .map((c, i) => ({ c, i }))
      .filter(
        ({ c }) =>
          c.method === 'PUT' &&
          c.url.startsWith('/api/day-notes/') &&
          !('encrypted' in (c.body as object)),
      );
    expect(plainPuts.map(({ c }) => c.url).sort()).toEqual([
      '/api/day-notes/2025-01-04',
      '/api/day-notes/2026-10-31',
    ]);
    expect(plainPuts.every(({ i }) => turnOff < i && i < deleteIndex)).toBe(true);
    expect(mock.all[deleteIndex].body).toEqual({
      password: loginPassword,
      discardEncrypted: false,
    });
    expect(server.key).toBeNull();
    expect(server.notes.get('2026-10-31')).toEqual({
      date: '2026-10-31',
      text: 'Pumpkin soup.',
      mood: 'custom:2',
    });
    expect(server.moods.get(2)).toEqual({ id: 2, label: 'Bright', emoji: null, archived: false });
    expect(journal.state.get()).toBe('off');
    expect(await new Keyring(null).get(baseMe.id)).toBeNull();
  });

  it('writes plaintext while turning off, even locked, and another device finishes the switch-off only when asked', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    await first.journal.save('2026-10-31', { text: 'Encrypted once.', mood: null });
    await first.journal.addMood({ label: 'Calm', emoji: null });
    server.turningOff = true;

    const { journal } = await device();
    expect(journal.state.get()).toBe('locked');
    expect(journal.turningOff.get()).toBe(true);
    await journal.save('2026-11-01', { text: 'Written mid-switch.', mood: null });
    expect(server.notes.get('2026-11-01')).toEqual({
      date: '2026-11-01',
      text: 'Written mid-switch.',
      mood: null,
    });

    await journal.unlock({ passphrase }, false);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(server.notes.get('2026-10-31')).toHaveProperty('encrypted');
    const mood = await journal.addMood({ label: 'Bright', emoji: null });
    expect(server.moods.get(mood.id)).toMatchObject({ label: 'Bright' });

    await journal.disable(loginPassword);
    expect([...server.notes.values(), ...server.moods.values()].some((v) => 'encrypted' in v)).toBe(
      false,
    );
    expect(server.notes.get('2026-10-31')).toMatchObject({ text: 'Encrypted once.' });
    expect(mock.all.filter((c) => c.url === '/api/me/journal-key/turn-off')).toHaveLength(0);
    expect(server.key).toBeNull();
    expect(journal.state.get()).toBe('off');
    expect(journal.turningOff.get()).toBe(false);
  });

  it('reports from memory whether the keyring stored the key on this device', async () => {
    const keyring = new Keyring(null);
    const key = await importJournalKey(new Uint8Array(32));

    await keyring.keep(baseMe.id, { key, keyId: 'k1' }, new Uint8Array(32), false);
    expect(await keyring.get(baseMe.id)).toMatchObject({ remembered: false });
    await keyring.keep(baseMe.id, { key, keyId: 'k1' }, new Uint8Array(32), true);
    expect(await keyring.get(baseMe.id)).toMatchObject({ remembered: true });
  });

  it('tells the settings screen whether this device keeps the key', async () => {
    const first = await device();
    await first.journal.enable(passphrase, false, loginPassword);
    expect(first.journal.remembered.get()).toBe(false);

    const { journal } = await device();
    await journal.unlock({ passphrase }, false);
    expect(journal.remembered.get()).toBe(false);
    await journal.unlock({ passphrase }, true);
    expect(journal.remembered.get()).toBe(true);
    expect((await device()).journal.remembered.get()).toBe(true);

    await journal.forget();
    expect(journal.remembered.get()).toBe(false);
    await journal.finishMigration();
  });

  describe('queued journal edits after the journal changed form', () => {
    it('encrypts a plaintext edit queued before the journal went private, then sends it', async () => {
      const offline = await device();
      await offline.queue.add({
        kind: 'note',
        date: '2026-10-30',
        body: { text: 'Queued while offline.', mood: null },
      });
      await offline.journal.enable(passphrase, false, loginPassword);

      expect(await offline.replay()).toMatchObject({ sent: 1, dropped: 0, remaining: 0 });
      expect(server.notes.get('2026-10-30')).toHaveProperty('encrypted');
      expect((await offline.journal.notes('2026-10-30', '2026-10-30')).notes).toEqual([
        { date: '2026-10-30', text: 'Queued while offline.', mood: null },
      ]);
    });

    it('holds it while locked without blocking later day edits, and saves it after the next unlock', async () => {
      const first = await device();
      await first.journal.enable(passphrase, false, loginPassword);
      const locked = await device();
      await locked.queue.add({
        kind: 'note',
        date: '2026-10-29',
        body: { text: 'Written before it went private.', mood: 'okay' },
      });
      await locked.queue.add({ habitId: 1, date: '2026-10-29', completed: true });

      expect(await locked.replay()).toMatchObject({ remaining: 0 });
      expect(server.dayEdits).toBe(1);
      expect(server.notes.has('2026-10-29')).toBe(false);
      expect(locked.queue.pending.get()).toBe(0);
      expect(locked.queue.droppedNotes.get()).toEqual([]);

      await locked.journal.unlock({ passphrase }, false);
      await vi.waitFor(() => expect(server.notes.get('2026-10-29')).toHaveProperty('encrypted'));
      expect((await locked.journal.notes('2026-10-29', '2026-10-29')).notes).toEqual([
        { date: '2026-10-29', text: 'Written before it went private.', mood: 'okay' },
      ]);
      await locked.journal.finishMigration();
    });

    it('forgets held edits with the key on sign-out', async () => {
      const keyring = new Keyring(null);
      await keyring.hold(baseMe.id, { kind: 'note', date: '2026-10-27', body: { text: 'Held' } });
      expect(await new Keyring(null).held(baseMe.id)).toHaveLength(1);
      expect(await new Keyring(null).held('u2')).toEqual([]);

      await keyring.forget();

      expect(await new Keyring(null).held(baseMe.id)).toEqual([]);
    });

    it('drops an edit refused for another reason and lists its text for the notice', async () => {
      const { queue, replay } = await device();
      await queue.add({
        kind: 'note',
        date: '2026-10-28',
        body: { text: 'Refused by the server.', mood: null },
      });
      await queue.add({ habitId: 1, date: '2026-10-28', completed: true });

      expect(await replay()).toMatchObject({ sent: 1, dropped: 1, remaining: 0 });
      expect(queue.droppedNotes.get()).toEqual([
        { date: '2026-10-28', text: 'Refused by the server.' },
      ]);
    });
  });

  describe('appendPrivate', () => {
    const day = '2026-11-02';
    const block = 'Moment note: breathing in the hallway.';
    const dayPuts = () =>
      mock.all.filter((c) => c.method === 'PUT' && c.url.startsWith('/api/day-notes/'));
    const sealed = async (date: string) => {
      const stored = server.notes.get(date) as unknown as { encrypted: EncryptedBlob };
      return decryptNote(
        await importJournalKey(fromBase64(await rawKey())),
        date,
        stored.encrypted,
      );
    };

    it('throws without any request while the private journal is off', async () => {
      const { journal } = await device();
      const before = mock.all.length;

      await expect(journal.appendPrivate(day, block)).rejects.toThrow();

      expect(mock.all.length).toBe(before);
      expect(server.notes.size).toBe(0);
    });

    it('throws without a PUT while locked', async () => {
      const first = await device();
      await first.journal.enable(passphrase, false, loginPassword);
      const { journal } = await device();

      await expect(journal.appendPrivate(day, block)).rejects.toBeInstanceOf(JournalLockedError);

      expect(dayPuts()).toHaveLength(0);
    });

    it('throws without a PUT while the journal is turning off', async () => {
      const { journal, auth } = await device();
      await journal.enable(passphrase, false, loginPassword);
      server.turningOff = true;
      await auth.loadMe(true);
      expect(journal.turningOff.get()).toBe(true);

      await expect(journal.appendPrivate(day, block)).rejects.toThrow();

      expect(dayPuts()).toHaveLength(0);
      expect(server.notes.size).toBe(0);
    });

    it('throws without a PUT while offline', async () => {
      const { journal } = await device();
      await journal.enable(passphrase, false, loginPassword);
      const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      try {
        await expect(journal.appendPrivate(day, block)).rejects.toThrow();
      } finally {
        online.mockRestore();
      }

      expect(dayPuts()).toHaveLength(0);
    });

    it('throws without a PUT when the entry would pass 2000 characters', async () => {
      const { journal } = await device();
      await journal.enable(passphrase, false, loginPassword);
      await journal.save(day, { text: 'a'.repeat(1990), mood: null });
      const before = dayPuts().length;

      await expect(journal.appendPrivate(day, 'b'.repeat(9))).rejects.toBeInstanceOf(RangeError);

      expect(dayPuts()).toHaveLength(before);
      expect((await sealed(day)).text).toBe('a'.repeat(1990));
    });

    it('adds nothing when the entry already ends with the block (a retry after a save that landed)', async () => {
      const { journal } = await device();
      await journal.enable(passphrase, false, loginPassword);
      await journal.appendPrivate(day, block);
      const before = dayPuts().length;

      await journal.appendPrivate(day, block);

      expect(dayPuts()).toHaveLength(before);
      expect((await sealed(day)).text).toBe(block);
    });

    it('sends one ciphertext-only PUT whose plaintext is the old entry, a blank line and the block, keeping the mood', async () => {
      const { journal } = await device();
      await journal.enable(passphrase, false, loginPassword);
      await journal.save(day, { text: 'Rough start.', mood: 'meh' });
      mock.all.length = 0;

      await journal.appendPrivate(day, block);

      const puts = dayPuts();
      expect(puts).toHaveLength(1);
      expect(puts[0].url).toBe(`/api/day-notes/${day}`);
      expect(Object.keys(puts[0].body as object)).toEqual(['encrypted']);
      const sent = JSON.stringify(mock.all.map((c) => [c.method, c.url, c.body]));
      expect(sent).not.toContain('hallway');
      expect(sent).not.toContain('Rough start');
      expect(await sealed(day)).toEqual({ text: `Rough start.\n\n${block}`, mood: 'meh' });
      expect((await journal.notes(day, day)).notes).toEqual([
        { date: day, text: `Rough start.\n\n${block}`, mood: 'meh' },
      ]);
    });

    it('uses just the block when the day has no entry yet', async () => {
      const { journal } = await device();
      await journal.enable(passphrase, false, loginPassword);
      mock.all.length = 0;

      await journal.appendPrivate(day, block);

      const puts = dayPuts();
      expect(puts).toHaveLength(1);
      expect(Object.keys(puts[0].body as object)).toEqual(['encrypted']);
      expect(JSON.stringify(mock.all.map((c) => [c.url, c.body]))).not.toContain('hallway');
      expect(await sealed(day)).toEqual({ text: block, mood: null });
    });

    it('never queues: a lost network rejects and leaves nothing waiting', async () => {
      const { journal, queue } = await device();
      await journal.enable(passphrase, false, loginPassword);
      server.stop();
      const settled = journal.appendPrivate(day, block).then(
        () => null,
        (error: unknown) => error,
      );
      const get = await mock.next('GET', `/api/day-notes?from=${day}&to=${day}`);
      get.respond(200, []);
      const put = await mock.next('PUT', `/api/day-notes/${day}`);
      put.fail();

      expect(await settled).toBeInstanceOf(Error);
      expect(queue.pending.get()).toBe(0);
      expect(await new DeviceStore().edits(baseMe.id)).toEqual([]);
    });
  });
});
