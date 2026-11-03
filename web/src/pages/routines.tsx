import { useQuery } from '@tanstack/react-query';
import { Bell, BellOff, Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { routineHabitsKey, routinesKey } from '@/components/routines/routine-sections';
import { routineTitle } from '@/components/routines/routine-title';
import { HearthIllustration } from '@/components/today/hearth-illustration';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';

const routineLimit = 10;

/** `/routines`: the user's routines with their habits in order and reminder, links to edit, and "New routine". */
export default function RoutinesPage() {
  const routines = useQuery({ queryKey: routinesKey, queryFn: () => api.listRoutines() });
  const habits = useQuery({ queryKey: routineHabitsKey, queryFn: () => api.listHabits() });
  const names = new Map((habits.data ?? []).map((h) => [h.id, h.name]));
  const list = routines.data;
  const atLimit = (list?.length ?? 0) >= routineLimit;

  const newButton = atLimit ? (
    <p className="text-[14px] text-muted-foreground">
      You have 10 routines, the most Ember keeps. Remove one you no longer need to make room.
    </p>
  ) : (
    <Button asChild variant={list?.length ? 'secondary' : 'default'} className="w-full sm:w-auto sm:self-start">
      <Link to="/routines/new">
        <Plus aria-hidden />
        New routine
      </Link>
    </Button>
  );

  let content: ReactNode;
  if (!list) {
    const error = routines.isError && !routines.isFetching ? asApiError(routines.error) : null;
    content = error ? (
      !error.handled && (
        <Notice tone="notice" heading="Your routines didn't load">
          <p>{problemToMessage(error).message}</p>
          <Button variant="secondary" onClick={() => void routines.refetch()}>
            Try again
          </Button>
        </Notice>
      )
    ) : (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span role="status" className="sr-only">
          Loading your routines…
        </span>
        {[1, 2].map((i) => (
          <Skeleton key={i} className="h-[112px] rounded-xl" />
        ))}
      </div>
    );
  } else if (list.length === 0) {
    content = (
      <Card className="items-center">
        <EmptyState
          illustration={<HearthIllustration />}
          title="No routines yet"
          action={newButton}
        >
          <p>Group habits you do together, like a morning routine, and give them one reminder.</p>
        </EmptyState>
      </Card>
    );
  } else {
    content = (
      <>
        <ul role="list" className="flex flex-col gap-3">
          {list.map((routine) => {
            const members = routine.habitIds.flatMap((id) => names.get(id) ?? []);
            return (
              <li key={routine.id} className={cardVariants({ className: 'gap-2' })}>
                <div className="flex items-start justify-between gap-3">
                  <h2 className="min-w-0 text-[20px] break-words">{routine.name}</h2>
                  <Button asChild variant="secondary" className="shrink-0">
                    <Link to={`/routines/${routine.id}/edit`} aria-label={`Edit ${routineTitle(routine.name)}`}>
                      Edit
                    </Link>
                  </Button>
                </div>
                <p className="inline-flex items-center gap-1.5 text-[14px] text-muted-foreground">
                  {routine.reminderTime ? (
                    <>
                      <Bell aria-hidden className="size-[14px] shrink-0" />
                      Reminder at {routine.reminderTime}
                    </>
                  ) : (
                    <>
                      <BellOff aria-hidden className="size-[14px] shrink-0" />
                      No reminder
                    </>
                  )}
                </p>
                {routine.habitIds.length === 0 ? (
                  <p className="text-[14px] text-muted-foreground">No habits in it yet.</p>
                ) : members.length > 0 ? (
                  <ol aria-label={`Habits in ${routine.name}`} className="flex flex-wrap gap-2">
                    {members.map((name, i) => (
                      <li key={`${i}-${name}`} className="rounded-full bg-secondary px-3 py-1 text-[14px] text-secondary-foreground">
                        {name}
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-[14px] text-muted-foreground">
                    {routine.habitIds.length === 1 ? '1 habit' : `${routine.habitIds.length} habits`}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
        {newButton}
      </>
    );
  }

  return (
    <div className="flex max-w-[40rem] flex-col gap-6">
      <PageHeader
        title="Routines"
        lede="Habits you do together, in the order you do them. Today shows them as a group."
      />
      {content}
    </div>
  );
}
