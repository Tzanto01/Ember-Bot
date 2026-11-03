import { useMutation, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, type KeyboardEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useNavigate } from 'react-router';
import { FormField, fieldMessages, focusFirstInvalid } from '@/components/form-field';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import type { Habit, NewRoutine, Routine, RoutinePatch } from '@/lib/models';
import { asApiError, type FriendlyProblem, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';
import { RoutineHabits } from './routine-habits';

/** Query key of the routine list, shared by Routines, the routine form and habit edit. */
export const routinesKey = ['routines'] as const;
/** Query key of the habits the routine pages offer. */
export const routineHabitsKey = ['routines', 'habits'] as const;

const limitMessage = 'You have 10 routines, the most Ember keeps. Remove one you no longer need to make room.';

/** Contract name rule: 1 to 50 characters after trimming. Null when valid. */
export function routineNameError(name: string): string | null {
  const length = name.trim().length;
  if (length === 0) return 'Give your routine a short name, like Morning.';
  if (length > 50) return fieldMessages.maxLength(50);
  return null;
}

/** The notice copy for a failed call (with `creating`, 409 is the limit), or null when the HTTP layer already acted. */
function failure(error: unknown, creating = false): FriendlyProblem | null {
  const apiError = asApiError(error);
  if (apiError.handled) return null;
  const problem = problemToMessage(apiError);
  return creating && apiError.status === 409 ? { ...problem, message: limitMessage } : problem;
}

interface Feedback {
  tone: NoticeTone;
  text: string;
}

export interface RoutineDetailsProps {
  /** Null while creating. */
  routine: Routine | null;
  habits: Habit[];
  routines: Routine[];
}

/**
 * The routine form: name, ordered habits and reminder time. Creating posts everything and lands on `/routines`;
 * editing sends only the changed fields, or says "Nothing has changed yet.".
 */
export function RoutineDetails({ routine, habits, routines }: RoutineDetailsProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const root = useRef<HTMLFormElement>(null);
  const known = new Set(habits.map((h) => h.id));
  const [name, setName] = useState(routine?.name ?? '');
  const [habitIds, setHabitIds] = useState(() => (routine?.habitIds ?? []).filter((id) => known.has(id)));
  const [reminderTime, setReminderTime] = useState(routine?.reminderTime ?? '');
  const [touched, setTouched] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const save = useMutation({
    mutationFn: (body: NewRoutine | RoutinePatch) =>
      routine ? api.updateRoutine(routine.id, body) : api.createRoutine(body as NewRoutine),
    onSuccess: (saved) => {
      queryClient.setQueryData<Routine[]>(routinesKey, (list) =>
        list && (routine ? list.map((r) => (r.id === saved.id ? saved : r)) : [...list, saved]),
      );
      void queryClient.invalidateQueries({ queryKey: routinesKey });
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      if (!routine) {
        void navigate('/routines');
        return;
      }
      setTouched(false);
      setFeedback({ tone: 'success', text: 'Saved.' });
    },
    onError: (error) => {
      const problem = failure(error, !routine);
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
    if (routineNameError(name)) {
      focusFirstInvalid(root.current);
      return;
    }
    const trimmed = name.trim();
    setFieldErrors({});
    if (!routine) {
      const body: NewRoutine = { name: trimmed, habitIds };
      if (reminderTime) body.reminderTime = reminderTime;
      save.mutate(body);
      return;
    }
    const patch: RoutinePatch = {};
    if (trimmed !== routine.name) patch.name = trimmed;
    if (habitIds.join() !== routine.habitIds.filter((id) => known.has(id)).join()) patch.habitIds = habitIds;
    if (!reminderTime && routine.reminderTime !== null) patch.clearReminder = true;
    else if (reminderTime && reminderTime !== routine.reminderTime) patch.reminderTime = reminderTime;
    if (Object.keys(patch).length === 0) {
      setFeedback({ tone: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    save.mutate(patch);
  }

  const nameError = (touched ? routineNameError(name) : null) ?? fieldErrors['name'] ?? null;

  return (
    <form
      ref={root}
      noValidate
      onSubmit={submit}
      aria-labelledby="routine-details-heading"
      className={cardVariants({ className: 'gap-5' })}
    >
      <h2 id="routine-details-heading" className="text-[22px]">
        Details
      </h2>
      <FormField label="Name" error={nameError} id="routine-name">
        {(field) => (
          <Input
            {...field}
            autoComplete="off"
            maxLength={60}
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        )}
      </FormField>
      <RoutineHabits
        value={habitIds}
        onChange={setHabitIds}
        habits={habits}
        routines={routines}
        routineId={routine?.id ?? null}
        error={fieldErrors['habitIds'] ?? null}
      />
      <FormField
        label="Reminder time"
        optional
        hint="One gentle nudge for the habits here that are still open. It replaces their own reminders while they're in this routine."
        error={fieldErrors['reminderTime'] ?? null}
      >
        {(field) => (
          <Input
            {...field}
            type="time"
            className="max-w-[12rem]"
            value={reminderTime}
            onChange={(event) => setReminderTime(event.target.value)}
          />
        )}
      </FormField>
      {!routine && (
        <p className="text-[14px] text-muted-foreground">
          Once it's saved, you can choose where its reminder goes.
        </p>
      )}
      {feedback && <Notice tone={feedback.tone}>{feedback.text}</Notice>}
      <div className="flex flex-col gap-3">
        <Button type="submit" block aria-disabled={save.isPending || undefined}>
          {save.isPending ? (
            <>
              <Spinner />
              Saving…
            </>
          ) : routine ? (
            'Save changes'
          ) : (
            'Create routine'
          )}
        </Button>
        <Button variant="ghost" block asChild>
          <Link to="/routines">{routine ? 'Back to routines' : 'Cancel'}</Link>
        </Button>
      </div>
    </form>
  );
}

/** "Delete routine" with an inline confirm: Escape or "Keep it" cancels; its habits stay. Success goes to `/routines`. */
export function RoutineDelete({ routine }: { routine: Routine }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const deleting = useRef(false);
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<FriendlyProblem | null>(null);

  const remove = useMutation({
    mutationFn: () => api.deleteRoutine(routine.id),
    onSuccess: () => {
      queryClient.setQueryData<Routine[]>(routinesKey, (list) => list?.filter((r) => r.id !== routine.id));
      void queryClient.invalidateQueries({ queryKey: ['today'] });
      void navigate('/routines');
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
    document.getElementById('routine-delete-confirm')?.focus();
  }

  function cancel(): void {
    if (deleting.current) return;
    flushSync(() => setConfirming(false));
    document.getElementById('routine-delete-start')?.focus();
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
    <section aria-labelledby="routine-delete-heading" className={cardVariants({ variant: 'farewell' })}>
      <h2 id="routine-delete-heading" className="text-[22px]">
        Delete routine
      </h2>
      {confirming ? (
        <div
          id="routine-delete-confirm"
          role="group"
          aria-labelledby="routine-delete-question"
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="flex flex-col gap-3 focus:outline-none"
        >
          <p id="routine-delete-question">
            Delete {routine.name}? Its habits and their check-ins stay, just no longer grouped.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="destructive" aria-disabled={remove.isPending || undefined} onClick={confirm}>
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
          <p className="text-[14px]">Your habits stay as they are. Only the grouping goes.</p>
          <Button
            id="routine-delete-start"
            type="button"
            variant="secondary"
            block
            className="bg-card"
            onClick={ask}
          >
            Delete routine
          </Button>
        </>
      )}
      {problem && <Notice tone="notice">{problem.message}</Notice>}
    </section>
  );
}
