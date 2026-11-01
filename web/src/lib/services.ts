import { ApiClient } from './api-client';
import { AuthService } from './auth';
import { DeviceStore } from './device-store';
import { DeviceSync } from './device-sync';
import { env } from './env';
import { Http } from './http';
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
export const deviceSync = new DeviceSync(auth, api, offlineQueue, reminders);

http.session = auth;
http.bearer = tokens;
http.onHabitWrite = () => deviceSync.rebuildReminders();
