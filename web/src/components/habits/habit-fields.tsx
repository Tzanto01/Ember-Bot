import { useId } from 'react';
import { FormField, fieldMessages } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { NativeSelect } from '@/components/ui/select';
import type { Frequency, Habit, TimeOfDay } from '@/lib/models';

/** What the create and edit form holds; the weekly target is kept while daily but not sent. */
export interface HabitFormState {
  name: string;
  frequency: Frequency;
  weeklyTarget: number;
  /** `HH:MM`, or empty for no reminder. */
  reminderTime: string;
}

/** The form read as API-ready values: name trimmed, weekly target only when weekly, empty reminder as null. */
export interface HabitFormValue {
  name: string;
  frequency: Frequency;
  weeklyTarget: number | null;
  reminderTime: TimeOfDay | null;
}

export const emptyHabitForm: HabitFormState = { name: '', frequency: 'daily', weeklyTarget: 3, reminderTime: '' };

/** The form filled from a saved habit. */
export function habitToForm(habit: Habit): HabitFormState {
  return {
    name: habit.name,
    frequency: habit.frequency,
    weeklyTarget: habit.weeklyTarget ?? 3,
    reminderTime: habit.reminderTime ?? '',
  };
}

/** Contract name rule: 1 to 100 characters after trimming. Null when valid. */
export function habitNameError(name: string): string | null {
  const length = name.trim().length;
  if (length === 0) return 'Give your habit a short name.';
  if (length > 100) return fieldMessages.maxLength(100);
  return null;
}

/** "Every day", "Once a week" or "3 times a week". */
export function cadenceText(frequency: Frequency, weeklyTarget: number | null): string {
  if (frequency === 'daily') return 'Every day';
  return weeklyTarget === 1 ? 'Once a week' : `${weeklyTarget ?? 1} times a week`;
}

export function habitFormValue(state: HabitFormState): HabitFormValue {
  return {
    name: state.name.trim(),
    frequency: state.frequency,
    weeklyTarget: state.frequency === 'weekly' ? state.weeklyTarget : null,
    reminderTime: state.reminderTime || null,
  };
}

const frequencies: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekly', label: 'A few times a week' },
];

const targets = [1, 2, 3, 4, 5, 6];

export interface HabitFieldsProps {
  value: HabitFormState;
  onChange: (value: HabitFormState) => void;
  /** Show the name rule's message (after the name loses focus or after a submit). */
  touched: boolean;
  onTouched: () => void;
  /** Server field messages from `problemToMessage(...).fields`; a client message wins. */
  errors?: Record<string, string>;
  /** Fixed id of the name input, so the page can focus it. */
  nameId?: string;
}

/** Name, "How often", times per week (weekly only) and the optional reminder time. Place inside the page's `form`. */
export function HabitFields({ value, onChange, touched, onTouched, errors = {}, nameId }: HabitFieldsProps) {
  const id = useId();
  const legendId = `${id}-often`;
  const nameError = (touched ? habitNameError(value.name) : null) ?? errors['name'] ?? null;
  return (
    <div className="flex flex-col gap-5">
      <FormField label="Name" error={nameError} {...(nameId ? { id: nameId } : {})}>
        {(field) => (
          <Input
            {...field}
            autoComplete="off"
            maxLength={120}
            value={value.name}
            onChange={(event) => onChange({ ...value, name: event.target.value })}
            onBlur={onTouched}
          />
        )}
      </FormField>

      <div className="flex flex-col gap-2">
        <p id={legendId} className="font-medium">
          How often
        </p>
        <RadioGroup
          aria-labelledby={legendId}
          value={value.frequency}
          onValueChange={(frequency) => onChange({ ...value, frequency: frequency as Frequency })}
          className="sm:grid-cols-2"
        >
          {frequencies.map((option) => (
            <Label
              key={option.value}
              htmlFor={`${id}-${option.value}`}
              className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border-[length:max(1px,var(--border-width))] border-input bg-card px-4 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:text-secondary-foreground"
            >
              <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
        {errors['frequency'] && <p className="text-[14px] text-destructive">{errors['frequency']}</p>}
      </div>

      {value.frequency === 'weekly' && (
        <FormField label="Times per week" error={errors['weeklyTarget'] ?? null}>
          {(field) => (
            <NativeSelect
              {...field}
              className="max-w-[12rem]"
              value={value.weeklyTarget}
              onChange={(event) => onChange({ ...value, weeklyTarget: Number(event.target.value) })}
            >
              {targets.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          )}
        </FormField>
      )}

      <FormField
        label="Reminder time"
        optional
        hint="Ember sends a gentle nudge at this time."
        error={errors['reminderTime'] ?? null}
      >
        {(field) => (
          <Input
            {...field}
            type="time"
            className="max-w-[12rem]"
            value={value.reminderTime}
            onChange={(event) => onChange({ ...value, reminderTime: event.target.value })}
          />
        )}
      </FormField>
    </div>
  );
}
