import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { DeviceSync } from '../core/device-sync';
import { OfflineQueue } from '../core/offline-queue';
import { NoticeComponent } from '../shared/notice';
import { FlameMarkComponent } from '../shared/flame-mark';
import { IconComponent, IconName } from '../shared/icon';
import { LegalLinksComponent } from '../shared/legal-links';

const NAV: { path: string; label: string; icon: IconName }[] = [
  { path: '/today', label: 'Today', icon: 'flame' },
  { path: '/history', label: 'History', icon: 'history' },
  { path: '/settings', label: 'Settings', icon: 'settings' },
];

/** Signed-in shell: header with the flame mark and main nav (a bottom tab bar below 48rem), content, legal footer. */
@Component({
  selector: 'app-app-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FlameMarkComponent, IconComponent, LegalLinksComponent, NoticeComponent],
  template: `
    <header class="topbar">
      <div class="topbar-inner">
        <a class="brand" routerLink="/today"><app-flame-mark />Ember</a>
        <nav class="nav" aria-label="Main">
          @for (item of nav; track item.path) {
            <a class="nav-link" [routerLink]="item.path" routerLinkActive="active" ariaCurrentWhenActive="page">
              <app-icon [name]="item.icon" />
              <span>{{ item.label }}</span>
            </a>
          }
        </nav>
        <button class="btn btn-quiet signout" type="button" [attr.aria-disabled]="signingOut() ? 'true' : null" (click)="signOut()">
          {{ signingOut() ? 'Signing out…' : 'Sign out' }}
        </button>
      </div>
    </header>
    <main id="main" tabindex="-1" class="main">
      @if (queue.pending() > 0) {
        <app-notice tone="info">
          {{ queue.pending() === 1 ? 'One change is' : queue.pending() + ' changes are' }} saved on this
          device and will sync when you're back online.
        </app-notice>
      }
      @if (sync.dropped() > 0) {
        <app-notice>
          A change you made offline couldn't be saved: that day can't be edited anymore, or the habit is
          gone. Everything else is in place.
          <button class="btn btn-quiet" type="button" (click)="sync.dropped.set(0)">Okay</button>
        </app-notice>
      }
      <router-outlet />
    </main>
    <footer class="footer">
      <app-legal-links />
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100dvh;
      padding-bottom: calc(var(--tabbar-height) + env(safe-area-inset-bottom));
    }
    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      padding-top: env(safe-area-inset-top);
      background: var(--color-bg);
      border-bottom: 1px solid var(--color-border);
    }
    .topbar-inner {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      max-width: var(--shell-max);
      margin: 0 auto;
      padding: var(--space-2) var(--space-4);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--tap);
      color: var(--color-text);
      font-family: var(--font-display);
      font-size: var(--text-md);
      font-weight: var(--weight-bold);
      text-decoration: none;
    }
    .nav {
      position: fixed;
      inset: auto 0 0;
      z-index: 10;
      display: flex;
      padding-bottom: env(safe-area-inset-bottom);
      background: var(--color-surface);
      border-top: 1px solid var(--color-border);
    }
    .nav-link {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 0.125rem;
      min-height: var(--tabbar-height);
      color: var(--color-text-muted);
      font-size: var(--text-xs);
      font-weight: var(--weight-medium);
      text-decoration: none;
      border-radius: 0;
    }
    .nav-link:focus-visible {
      outline-offset: -3px;
    }
    .nav-link.active {
      color: var(--color-primary);
      font-weight: var(--weight-bold);
      box-shadow: inset 0 3px 0 var(--color-primary);
    }
    .signout {
      margin-left: auto;
    }
    .main {
      flex: 1;
      width: 100%;
      max-width: var(--shell-max);
      margin: 0 auto;
      padding: var(--space-6) var(--space-4) var(--space-10);
    }
    .main:focus {
      outline: none;
    }
    .footer {
      padding: var(--space-4);
      border-top: 1px solid var(--color-border);
    }
    @media (min-width: 48rem) {
      :host {
        padding-bottom: 0;
      }
      .nav {
        position: static;
        gap: var(--space-1);
        padding: 0;
        background: none;
        border: 0;
      }
      .nav-link {
        flex: none;
        flex-direction: row;
        gap: var(--space-2);
        min-height: var(--tap);
        padding: 0 var(--space-3);
        border-radius: var(--radius-md);
        font-size: var(--text-base);
      }
      .nav-link:hover {
        background: var(--color-surface-sunken);
        color: var(--color-text);
      }
      .nav-link.active {
        background: var(--color-surface-sunken);
        color: var(--color-text);
        box-shadow: inset 0 -3px 0 var(--color-primary);
      }
      .main {
        padding: var(--space-10) var(--space-6) var(--space-12);
      }
    }
  `,
})
export class AppLayout {
  private readonly auth = inject(AuthService);
  protected readonly queue = inject(OfflineQueue);
  protected readonly sync = inject(DeviceSync);
  protected readonly nav = NAV;
  protected readonly signingOut = signal(false);

  protected async signOut(): Promise<void> {
    if (this.signingOut()) return;
    this.signingOut.set(true);
    await this.auth.logout();
    this.signingOut.set(false);
  }
}
