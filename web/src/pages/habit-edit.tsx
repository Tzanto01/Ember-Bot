import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { EmptyState } from '@/components/empty-state';
import {
  ChannelsSection,
  DeleteSection,
  DetailsSection,
  DriftingSpark,
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

function Summary({ habit }: { habit: Habit }) {
  const { streak, week } = habit.stats;
  return (
    <Card className="hidden lg:flex">
      {streak !== null && streak > 0 && <p className="font-semibold">{streak}-day streak</p>}
      {week && week.done > 0 && (
        <p className="font-semibold">
          {week.done} of {week.target} this week
        </p>
      )}
      <TapLink to={`/history/${habit.id}`} className="self-start">
        See its history
      </TapLink>
    </Card>
  );
}

/** `/habits/:id/edit`: details, reminder channels, pause and delete; reloads `me` on entry for a fresh local today. */
export default function HabitEditPage() {
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

  let content: ReactNode;
  if (!valid || error?.status === 404) {
    content = (
      <EmptyState
        illustration={<DriftingSpark />}
        title="This habit wandered off."
        action={
          <Button asChild>
            <Link to="/today">Back to Today</Link>
          </Button>
        }
      >
        <p>It may have been removed, or the link is out of date.</p>
      </EmptyState>
    );
  } else if (habit) {
    content = (
      <div className="grid gap-6 lg:grid-cols-[minmax(0,40rem)_18rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <DetailsSection key={habit.id} habit={habit} onChange={onChange} />
          {habit.reminderChannels && (
            <ChannelsSection habit={habit} channels={habit.reminderChannels} onChange={onChange} />
          )}
          <PauseSection habit={habit} onChange={onChange} />
          <DeleteSection habit={habit} />
        </div>
        <Summary habit={habit} />
      </div>
    );
  } else if (error) {
    content = error.handled ? null : (
      <Notice tone="notice" heading="This habit didn't load">
        <p>{problemToMessage(error).message}</p>
        <Button
          type="button"
          variant="secondary"
          aria-disabled={query.isFetching || undefined}
          onClick={() => void query.refetch()}
        >
          Try again
        </Button>
      </Notice>
    );
  } else {
    content = (
      <div className="flex max-w-[40rem] flex-col gap-6">
        <p role="status" className="sr-only">
          Loading your habit…
        </p>
        <Skeleton className="h-[22rem] rounded-xl" />
        <Skeleton className="h-[10rem] rounded-xl" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Edit habit" lede={habit?.name} />
      {content}
    </div>
  );
}
