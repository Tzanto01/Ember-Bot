import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { DayCell } from '@/components/day-cell';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import {
  habitDaysError,
  HabitFields,
  habitFormValue,
  habitNameError,
  habitToForm,
} from '@/components/habits/habit-fields';
import { routineTitle } from '@/components/routines/routine-title';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import {
  allowDeviceReminders,
  canAskDevice,
  DestinationName,
  deviceChannel,
  DeviceRemindersOff,
  reminderDestinationsKey,
  useReminderDestinations,
} from '@/components/habits/device-reminders';
import { env } from '@/lib/env';
import { formatDate } from '@/lib/local-date';
import {
  type Habit,
  type HabitPatch,
  type LocalDateString,
  type ReminderChannel,
  reminderTimesOf,
  type Routine,
} from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api, auth, localMode, push } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

interface Feedback {
  tone: NoticeTone;
  text: string;
}

const destinationsLink = { pathname: '/settings', hash: 'push' };

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/** The notice copy for a failed call, or null when the HTTP layer already acted (session ended, consent). */
function failure(error: unknown): FriendlyProblem | null {
  const apiError = asApiError(error);
  return apiError.handled ? null : problemToMessage(apiError);
}

export interface SectionProps {
  habit: Habit;
  /** Called with the habit the server returned after a change. */
  onChange: (habit: Habit) => void;
}

/**
 * "Details": the habit form; sends only the changed fields, or says "Nothing has changed yet.". With `routine`
 * (the habit's routine) it links there and, when that routine has a reminder, shows it replacing the habit's own.
 */
export function DetailsSection({ habit, onChange, routine = null }: SectionProps & { routine?: Routine | null }) {
  const root = useRef<HTMLFormElement>(null);
  const [form, setForm] = useState(() => habitToForm(habit));
  const [touched, setTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deviceOff, setDeviceOff] = useState(false);
  const local = useStore(localMode.mode) === 'local';
  const localWeb = local && !env.native;
  const queryClient = useQueryClient();
  const here = useReminderDestinations(!local).data?.find((d) => d.current);
  const remindsHere = local
    ? !!habit.reminderChannels?.includes(deviceChannel())
    : !here || (here.enabled && !habit.reminderExclusions?.includes(here.id));

  const save = useMutation({
    mutationFn: async ({ patch, ask }: { patch: HabitPatch; ask: boolean }) => {
      const allowed = ask ? await allowDeviceReminders() : true;
      return { updated: await api.updateHabit(habit.id, patch), allowed, asked: ask };
    },
    onSuccess: ({ updated, allowed, asked }) => {
      if (asked && !local) void queryClient.invalidateQueries({ queryKey: reminderDestinationsKey });
      onChange(updated);
      setForm(habitToForm(updated));
      setTouched(false);
      setDeviceOff(!allowed);
      setFeedback({ tone: 'success', text: 'Saved.' });
    },
    onError: (error) => {
      const problem = failure(error);
      if (!problem) return;
      setFieldErrors(problem.fields);
      setFeedback({ tone: 'notice', text: problem.message });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (save.isPending) return;
    flushSync(() => {
      setFeedback(null);
      setDeviceOff(false);
      setTouched(true);
    });
    if (habitNameError(form.name) || habitDaysError(form)) {
      focusFirstInvalid(root.current);
      return;
    }
    const value = habitFormValue(form);
    const patch: HabitPatch = {};
    if (value.name !== habit.name) patch.name = value.name;
    if (value.frequency !== habit.frequency) patch.frequency = value.frequency;
    if (value.frequency === 'weekly' && value.weeklyTarget !== habit.weeklyTarget) patch.weeklyTarget = value.weeklyTarget;
    if (value.days !== null ? value.days.join() !== (habit.days ?? []).join() : habit.days !== null)
      patch.days = value.days;
    if (value.timesPerDay !== habit.timesPerDay) patch.timesPerDay = value.timesPerDay;
    if (value.reminderTimes.join() !== reminderTimesOf(habit).join()) patch.reminderTimes = value.reminderTimes;
    if (Object.keys(patch).length === 0) {
      setFeedback({ tone: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    setFieldErrors({});
    save.mutate({
      patch,
      ask: !!patch.reminderTimes?.length && remindsHere && canAskDevice(),
    });
  }

  return (
    <form
      ref={root}
      noValidate
      onSubmit={submit}
      aria-labelledby="details-heading"
      className={cardVariants({ className: 'gap-5' })}
    >
      <h2 id="details-heading" className="text-[22px]">
        Details
      </h2>
      <HabitFields
        value={form}
        onChange={setForm}
        touched={touched}
        onTouched={() => setTouched(true)}
        errors={fieldErrors}
        savedTimesPerDay={habit.frequency === 'weekly' ? undefined : habit.timesPerDay}
        showReminder={!localWeb}
        silent={habit.reminderChannels?.length === 0}
        reminderNote={
          routine?.reminderTime &&
          `Your ${routineTitle(routine.name)} reminds you at ${routine.reminderTime} instead, while this habit is part of it.`
        }
      />
      <p className="text-[14px] text-muted-foreground">
        Grace days apply to all your habits. You can change them in <Link to="/settings">Settings</Link>.
      </p>
      <p className="text-[14px] text-muted-foreground">
        {routine ? (
          <>
            Part of your <Link to={`/routines/${routine.id}/edit`}>{routineTitle(routine.name)}</Link>.
          </>
        ) : (
          <>
            Habits you do together can share one reminder in <Link to="/routines">Routines</Link>.
          </>
        )}
      </p>
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      {deviceOff && <DeviceRemindersOff />}
      <Button type="submit" block aria-disabled={save.isPending || undefined}>
        {save.isPending ? (
          <>
            <Spinner />
            Saving…
          </>
        ) : (
          'Save changes'
        )}
      </Button>
    </form>
  );
}

/** The labelled checkbox group of reminder channels (no-account mode: "Remind me on this phone"). */
export function ChannelChoices({
  options,
  current,
  onToggle,
  idPrefix = 'channel',
}: {
  options: { channel: ReminderChannel; label: string }[];
  current: readonly ReminderChannel[];
  onToggle: (channel: ReminderChannel, checked: boolean) => void;
  idPrefix?: string;
}) {
  return (
    <div role="group" aria-label="Reminder channels" className="flex flex-col gap-1">
      {options.map(({ channel, label }) => (
        <div key={channel} className="flex min-h-[44px] items-center gap-3">
          <Checkbox
            id={`${idPrefix}-${channel}`}
            checked={current.includes(channel)}
            onCheckedChange={(checked) => onToggle(channel, checked === true)}
          />
          <Label htmlFor={`${idPrefix}-${channel}`} className="cursor-pointer font-normal">
            {label}
          </Label>
        </div>
      ))}
    </div>
  );
}

/** The one channel choice without an account: the phone, in the app. */
export const phoneChoice = [{ channel: 'mobile' as const, label: 'Remind me on this phone' }];

/** What {@link RemindersSection} saves: the phone's channel without an account, else the skipped destinations. */
export type ReminderChoice = { reminderChannels: ReminderChannel[] } | { reminderExclusions: string[] };

export interface RemindersSectionProps {
  /** What the reminders belong to, in the copy: "this habit" or "this routine". */
  subject: 'habit' | 'routine';
  /** The item's reminder channels; only read without an account. */
  channels: ReminderChannel[];
  /** The destination ids the item skips (v1.14). */
  exclusions: string[];
  hasReminderTime: boolean;
  /** Saves the choice and hands the server's answer to the page. */
  save: (choice: ReminderChoice) => Promise<void>;
}

/** {@link RemindersSection} for a habit, saving through `PATCH /api/habits/{id}`. */
export function HabitRemindersSection({ habit, onChange }: SectionProps) {
  return (
    <RemindersSection
      subject="habit"
      channels={habit.reminderChannels ?? []}
      exclusions={habit.reminderExclusions ?? []}
      hasReminderTime={habit.reminderTime !== null}
      save={async (choice) => onChange(await api.updateHabit(habit.id, choice))}
    />
  );
}

/**
 * Where an item's reminders go. With an account, "Remind me on": every destination from Settings, ticked unless the
 * item skips it; one switched off in Settings shows unticked and disabled. Without an account, "Remind me on this
 * phone" in the app (the `mobile` channel), and on the web a note that reminders need the app or an account.
 */
export function RemindersSection(props: RemindersSectionProps) {
  return useStore(localMode.mode) === 'local' ? <PhoneReminders {...props} /> : <RemindOn {...props} />;
}

function PhoneReminders({ subject, channels, hasReminderTime, save }: RemindersSectionProps) {
  const [shown, setShown] = useState<{ base: string; next: ReminderChannel[] } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [deviceOff, setDeviceOff] = useState(false);

  const change = useMutation({
    mutationFn: async (next: ReminderChannel[]) => {
      const allowed = next.length ? await allowDeviceReminders() : true;
      await save({ reminderChannels: next });
      return allowed;
    },
    onSuccess: (allowed, next) => {
      setDeviceOff(!allowed);
      setFeedback(
        allowed ? { tone: 'success', text: next.length ? 'This phone will remind you.' : 'Reminder channels saved.' } : null,
      );
    },
    onError: (error) => {
      setShown(null);
      const problem = failure(error);
      if (problem) setFeedback({ tone: 'notice', text: problem.message });
    },
  });

  const current = shown?.base === channels.join() ? shown.next : channels;

  function toggle(checked: boolean): void {
    if (change.isPending) return;
    const next: ReminderChannel[] = checked ? ['mobile'] : [];
    setShown({ base: channels.join(), next });
    setFeedback(null);
    setDeviceOff(false);
    change.mutate(next);
  }

  return (
    <section aria-labelledby="channels-heading" className={cardVariants()}>
      <h2 id="channels-heading" className="text-[22px]">
        Where reminders go
      </h2>
      {env.native ? (
        <>
          <ChannelChoices options={phoneChoice} current={current} onToggle={(_, checked) => toggle(checked)} />
          {channels.length === 0 ? (
            <p className="text-[14px] text-muted-foreground">
              No reminders will go out for this {subject}. That's fine too.
            </p>
          ) : (
            !hasReminderTime && (
              <p className="text-[14px] text-muted-foreground">
                Set a reminder time above so these have a moment to arrive.
              </p>
            )
          )}
        </>
      ) : (
        <p className="text-muted-foreground">Reminders need the Ember app or an account.</p>
      )}
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      {deviceOff && <DeviceRemindersOff />}
    </section>
  );
}

function RemindOn({ subject, exclusions, hasReminderTime, save }: RemindersSectionProps) {
  const destinations = useReminderDestinations();
  const pushAvailable = useStore(push.available);
  const [shown, setShown] = useState<{ base: string; next: string[] } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (!env.native) void push.check();
  }, []);

  const change = useMutation({
    mutationFn: (next: string[]) => save({ reminderExclusions: next }),
    onSuccess: () => {
      setFeedback({ tone: 'success', text: 'Saved.' });
    },
    onError: (error) => {
      setShown(null);
      const problem = failure(error);
      if (problem) setFeedback({ tone: 'notice', text: problem.message });
    },
  });

  const skipped = shown?.base === exclusions.join() ? shown.next : exclusions;
  const list = destinations.data ?? [];
  const reaching = list.filter((d) => d.enabled && !skipped.includes(d.id)).length;
  const loadProblem = destinations.isError && !destinations.data ? failure(destinations.error) : null;

  function toggle(id: string, checked: boolean): void {
    if (change.isPending) return;
    const next = checked ? exclusions.filter((x) => x !== id) : [...exclusions, id];
    setShown({ base: exclusions.join(), next });
    setFeedback(null);
    change.mutate(next);
  }

  let content: ReactNode;
  if (destinations.data) {
    content =
      list.length === 0 ? (
        <p className="text-muted-foreground">
          Nothing can remind you yet. You can turn reminders on in{' '}
          <Link to={destinationsLink}>Settings</Link>.
        </p>
      ) : (
        <div role="group" aria-labelledby="channels-heading" className="flex flex-col gap-1">
          {list.map((destination) => {
            const id = `destination-${destination.id}`;
            return (
              <div key={destination.id} className="flex min-h-[44px] items-center gap-3 py-1">
                <Checkbox
                  id={id}
                  checked={destination.enabled && !skipped.includes(destination.id)}
                  disabled={!destination.enabled}
                  aria-describedby={destination.enabled ? undefined : `${id}-off`}
                  onCheckedChange={(checked) => toggle(destination.id, checked === true)}
                />
                <div className="flex min-w-0 flex-col">
                  <Label
                    htmlFor={id}
                    className={cn(
                      'flex flex-wrap items-center gap-x-2 gap-y-1 font-normal',
                      destination.enabled ? 'cursor-pointer' : 'text-muted-foreground',
                    )}
                  >
                    <DestinationName destination={destination} />
                  </Label>
                  {!destination.enabled && (
                    <p id={`${id}-off`} className="text-[14px] text-muted-foreground">
                      Turned off in <Link to={destinationsLink}>Settings</Link>.
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      );
  } else if (destinations.isError) {
    content = loadProblem && (
      <Notice tone="notice">
        <p>{loadProblem.message}</p>
        <Button
          type="button"
          variant="secondary"
          aria-disabled={destinations.isFetching || undefined}
          onClick={() => void destinations.refetch()}
        >
          Try again
        </Button>
      </Notice>
    );
  } else {
    content = (
      <>
        <p role="status" className="sr-only">
          Loading where Ember can remind you…
        </p>
        <Skeleton className="h-[6rem] rounded-md" />
      </>
    );
  }

  const thisDevice = env.native ? 'phone' : 'browser';
  const missingHere =
    !!destinations.data && (env.native || pushAvailable) && !list.some((d) => d.current && d.kind === thisDevice);

  return (
    <section aria-labelledby="channels-heading" className={cardVariants()}>
      <h2 id="channels-heading" className="text-[22px]">
        Remind me on
      </h2>
      {content}
      {list.length > 0 &&
        (reaching === 0 ? (
          <p className="text-[14px] text-muted-foreground">
            No reminders will go out for this {subject}. That's fine too.
          </p>
        ) : (
          !hasReminderTime && (
            <p className="text-[14px] text-muted-foreground">
              Set a reminder time above so these have a moment to arrive.
            </p>
          )
        ))}
      {missingHere && (
        <p className="text-[14px] text-muted-foreground">
          To be reminded on this {thisDevice} too, turn it on in <Link to={destinationsLink}>Settings</Link>.
        </p>
      )}
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
    </section>
  );
}

function pauseError(until: string, today: LocalDateString | null): string | null {
  if (!until) return 'Choose the day the pause ends.';
  if (today && until < today) return 'Pick today or a later day.';
  return null;
}

/** "Take a break": pause until a day (not before `me.localToday`) or resume; focus returns to the heading. */
export function PauseSection({ habit, onChange }: SectionProps) {
  const root = useRef<HTMLFormElement>(null);
  const today = useStore(auth.me)?.localToday ?? null;
  const [until, setUntil] = useState('');
  const [touched, setTouched] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const paused = habit.pausedToday || habit.pausedUntil !== null;
  const error = touched ? pauseError(until, today) : null;

  const run = useMutation({
    mutationFn: ({ until }: { until: LocalDateString | null; success: string }) => api.pauseHabit(habit.id, until),
    onMutate: () => setFeedback(null),
    onSuccess: (updated, { success }) => {
      flushSync(() => {
        onChange(updated);
        setUntil('');
        setTouched(false);
        setFeedback({ tone: 'success', text: success });
      });
      document.getElementById('pause-heading')?.focus();
    },
    onError: (error) => {
      const problem = failure(error);
      if (problem) setFeedback({ tone: 'notice', text: problem.message });
    },
  });

  function pause(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (run.isPending) return;
    flushSync(() => setTouched(true));
    if (pauseError(until, today)) {
      focusFirstInvalid(root.current);
      return;
    }
    run.mutate({ until, success: `Paused until ${formatDate(until, longDate)}.` });
  }

  return (
    <section aria-labelledby="pause-heading" className={cardVariants()}>
      <div className="flex items-center gap-3">
        <h2 id="pause-heading" tabIndex={-1} className="text-[22px] focus:outline-none">
          Take a break
        </h2>
        <DayCell state="paused" size="swatch" />
      </div>
      {paused ? (
        <>
          <p>
            {habit.pausedUntil ? `Paused until ${formatDate(habit.pausedUntil, longDate)}.` : 'Paused for now.'} Pick it
            up again whenever you like.
          </p>
          <Button
            type="button"
            variant="secondary"
            block
            aria-disabled={run.isPending || undefined}
            onClick={() => run.mutate({ until: null, success: 'Welcome back. This habit is active again.' })}
          >
            Resume now
          </Button>
        </>
      ) : (
        <>
          <p className="text-[14px] text-muted-foreground">
            Pausing keeps your history and skips reminders until the day you choose.
          </p>
          <form ref={root} noValidate onSubmit={pause} className="flex flex-col gap-3">
            <FormField label="Pause until" error={error}>
              {(field) => (
                <Input
                  {...field}
                  type="date"
                  className="max-w-[14rem]"
                  min={today ?? undefined}
                  value={until}
                  onChange={(event) => setUntil(event.target.value)}
                  onBlur={() => setTouched(true)}
                />
              )}
            </FormField>
            <Button type="submit" variant="secondary" block aria-disabled={run.isPending || undefined}>
              Pause habit
            </Button>
          </form>
        </>
      )}
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
    </section>
  );
}

/** "Delete habit" with an inline confirm: Escape or "Keep it" cancels (not while deleting); success goes to `/today`. */
export function DeleteSection({ habit }: { habit: Habit }) {
  const navigate = useNavigate();
  const deleting = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteHabit(habit.id),
    onSuccess: () => {
      void navigate('/today');
    },
    onError: (error) => setProblem(failure(error)),
    onSettled: () => {
      deleting.current = false;
    },
  });

  function ask(): void {
    flushSync(() => {
      setProblem(null);
      setConfirming(true);
    });
    document.getElementById('delete-confirm')?.focus();
  }

  function cancel(): void {
    if (deleting.current) return;
    flushSync(() => setConfirming(false));
    document.getElementById('delete-start')?.focus();
  }

  function confirm(): void {
    if (deleting.current) return;
    deleting.current = true;
    setProblem(null);
    remove.mutate();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') cancel();
  }

  return (
    <section aria-labelledby="delete-heading" className={cardVariants({ variant: 'farewell' })}>
      <h2 id="delete-heading" className="text-[22px]">
        Delete habit
      </h2>
      {confirming ? (
        <div
          id="delete-confirm"
          role="group"
          aria-labelledby="delete-question"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="flex flex-col gap-3 focus:outline-none"
        >
          <p id="delete-question">Delete {habit.name} and all its check-ins? This can't be undone.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="destructive"
              aria-disabled={remove.isPending || undefined}
              onClick={confirm}
            >
              {remove.isPending ? (
                <>
                  <Spinner />
                  Deleting…
                </>
              ) : (
                'Yes, delete it'
              )}
            </Button>
            <Button type="button" variant="secondary" onClick={cancel}>
              Keep it
            </Button>
          </div>
        </div>
      ) : (
        <>
          <p className="text-[14px]">If this habit no longer fits, you can let it go.</p>
          <Button id="delete-start" type="button" variant="secondary" block className="bg-card" onClick={ask}>
            Delete habit
          </Button>
        </>
      )}
      {problem && <Notice tone="notice">{problem.message}</Notice>}
    </section>
  );
}

/** The not-found illustration: one spark drifting off a dotted path (token colours only). */
export function DriftingSpark() {
  return (
    <svg viewBox="0 0 96 64" focusable="false" className="h-[64px] w-[96px]">
      <path
        d="M6 56C28 56 40 34 62 28"
        fill="none"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="1 7"
        className="stroke-muted-foreground"
      />
      <circle cx="80" cy="18" r="8" className="fill-flame" />
      <circle cx="80" cy="19" r="3.5" className="fill-flame-core" />
    </svg>
  );
}
