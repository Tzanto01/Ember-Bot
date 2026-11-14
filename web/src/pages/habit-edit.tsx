import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { EmptyState } from '@/components/empty-state';
import {
  DeleteSection,
  DetailsSection,
  DriftingSpark,
  HabitRemindersSection,
  PauseSection,
} from '@/components/habits/habit-edit-sections';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import type { Habit } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';
import { useStore } from '@/lib/store';

function Summary({ habit }: { habit: Habit }) {
  const { t } = useTranslation();
  const { streak, week } = habit.stats;
  const showStreaks = useStore(auth.me)?.showStreaks !== false;
  return (
    <Card className="hidden lg:flex">
      {showStreaks && streak !== null && streak > 0 && <p className="font-semibold">{t('habit.streak', { count: streak })}</p>}
      {week && week.done > 0 && (
        <p className="font-semibold">
          {t('habit.weekProgress', { done: week.done, target: week.target })}
        </p>
      )}
      <TapLink to={`/history/${habit.id}`} className="self-start">
        {t('habitEdit.history')}
      </TapLink>
    </Card>
  );
}

/** `/habits/:id/edit`: details, where reminders go, pause and delete; reloads `me` on entry for a fresh local today. */
export default function HabitEditPage() {
  const { t } = useTranslation();
  const id = Number(useParams()['id']);
  const valid = Number.isInteger(id) && id > 0;
  const queryClient = useQueryClient();
  const queryKey = ['habit', id];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      await auth.loadMe(true).catch(() => null);
      return api.getHabit(id);
    },
    enabled: valid,
  });
  const error = query.isError ? asApiError(query.error) : null;
  const habit = query.data;
  const onChange = (updated: Habit) => queryClient.setQueryData(queryKey, updated);
  const routineId = habit?.routineId ?? null;
  const routines = useQuery({
    queryKey: ['routines'],
    queryFn: () => api.listRoutines(),
    enabled: routineId !== null,
    retry: false,
  });
  const routine = routines.data?.find((r) => r.id === routineId) ?? null;

  let content: ReactNode;
  if (!valid || error?.status === 404) {
    content = (
      <EmptyState
        illustration={<DriftingSpark />}
        title={t('habitEdit.notFound')}
        action={
          <Button asChild>
            <Link to="/today">{t('habitEdit.backToToday')}</Link>
          </Button>
        }
      >
        <p>{t('habitEdit.notFoundBody')}</p>
      </EmptyState>
    );
  } else if (habit) {
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,40rem)_18rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <DetailsSection key={habit.id} habit={habit} onChange={onChange} routine={routine} />
          {habit.reminderChannels && <HabitRemindersSection habit={habit} onChange={onChange} />}
          <PauseSection habit={habit} onChange={onChange} />
          <DeleteSection habit={habit} />
        </div>
        <Summary habit={habit} />
      </div>
    );
  } else if (error) {
    content = error.handled ? null : (
      <Notice tone="notice" heading={t('habitEdit.loadFailed')}>
        <p>{problemToMessage(error).message}</p>
        <Button
          type="button"
          variant="secondary"
          aria-disabled={query.isFetching || undefined}
          onClick={() => void query.refetch()}
        >
          {t('habitEdit.tryAgain')}
        </Button>
      </Notice>
    );
  } else {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6">
        <p role="status" className="sr-only">
          {t('habitEdit.loading')}
        </p>
        <Skeleton className="h-[22rem] rounded-xl" />
        <Skeleton className="h-[10rem] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 2xl:mx-auto 2xl:w-full 2xl:max-w-[59.5rem]">
      <PageHeader title={t('habitEdit.title')} lede={habit?.name} />
      {content}
    </div>
  );
}
