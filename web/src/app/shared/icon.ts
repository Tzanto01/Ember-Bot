import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

const ICONS = {
  flame: ['M12 3c1.5 3.5 5 6 5 10.5a5 5 0 0 1-10 0c0-2.5 1.2-4.2 2.5-5.5.2 1.8 1 2.8 2 3.2-.3-2.8 0-5.6.5-8.2z'],
  history: ['M8 2v4', 'M16 2v4', 'M3 10h18', 'M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z'],
  settings: [
    'M4 7h9',
    'M17 7h3',
    'M13 7a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
    'M4 17h3',
    'M11 17h9',
    'M7 17a2 2 0 1 0 4 0a2 2 0 1 0-4 0',
  ],
  info: ['M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18', 'M12 11v5', 'M12 8h.01'],
  check: ['M5 12.5l4.5 4.5L19 7.5'],
  moon: ['M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z'],
  pause: ['M9 5v14', 'M15 5v14'],
  mail: ['M4 6h16v12H4z', 'M4 7l8 6 8-6'],
  'arrow-left': ['M19 12H5', 'M11 6l-6 6 6 6'],
} satisfies Record<string, string[]>;

/** Names accepted by `<app-icon>`. */
export type IconName = keyof typeof ICONS;

/**
 * Decorative line icon (24 px grid, `currentColor`, hidden from assistive tech).
 * Size with the `--icon-size` custom property. Always pair it with visible text or an `aria-label` on the control.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" focusable="false">
      @for (d of paths(); track $index) {
        <path [attr.d]="d" />
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      width: var(--icon-size, 1.25rem);
      height: var(--icon-size, 1.25rem);
    }
    svg {
      width: 100%;
      height: 100%;
    }
  `,
})
export class IconComponent {
  /** Which icon to draw. */
  readonly name = input.required<IconName>();
  protected readonly paths = computed(() => ICONS[this.name()]);
}
