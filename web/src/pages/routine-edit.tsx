import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation();
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
        title={t('routine.notFound')}
        action={
          <Button asChild>
            <Link to="/routines">{t('routine.back')}</Link>
          </Button>
        }
      >
        <p>{t('routine.notFoundBody')}</p>
      </EmptyState>
    );
  } else if (loaded && routines.data && habits.data) {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6 2xl:mx-auto 2xl:w-full">
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
      <Notice tone="notice" heading={t('routine.loadFailed')}>
        <p>{problemToMessage(error).message}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void routines.refetch();
            void habits.refetch();
          }}
        >
          {t('routine.tryAgain')}
        </Button>
      </Notice>
    );
  } else {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6 2xl:mx-auto 2xl:w-full">
        <p role="status" className="sr-only">
          {t('routine.loading')}
        </p>
        <Skeleton className="h-[22rem] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 2xl:mx-auto 2xl:w-full 2xl:max-w-[40rem]">
      <PageHeader
        title={creating ? t('routine.newTitle') : t('routine.editTitle')}
        lede={creating ? t('routine.newLede') : routine?.name}
      />
      {content}
    </div>
  );
}
