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

const conflictCopy = 'This account already has habits, so nothing was moved. Your device data is still here.';

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

function customId(mood: MoodKey | null): number | null {
  return mood?.startsWith('custom:') ? Number(mood.slice(7)) : null;
}

/**
 * "Create an account and keep my data": imports the device data into the signed-in account (`POST /api/me/import`),
 * encrypting the journal first when the private journal is chosen, then removes the device copy. Progress is kept on the
 * device, so a retry after an interruption resumes and never imports twice; nothing local is deleted on any failure.
 */
export class UpgradeService implements UpgradeApi {
  constructor(
    private readonly store: LocalStore,
    private readonly api: Pick<ApiClient, 'importData' | 'updateMe'>,
    private readonly auth: Pick<AuthService, 'me'>,
    private readonly journal: Pick<JournalApi, 'state' | 'enable' | 'moods' | 'addMood' | 'updateMood' | 'save'>,
    private readonly device: Pick<DeviceStore, 'clearUser'>,
    private readonly localMode: Pick<LocalMode, 'mode' | 'finishUpgrade'>,
  ) {}

  async summary(): Promise<UpgradeSummary | null> {
    const data = await this.store.load().catch(() => null);
    if (!data) return null;
    const out = leftOut(data);
    return {
      habits: data.habits.length,
      checkIns: data.logs.length,
      notes: data.notes.length,
      moods: data.moods.length,
      leftOut: { notes: out.notes.length, lowDays: out.lowDays.length },
    };
  }

  async run(
    options: { privateJournal?: { passphrase: string; remember: boolean; password?: string } } = {},
  ): Promise<UpgradeResult> {
    const me = this.auth.me.get();
    if (this.localMode.mode.get() !== 'upgrading' || !me) return failed('Sign in to your new account first.');
    const data = await this.store.load().catch(() => null);
    if (!data) return failed("There's no device data waiting to be moved.");
    const secret = options.privateJournal;
    if (data.upgrade && data.upgrade.userId !== me.id && data.upgrade.importSent && !data.upgrade.imported) {
      return failed('Sign in to the account you started moving your data to, then try again.');
    }
    if (data.upgrade?.imported && data.upgrade.userId !== me.id) {
      return failed('Your data already moved to another account. Sign in to that account to finish.');
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
    const save = async (change: Partial<UpgradeProgress>) => {
      progress = { ...progress, ...change };
      const next = progress;
      await this.store.update((d) => ({ ...d, upgrade: next }));
    };

    let importing = true;
    try {
      if (!progress.imported) {
        const sentBefore = progress.importSent;
        const omit = sentBefore ? progress.journalOmitted : !!secret;
        const { profile } = data;
        await this.api.updateMe({
          timezone: profile.timezone,
          graceDaysPerWeek: profile.graceDaysPerWeek,
          ...(profile.theme ? { theme: profile.theme } : {}),
        });
        await save({ importSent: true, journalOmitted: omit });
        try {
          await this.api.importData(importDocument(data, !omit));
        } catch (error) {
          const apiError = asApiError(error);
          if (!(sentBefore && isNotEmpty(apiError))) {
            if (apiError.status >= 400 && apiError.status < 500 && apiError.status !== 429) await save({ importSent: false });
            throw error;
          }
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

      await this.store.clear();
      await this.device.clearUser(data.profile.userId).catch(() => undefined);
      this.localMode.finishUpgrade();
      return { ok: true, recoveryCode: progress.recoveryCode };
    } catch (error) {
      if (error instanceof JournalLockedError) return failed('Unlock your private journal on this device, then try again.');
      if (error instanceof RangeError) return failed(error.message);
      const apiError = asApiError(error);
      if (importing && isNotEmpty(apiError)) return { ok: false, reason: 'conflict', message: conflictCopy };
      if (apiError.status === 403 && apiError.type === 'consent_required') {
        return { ok: false, reason: 'consent', message: problemToMessage(apiError).message };
      }
      return failed(problemToMessage(apiError).message);
    }
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
