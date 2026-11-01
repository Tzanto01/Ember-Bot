import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FlameMarkComponent } from './flame-mark';

/**
 * Friendly empty view: a small flame, a heading and projected text plus actions.
 *
 * `<app-empty-state heading="No habits yet"><p>…</p><a class="btn btn-primary" routerLink="/habits/new">Add a habit</a></app-empty-state>`
 */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FlameMarkComponent],
  template: `
    <app-flame-mark class="mark" />
    <h2>{{ heading() }}</h2>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--space-3);
      padding: var(--space-10) var(--space-4);
      text-align: center;
      color: var(--color-text-muted);
    }
    h2 {
      color: var(--color-text);
    }
    .mark {
      width: 2.5rem;
      height: 2.5rem;
    }
  `,
})
export class EmptyStateComponent {
  readonly heading = input.required<string>();
}
