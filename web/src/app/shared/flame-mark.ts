import { ChangeDetectionStrategy, Component } from '@angular/core';

/** The Ember flame logo in brand colours. Decorative; size it with CSS `width`/`height` on the host. */
@Component({
  selector: 'app-flame-mark',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="12 2 40 54" focusable="false">
      <path class="outer" d="M32 4C36 14 48 22 48 38A16 16 0 0 1 16 38C16 29 21 23 25 18C26 23 28 26 30.5 27C30 19 30.5 11 32 4Z" />
      <path class="core" d="M32 30C35.5 34.5 40 37.5 40 43.5A8 8 0 0 1 24 43.5C24 38.5 28 35 32 30Z" />
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: 1.75rem;
      height: 1.75rem;
    }
    svg {
      width: 100%;
      height: 100%;
    }
    .outer {
      fill: var(--color-flame);
    }
    .core {
      fill: var(--color-flame-core);
    }
  `,
})
export class FlameMarkComponent {}
