import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { DriftingSpark, RemindersSection } from '@/components/habits/habit-edit-sections';
import { PageHeader } from '@/components/page-header';
import {
  RoutineDelete,
  RoutineDetails,
  routineHabitsKey,
  routinesKey,
} from '@/components/routines/routine-sections';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { Routine } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

/** `/routines/new` and `/routines/:id/edit`: the routine form; editing adds where reminders go and delete. */
export default function RoutineEditPage() {
  const raw = useParams()['id'];
  const creating = raw === undefined;
  const id = Number(raw);
  const valid = creating || (Number.isInteger(id) && id > 0);
  const queryClient = useQueryClient();
  const routines = useQuery({ queryKey: routinesKey, queryFn: () => api.listRoutines(), enabled: valid });
  const habits = useQuery({ queryKey: routineHabitsKey, queryFn: () => api.listHabits(), enabled: valid });
  const routine = creating ? null : (routines.data?.find((r) => r.id === id) ?? null);
  const failed = [routines, habits].find((q) => q.isError && !q.data);
  const error = failed ? asApiError(failed.error) : null;
  const loaded = !!routines.data && !!habits.data;

  const replace = (saved: Routine) =>
    queryClient.setQueryData<Routine[]>(routinesKey, (list) => list?.map((r) => (r.id === saved.id ? saved : r)));

  let content: ReactNode;
  if (!valid || (loaded && !creating && !routine)) {
    content = (
      <EmptyState
        illustration={<DriftingSpark />}
        title="This routine wandered off."
        action={
          <Button asChild>
            <Link to="/routines">Back to routines</Link>
          </Button>
        }
      >
        <p>It may have been removed, or the link is out of date.</p>
      </EmptyState>
    );
  } else if (loaded && routines.data && habits.data) {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6">
        <RoutineDetails key={routine?.id ?? 'new'} routine={routine} habits={habits.data} routines={routines.data} />
        {routine && (
          <RemindersSection
            subject="routine"
            channels={routine.reminderChannels}
            exclusions={routine.reminderExclusions ?? []}
            hasReminderTime={routine.reminderTime !== null}
            save={async (choice) => {
              replace(await api.updateRoutine(routine.id, choice));
            }}
          />
        )}
        {routine && <RoutineDelete routine={routine} />}
      </div>
    );
  } else if (error) {
    content = error.handled ? null : (
      <Notice tone="notice" heading="This routine didn't load">
        <p>{problemToMessage(error).message}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void routines.refetch();
            void habits.refetch();
          }}
        >
          Try again
        </Button>
      </Notice>
    );
  } else {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6">
        <p role="status" className="sr-only">
          Loading your routine…
        </p>
        <Skeleton className="h-[22rem] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={creating ? 'New routine' : 'Edit routine'}
        lede={creating ? 'Pick the habits you do together and put them in order.' : routine?.name}
      />
      {content}
    </div>
  );
}
