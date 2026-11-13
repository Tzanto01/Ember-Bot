import type { ApiClient } from '../api-client';
import { t } from '../i18n';
import type { JournalService } from '../journal/journal';
import type { Me } from '../models';
import { ApiError, asApiError } from '../problem';
import { JournalLockedError } from '../journal/types';
import { Store } from '../store';
import { type HelpItem, maxHelps, maxHelpText } from './types';

/** The API calls the list uses. */
export type HelpsSource = Pick<ApiClient, 'getHelps' | 'putHelps'>;
/** The journal parts the list needs: its state and the sealing with the journal key. */
export type HelpsJournal = Pick<JournalService, 'state' | 'turningOff' | 'sealHelps' | 'openHelps'>;

/** Why a change to the list was refused: too many items, empty or too long text, or another save got in the way twice. */
export class HelpsError extends Error {
  constructor(readonly reason: 'full' | 'text' | 'conflict') {
    super(
      reason === 'full'
        ? t('helps.error.full', { max: maxHelps })
        : reason === 'text'
          ? t('helps.error.text', { max: maxHelpText })
          : t('helps.error.conflict'),
    );
    this.name = 'HelpsError';
  }
}

type Op =
  | { kind: 'add'; item: HelpItem }
  | { kind: 'edit'; id: string; text: string }
  | { kind: 'remove'; id: string }
  | { kind: 'move'; id: string; delta: number };

const same = (a: string, b: string) =>
  a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();

/** True when `list` already holds an item for that practice or with that text (ignoring case). */
export function hasHelp(list: HelpItem[], entry: { text: string; practiceId?: string }): boolean {
  return list.some(
    (item) =>
      (!!entry.practiceId && item.practiceId === entry.practiceId) || same(item.text, entry.text),
  );
}

function helpText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length > maxHelpText) throw new HelpsError('text');
  return trimmed;
}

function apply(list: HelpItem[], op: Op): HelpItem[] | null {
  if (op.kind === 'add') {
    if (list.some((item) => item.id === op.item.id) || hasHelp(list, op.item)) return null;
    if (list.length >= maxHelps) throw new HelpsError('full');
    return [...list, op.item];
  }
  const index = list.findIndex((item) => item.id === op.id);
  if (index < 0) return null;
  if (op.kind === 'remove') return list.filter((item) => item.id !== op.id);
  if (op.kind === 'edit') {
    if (list[index]!.text === op.text) return null;
    return list.map((item) => (item.id === op.id ? { ...item, text: op.text } : item));
  }
  const target = Math.max(0, Math.min(list.length - 1, index + op.delta));
  if (target === index) return null;
  const next = [...list];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/**
 * The end-to-end encrypted "What helps me" list (contract companion-v1 "What helps me"), held in memory only. It loads
 * when the signed-in app shell asks (`ensureLoaded`) and is cleared when the user changes or the private journal is
 * no longer unlocked. Every change is an id-based operation saved with the version last read; on 409 it re-reads,
 * applies the same operation to the fresh list and saves once more.
 */
export class HelpsService {
  /** The items in order; null while not loaded. */
  readonly items = new Store<HelpItem[] | null>(null);
  /** True when the last load failed. */
  readonly loadFailed = new Store(false);

  private version = 0;
  private owner: string | null = null;
  private epoch = 0;
  private loading: Promise<void> | null = null;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly api: HelpsSource,
    private readonly journal: HelpsJournal,
    private readonly session: { readonly me: Store<Me | null> },
  ) {
    journal.state.subscribe(() => this.follow());
    journal.turningOff.subscribe(() => this.follow());
    session.me.subscribe(() => this.follow());
  }

  /** Loads the list unless it is in memory or loading. Call only from the signed-in shell with the journal unlocked. */
  ensureLoaded(): Promise<void> {
    if (this.items.get() !== null) return Promise.resolve();
    return this.load();
  }

  /** Reads and decrypts the list (`GET /api/me/helps`). */
  load(): Promise<void> {
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.owner = this.session.me.get()?.id ?? null;
    const loading: Promise<void> = this.read()
      .then(
        () => {
          if (epoch === this.epoch) this.loadFailed.set(false);
        },
        (error: unknown) => {
          if (epoch === this.epoch) this.loadFailed.set(true);
          throw error;
        },
      )
      .finally(() => {
        if (this.loading === loading) this.loading = null;
      });
    this.loading = loading;
    return loading;
  }

  /**
   * Adds an item to the end. Resolves false, without saving, when the list already holds that text or practice.
   * Rejects with `HelpsError` for empty or too long text and a full list.
   */
  async add(entry: { text: string; practiceId?: string }): Promise<boolean> {
    const text = helpText(entry.text);
    const item: HelpItem = {
      id: crypto.randomUUID(),
      text,
      ...(entry.practiceId ? { practiceId: entry.practiceId } : {}),
      addedAt: new Date().toISOString(),
    };
    let added = false;
    await this.run({ kind: 'add', item }, (list) => (added = list.some((i) => i.id === item.id)));
    return added;
  }

  /** Changes an item's text. */
  async edit(id: string, text: string): Promise<void> {
    return this.run({ kind: 'edit', id, text: helpText(text) });
  }

  /** Removes an item. */
  remove(id: string): Promise<void> {
    return this.run({ kind: 'remove', id });
  }

  /** Moves an item by `delta` places (negative is up). */
  move(id: string, delta: number): Promise<void> {
    return this.run({ kind: 'move', id, delta });
  }

  private follow(): void {
    const me = this.session.me.get();
    const ready = !!me && this.journal.state.get() === 'unlocked' && !this.journal.turningOff.get();
    if (ready && me.id === this.owner) return;
    if (this.owner === null && this.items.get() === null && !this.loading) return;
    this.epoch++;
    this.owner = null;
    this.version = 0;
    this.loading = null;
    this.loadFailed.set(false);
    this.items.set(null);
  }

  private async read(): Promise<HelpItem[]> {
    const epoch = this.epoch;
    const stored = await this.api.getHelps();
    const items = stored ? (await this.journal.openHelps(stored.encrypted)).items : [];
    if (epoch !== this.epoch) throw new Error('The list changed hands.');
    this.version = stored?.version ?? 0;
    this.items.set(items);
    return items;
  }

  private run(op: Op, done?: (list: HelpItem[]) => void): Promise<void> {
    const epoch = this.epoch;
    const next = this.queue.then(() => this.change(op, epoch, done));
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async change(op: Op, epoch: number, done?: (list: HelpItem[]) => void): Promise<void> {
    const sameOwner = () => {
      if (epoch !== this.epoch) throw new Error('The list changed hands.');
    };
    sameOwner();
    if (this.items.get() === null) await this.load();
    sameOwner();
    const current = this.items.get() ?? [];
    const next = apply(current, op);
    if (!next) return void done?.(current);
    let saved: HelpItem[];
    try {
      saved = await this.write(next);
    } catch (error) {
      if (asApiError(error).status !== 409) throw error;
      sameOwner();
      const fresh = await this.read();
      const merged = apply(fresh, op);
      if (!merged) return void done?.(fresh);
      try {
        saved = await this.write(merged);
      } catch (again) {
        throw asApiError(again).status === 409 ? new HelpsError('conflict') : again;
      }
    }
    done?.(saved);
  }

  private async write(items: HelpItem[]): Promise<HelpItem[]> {
    const epoch = this.epoch;
    const encrypted = await this.journal.sealHelps({ v: 1, items });
    const { version } = await this.api.putHelps({ encrypted, version: this.version });
    if (epoch !== this.epoch) throw new Error('The list changed hands.');
    this.version = version;
    this.items.set(items);
    return items;
  }
}

/** A gentle message for a failed change to the list, or null when the app already handled it. */
export function helpsProblem(error: unknown): string | null {
  if (error instanceof HelpsError || error instanceof JournalLockedError) return error.message;
  if (error instanceof ApiError && error.handled) return null;
  return t('helps.error.save');
}
