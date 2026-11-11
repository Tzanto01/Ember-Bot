import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { type ChangeEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { EmptyState } from '@/components/empty-state';
import { NotebookIllustration } from '@/components/history/illustrations';
import { useJournal } from '@/components/journal/journal-context';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { NativeSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  daysFromEntries,
  daysFromStats,
  showedUpPerYear,
  showedUpRecently,
  yearStart,
} from '@/components/year/year-data';
import { YearHeatmap, YearLegend } from '@/components/year/year-heatmap';
import { formatDate } from '@/lib/local-date';
import type { DayEntry, DayStat, Habit, LocalDateString } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';
import { useStore } from '@/lib/store';

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };

async function loadHabits(): Promise<Habit[]> {
  await auth.loadMe(true).catch(() => null);
  return api.listHabits();
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** `/year`: the last 12 months as a calendar heatmap, across all habits or for one, with moods when readable. */
export default function YearPage() {
  const journal = useJournal();
  const queryClient = useQueryClient();
  const journalState = useStore(journal.state);
  const changed = useStore(journal.changed);
  const today = useStore(auth.me)?.localToday ?? null;
  const detailId = useId();
  const showMoods = journalState !== 'locked';

  const habitsQuery = useQuery({ queryKey: ['year', 'habits'], queryFn: loadHabits });
  const habits = habitsQuery.data;
  const [habitId, setHabitId] = useState<number | null>(null);
  const habit = habitId === null ? null : (habits?.find((h) => h.id === habitId) ?? null);

  const start = today ? yearStart(today) : null;
  const first = habit && start && habit.startDate > start ? habit.startDate : start;
  const ready = !!habits?.length && !!today && !!start && !!first;

  const daysQuery = useQuery({
    queryKey: ['year', 'days', habit?.id ?? 'all', first, today],
    queryFn: async (): Promise<{ stats: DayStat[] | null; entries: DayEntry[] }> => {
      if (!habit) return { stats: await api.dayStats(first!, today!), entries: [] };
      return { stats: null, entries: first! > today! ? [] : await api.getDays(habit.id, first!, today!) };
    },
    enabled: ready,
  });

  const moodsQuery = useQuery({
    queryKey: ['journal', 'year', start, today],
    queryFn: async () => {
      const [{ notes }, moods] = await Promise.all([journal.notes(start!, today!), journal.moods()]);
      return { notes, moods };
    },
    enabled: ready && showMoods,
  });

  const seenChange = useRef(changed);
  useEffect(() => {
    if (seenChange.current === changed) return;
    seenChange.current = changed;
    void queryClient.invalidateQueries({ queryKey: ['journal'] });
  }, [changed, queryClient]);

  const [selected, setSelected] = useState<LocalDateString | null>(null);
  const [cursor, setCursor] = useState<LocalDateString | null>(null);

  function closeDay() {
    const date = selected;
    flushSync(() => setSelected(null));
    if (date) document.querySelector<HTMLElement>(`[data-date="${date}"]`)?.focus();
  }

  function choose(event: ChangeEvent<HTMLSelectElement>) {
    setHabitId(event.target.value === 'all' ? null : Number(event.target.value));
    setSelected(null);
  }

  let content: ReactNode;
  if (!habits || !today) {
    const listError = habitsQuery.isError && !habitsQuery.isFetching ? asApiError(habitsQuery.error) : null;
    content = listError ? (
      !listError.handled && (
        <Notice tone="notice" heading="Your habits didn't load">
          <p>{problemToMessage(listError).message}</p>
          <Button variant="secondary" onClick={() => void habitsQuery.refetch()}>
            Try again
          </Button>
        </Notice>
      )
    ) : (
      <Loading />
    );
  } else if (habits.length === 0) {
    content = (
      <Card className="items-center">
        <EmptyState
          illustration={<NotebookIllustration />}
          title="Nothing to look back on yet"
          action={
            <Button asChild>
              <Link to="/habits/new">Create a habit</Link>
            </Button>
          }
        >
          <p>Once you have a habit, your year fills in here.</p>
        </EmptyState>
      </Card>
    );
  } else {
    const notes = showMoods ? (moodsQuery.data?.notes ?? []) : [];
    const own = showMoods ? (moodsQuery.data?.moods ?? []) : [];
    const data = daysQuery.data;
    const days = data
      ? data.stats
        ? daysFromStats(data.stats, notes, own)
        : daysFromEntries(data.entries, notes, own)
      : null;
    const earliest = habit
      ? habit.startDate
      : habits.reduce((min, h) => (h.startDate < min ? h.startDate : min), habits[0].startDate);
    const pickFrom = first! > today ? today : first!;
    const recent = days ? showedUpRecently(days, today, earliest) : null;
    const perYear = days ? showedUpPerYear(days) : [];
    const openDay = selected ? days?.get(selected) : undefined;
    const daysError = daysQuery.isError && !daysQuery.isFetching ? asApiError(daysQuery.error) : null;

    content = (
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="year-habit">Show</Label>
          <NativeSelect id="year-habit" value={habit?.id ?? 'all'} onChange={choose}>
            <option value="all">All habits</option>
            {habits.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </NativeSelect>
        </div>
        {daysError ? (
          <Notice tone="notice" heading="Your year didn't load">
            {!daysError.handled && <p>{problemToMessage(daysError).message}</p>}
            <Button variant="secondary" onClick={() => void daysQuery.refetch()}>
              Try again
            </Button>
          </Notice>
        ) : !days || !recent ? (
          <Loading />
        ) : (
          <>
            <Card>
              <p className="text-[22px] font-semibold text-foreground">
                {recent.of === 0
                  ? 'Your year starts here.'
                  : `You showed up ${recent.showed} of the last ${recent.of} ${recent.of === 1 ? 'day' : 'days'}.`}
              </p>
              {perYear.length > 0 && (
                <ul className="flex flex-wrap gap-x-5 gap-y-1 text-muted-foreground">
                  {perYear.map((y) => (
                    <li key={y.year}>
                      {y.year}: {y.days} {y.days === 1 ? 'day' : 'days'}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card aria-busy={daysQuery.isFetching || undefined}>
              <YearHeatmap
                start={start!}
                today={today}
                first={pickFrom}
                days={days}
                showMoods={showMoods}
                selected={selected}
                cursor={cursor && cursor >= pickFrom && cursor <= today ? cursor : today}
                onCursor={setCursor}
                onSelect={(date) => setSelected((open) => (open === date ? null : date))}
                detailId={detailId}
              />
              <YearLegend habit={!!habit} showMoods={showMoods} />
              {!showMoods && (
                <p className="text-[14px] text-muted-foreground">
                  Moods stay hidden while your private journal is locked on this device.{' '}
                  <TapLink to="/settings#journal">Unlock it in Settings</TapLink>
                </p>
              )}
            </Card>
            {selected && (
              <Card
                id={detailId}
                role="region"
                aria-label={formatDate(selected, longDate)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') closeDay();
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[22px]">{formatDate(selected, longDate)}</h2>
                  <Button variant="ghost" size="icon" aria-label="Close this day" onClick={closeDay}>
                    <X aria-hidden />
                  </Button>
                </div>
                <p>{capitalize(openDay?.words ?? 'nothing recorded')}.</p>
                {showMoods && openDay?.mood && (
                  <p className="flex items-center gap-2">
                    <span className="text-muted-foreground">Mood:</span>
                    {openDay.mood.emoji && <span aria-hidden="true">{openDay.mood.emoji}</span>}
                    {openDay.mood.label}
                  </p>
                )}
                <TapLink to={habit ? `/history/${habit.id}` : '/history'} className="self-start">
                  Open in History
                </TapLink>
              </Card>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Your year" lede="Every day you showed up, across the last 12 months. Tap a day for more." />
      {content}
    </div>
  );
}

function Loading() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span role="status" className="sr-only">
        Loading your year…
      </span>
      <Skeleton className="h-[96px] rounded-xl" />
      <Skeleton className="h-[12rem] rounded-xl" />
    </div>
  );
}
