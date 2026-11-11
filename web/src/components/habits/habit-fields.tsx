import { Plus, X } from 'lucide-react';
import { type ReactNode, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { FormField, fieldMessages } from '@/components/form-field';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect } from '@/components/ui/select';
import { weekdayLabels } from '@/lib/local-date';
import { type Frequency, type Habit, reminderTimesOf, type TimeOfDay, type Weekday, weekdays } from '@/lib/models';

/** What the create and edit form holds; fields that don't fit the chosen schedule are kept but not sent. */
export interface HabitFormState {
  name: string;
  frequency: Frequency;
  weeklyTarget: number;
  /** The chosen weekdays (for `weekdays`), Monday first. */
  days: Weekday[];
  /** 1 to 10 (for `daily` and `weekdays`). */
  timesPerDay: number;
  /** The reminder rows in the order they were added, each `HH:MM` or empty; at least one row. */
  reminderTimes: string[];
}

/**
 * The form read as API-ready values: name trimmed, weekly target only when weekly, days only for set weekdays
 * (all seven become `daily`), times per day 1 when weekly, reminder times sorted without blanks or repeats and at
 * most one per check-in (the earliest).
 */
export interface HabitFormValue {
  name: string;
  frequency: Frequency;
  weeklyTarget: number | null;
  days: Weekday[] | null;
  timesPerDay: number;
  reminderTimes: TimeOfDay[];
}

const workdays: Weekday[] = ['mon', 'tue', 'wed', 'thu', 'fri'];

export const emptyHabitForm: HabitFormState = {
  name: '',
  frequency: 'daily',
  weeklyTarget: 3,
  days: workdays,
  timesPerDay: 1,
  reminderTimes: [''],
};

/** The form filled from a saved habit. */
export function habitToForm(habit: Habit): HabitFormState {
  return {
    name: habit.name,
    frequency: habit.frequency,
    weeklyTarget: habit.weeklyTarget ?? 3,
    days: habit.days ?? workdays,
    timesPerDay: habit.timesPerDay,
    reminderTimes: reminderTimesOf(habit).length ? [...reminderTimesOf(habit)] : [''],
  };
}

/** Contract name rule: 1 to 100 characters after trimming. Null when valid. */
export function habitNameError(name: string): string | null {
  const length = name.trim().length;
  if (length === 0) return 'Give your habit a short name.';
  if (length > 100) return fieldMessages.maxLength(100);
  return null;
}

/** Null when the chosen weekdays are fine (at least one, when the schedule is set weekdays). */
export function habitDaysError(state: HabitFormState): string | null {
  return state.frequency === 'weekdays' && state.days.length === 0 ? 'Pick at least one day.' : null;
}

const shortDays = weekdayLabels(undefined, 'short');
const longDays = weekdayLabels(undefined, 'long');

/** "Every day", "Mon, Wed, Fri", "Once a week" or "3 times a week", with ", 3 times a day" when more than once. */
export function cadenceText(
  frequency: Frequency,
  weeklyTarget: number | null,
  days: readonly Weekday[] | null = null,
  timesPerDay = 1,
): string {
  if (frequency === 'weekly') return weeklyTarget === 1 ? 'Once a week' : `${weeklyTarget ?? 1} times a week`;
  const perDay = timesPerDay > 1 ? `${timesPerDay} times a day` : null;
  if (frequency === 'weekdays' && days?.length) {
    const names = weekdays.flatMap((day, i) => (days.includes(day) ? [shortDays[i]] : [])).join(', ');
    return perDay ? `${names}, ${perDay}` : names;
  }
  return perDay ? perDay.charAt(0).toUpperCase() + perDay.slice(1) : 'Every day';
}

/** {@link cadenceText} for a saved habit. */
export function habitCadence(habit: Habit): string {
  return cadenceText(habit.frequency, habit.weeklyTarget, habit.days, habit.timesPerDay);
}

/** The filled rows, sorted, without repeats. */
function sortedTimes(rows: readonly string[]): TimeOfDay[] {
  return [...new Set(rows.filter(Boolean))].sort();
}

function timeList(times: readonly string[]): string {
  return times.length > 1 ? `${times.slice(0, -1).join(', ')} and ${times[times.length - 1]}` : (times[0] ?? '');
}

/**
 * The line under the reminder times when more than one check-in a day is asked for: "Ember reminds you at 08:00,
 * 13:00 and 20:00 until you've checked in 3 times." Null with no time or one check-in a day.
 */
export function reminderSchedule(times: readonly TimeOfDay[], timesPerDay: number): string | null {
  if (!times.length || timesPerDay <= 1) return null;
  if (times.length === 1) return `Ember reminds you once, at ${times[0]}. You can add a time for each check-in.`;
  return `Ember reminds you at ${timeList(times)} until you've checked in ${timesPerDay} times.`;
}

export function habitFormValue(state: HabitFormState): HabitFormValue {
  const allDays = state.frequency === 'weekdays' && state.days.length === weekdays.length;
  const frequency = allDays ? 'daily' : state.frequency;
  return {
    name: state.name.trim(),
    frequency,
    weeklyTarget: frequency === 'weekly' ? state.weeklyTarget : null,
    days: frequency === 'weekdays' ? weekdays.filter((day) => state.days.includes(day)) : null,
    timesPerDay: frequency === 'weekly' ? 1 : state.timesPerDay,
    reminderTimes: sortedTimes(state.reminderTimes).slice(0, frequency === 'weekly' ? 1 : state.timesPerDay),
  };
}

const frequencies: { value: Frequency; label: string }[] = [
  { value: 'daily', label: 'Every day' },
  { value: 'weekdays', label: 'On set days' },
  { value: 'weekly', label: 'A few times a week' },
];

const targets = [1, 2, 3, 4, 5, 6];
const perDayOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const optionClass =
  'flex min-h-[56px] cursor-pointer items-center gap-3 rounded-md border-[length:max(1px,var(--border-width))] border-input bg-card px-4 py-2 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-secondary has-[[data-state=checked]]:text-secondary-foreground';

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
  /** The saved times per day (edit); a lower choice gets a note that past days stay as they are. */
  savedTimesPerDay?: number;
  /** Shown under the reminder time, for example when a routine's reminder replaces this one. */
  reminderNote?: ReactNode;
  /** False hides the reminder time, where reminders can't go out (no-account mode on the web). */
  showReminder?: boolean;
  /** True when every reminder channel is off, so the times stay quiet and the form says so. */
  silent?: boolean;
}

/**
 * Name, "How often" (every day, set weekdays or a few times a week), the weekdays, times per day or per week, and
 * the optional reminder times (one per check-in a day, with "Add another time" and a line spelling out the schedule).
 * Place inside the page's `form`.
 */
export function HabitFields({
  value,
  onChange,
  touched,
  onTouched,
  errors = {},
  nameId,
  savedTimesPerDay,
  reminderNote,
  showReminder = true,
  silent = false,
}: HabitFieldsProps) {
  const id = useId();
  const timesId = `${id}-times`;
  const timesRef = useRef<HTMLDivElement>(null);
  const [dropped, setDropped] = useState<TimeOfDay[]>([]);
  const limit = value.frequency === 'weekly' ? 1 : value.timesPerDay;
  const times = sortedTimes(value.reminderTimes);
  const timesError = errors['reminderTimes'] ?? errors['reminderTime'] ?? null;
  const schedule = silent
    ? times.length
      ? 'No reminders will go out for this habit, since every way to reach you is off.'
      : null
    : reminderSchedule(times, limit);
  const droppedNote = dropped.length
    ? `${timeList(dropped)} ${dropped.length === 1 ? 'was' : 'were'} taken off, since you now check in ${limit === 1 ? 'once' : `${limit} times`} a day.`
    : null;

  function changeSchedule(next: HabitFormState): void {
    const nextLimit = next.frequency === 'weekly' ? 1 : next.timesPerDay;
    if (next.reminderTimes.length <= nextLimit) {
      setDropped([]);
      onChange(next);
      return;
    }
    const kept = sortedTimes(next.reminderTimes);
    setDropped(kept.slice(nextLimit));
    onChange({ ...next, reminderTimes: kept.length ? kept.slice(0, nextLimit) : [''] });
  }

  function setTime(index: number, time: string): void {
    setDropped([]);
    onChange({ ...value, reminderTimes: value.reminderTimes.map((t, i) => (i === index ? time : t)) });
  }

  function focusTime(index: number): void {
    timesRef.current?.querySelectorAll<HTMLInputElement>('input[type="time"]')[index]?.focus();
  }

  function addTime(): void {
    flushSync(() => {
      setDropped([]);
      onChange({ ...value, reminderTimes: [...value.reminderTimes, ''] });
    });
    focusTime(value.reminderTimes.length);
  }

  function removeTime(index: number): void {
    flushSync(() => {
      setDropped([]);
      onChange({ ...value, reminderTimes: value.reminderTimes.filter((_, i) => i !== index) });
    });
    focusTime(Math.min(index, value.reminderTimes.length - 2));
  }
  const legendId = `${id}-often`;
  const daysId = `${id}-days`;
  const nameError = (touched ? habitNameError(value.name) : null) ?? errors['name'] ?? null;
  const daysError = (touched ? habitDaysError(value) : null) ?? errors['days'] ?? null;
  const allDays = value.frequency === 'weekdays' && value.days.length === weekdays.length;

  function toggleDay(day: Weekday, checked: boolean): void {
    const days = checked ? [...value.days, day] : value.days.filter((d) => d !== day);
    onChange({ ...value, days: weekdays.filter((d) => days.includes(d)) });
  }
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
          onValueChange={(frequency) => changeSchedule({ ...value, frequency: frequency as Frequency })}
          className="sm:grid-cols-3"
        >
          {frequencies.map((option) => (
            <Label key={option.value} htmlFor={`${id}-${option.value}`} className={optionClass}>
              <RadioGroupItem id={`${id}-${option.value}`} value={option.value} />
              {option.label}
            </Label>
          ))}
        </RadioGroup>
        {errors['frequency'] && <p className="text-[14px] text-destructive">{errors['frequency']}</p>}
      </div>

      {value.frequency === 'weekdays' && (
        <div className="flex flex-col gap-2">
          <p id={daysId} className="font-medium">
            Which days
          </p>
          <div
            role="group"
            aria-labelledby={daysId}
            aria-describedby={daysError ? `${daysId}-error` : allDays ? `${daysId}-hint` : undefined}
            className="grid grid-cols-4 gap-2 sm:grid-cols-7"
          >
            {weekdays.map((day, i) => (
              <Label
                key={day}
                htmlFor={`${id}-day-${day}`}
                className={`${optionClass} min-h-[48px] justify-center gap-2 px-2`}
              >
                <Checkbox
                  id={`${id}-day-${day}`}
                  checked={value.days.includes(day)}
                  aria-invalid={!!daysError || undefined}
                  onCheckedChange={(checked) => toggleDay(day, checked === true)}
                />
                <span aria-hidden="true">{shortDays[i]}</span>
                <span className="sr-only">{longDays[i]}</span>
              </Label>
            ))}
          </div>
          {daysError ? (
            <p id={`${daysId}-error`} className="text-[14px] text-destructive">
              {daysError}
            </p>
          ) : (
            allDays && (
              <p id={`${daysId}-hint`} className="text-[14px] text-muted-foreground">
                All seven days is the same as every day, so it saves as every day.
              </p>
            )
          )}
        </div>
      )}

      {value.frequency !== 'weekly' && (
        <FormField
          label="Times a day"
          hint="More than once, like water through the day? Each check-in adds one."
          error={errors['timesPerDay'] ?? null}
        >
          {(field) => (
            <>
              <NativeSelect
                {...field}
                className="max-w-[12rem]"
                value={value.timesPerDay}
                onChange={(event) => changeSchedule({ ...value, timesPerDay: Number(event.target.value) })}
              >
                {perDayOptions.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </NativeSelect>
              {savedTimesPerDay !== undefined && value.timesPerDay < savedTimesPerDay && (
                <p className="text-[14px] text-muted-foreground">Past days stay as they are.</p>
              )}
            </>
          )}
        </FormField>
      )}

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

      {showReminder && (
        <>
          {limit === 1 ? (
            <FormField
              label="Reminder time"
              optional
              hint="Ember sends a gentle nudge at this time."
              error={timesError}
            >
              {(field) => (
                <Input
                  {...field}
                  type="time"
                  className="max-w-[12rem]"
                  value={value.reminderTimes[0] ?? ''}
                  onChange={(event) => setTime(0, event.target.value)}
                />
              )}
            </FormField>
          ) : (
            <div className="flex flex-col gap-2">
              <p id={timesId} className="font-medium">
                Reminder times <span className="font-normal text-muted-foreground">(optional)</span>
              </p>
              <p id={`${timesId}-hint`} className="-mt-1 text-[14px] text-muted-foreground">
                One gentle nudge at each time, up to one per check-in.
              </p>
              <div
                ref={timesRef}
                role="group"
                aria-labelledby={timesId}
                aria-describedby={[`${timesId}-hint`, schedule ? `${timesId}-schedule` : '', timesError ? `${timesId}-error` : '']
                  .filter(Boolean)
                  .join(' ')}
                className="flex flex-col gap-2"
              >
                {value.reminderTimes.map((time, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`Reminder time ${i + 1}`}
                      aria-invalid={timesError ? true : undefined}
                      className="max-w-[12rem]"
                      value={time}
                      onChange={(event) => setTime(i, event.target.value)}
                    />
                    {value.reminderTimes.length > 1 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={time ? `Remove ${time}` : `Remove reminder time ${i + 1}`}
                        onClick={() => removeTime(i)}
                      >
                        <X aria-hidden />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              {value.reminderTimes.length < limit && (
                <Button type="button" variant="secondary" className="self-start" onClick={addTime}>
                  <Plus aria-hidden />
                  Add another time
                </Button>
              )}
              {schedule && (
                <p id={`${timesId}-schedule`} className="text-[14px] text-muted-foreground">
                  {schedule}
                </p>
              )}
              {timesError && (
                <p id={`${timesId}-error`} role="alert" className="text-[14px] text-destructive">
                  {timesError}
                </p>
              )}
            </div>
          )}
          {limit === 1 && silent && schedule && <p className="-mt-3 text-[14px] text-muted-foreground">{schedule}</p>}
          {droppedNote && <p className="-mt-3 text-[14px] text-muted-foreground">{droppedNote}</p>}
          <LiveRegion message={droppedNote ?? ''} />
          {reminderNote && <p className="-mt-3 text-[14px] text-muted-foreground">{reminderNote}</p>}
        </>
      )}
    </div>
  );
}
