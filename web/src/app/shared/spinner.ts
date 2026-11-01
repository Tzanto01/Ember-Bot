import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * Small busy indicator in `currentColor`. With a `label` it is announced (role status);
 * without one it is decorative, for example inside a button whose text already says "Saving…".
 * For loading layouts prefer the global `.skeleton` class.
 */
@Component({
  selector: 'app-spinner',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.role]': "label() ? 'status' : null", '[attr.aria-hidden]': "label() ? null : 'true'" },
  template: `
    <span class="ring"></span>
    @if (label()) {
      <span class="visually-hidden">{{ label() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .ring {
      width: 1em;
      height: 1em;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `,
})
export class SpinnerComponent {
  /** Accessible text such as "Loading habits". */
  readonly label = input<string>();
}
