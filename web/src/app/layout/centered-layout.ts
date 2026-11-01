import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterOutlet } from '@angular/router';
import { FlameMarkComponent } from '../shared/flame-mark';
import { LegalLinksComponent } from '../shared/legal-links';

/** Simple centred frame for sign-in, email-link, consent, legal and not-found pages (no app nav). */
@Component({
  selector: 'app-centered-layout',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, FlameMarkComponent, LegalLinksComponent],
  template: `
    <header class="head">
      <a class="brand" routerLink="/"><app-flame-mark />Ember</a>
    </header>
    <main id="main" tabindex="-1" class="panel card">
      <router-outlet />
    </main>
    <footer class="foot">
      <app-legal-links />
    </footer>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-6);
      min-height: 100dvh;
      padding: max(var(--space-6), env(safe-area-inset-top)) var(--space-4) max(var(--space-4), env(safe-area-inset-bottom));
      background: radial-gradient(60rem 30rem at 50% -10rem, var(--color-notice-bg), transparent 70%), var(--color-bg);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: var(--space-2);
      min-height: var(--tap);
      color: var(--color-text);
      font-family: var(--font-display);
      font-size: var(--text-lg);
      font-weight: var(--weight-bold);
      text-decoration: none;
    }
    .panel {
      width: 100%;
      max-width: 30rem;
    }
    .panel:focus {
      outline: none;
    }
    .foot {
      margin-top: auto;
    }
    @media (max-width: 30rem) {
      .panel {
        padding: var(--space-5) var(--space-4);
      }
    }
  `,
})
export class CenteredLayout {}
