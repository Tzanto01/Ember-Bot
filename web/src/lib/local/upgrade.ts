import type { ApiClient } from '../api-client';
import type { AuthService } from '../auth';
import type { DeviceStore } from '../device-store';
import { type JournalApi, JournalLockedError } from '../journal/types';
import type { MoodKey, OwnMood } from '../models';
import { ApiError, asApiError, problemToMessage } from '../problem';
import { earliestStart, exportDocument } from './backend';
import type { LocalMode } from './mode';
import type { LocalStore } from './store';
import type { LocalData, LocalMood, LocalNote, UpgradeApi, UpgradeProgress, UpgradeResult, UpgradeSummary } from './types';
import { deviceLanguage, t } from '../i18n';

const conflictCopy = () => t('upgrade.error.conflict');

/** The `detail` of the API's 409 `conflict` when the account isn't empty (`ImportEndpoints.NotEmptyMessage`). */
export const notEmptyDetail = 'Import only works into an account without habits, routines, moods or journal entries.';

function isNotEmpty(error: ApiError): boolean {
  return error.status === 409 && error.type === 'conflict' && error.problem?.detail === notEmptyDetail;
}

/** Day notes and low days the account can't take: dated before the earliest habit start, or all of them without habits. */
function leftOut(data: LocalData): { notes: LocalNote[]; lowDays: string[] } {
  const start = earliestStart(data);
  const before = (date: string) => start === null || date < start;
  return { notes: data.notes.filter((n) => before(n.date)), lowDays: data.lowDays.filter(before) };
}

/** The import body: the export document without what the account can't take, and without the journal when `journal` is false. */
function importDocument(data: LocalData, journal: boolean): Record<string, unknown> {
  const out = leftOut(data);
  return exportDocument(
    { ...data, notes: data.notes.filter((n) => !out.notes.includes(n)), lowDays: data.lowDays.filter((d) => !out.lowDays.includes(d)) },
    journal,
  );
}

function failed(message: string): UpgradeResult {
  return { ok: false, reason: 'failed', message };
}

function holdsData(data: LocalData): boolean {
  return [data.habits, data.logs, data.lowDays, data.routines, data.moods, data.notes].some((list) => list.length > 0);
}

function sameSorted(a: string[], b: string[]): boolean {
  const x = [...a].sort();
  const y = [...b].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

function customId(mood: MoodKey | null): number | null {
  return mood?.startsWith('custom:') ? Number(mood.slice(7)) : null;
}

/**
 * "Create an account and keep my data": imports the device data into the signed-in account (`POST /api/me/import`),
 * encrypting the journal first when the private journal is chosen, then removes the device copy (with a recovery code,
 * all but the code until it is acknowledged). Progress is kept on the device, so a retry after an interruption resumes
 * and never imports twice; nothing local is deleted on any failure.
 */
export class UpgradeService implements UpgradeApi {
  constructor(
    private readonly store: LocalStore,
    private readonly api: Pick<ApiClient, 'importData' | 'listHabits' | 'listRoutines' | 'updateMe'>,
    private readonly auth: Pick<AuthService, 'me'>,
    private readonly journal: Pick<JournalApi, 'state' | 'enable' | 'moods' | 'addMood' | 'updateMood' | 'save'>,
    private readonly device: Pick<DeviceStore, 'clearUser'>,
    private readonly localMode: Pick<LocalMode, 'mode' | 'finishUpgrade'>,
  ) {}

  async summary(): Promise<UpgradeSummary | null> {
    const data = await this.store.load().catch(() => null);
    if (!data || (data.upgrade?.finished && !holdsData(data))) return null;
    const out = leftOut(data);
    return {
      habits: data.habits.length,
      checkIns: data.logs.length,
      notes: data.notes.length,
      moods: data.moods.length,
      leftOut: { notes: out.notes.length, lowDays: out.lowDays.length },
    };
  }

  async pendingRecoveryCode(): Promise<string | null> {
    const data = await this.store.load().catch(() => null);
    const progress = data?.upgrade;
    if (!data || !progress?.finished || holdsData(data)) return null;
    return progress.userId === this.auth.me.get()?.id ? progress.recoveryCode : null;
  }

  async acknowledge(): Promise<void> {
    const userId = (await this.store.load())?.profile.userId;
    await this.store.clear();
    if (userId) await this.device.clearUser(userId).catch(() => undefined);
    this.localMode.finishUpgrade();
  }

  async run(
    options: { privateJournal?: { passphrase: string; remember: boolean; password?: string } } = {},
  ): Promise<UpgradeResult> {
    const me = this.auth.me.get();
    if (this.localMode.mode.get() !== 'upgrading' || !me) return failed(t('upgrade.error.signIn'));
    const data = await this.store.load().catch(() => null);
    if (!data) return failed(t('upgrade.error.nothing'));
    const secret = options.privateJournal;
    if (data.upgrade && data.upgrade.userId !== me.id && data.upgrade.importSent && !data.upgrade.imported) {
      return failed(t('upgrade.error.otherTarget'));
    }
    if (data.upgrade?.imported && data.upgrade.userId !== me.id) {
      return failed(t('upgrade.error.movedElsewhere'));
    }

    let progress: UpgradeProgress =
      data.upgrade?.userId === me.id
        ? data.upgrade
        : {
            userId: me.id,
            importSent: false,
            imported: false,
            journalOmitted: false,
            journalEnabled: false,
            recoveryCode: null,
            moodIds: {},
            archivedMoods: [],
            notesDone: [],
          };
    if (progress.finished) {
      if (holdsData(data)) {
        return failed(t('upgrade.error.recoveryFirst'));
      }
      return { ok: true, recoveryCode: progress.recoveryCode };
    }
    const save = async (change: Partial<UpgradeProgress>) => {
      progress = { ...progress, ...change };
      const next = progress;
      await this.store.update((d) => ({ ...d, upgrade: next }));
    };

    let importing = true;
    try {
      if (!progress.imported) {
        const sentBefore = progress.importSent;
        const omit = sentBefore ? progress.journalOmitted || !!secret : !!secret;
        const names = (await this.api.listHabits()).map((h) => h.name).sort();
        const local = data.habits.map((h) => h.name).sort();
        const landed =
          sentBefore &&
          names.length === local.length &&
          names.every((name, i) => name === local[i]) &&
          (names.length > 0 || (await this.landedWithoutHabits(data, progress.journalOmitted)));
        if (!landed) {
          if (names.length > 0) return { ok: false, reason: 'conflict', message: conflictCopy() };
          const { profile } = data;
          const updated = await this.api.updateMe({
            timezone: profile.timezone,
            graceDaysPerWeek: profile.graceDaysPerWeek,
            showStreaks: profile.showStreaks ?? true,
            language: deviceLanguage(),
            ...(profile.theme ? { theme: profile.theme } : {}),
          });
          const current = this.auth.me.get();
          if (updated?.language && current && updated.id === current.id) this.auth.me.set({ ...current, language: updated.language });
          await save({ importSent: true, journalOmitted: omit });
          try {
            await this.api.importData(importDocument(data, !omit));
          } catch (error) {
            const apiError = asApiError(error);
            if (apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429) await save({ importSent: false });
            throw error;
          }
        } else if (omit !== progress.journalOmitted) {
          await save({ journalOmitted: omit });
        }
        await save({ imported: true });
      }
      importing = false;
      if (secret && !progress.journalEnabled) {
        let recoveryCode: string | null = null;
        if (!this.auth.me.get()?.journal.encrypted) {
          ({ recoveryCode } = await this.journal.enable(secret.passphrase, secret.remember, secret.password));
        }
        await save({ journalEnabled: true, recoveryCode });
      }
      if (progress.journalOmitted) await this.moveJournal(data, !!secret, () => progress, save);

      if (progress.recoveryCode) {
        const finished = { ...progress, finished: true };
        await this.store.update((d) => ({
          ...d,
          habits: [],
          logs: [],
          lowDays: [],
          routines: [],
          moods: [],
          notes: [],
          upgrade: finished,
        }));
        await this.device.clearUser(data.profile.userId).catch(() => undefined);
        return { ok: true, recoveryCode: progress.recoveryCode };
      }
      await this.store.clear();
      await this.device.clearUser(data.profile.userId).catch(() => undefined);
      this.localMode.finishUpgrade();
      return { ok: true, recoveryCode: null };
    } catch (error) {
      if (error instanceof JournalLockedError) return failed(t('upgrade.error.locked'));
      if (error instanceof RangeError) return failed(error.message);
      const apiError = asApiError(error);
      if (importing && isNotEmpty(apiError)) return { ok: false, reason: 'conflict', message: conflictCopy() };
      if (apiError.status === 403 && apiError.type === 'consent_required') {
        return { ok: false, reason: 'consent', message: problemToMessage(apiError).message };
      }
      return failed(problemToMessage(apiError).message);
    }
  }

  /** Whether a sent import without habits landed: the account holds its routines and moods, and it sent at least one. */
  private async landedWithoutHabits(data: LocalData, journalOmitted: boolean): Promise<boolean> {
    const routines = data.routines.map((r) => r.name);
    const moods = journalOmitted ? [] : data.moods.map((m) => m.label);
    if (routines.length + moods.length === 0) return false;
    const accountRoutines = (await this.api.listRoutines()).map((r) => r.name);
    const accountMoods = moods.length > 0 ? (await this.journal.moods()).map((m) => m.label) : [];
    return sameSorted(accountRoutines, routines) && sameSorted(accountMoods, moods);
  }

  private async moveJournal(
    data: LocalData,
    encrypted: boolean,
    progress: () => UpgradeProgress,
    save: (change: Partial<UpgradeProgress>) => Promise<void>,
  ): Promise<void> {
    if ((encrypted || this.auth.me.get()?.journal.encrypted) && this.journal.state.get() !== 'unlocked') {
      throw new JournalLockedError();
    }

    let existing: OwnMood[] | null = null;
    const accountMood = async (mood: LocalMood): Promise<number> => {
      const mapped = progress().moodIds[mood.id];
      if (mapped !== undefined) return mapped;
      existing ??= await this.journal.moods();
      const taken = new Set(Object.values(progress().moodIds));
      const match = existing.find((m) => !taken.has(m.id) && m.label === mood.label && m.emoji === mood.emoji);
      const id = match?.id ?? (await this.journal.addMood({ label: mood.label, emoji: mood.emoji })).id;
      await save({ moodIds: { ...progress().moodIds, [mood.id]: id } });
      return id;
    };
    const skipped = new Set(leftOut(data).notes.map((n) => n.date));
    const saveNote = async (note: LocalNote) => {
      if (skipped.has(note.date) || progress().notesDone.includes(note.date)) return;
      const local = customId(note.mood);
      const mapped = local === null ? undefined : progress().moodIds[local];
      const mood: MoodKey | null = local === null ? note.mood : mapped === undefined ? null : `custom:${mapped}`;
      const { queued } = await this.journal.save(note.date, { text: note.text, mood });
      if (queued) throw new ApiError(0, null);
      await save({ notesDone: [...progress().notesDone, note.date] });
    };

    for (const mood of data.moods.filter((m) => m.archived)) {
      if (progress().archivedMoods.includes(mood.id)) continue;
      const id = await accountMood(mood);
      for (const note of data.notes.filter((n) => customId(n.mood) === mood.id)) await saveNote(note);
      await this.journal.updateMood(id, { archived: true });
      await save({ archivedMoods: [...progress().archivedMoods, mood.id] });
    }
    for (const mood of data.moods.filter((m) => !m.archived)) await accountMood(mood);
    for (const note of data.notes) await saveNote(note);
  }
}
