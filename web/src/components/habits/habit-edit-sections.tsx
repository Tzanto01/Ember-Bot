import { useMutation } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useEffect, useRef, useState } from 'react';
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
import { env } from '@/lib/env';
import { formatDate } from '@/lib/local-date';
import type { Habit, HabitPatch, LocalDateString, ReminderChannel, Routine } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api, auth, push, reminders } from '@/lib/services';
import { useStore } from '@/lib/store';

interface Feedback {
  tone: NoticeTone;
  text: string;
}

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

  const save = useMutation({
    mutationFn: (patch: HabitPatch) => api.updateHabit(habit.id, patch),
    onSuccess: (updated) => {
      onChange(updated);
      setForm(habitToForm(updated));
      setTouched(false);
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
    if (value.reminderTime === null && habit.reminderTime !== null) patch.clearReminder = true;
    else if (value.reminderTime !== null && value.reminderTime !== habit.reminderTime)
      patch.reminderTime = value.reminderTime;
    if (Object.keys(patch).length === 0) {
      setFeedback({ tone: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    setFieldErrors({});
    save.mutate(patch);
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

interface ChannelChange {
  next: ReminderChannel[];
  /** Set when "Remind me on this phone" changed: true turned on, false turned off. */
  phone?: boolean;
  /** The channels to remember on this device when the phone is turned on. */
  before?: ReminderChannel[];
}

const webChannels: { channel: Exclude<ReminderChannel, 'mobile'>; label: string }[] = [
  { channel: 'discord', label: 'Discord DM' },
  { channel: 'webpush', label: 'Web push' },
];

export interface ChannelsSectionProps {
  /** What the reminders belong to, in the copy: "this habit" or "this routine". */
  subject: 'habit' | 'routine';
  channels: ReminderChannel[];
  /** Device key for the channels to restore when "Remind me on this phone" is turned off. */
  memoryKey: string;
  hasReminderTime: boolean;
  /** Saves the channels and hands the server's answer to the page. */
  save: (next: ReminderChannel[]) => Promise<void>;
}

/** {@link ChannelsSection} for a habit, saving through `PATCH /api/habits/{id}`. */
export function HabitChannelsSection({ habit, channels, onChange }: SectionProps & { channels: ReminderChannel[] }) {
  return (
    <ChannelsSection
      subject="habit"
      channels={channels}
      memoryKey={`ember.channelsBeforePhone.${habit.id}`}
      hasReminderTime={habit.reminderTime !== null}
      save={async (next) => onChange(await api.updateHabit(habit.id, { reminderChannels: next }))}
    />
  );
}

/**
 * "Where reminders go". Adding Discord DM or Web push drops `mobile`; native "Remind me on this phone" sets the
 * channels to `mobile` only, and turning it off restores the channels remembered on this device under
 * `memoryKey`, else `discord` when Discord is linked, else `webpush`.
 */
export function ChannelsSection({ subject, channels, memoryKey, hasReminderTime, save }: ChannelsSectionProps) {
  const me = useStore(auth.me);
  const pushAvailable = useStore(push.available);
  const [shown, setShown] = useState<{ base: ReminderChannel[]; next: ReminderChannel[] } | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useEffect(() => {
    if (!env.native) void push.check();
  }, []);

  const change = useMutation({
    mutationFn: async ({ next, phone }: ChannelChange) => {
      const allowed = phone ? ((await reminders?.requestPermission().catch(() => false)) ?? false) : true;
      await save(next);
      return allowed;
    },
    onSuccess: (allowed, { phone, before }) => {
      setShown(null);
      if (phone === true) localStorage.setItem(memoryKey, JSON.stringify(before ?? []));
      else if (phone === false) localStorage.removeItem(memoryKey);
      setFeedback(
        !allowed
          ? {
              tone: 'notice',
              text: 'Notifications are off for Ember on this phone. Turn them on in your phone settings so reminders can arrive.',
            }
          : { tone: 'success', text: phone ? 'This phone will remind you.' : 'Reminder channels saved.' },
      );
    },
    onError: (error) => {
      setShown(null);
      const problem = failure(error);
      if (problem) setFeedback({ tone: 'notice', text: problem.message });
    },
  });

  const busy = shown !== null && shown.base === channels;
  const current = busy ? shown.next : channels;

  function send(request: ChannelChange): void {
    setShown({ base: channels, next: request.next });
    setFeedback(null);
    change.mutate(request);
  }

  function toggleChannel(channel: ReminderChannel, checked: boolean): void {
    if (busy) return;
    const others = channels.filter((c) => c !== channel);
    send({ next: checked ? [...others.filter((c) => c !== 'mobile'), channel] : others });
  }

  function togglePhone(checked: boolean): void {
    if (busy) return;
    if (checked) {
      send({ next: ['mobile'], phone: true, before: channels.filter((c) => c !== 'mobile') });
      return;
    }
    let previous: ReminderChannel[] | null = null;
    try {
      previous = JSON.parse(localStorage.getItem(memoryKey) ?? 'null') as ReminderChannel[] | null;
    } catch {
      previous = null;
    }
    const fallback: ReminderChannel[] = me?.discord.linked ? ['discord'] : ['webpush'];
    send({ next: previous ?? fallback, phone: false });
  }

  const boxes = [
    ...webChannels.map(({ channel, label }) => ({
      key: channel,
      label,
      checked: current.includes(channel),
      onChange: (checked: boolean) => toggleChannel(channel, checked),
    })),
    ...(env.native
      ? [
          {
            key: 'mobile',
            label: 'Remind me on this phone',
            checked: current.includes('mobile'),
            onChange: togglePhone,
          },
        ]
      : []),
  ];

  return (
    <section aria-labelledby="channels-heading" className={cardVariants()}>
      <h2 id="channels-heading" className="text-[22px]">
        Where reminders go
      </h2>
      <div role="group" aria-label="Reminder channels" className="flex flex-col gap-1">
        {boxes.map((box) => (
          <div key={box.key} className="flex min-h-[44px] items-center gap-3">
            <Checkbox
              id={`channel-${box.key}`}
              checked={box.checked}
              onCheckedChange={(checked) => box.onChange(checked === true)}
            />
            <Label htmlFor={`channel-${box.key}`} className="cursor-pointer font-normal">
              {box.label}
            </Label>
          </div>
        ))}
      </div>
      {channels.includes('mobile') && (
        <p className="text-[14px] text-muted-foreground">
          Reminders for this {subject} come to your phone only, not Discord or web push, so you get each one once.
        </p>
      )}
      {channels.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">No reminders will go out for this {subject}. That's fine too.</p>
      ) : (
        !hasReminderTime && (
          <p className="text-[14px] text-muted-foreground">
            Set a reminder time above so these have a moment to arrive.
          </p>
        )
      )}
      {pushAvailable && (
        <p className="text-[14px] text-muted-foreground">
          Web push also needs this browser turned on for notifications in{' '}
          <Link to={{ pathname: '/settings', hash: 'push' }}>Settings</Link>.
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
