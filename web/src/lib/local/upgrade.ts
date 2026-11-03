import type { ApiClient } from '../api-client';
import type { AuthService } from '../auth';
import type { DeviceStore } from '../device-store';
import { type JournalApi, JournalLockedError } from '../journal/types';
import type { MoodKey } from '../models';
import { ApiError, asApiError, problemToMessage } from '../problem';
import { exportDocument } from './backend';
import type { LocalMode } from './mode';
import type { LocalStore } from './store';
import type { LocalData, LocalMood, LocalNote, UpgradeApi, UpgradeProgress, UpgradeResult, UpgradeSummary } from './types';

const conflictCopy = 'This account already has habits, so nothing was moved. Your device data is still here.';

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
    private readonly api: Pick<ApiClient, 'importData' | 'listHabits'>,
    private readonly auth: Pick<AuthService, 'me'>,
    private readonly journal: Pick<JournalApi, 'state' | 'enable' | 'addMood' | 'updateMood' | 'save'>,
    private readonly device: Pick<DeviceStore, 'clearUser'>,
    private readonly localMode: Pick<LocalMode, 'mode' | 'finishUpgrade'>,
  ) {}

  async summary(): Promise<UpgradeSummary | null> {
    const data = await this.store.load().catch(() => null);
    if (!data) return null;
    return { habits: data.habits.length, checkIns: data.logs.length, notes: data.notes.length, moods: data.moods.length };
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
        await save({ importSent: true });
        try {
          await this.api.importData(exportDocument(data, !secret));
        } catch (error) {
          const apiError = asApiError(error);
          const ours = apiError.status === 409 && sentBefore && (await this.alreadyImported(data));
          if (!ours) {
            if (apiError.status >= 400 && apiError.status < 500) await save({ importSent: false });
            throw error;
          }
        }
        await save({ imported: true });
      }
      importing = false;
      if (secret) await this.moveJournal(data, secret, () => progress, save);

      await this.store.clear();
      await this.device.clearUser(data.profile.userId).catch(() => undefined);
      this.localMode.finishUpgrade();
      return { ok: true, recoveryCode: secret ? progress.recoveryCode : null };
    } catch (error) {
      if (error instanceof JournalLockedError) return failed('Unlock your private journal on this device, then try again.');
      if (error instanceof RangeError) return failed(error.message);
      const apiError = asApiError(error);
      if (importing && apiError.status === 409) return { ok: false, reason: 'conflict', message: conflictCopy };
      if (apiError.status === 403 && apiError.type === 'consent_required') {
        return { ok: false, reason: 'consent', message: problemToMessage(apiError).message };
      }
      return failed(problemToMessage(apiError).message);
    }
  }

  /** True when the account's habits are exactly the device's (an earlier import went through but its answer was lost). */
  private async alreadyImported(data: LocalData): Promise<boolean> {
    const names = (await this.api.listHabits()).map((h) => h.name).sort();
    const local = data.habits.map((h) => h.name).sort();
    return names.length === local.length && names.every((name, i) => name === local[i]);
  }

  private async moveJournal(
    data: LocalData,
    secret: { passphrase: string; remember: boolean; password?: string },
    progress: () => UpgradeProgress,
    save: (change: Partial<UpgradeProgress>) => Promise<void>,
  ): Promise<void> {
    if (!progress().journalEnabled) {
      let recoveryCode: string | null = null;
      if (!this.auth.me.get()?.journal.encrypted) {
        ({ recoveryCode } = await this.journal.enable(secret.passphrase, secret.remember, secret.password));
      }
      await save({ journalEnabled: true, recoveryCode });
    }
    if (this.journal.state.get() !== 'unlocked') throw new JournalLockedError();

    const accountMood = async (mood: LocalMood): Promise<number> => {
      const mapped = progress().moodIds[mood.id];
      if (mapped !== undefined) return mapped;
      const created = await this.journal.addMood({ label: mood.label, emoji: mood.emoji });
      await save({ moodIds: { ...progress().moodIds, [mood.id]: created.id } });
      return created.id;
    };
    const saveNote = async (note: LocalNote) => {
      if (progress().notesDone.includes(note.date)) return;
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
