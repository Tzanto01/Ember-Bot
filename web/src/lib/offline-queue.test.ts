import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { type DayEdit, DeviceStore, type QueueEdit } from './device-store';
import { OfflineQueue } from './offline-queue';
import { ApiError } from './problem';

const edit = (habitId: number, completed: boolean | null = true): DayEdit => ({
  habitId,
  date: '2026-11-01',
  completed,
});

describe('OfflineQueue', () => {
  let queue: OfflineQueue;

  beforeEach(() => {
    (globalThis as unknown as { indexedDB: unknown }).indexedDB = new IDBFactory();
    queue = new OfflineQueue(new DeviceStore());
    queue.userId.set('user-a');
  });

  function recorder(failures: Record<number, ApiError> = {}) {
    const sent: QueueEdit[] = [];
    const send = async (e: QueueEdit) => {
      sent.push(e);
      if (failures[(e as DayEdit).habitId]) throw failures[(e as DayEdit).habitId];
    };
    return { sent, send };
  }

  it('sends an edit queued while a replay is running in that same replay', async () => {
    await queue.add(edit(1));
    const sent: QueueEdit[] = [];
    const send = async (e: QueueEdit) => {
      sent.push(e);
      if ((e as DayEdit).habitId === 1) await queue.add(edit(2));
    };

    const result = await queue.replay('user-a', send);

    expect(sent).toEqual([edit(1), edit(2)]);
    expect(result.sent).toBe(2);
    expect(queue.pending.get()).toBe(0);
  });

  it('refuses to queue without a signed-in user', async () => {
    queue.userId.set(null);

    expect(await queue.add(edit(1))).toBe(false);
  });

  it('counts the signed-in user’s queued edits as pending', async () => {
    await queue.add(edit(1));
    await queue.add(edit(2));

    expect(queue.pending.get()).toBe(2);
  });

  it('replays in insertion order, drops sent edits from the queue and sends nothing the second time', async () => {
    await queue.add(edit(3));
    await queue.add(edit(1, false));
    await queue.add(edit(2, null));
    const first = recorder();

    const result = await queue.replay('user-a', first.send);

    expect(first.sent).toEqual([edit(3), edit(1, false), edit(2, null)]);
    expect(result).toEqual({ sent: 3, dropped: 0, remaining: 0 });
    expect(queue.pending.get()).toBe(0);

    const second = recorder();
    expect(await queue.replay('user-a', second.send)).toEqual({ sent: 0, dropped: 0, remaining: 0 });
    expect(second.sent).toEqual([]);
  });

  it('sends the same edit twice when it was queued twice', async () => {
    await queue.add(edit(1));
    await queue.add(edit(1));
    const run = recorder();

    await queue.replay('user-a', run.send);

    expect(run.sent).toHaveLength(2);
  });

  it('drops edits refused with 404 or 422 before_habit_start / in_future and continues', async () => {
    for (const id of [1, 2, 3, 4]) await queue.add(edit(id));
    const run = recorder({
      1: new ApiError(404, null),
      2: new ApiError(422, { type: 'before_habit_start' }),
      3: new ApiError(422, { type: 'in_future' }),
    });

    const result = await queue.replay('user-a', run.send);

    expect(run.sent.map((e) => (e as DayEdit).habitId)).toEqual([1, 2, 3, 4]);
    expect(result).toEqual({ sent: 1, dropped: 3, remaining: 0 });
    expect(queue.pending.get()).toBe(0);
  });

  it.each([
    ['403 consent_required', new ApiError(403, { type: 'consent_required' })],
    ['401', new ApiError(401, null)],
    ['429', new ApiError(429, null, 30)],
    ['500', new ApiError(500, null)],
    ['network failure', new ApiError(0, null)],
    ['422 with another type', new ApiError(422, { type: 'out_of_range' })],
  ])('keeps the edit and stops the replay on %s', async (_name, error) => {
    for (const id of [1, 2, 3]) await queue.add(edit(id));
    const run = recorder({ 2: error });

    const result = await queue.replay('user-a', run.send);

    expect(run.sent.map((e) => (e as DayEdit).habitId)).toEqual([1, 2]);
    expect(result).toEqual({ sent: 1, dropped: 0, remaining: 2 });
    expect(queue.pending.get()).toBe(2);

    const retry = recorder();
    await queue.replay('user-a', retry.send);
    expect(retry.sent.map((e) => (e as DayEdit).habitId)).toEqual([2, 3]);
  });

  it('never replays one user’s edits for another user', async () => {
    await queue.add(edit(1));
    queue.userId.set('user-b');
    await queue.add(edit(2));
    const run = recorder();

    await queue.replay('user-b', run.send);

    expect(run.sent.map((e) => (e as DayEdit).habitId)).toEqual([2]);
    const forA = recorder();
    await queue.replay('user-a', forA.send);
    expect(forA.sent.map((e) => (e as DayEdit).habitId)).toEqual([1]);
  });

  it('clearing one user leaves the other user’s queue', async () => {
    await queue.add(edit(1));
    queue.userId.set('user-b');
    await queue.add(edit(2));

    await queue.clear('user-a');

    const forA = recorder();
    await queue.replay('user-a', forA.send);
    expect(forA.sent).toEqual([]);
    const forB = recorder();
    await queue.replay('user-b', forB.send);
    expect(forB.sent.map((e) => (e as DayEdit).habitId)).toEqual([2]);
  });

  it('resets pending when the signed-in user is cleared', async () => {
    await queue.add(edit(1));

    await queue.clear('user-a');

    expect(queue.pending.get()).toBe(0);
  });
});
