import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Moves focus to the first `h1` inside `root` (adds `tabindex="-1"` when needed). Call after render. */
export function focusPageHeading(root: ParentNode = document): void {
  const heading = root.querySelector<HTMLElement>('h1');
  if (!heading) return;
  if (!heading.hasAttribute('tabindex')) heading.setAttribute('tabindex', '-1');
  heading.focus();
}

/**
 * Page frame: the screen's single `h1` (the shell focuses it after navigation), an optional lede,
 * then the projected content. Content flows in a vertical stack.
 *
 * `<app-page heading="Today" lede="Sunday, 1 November">…</app-page>`
 */
@Component({
  selector: 'app-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <h1 tabindex="-1">{{ heading() }}</h1>
      @if (lede()) {
        <p class="muted">{{ lede() }}</p>
      }
    </header>
    <ng-content />
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-6);
    }
    .page-head {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
  `,
})
export class PageComponent {
  readonly heading = input.required<string>();
  readonly lede = input<string>();
}
