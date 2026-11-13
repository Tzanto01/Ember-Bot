import { ApiClient } from './api-client';
import { AuthService } from './auth';
import { DeviceStore } from './device-store';
import { DeviceSync } from './device-sync';
import { env } from './env';
import { HelpsService } from './helps/helps';
import { Http } from './http';
import { JournalService } from './journal/journal';
import { Keyring } from './journal/keyring';
import { LocalBackend } from './local/backend';
import { BackupService } from './local/backup';
import { LocalMode } from './local/mode';
import { LocalStore } from './local/store';
import { UpgradeService } from './local/upgrade';
import { Reminders } from './native/reminders';
import { capacitorSecureStore, TokenStore } from './native/token-store';
import { OfflineQueue } from './offline-queue';
import { PushService, serviceWorkerRegistration } from './push';

/** The app's single instances. Tests build their own with fakes instead of importing these. */
export const http = new Http({ native: env.native, apiBase: env.apiBase });
export const deviceStore = new DeviceStore();
export const offlineQueue = new OfflineQueue(deviceStore);
export const api = new ApiClient(http, offlineQueue);

/** Native build only (null on the web): bearer tokens. */
export const tokens = env.native ? new TokenStore(http, capacitorSecureStore) : null;
/** Native build only (null on the web): local reminder notifications. */
export const reminders = env.native ? new Reminders(api, deviceStore) : null;

export const push = new PushService(api, env.native ? async () => null : serviceWorkerRegistration);
export const auth = new AuthService(
  api,
  offlineQueue,
  env.native ? null : push,
  tokens && reminders ? { tokens, reminders } : null,
);
/** The day journal (plain or end-to-end encrypted); its key stays on this device. */
export const journal = new JournalService(
  api,
  auth,
  new Keyring(env.native ? capacitorSecureStore : null),
);
auth.journal = journal;
offlineQueue.resealNote = (edit) => journal.resealNote(edit);
journal.onDroppedNote = (note) => offlineQueue.droppedNotes.update((notes) => [...notes, note]);
/** "What helps me", end-to-end encrypted, in memory only; the signed-in shell loads it. */
export const helps = new HelpsService(api, journal, auth);
export const deviceSync = new DeviceSync(auth, api, offlineQueue, reminders);

http.session = auth;
http.bearer = tokens;
http.onHabitWrite = () => deviceSync.rebuildReminders();

/** No-account mode: the device data (IndexedDB `ember-local`). */
export const localStore = new LocalStore();
/** No-account mode: answers own `/api` requests from the device data while `Http.local` points at it. */
export const localBackend = new LocalBackend(localStore, { native: env.native });
/** Which data source the app runs on (account, device, or upgrading from device to account). */
export const localMode = new LocalMode(localStore, localBackend, http, api, auth, { native: env.native });
/** Backup files and the backup reminder of no-account mode. */
export const backup = new BackupService(localStore);
/** Moves the device data into the signed-in account. */
export const upgrade = new UpgradeService(localStore, api, auth, journal, deviceStore, localMode);
