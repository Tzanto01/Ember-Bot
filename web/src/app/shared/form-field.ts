import {
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChild,
  Directive,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { NgControl, ValidationErrors } from '@angular/forms';
import { IconComponent } from './icon';

let nextId = 0;

/** Focuses the first invalid reactive control inside `root`; call after `markAllAsTouched()` on a failed submit. */
export function focusFirstInvalid(root: HTMLElement): void {
  root.querySelector<HTMLElement>('input.ng-invalid, select.ng-invalid, textarea.ng-invalid')?.focus();
}

const defaultMessages: Record<string, (error: unknown) => string> = {
  required: () => 'Please fill this in.',
  email: () => "That doesn't look like an email address yet.",
  minlength: (e) => `Use at least ${(e as { requiredLength: number }).requiredLength} characters.`,
  maxlength: (e) => `Keep it to ${(e as { requiredLength: number }).requiredLength} characters or fewer.`,
};

/**
 * Labelled form field. Put one control inside and mark it with `appFieldInput`; the directive
 * wires `id`, `aria-describedby` and `aria-invalid`. Client errors show once the control is
 * touched (call `form.markAllAsTouched()` on submit); a `serverError` shows when there is no client error.
 *
 * ```html
 * <app-form-field label="Email" [serverError]="fieldErrors()['email']">
 *   <input appFieldInput class="input" type="email" formControlName="email" autocomplete="email" />
 * </app-form-field>
 * ```
 */
@Component({
  selector: 'app-form-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent],
  template: `
    <label class="label" [for]="inputId">
      {{ label() }}
      @if (optional()) {
        <span class="muted">(optional)</span>
      }
    </label>
    <ng-content />
    @if (hint()) {
      <p class="hint" [id]="inputId + '-hint'">{{ hint() }}</p>
    }
    @if (error(); as message) {
      <p class="error" [id]="inputId + '-error'">
        <app-icon name="info" />
        <span>{{ message }}</span>
      </p>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .label {
      font-weight: var(--weight-medium);
    }
    .hint {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    .error {
      display: flex;
      gap: var(--space-2);
      align-items: flex-start;
      font-size: var(--text-sm);
      color: var(--color-notice-text);
      --icon-size: 1.125rem;
    }
  `,
})
export class FormFieldComponent {
  readonly label = input.required<string>();
  readonly hint = input<string>();
  /** Shows "(optional)" after the label. */
  readonly optional = input(false, { transform: booleanAttribute });
  /** Overrides for validator keys, for example `{ required: 'Please add a name.' }`. */
  readonly messages = input<Record<string, string>>({});
  /** A message from the server for this field (from `problemToMessage(...).fields`). */
  readonly serverError = input<string | null | undefined>(null);

  /** The id given to the projected control. */
  readonly inputId = `field-${++nextId}`;

  private readonly control = contentChild(FieldInputDirective);
  private readonly version = signal(0);

  constructor() {
    effect((onCleanup) => {
      const control = this.control()?.ngControl.control;
      if (!control) return;
      const sub = control.events.subscribe(() => this.version.update((v) => v + 1));
      onCleanup(() => sub.unsubscribe());
    });
  }

  /** The message currently shown, or null. */
  readonly error = computed(() => {
    this.version();
    const control = this.control()?.ngControl.control;
    if (control?.touched && control.invalid && control.errors) return this.clientMessage(control.errors);
    return this.serverError() || null;
  });

  /** Value for the control's `aria-describedby`. */
  readonly describedBy = computed(() => {
    const ids = [this.hint() ? `${this.inputId}-hint` : '', this.error() ? `${this.inputId}-error` : ''];
    return ids.filter(Boolean).join(' ') || null;
  });

  private clientMessage(errors: ValidationErrors): string {
    const key = Object.keys(errors)[0];
    const override = this.messages()[key];
    if (override) return override;
    const fallback = defaultMessages[key];
    return fallback ? fallback(errors[key]) : 'Please check this field.';
  }
}

/** Marks the control inside `<app-form-field>`; requires a reactive forms directive on the same element. */
@Directive({
  selector: '[appFieldInput]',
  host: {
    '[id]': 'field.inputId',
    '[attr.aria-describedby]': 'field.describedBy()',
    '[attr.aria-invalid]': "field.error() ? 'true' : null",
  },
})
export class FieldInputDirective {
  /** The enclosing field. */
  readonly field = inject(FormFieldComponent);
  /** The reactive forms control on this element. */
  readonly ngControl = inject(NgControl, { self: true });
}
