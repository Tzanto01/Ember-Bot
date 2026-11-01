import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Footer navigation to the three legal pages. */
@Component({
  selector: 'app-legal-links',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <nav aria-label="Legal">
      <a class="tap-link" routerLink="/legal/privacy">Privacy</a>
      <a class="tap-link" routerLink="/legal/terms">Terms</a>
      <a class="tap-link" routerLink="/legal/imprint">Imprint</a>
    </nav>
  `,
  styles: `
    nav {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--space-2) var(--space-5);
      font-size: var(--text-sm);
    }
    a {
      color: var(--color-text-muted);
    }
  `,
})
export class LegalLinksComponent {}
