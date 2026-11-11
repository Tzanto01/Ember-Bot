import type { ApiClient } from '../api-client';
import type { AuthService } from '../auth';
import type { Http } from '../http';
import { browserTimeZone } from '../local-date';
import { Store } from '../store';
import { currentTheme } from '../theme';
import { newLocalData, type LocalBackend } from './backend';
import type { LocalStore } from './store';
import type { AppMode, LocalModeApi } from './types';

const flagKey = 'ember.mode';

function readFlag(): string | null {
  try {
    return localStorage.getItem(flagKey);
  } catch {
    return null;
  }
}

function writeFlag(mode: AppMode): void {
  try {
    if (mode === 'account') localStorage.removeItem(flagKey);
    else localStorage.setItem(flagKey, mode);
  } catch {}
}

/**
 * The app's data source (contract "No account (device only)"). `local` routes own `/api` requests to the device's
 * {@link LocalBackend} through `Http.local`; `upgrading` talks to the server while the device data waits for import.
 * The mode survives restarts in localStorage (`ember.mode`). Navigation is left to the screens.
 */
export class LocalMode implements LocalModeApi {
  readonly mode = new Store<AppMode>('account');
  readonly evicted = new Store(false);

  constructor(
    private readonly store: LocalStore,
    private readonly backend: LocalBackend,
    private readonly http: Http,
    private readonly api: ApiClient,
    private readonly auth: AuthService,
    private readonly options: { native: boolean },
  ) {}

  /**
   * Restores the mode at app start, before anything calls the API. `upgrading` without device data left goes back to the
   * account mode; `local` without device data starts a fresh profile and sets `evicted`. A storage read error changes
   * nothing (the local API then answers with errors). Never throws.
   */
  async init(): Promise<void> {
    const flag = readFlag();
    if (flag === 'upgrading') {
      if ((await this.store.exists().catch(() => true)) === false) this.leave();
      else this.mode.set('upgrading');
      return;
    }
    if (flag !== 'local') return;
    let evicted = false;
    await this.store
      .upsert((data) => {
        if (data) return data;
        evicted = true;
        return this.fresh();
      })
      .then(
        () => this.evicted.set(evicted),
        () => undefined,
      );
    this.enterLocal();
  }

  /**
   * Starts no-account mode on this device. A finished upgrade whose recovery code wasn't acknowledged yet keeps its
   * record and goes back to `upgrading` instead, so the code is shown once the user signs in to that account.
   */
  async start(): Promise<void> {
    const data = await this.store.upsert((current) => current ?? this.fresh());
    if (data.upgrade?.finished) {
      this.http.local = null;
      writeFlag('upgrading');
      this.mode.set('upgrading');
      return;
    }
    if (!this.options.native) await navigator.storage?.persist?.().catch(() => false);
    this.enterLocal();
    await this.auth.loadMe(true);
  }

  async beginUpgrade(): Promise<void> {
    this.http.local = null;
    writeFlag('upgrading');
    this.mode.set('upgrading');
    this.auth.clearSession();
    await this.auth.refreshAntiforgery();
  }

  /** Back to no-account mode with the device data; does nothing while a finished upgrade's recovery code waits. */
  async cancelUpgrade(): Promise<void> {
    if ((await this.store.load().catch(() => null))?.upgrade?.finished) return;
    if (this.auth.signedIn()) {
      if (!this.options.native) await this.api.logout().catch(() => undefined);
      await this.auth.wipeDevice();
      this.auth.clearSession();
    }
    await this.store.upsert((data) => {
      if (!data) return this.fresh();
      const { upgrade: _dropped, ...rest } = data;
      return rest;
    });
    this.enterLocal();
    await this.auth.loadMe(true);
  }

  async wipe(): Promise<void> {
    await this.auth.wipeDevice();
    await this.store.clear();
    this.leave();
    this.auth.clearSession();
    await this.auth.refreshAntiforgery();
  }

  /** Back to the account mode after the device data moved into the account (the upgrade cleared it already). */
  finishUpgrade(): void {
    this.leave();
  }

  private fresh() {
    return newLocalData({ timezone: browserTimeZone(), theme: currentTheme() }, new Date());
  }

  private enterLocal(): void {
    writeFlag('local');
    this.http.local = this.backend.handle;
    this.mode.set('local');
  }

  private leave(): void {
    writeFlag('account');
    this.http.local = null;
    this.evicted.set(false);
    this.mode.set('account');
  }
}
