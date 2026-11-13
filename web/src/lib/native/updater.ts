import { Capacitor, type PluginListenerHandle, registerPlugin } from '@capacitor/core';
import { env } from '../env';
import { type LocalizedNotes, loadReleaseNotes } from '../release-notes';

/** A newer sideloaded beta build, from `latest.json` next to the APK. */
export interface BetaUpdate {
  versionCode: number;
  versionName: string;
  url: string;
  sha256: string;
  size?: number;
}

/** The custom native plugin (`EmberUpdater`, beta Android build only). */
export interface EmberUpdaterPlugin {
  canInstall(): Promise<{ value: boolean }>;
  openInstallSettings(): Promise<void>;
  /** Downloads, checks SHA-256 and size natively, then opens Android's installer (which asks the user). */
  downloadAndInstall(options: { url: string; sha256: string; size?: number }): Promise<void>;
  addListener(
    event: 'downloadProgress',
    listener: (progress: { received: number; total: number }) => void,
  ): Promise<PluginListenerHandle>;
}

export const EmberUpdater = registerPlugin<EmberUpdaterPlugin>('EmberUpdater');

/** True only in the sideloaded beta app: native with the `EmberUpdater` plugin (never on the web or from Play). */
export const updaterAvailable = (): boolean =>
  env.native && Capacitor.isPluginAvailable('EmberUpdater');

const positiveInt = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

/**
 * The update `body` describes when it is a valid manifest, its `url` is https on `origin` and its `versionCode` is
 * above `installed`; otherwise null.
 */
export function parseManifest(body: unknown, origin: string, installed: number): BetaUpdate | null {
  if (!body || typeof body !== 'object') return null;
  const { versionCode, versionName, url, sha256, size } = body as Record<string, unknown>;
  if (!positiveInt(versionCode) || versionCode <= installed) return null;
  if (typeof versionName !== 'string' || !versionName.trim()) return null;
  if (typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) return null;
  if (size !== undefined && size !== null && !positiveInt(size)) return null;
  if (typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.origin !== origin) return null;
  return { versionCode, versionName, url, sha256, ...(positiveInt(size) ? { size } : {}) };
}

/**
 * Reads `{apiBase}/download/latest.json` and returns a build newer than the installed one. Null outside the beta
 * app and whenever the manifest is missing, broken or invalid.
 */
export async function findUpdate(): Promise<BetaUpdate | null> {
  if (!updaterAvailable()) return null;
  try {
    const origin = new URL(env.apiBase).origin;
    const { App } = await import('@capacitor/app');
    const installed = Number((await App.getInfo()).build);
    if (!Number.isSafeInteger(installed)) return null;
    const response = await fetch(`${env.apiBase}/download/latest.json`, { cache: 'no-store' });
    if (!response.ok) return null;
    return parseManifest(await response.json(), origin, installed);
  } catch {
    return null;
  }
}

/** The notes for `versionName` from the server's `{apiBase}/release-notes.json`; null when they are missing or unreachable. */
export async function findReleaseNotes(versionName: string): Promise<LocalizedNotes | null> {
  try {
    const entries = await loadReleaseNotes(`${env.apiBase}/release-notes.json`);
    return entries.find((entry) => entry.version === versionName)?.notes ?? null;
  } catch {
    return null;
  }
}
