import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent, IconName } from './icon';

/** `notice` is the calm "something needs attention" tone (never red); the others are informational. */
export type NoticeTone = 'notice' | 'info' | 'success' | 'lowday';

const toneIcons: Record<NoticeTone, IconName> = {
  notice: 'info',
  info: 'info',
  success: 'check',
  lowday: 'moon',
};

/**
 * Inline message with an icon. Project the text (and any action button) as content.
 * Tone `notice` is announced as an alert, the others as a polite status.
 *
 * `<app-notice tone="notice" heading="Couldn't save">{{ message }}</app-notice>`
 */
@Component({
  selector: 'app-notice',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  host: {
    '[attr.role]': "tone() === 'notice' ? 'alert' : 'status'",
    '[attr.data-tone]': 'tone()',
  },
  template: `
    <app-icon class="notice-icon" [name]="icon()" />
    <div class="notice-body">
      @if (heading()) {
        <p class="notice-heading">{{ heading() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: `
    :host {
      display: flex;
      gap: var(--space-3);
      align-items: flex-start;
      padding: var(--space-3) var(--space-4);
      border-radius: var(--radius-md);
      border: 1px solid var(--color-border);
      background: var(--color-surface-sunken);
      color: var(--color-text);
    }
    :host([data-tone='notice']) {
      background: var(--color-notice-bg);
      border-color: var(--color-notice-border);
    }
    :host([data-tone='notice']) .notice-icon {
      color: var(--color-notice-icon);
    }
    :host([data-tone='success']) {
      background: var(--color-success-bg);
      border-color: transparent;
    }
    :host([data-tone='success']) .notice-icon {
      color: var(--color-success);
    }
    :host([data-tone='lowday']) {
      background: var(--color-lowday-bg);
      border-color: transparent;
    }
    :host([data-tone='lowday']) .notice-icon {
      color: var(--color-lowday);
    }
    .notice-icon {
      margin-top: 0.125rem;
      color: var(--color-text-muted);
    }
    .notice-body {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
      min-width: 0;
    }
    .notice-heading {
      font-weight: var(--weight-bold);
    }
  `,
})
export class NoticeComponent {
  readonly tone = input<NoticeTone>('info');
  /** Optional bold first line. */
  readonly heading = input<string>();
  protected readonly icon = computed(() => toneIcons[this.tone()]);
}
