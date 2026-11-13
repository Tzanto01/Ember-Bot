import { describe, expect, it } from 'vitest';
import {
  decryptHelps,
  decryptMood,
  encryptHelps,
  encryptMood,
  importJournalKey,
  newJournalKeyBytes,
} from '../journal/crypto';
import type { JournalState } from '../journal/types';
import type { EncryptedBlob, Me } from '../models';
import { ApiError } from '../problem';
import { Store } from '../store';
import { me as baseMe } from '../test-support';
import { HelpsError, HelpsService } from './helps';
import type { HelpItem, HelpsList } from './types';

const item = (id: string, text: string): HelpItem => ({
  id,
  text,
  addedAt: '2026-11-01T10:00:00.000Z',
});

async function setup() {
  const key = await importJournalKey(newJournalKeyBytes());
  const state = new Store<JournalState>('unlocked');
  const journal = {
    state,
    turningOff: new Store(false),
    sealHelps: async (list: HelpsList) => JSON.stringify(await encryptHelps(key, list)),
    openHelps: (encrypted: string) => decryptHelps(key, JSON.parse(encrypted) as EncryptedBlob),
  };
  const server = {
    stored: null as { encrypted: string; version: number } | null,
    puts: [] as { encrypted: string; version: number }[],
    conflicts: 0,
    onGet: null as (() => void) | null,
  };
  const api = {
    getHelps: async () => {
      server.onGet?.();
      return server.stored;
    },
    putHelps: async (body: { encrypted: string; version: number }) => {
      server.puts.push(body);
      if (server.conflicts > 0 || body.version !== (server.stored?.version ?? 0)) {
        server.conflicts = Math.max(0, server.conflicts - 1);
        throw new ApiError(409, null);
      }
      server.stored = { encrypted: body.encrypted, version: body.version + 1 };
      return { version: body.version + 1 };
    },
  };
  const session = { me: new Store<Me | null>({ ...baseMe }) };
  const helps = new HelpsService(api, journal, session);
  const storeOnServer = async (items: HelpItem[], version: number) => {
    server.stored = { encrypted: await journal.sealHelps({ v: 1, items }), version };
  };
  return { key, state, session, server, helps, storeOnServer, journal };
}

describe('helps crypto', () => {
  it('round-trips the list, drops malformed items and refuses a mood blob', async () => {
    const key = await importJournalKey(newJournalKeyBytes());
    const blob = await encryptHelps(key, {
      v: 1,
      items: [
        item('a', ' tea '),
        item('b', ''),
        item('a', 'again'),
        { ...item('c', 'x'.repeat(81)) },
      ],
    });
    expect(await decryptHelps(key, blob)).toEqual({ v: 1, items: [item('a', 'tea')] });
    await expect(
      decryptHelps(key, await encryptMood(key, { label: 'calm', emoji: null })),
    ).rejects.toThrow();
    await expect(decryptMood(key, blob)).rejects.toThrow();
  });
});

describe('HelpsService', () => {
  it('sends only ciphertext and the version it read', async () => {
    const { helps, server, journal } = await setup();
    await helps.ensureLoaded();
    expect(await helps.add({ text: 'A walk around the block' })).toBe(true);

    expect(server.puts).toHaveLength(1);
    const body = server.puts[0]!;
    expect(Object.keys(body).sort()).toEqual(['encrypted', 'version']);
    expect(body.version).toBe(0);
    expect(body.encrypted).not.toContain('walk');
    expect((await journal.openHelps(body.encrypted)).items.map((i) => i.text)).toEqual([
      'A walk around the block',
    ]);
    expect(helps.items.get()?.map((i) => i.text)).toEqual(['A walk around the block']);
  });

  it('on 409 re-reads, applies the same change to the fresh list and saves once more', async () => {
    const { helps, server, storeOnServer } = await setup();
    await storeOnServer([item('a', 'tea'), item('b', 'music')], 3);
    await helps.ensureLoaded();
    await storeOnServer([item('b', 'music'), item('c', 'a bath')], 4);

    await helps.remove('b');
    expect(helps.items.get()?.map((i) => i.id)).toEqual(['c']);
    expect(server.puts.map((p) => p.version)).toEqual([3, 4]);

    await helps.remove('a');
    expect(server.puts).toHaveLength(2);
  });

  it('does not add text or a practice already in the list, and refuses a 21st item', async () => {
    const { helps, server, storeOnServer } = await setup();
    await storeOnServer(
      Array.from({ length: 19 }, (_, i) => item(`i${i}`, `thing ${i}`)).concat({
        ...item('p', 'Slow breathing'),
        practiceId: 'paced-breathing',
      }),
      1,
    );
    await helps.ensureLoaded();

    expect(await helps.add({ text: 'THING 3' })).toBe(false);
    expect(await helps.add({ text: 'Langsam atmen', practiceId: 'paced-breathing' })).toBe(false);
    await expect(helps.add({ text: 'one more' })).rejects.toBeInstanceOf(HelpsError);
    expect(server.puts).toHaveLength(0);
  });

  it('seals the list as a {v,iv,ct} envelope that shows no item text or id', async () => {
    const { helps, server } = await setup();
    await helps.ensureLoaded();
    await helps.add({ text: 'Cold water on my wrists', practiceId: 'paced-breathing' });

    const envelope = JSON.parse(server.puts[0]!.encrypted) as Record<string, unknown>;
    expect(Object.keys(envelope).sort()).toEqual(['ct', 'iv', 'v']);
    const id = helps.items.get()![0]!.id;
    for (const secret of ['Cold water', 'wrists', 'paced-breathing', id, 'practiceId'])
      expect(server.puts[0]!.encrypted).not.toContain(secret);
  });

  it('on 409 keeps the other device\'s item and adds the new one exactly once', async () => {
    const { helps, server, storeOnServer } = await setup();
    await storeOnServer([item('a', 'tea')], 1);
    await helps.ensureLoaded();
    await storeOnServer([item('a', 'tea'), item('x', 'from the phone')], 2);

    expect(await helps.add({ text: 'a bath' })).toBe(true);

    expect(helps.items.get()?.map((i) => i.text)).toEqual(['tea', 'from the phone', 'a bath']);
    expect(server.puts.map((p) => p.version)).toEqual([1, 2]);
  });

  it('stops a 409 retry when the user switches while it re-reads, and never writes to the new list', async () => {
    const { helps, server, session, storeOnServer } = await setup();
    await storeOnServer([item('a', 'tea')], 1);
    await helps.ensureLoaded();
    await storeOnServer([item('a', 'tea'), item('x', 'music')], 2);
    server.onGet = () => session.me.set({ ...baseMe, id: 'u2' });

    await expect(helps.remove('a')).rejects.toThrow();

    expect(server.puts).toHaveLength(1);
    expect(helps.items.get()).toBeNull();
    expect(server.stored?.version).toBe(2);
  });

  it('surfaces a second 409 gently', async () => {
    const { helps, server } = await setup();
    await helps.ensureLoaded();
    server.conflicts = 2;
    await expect(helps.add({ text: 'tea' })).rejects.toMatchObject({ reason: 'conflict' });
  });

  it('forgets the list when the journal locks or another user signs in', async () => {
    const { helps, state, session, storeOnServer } = await setup();
    await storeOnServer([item('a', 'tea')], 1);
    await helps.ensureLoaded();
    session.me.set({ ...baseMe });
    expect(helps.items.get()).toHaveLength(1);

    state.set('locked');
    expect(helps.items.get()).toBeNull();

    state.set('unlocked');
    await helps.ensureLoaded();
    session.me.set({ ...baseMe, id: 'u2' });
    expect(helps.items.get()).toBeNull();
  });
});
