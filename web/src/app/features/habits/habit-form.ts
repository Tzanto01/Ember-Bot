import { ChangeDetectionStrategy, Component, effect, input, signal } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { Frequency } from '../../core/models';
import { FieldInputDirective, FormFieldComponent } from '../../shared/form-field';

/** The create and edit form. `weeklyTarget` is disabled while the frequency is daily. */
export type HabitForm = FormGroup<{
  name: FormControl<string>;
  frequency: FormControl<Frequency>;
  weeklyTarget: FormControl<number>;
  reminderTime: FormControl<string>;
}>;

/** Plain values of a `HabitForm`, with the name trimmed and an empty reminder as null. */
export interface HabitFormValue {
  name: string;
  frequency: Frequency;
  weeklyTarget: number | null;
  reminderTime: string | null;
}

/** Name rules from the contract: 1 to 100 characters after trimming. */
export function habitNameValidator(control: AbstractControl<string>): ValidationErrors | null {
  const length = (control.value ?? '').trim().length;
  if (length === 0) return { required: true };
  if (length > 100) return { maxlength: { requiredLength: 100 } };
  return null;
}

/** Builds the form; the weekly target follows the frequency. */
export function createHabitForm(): HabitForm {
  const form: HabitForm = new FormGroup({
    name: new FormControl('', { nonNullable: true, validators: [habitNameValidator] }),
    frequency: new FormControl<Frequency>('daily', { nonNullable: true }),
    weeklyTarget: new FormControl(
      { value: 3, disabled: true },
      { nonNullable: true, validators: [Validators.min(1), Validators.max(6)] },
    ),
    reminderTime: new FormControl('', { nonNullable: true }),
  });
  form.controls.frequency.valueChanges.subscribe((frequency) => {
    const target = form.controls.weeklyTarget;
    if (frequency === 'weekly') target.enable({ emitEvent: false });
    else target.disable({ emitEvent: false });
  });
  return form;
}

/** "Every day", "Once a week" or "3 times a week". */
export function cadenceText(frequency: Frequency, weeklyTarget: number | null): string {
  if (frequency === 'daily') return 'Every day';
  return weeklyTarget === 1 ? 'Once a week' : `${weeklyTarget ?? 1} times a week`;
}

/** Reads the form as API-ready values. */
export function habitFormValue(form: HabitForm): HabitFormValue {
  const raw = form.getRawValue();
  return {
    name: raw.name.trim(),
    frequency: raw.frequency,
    weeklyTarget: raw.frequency === 'weekly' ? raw.weeklyTarget : null,
    reminderTime: raw.reminderTime || null,
  };
}

/** Name, frequency, weekly target and reminder time. Place inside the page's `<form [formGroup]>`. */
@Component({
  selector: 'app-habit-fields',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, FormFieldComponent, FieldInputDirective],
  template: `
    <div class="stack" [formGroup]="form()">
      <app-form-field
        label="Name"
        [messages]="{ required: 'Give your habit a short name.' }"
        [serverError]="errors()['name']"
      >
        <input
          appFieldInput
          class="input"
          type="text"
          formControlName="name"
          autocomplete="off"
          maxlength="120"
        />
      </app-form-field>

      <fieldset class="choices">
        <legend class="legend">How often</legend>
        <label class="checkbox">
          <input type="radio" formControlName="frequency" value="daily" />
          Every day
        </label>
        <label class="checkbox">
          <input type="radio" formControlName="frequency" value="weekly" />
          A few times a week
        </label>
        @if (errors()['frequency']; as message) {
          <p class="error">{{ message }}</p>
        }
      </fieldset>

      @if (weekly()) {
        <app-form-field label="Times per week" [serverError]="errors()['weeklyTarget']">
          <select appFieldInput class="input" formControlName="weeklyTarget">
            @for (n of targets; track n) {
              <option [ngValue]="n">{{ n }}</option>
            }
          </select>
        </app-form-field>
      }

      <app-form-field
        label="Reminder time"
        optional
        hint="Ember sends a gentle nudge at this time."
        [serverError]="errors()['reminderTime']"
      >
        <input appFieldInput class="input time" type="time" formControlName="reminderTime" />
      </app-form-field>
    </div>
  `,
  styles: `
    .choices {
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .legend {
      padding: 0;
      margin-bottom: var(--space-1);
      font-weight: var(--weight-medium);
    }
    .error {
      font-size: var(--text-sm);
      color: var(--color-notice-text);
    }
    .time {
      max-width: 12rem;
    }
  `,
})
export class HabitFieldsComponent {
  readonly form = input.required<HabitForm>();
  /** Server field messages from `problemToMessage(...).fields`. */
  readonly errors = input<Record<string, string>>({});
  protected readonly targets = [1, 2, 3, 4, 5, 6];
  protected readonly weekly = signal(false);

  constructor() {
    effect((onCleanup) => {
      const frequency = this.form().controls.frequency;
      this.weekly.set(frequency.value === 'weekly');
      const sub = frequency.valueChanges.subscribe((value) => this.weekly.set(value === 'weekly'));
      onCleanup(() => sub.unsubscribe());
    });
  }
}
