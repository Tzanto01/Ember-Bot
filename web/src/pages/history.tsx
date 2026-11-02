import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useReducedMotion } from 'motion/react';
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { type DayAction, DayPanel } from '@/components/history/day-panel';
import { CalendarIllustration, NotebookIllustration } from '@/components/history/illustrations';
import { Legend } from '@/components/history/legend';
import { MonthCalendar } from '@/components/history/month-calendar';
import { StatTiles } from '@/components/history/stat-tiles';
import { LiveRegion } from '@/components/live-region';
import { PageHeader } from '@/components/page-header';
import { readReward, type RewardKeyword } from '@/components/today/reward';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { NativeSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { buildMonth, canGoNext, canGoPrevious, monthRange } from '@/lib/calendar';
import { addMonths, formatDate, monthLabel, startOfMonth } from '@/lib/local-date';
import type { Habit, LocalDateString } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';
import { useStore } from '@/lib/store';

const habitsKey = ['history', 'habits'] as const;
const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

async function loadHabits(): Promise<Habit[]> {
  await auth.loadMe(true).catch(() => null);
  return api.listHabits();
}

const idFrom = (raw: string | undefined) => (raw === undefined ? null : Number(raw));

/** `/history` and `/history/:habitId`: one habit's month calendar with stats, the legend and the day panel. */
export default function HistoryPage() {
  const queryClient = useQueryClient();
  const routeParam = useParams()['habitId'];
  const today = useStore(auth.me)?.localToday ?? null;
  const reduceMotion = useReducedMotion();

  const habitsQuery = useQuery({ queryKey: habitsKey, queryFn: loadHabits });
  const habits = habitsQuery.data;

  const [route, setRoute] = useState(routeParam);
  const [chosenId, setChosenId] = useState(idFrom(routeParam));
  if (route !== routeParam) {
    setRoute(routeParam);
    setChosenId(idFrom(routeParam));
  }
  const selected = !habits?.length
    ? null
    : chosenId === null
      ? habits[0]
      : (habits.find((h) => h.id === chosenId) ?? null);

  const [shownMonth, setShownMonth] = useState<{ habitId: number; month: LocalDateString } | null>(null);
  const month =
    selected && today
      ? shownMonth?.habitId === selected.id
        ? shownMonth.month
        : startOfMonth(today)
      : null;
  const monthKey = `${selected?.id}|${month}`;
  const range = selected && month && today ? monthRange(month, selected.startDate, today) : null;

  const daysQuery = useQuery({
    queryKey: ['history', 'days', selected?.id, month, range?.from, range?.to],
    queryFn: async () => {
      if (!selected || !range) return { days: [], lowDays: [] };
      const [days, lowDays] = await Promise.all([
        api.getDays(selected.id, range.from, range.to),
        api.listLowDays(range.from, range.to),
      ]);
      return { days, lowDays };
    },
    enabled: !!selected && !!month && !!today,
  });

  const [open, setOpen] = useState<{ key: string; date: LocalDateString } | null>(null);
  const openDate = open?.key === monthKey ? open.date : null;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [dayProblem, setDayProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [reward, setReward] = useState<{ date: LocalDateString; keyword: RewardKeyword } | null>(null);
  const focusDay = useRef<LocalDateString | null>(null);

  useEffect(() => {
    if (!focusDay.current) return;
    document.getElementById(`day-${focusDay.current}`)?.focus();
    focusDay.current = null;
  });

  const weeks =
    selected && month && today
      ? buildMonth(month, daysQuery.data?.days ?? [], daysQuery.data?.lowDays ?? [], selected.startDate, today)
      : [];
  const inMonth = weeks.flat().filter((d) => d.inMonth);
  const openDay = openDate ? (inMonth.find((d) => d.date === openDate && d.editable) ?? null) : null;
  const canPrevious = !!selected && !!month && canGoPrevious(month, selected.startDate);
  const canNext = !!month && !!today && canGoNext(month, today);

  function choose(event: ChangeEvent<HTMLSelectElement>) {
    const id = Number(event.target.value);
    setChosenId(id);
    setOpen(null);
    setDayProblem(null);
    window.history.replaceState(window.history.state, '', `/history/${id}`);
  }

  function shiftMonth(step: 1 | -1) {
    if (!selected || !month || !(step < 0 ? canPrevious : canNext)) return;
    setShownMonth({ habitId: selected.id, month: addMonths(month, step) });
    setOpen(null);
    setDayProblem(null);
  }

  function closeDay() {
    if (openDate) focusDay.current = openDate;
    setOpen(null);
    setDayProblem(null);
  }

  function toggleDay(date: LocalDateString) {
    if (openDate === date) {
      closeDay();
      return;
    }
    setDayProblem(null);
    setOpen({ key: monthKey, date });
  }

  async function runEdit(
    action: () => Promise<string>,
    done: { date: LocalDateString; keyword: RewardKeyword } | null = null,
  ) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDayProblem(null);
    try {
      const message = await action();
      await daysQuery.refetch();
      setAnnouncement(message);
      if (done) setReward(done);
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) setDayProblem(problemToMessage(apiError).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function editDay(action: DayAction) {
    const habit = selected;
    const date = openDate;
    if (!habit || !date) return;
    const keyword = action === 'done' ? readReward(reduceMotion) : null;
    void runEdit(
      async () => {
        const updated =
          action === 'clear'
            ? await api.clearDay(habit.id, date)
            : await api.setDay(habit.id, date, action === 'done');
        queryClient.setQueryData<Habit[]>(habitsKey, (list) =>
          list?.map((h) => (h.id === updated.id ? updated : h)),
        );
        const words = action === 'done' ? 'marked done' : action === 'notdone' ? 'marked not done' : 'cleared';
        return `${formatDate(date, longDate)} ${words}.`;
      },
      keyword ? { date, keyword } : null,
    );
  }

  function toggleLowDay() {
    const day = openDay;
    if (!day) return;
    void runEdit(async () => {
      if (day.lowDay) await api.clearLowDay(day.date);
      else await api.markLowDay(day.date);
      return `${formatDate(day.date, longDate)} ${day.lowDay ? 'is no longer a low day' : 'marked as a low day'}.`;
    });
  }

  let content: ReactNode;
  if (!habits) {
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
      <div aria-busy="true" className="flex flex-col gap-6">
        <span role="status" className="sr-only">
          Loading your history…
        </span>
        <div className="grid grid-cols-3 gap-2">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[64px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[22rem] rounded-xl" />
      </div>
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
          <p>Once you have a habit, its days show up here.</p>
        </EmptyState>
      </Card>
    );
  } else if (!selected || !month) {
    content = selected ? null : (
      <Notice tone="notice" heading="We couldn't find that habit">
        <p>It may have been removed.</p>
        <Button asChild variant="secondary">
          <Link to="/history">Show my history</Link>
        </Button>
      </Notice>
    );
  } else {
    const monthError =
      daysQuery.isError && !daysQuery.data && !daysQuery.isFetching ? asApiError(daysQuery.error) : null;
    content = (
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {habits.length > 1 ? (
            <div className="flex flex-col gap-2">
              <Label htmlFor="habit-picker">Habit</Label>
              <NativeSelect id="habit-picker" value={selected.id} onChange={choose}>
                {habits.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : (
            <p className="text-muted-foreground">{selected.name}</p>
          )}
          <StatTiles
            habit={selected}
            monthName={formatDate(month, { month: 'long' })}
            doneInMonth={daysQuery.data ? inMonth.filter((d) => d.state === 'done').length : null}
            lowDaysInMonth={inMonth.filter((d) => d.lowDay).length}
          />
          <MonthCalendar
            title={monthLabel(month)}
            weeks={weeks}
            loading={daysQuery.isFetching && !busy}
            canPrevious={canPrevious}
            canNext={canNext}
            onPrevious={() => shiftMonth(-1)}
            onNext={() => shiftMonth(1)}
            openDate={openDate}
            onSelect={toggleDay}
            reward={reward}
            onRewardEnd={() => setReward(null)}
            problem={
              monthError && (
                <div className="px-4 md:px-0">
                  <Notice tone="notice" heading="These days didn't load">
                    {!monthError.handled && <p>{problemToMessage(monthError).message}</p>}
                    <Button variant="secondary" onClick={() => void daysQuery.refetch()}>
                      Try again
                    </Button>
                  </Notice>
                </div>
              )
            }
          />
          <Legend />
        </div>
        <div className="flex flex-col gap-6 lg:sticky lg:top-[calc(56px+env(safe-area-inset-top)+1.5rem)]">
          {openDay ? (
            <DayPanel
              day={openDay}
              busy={busy}
              problem={dayProblem}
              onEdit={editDay}
              onToggleLowDay={toggleLowDay}
              onClose={closeDay}
            />
          ) : (
            <Card className="hidden items-center text-center text-muted-foreground lg:flex">
              <CalendarIllustration />
              <p>Pick a day to fill it in or change it.</p>
            </Card>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="History" lede="Any day can be filled in later. Tap a day to change it." />
      <LiveRegion message={announcement} />
      {content}
    </div>
  );
}
