import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ListOrdered, Moon, Pencil, Plus } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { EmptyState } from '@/components/empty-state';
import { DayJournal } from '@/components/journal/day-journal';
import { DeviceNotices } from '@/components/local/device-notices';
import { LiveRegion } from '@/components/live-region';
import { PageHeader } from '@/components/page-header';
import { routineTitle } from '@/components/routines/routine-title';
import { HabitRow } from '@/components/today/habit-row';
import { HearthIllustration } from '@/components/today/hearth-illustration';
import { readReward, type RewardKeyword } from '@/components/today/reward';
import { TodaysEmber } from '@/components/today/todays-ember';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { isOffday } from '@/lib/calendar';
import { formatDate } from '@/lib/local-date';
import type { DayState, Habit, LocalDateString, Routine, WeeklyStats } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth, deviceSync } from '@/lib/services';
import { useStore } from '@/lib/store';

interface TodayData {
  habits: Habit[];
  /** Null when the low-day lookup failed; the low-day action is hidden then. */
  lowDayToday: boolean | null;
  weekly: WeeklyStats | null;
  /** Null when routines didn't load; habits then show ungrouped. */
  routines: Routine[] | null;
}

interface HabitGroup {
  routine: Routine | null;
  habits: Habit[];
}

/** Habits grouped by routine in each routine's `habitIds` order, then the habits in no shown routine. */
function groupHabits(habits: Habit[], routines: Routine[] | null): HabitGroup[] {
  const byId = new Map(habits.map((h) => [h.id, h]));
  const placed = new Set<number>();
  const groups: HabitGroup[] = [];
  for (const routine of routines ?? []) {
    const members = routine.habitIds.flatMap((id) => {
      const habit = byId.get(id);
      if (!habit || placed.has(id)) return [];
      placed.add(id);
      return [habit];
    });
    if (members.length) groups.push({ routine, habits: members });
  }
  const rest = habits.filter((h) => !placed.has(h.id));
  if (rest.length) groups.push({ routine: null, habits: rest });
  return groups;
}

interface Problem {
  heading: string;
  message: string;
}

const todayKey = ['today'] as const;

async function loadToday(): Promise<TodayData> {
  await auth.loadMe(true).catch(() => null);
  const today = auth.me.get()?.localToday ?? null;
  const [habits, lowDays, weekly, routines] = await Promise.allSettled([
    api.listHabits(),
    today ? api.listLowDays(today, today) : Promise.reject(new Error('no local day')),
    api.weeklyStats(),
    api.listRoutines(),
  ]);
  if (habits.status === 'rejected') throw habits.reason;
  return {
    habits: habits.value,
    lowDayToday: lowDays.status === 'fulfilled' && today ? lowDays.value.includes(today) : null,
    weekly: weekly.status === 'fulfilled' ? weekly.value : null,
    routines: routines.status === 'fulfilled' ? routines.value : null,
  };
}

/** `/today`: today's habits with check-ins, the low-day switch, Today's ember and the weekly summary. */
export default function TodayPage() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: todayKey, queryFn: loadToday, structuralSharing: false });
  const { data, refetch } = query;
  const today: LocalDateString | null = useStore(auth.me)?.localToday ?? null;
  const synced = useStore(deviceSync.synced);
  const firstSynced = useRef(synced);
  const reduceMotion = useReducedMotion();

  const inFlight = useRef(new Set<number>());
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rewards, setRewards] = useState<ReadonlyMap<number, RewardKeyword>>(new Map());
  const [lowDayBusy, setLowDayBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (synced !== firstSynced.current) void refetch();
  }, [synced, refetch]);

  const nativeCheckIn = useStore(deviceSync.nativeCheckIn);
  useEffect(() => {
    if (nativeCheckIn) void refetch();
  }, [nativeCheckIn, refetch]);

  const setData = (fn: (data: TodayData) => TodayData) =>
    queryClient.setQueryData<TodayData>(todayKey, (current) => current && fn(current));
  const updateHabit = (id: number, fn: (current: Habit) => Habit) =>
    setData((d) => ({ ...d, habits: d.habits.map((h) => (h.id === id ? fn(h) : h)) }));
  const mark = (id: number, on: boolean) =>
    setBusy((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const setReward = (id: number, reward: RewardKeyword | null) =>
    setRewards((map) => {
      const next = new Map(map);
      if (reward) next.set(id, reward);
      else next.delete(id);
      return next;
    });

  async function toggle(habit: Habit, undoOne = false) {
    if (inFlight.current.has(habit.id) || !data) return;
    inFlight.current.add(habit.id);
    const target = habit.timesPerDay;
    const multi = target > 1;
    const current = Math.min(habit.today.count, target);
    const nextCount = !multi
      ? null
      : undoOne
        ? Math.max(current - 1, 0)
        : habit.today.state === 'done'
          ? 0
          : current + 1;
    const checkIn = nextCount === null ? habit.today.state !== 'done' : nextCount > current;
    const reaches = nextCount === null ? checkIn : nextCount >= target;
    const resting: DayState = isOffday(habit, habit.today.date)
      ? 'offday'
      : data.lowDayToday
        ? 'lowday'
        : 'pending';
    const optimistic: Habit = {
      ...habit,
      today: {
        ...habit.today,
        state: reaches ? 'done' : nextCount ? 'partial' : resting,
        completed: reaches ? true : null,
        count: nextCount ?? (checkIn ? target : 0),
      },
    };
    mark(habit.id, true);
    setProblem(null);
    setReward(habit.id, checkIn ? readReward(reduceMotion) : null);
    const refetching = queryClient.isFetching({ queryKey: todayKey }) > 0;
    await queryClient.cancelQueries({ queryKey: todayKey });
    updateHabit(habit.id, () => optimistic);
    try {
      const updated =
        nextCount !== null
          ? await api.setDayCount(habit.id, habit.today.date, nextCount)
          : checkIn
            ? await api.setDay(habit.id, habit.today.date, true)
            : await api.clearDay(habit.id, habit.today.date);
      updateHabit(habit.id, () => updated);
      setAnnouncement(
        nextCount === null
          ? checkIn
            ? `${habit.name}: checked in for today.`
            : `${habit.name}: check-in cleared.`
          : nextCount === 0
            ? `${habit.name}: check-ins cleared for today.`
            : `${habit.name}: ${nextCount} of ${target} for today${reaches ? ', done' : ''}.`,
      );
    } catch (error) {
      updateHabit(habit.id, (current) => (current === optimistic ? habit : current));
      setReward(habit.id, null);
      const apiError = asApiError(error);
      if (!apiError.handled) {
        setProblem({
          heading: checkIn ? `Your check-in for ${habit.name} didn't save` : `${habit.name} didn't change`,
          message: problemToMessage(apiError).message,
        });
      }
    } finally {
      inFlight.current.delete(habit.id);
      mark(habit.id, false);
      if (refetching) void queryClient.invalidateQueries({ queryKey: todayKey });
    }
  }

  async function toggleLowDay() {
    if (!today || !data || lowDayBusy) return;
    const marking = !data.lowDayToday;
    setLowDayBusy(true);
    setProblem(null);
    try {
      if (marking) await api.markLowDay(today);
      else await api.clearLowDay(today);
      setData((d) => ({ ...d, lowDayToday: marking }));
      setAnnouncement(marking ? 'Today is marked as a low day.' : 'Low day cleared.');
      const habits = await api.listHabits().catch(() => null);
      if (habits) setData((d) => ({ ...d, habits }));
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) {
        setProblem({
          heading: marking ? "Today couldn't be marked as a low day" : "The low day couldn't be cleared",
          message: problemToMessage(apiError).message,
        });
      }
    } finally {
      setLowDayBusy(false);
    }
  }

  const doneCount = data?.habits.filter((h) => h.today.state === 'done').length ?? 0;
  const lowDay = data?.lowDayToday === true;
  const ember = (className: string) => (
    <TodaysEmber count={doneCount} lowDay={lowDay} stepping={rewards.size > 0} className={className} />
  );
  const hasHabits = !!data && data.habits.length > 0;
  const groups = data ? groupHabits(data.habits, data.routines) : [];
  const habitList = (habits: Habit[], headingLevel: 'h2' | 'h3') => (
    <ul role="list" className="flex flex-col gap-3">
      {habits.map((habit) => (
        <HabitRow
          key={habit.id}
          habit={habit}
          headingLevel={headingLevel}
          busy={busy.has(habit.id)}
          reward={rewards.get(habit.id) ?? null}
          onToggle={() => void toggle(habit)}
          onUndoOne={() => void toggle(habit, true)}
          onRewardEnd={() => setReward(habit.id, null)}
        />
      ))}
    </ul>
  );

  let body: ReactNode;
  if (!data) {
    const loadProblem = query.isError && !query.isFetching ? asApiError(query.error) : null;
    body = loadProblem ? (
      !loadProblem.handled && (
        <Notice tone="notice" heading="Your habits didn't load">
          <p>{problemToMessage(loadProblem).message}</p>
          <Button variant="secondary" onClick={() => void refetch()}>
            Try again
          </Button>
        </Notice>
      )
    ) : (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span role="status" className="sr-only">
          Loading your habits…
        </span>
        {[1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[88px] rounded-xl" />
        ))}
      </div>
    );
  } else if (!hasHabits) {
    body = (
      <Card className="items-center">
        <EmptyState
          illustration={<HearthIllustration />}
          title="Ready when you are."
          action={
            <>
              <Button asChild>
                <Link to="/habits/new">Create your first habit</Link>
              </Button>
              <p className="text-[14px] text-muted-foreground">Low days and pauses never count against you.</p>
            </>
          }
        >
          <p>Start with one small habit. You can add more any time.</p>
        </EmptyState>
      </Card>
    );
  } else {
    body = (
      <div className="flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {lowDay && (
            <Notice tone="lowday" heading="Today is a low day">
              <p>Go gently. Checking in is still welcome if you feel like it.</p>
              <Button variant="ghost" aria-disabled={lowDayBusy || undefined} onClick={() => void toggleLowDay()}>
                Clear low day
              </Button>
            </Notice>
          )}
          {groups.length === 1 && !groups[0].routine ? (
            habitList(groups[0].habits, 'h2')
          ) : (
            groups.map(({ routine, habits }) => (
              <section
                key={routine?.id ?? 'other'}
                aria-labelledby={routine ? `routine-${routine.id}` : 'routine-other'}
                className="flex flex-col gap-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <h2
                    id={routine ? `routine-${routine.id}` : 'routine-other'}
                    className="text-[20px] break-words"
                  >
                    {routine?.name ?? 'Other habits'}
                  </h2>
                  {routine && (
                    <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                      <Link to={`/routines/${routine.id}/edit`} aria-label={`Edit ${routineTitle(routine.name)}`}>
                        <Pencil aria-hidden />
                      </Link>
                    </Button>
                  )}
                </div>
                {habitList(habits, 'h3')}
              </section>
            ))
          )}
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
            <Button asChild variant="secondary" className="w-full lg:w-auto">
              <Link to="/habits/new">
                <Plus aria-hidden />
                New habit
              </Link>
            </Button>
            <Button asChild variant="ghost" className="w-full lg:w-auto">
              <Link to="/routines">
                <ListOrdered aria-hidden />
                Routines
              </Link>
            </Button>
            {data.lowDayToday === false && (
              <Button
                variant="ghost"
                className="w-full lg:w-auto"
                aria-disabled={lowDayBusy || undefined}
                onClick={() => void toggleLowDay()}
              >
                <Moon aria-hidden />
                Mark today as a low day
              </Button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Card className="hidden lg:flex">{ember('')}</Card>
          {data.weekly && (
            <section aria-labelledby="weekly-heading" className={cardVariants()}>
              <h2 id="weekly-heading" className="text-[22px]">
                Your week
              </h2>
              <p className="whitespace-pre-line">{data.weekly.headline}</p>
              {data.weekly.footer && (
                <p className="whitespace-pre-line text-[14px] text-muted-foreground">{data.weekly.footer}</p>
              )}
            </section>
          )}
          {today && <DayJournal date={today} />}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Today"
        lede={
          today ? (
            <span className="whitespace-nowrap">
              {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          ) : undefined
        }
        aside={hasHabits ? ember('lg:hidden') : undefined}
      />
      <LiveRegion message={announcement} />
      {problem && (
        <Notice tone="notice" heading={problem.heading}>
          <p>{problem.message}</p>
        </Notice>
      )}
      <DeviceNotices />
      {body}
    </div>
  );
}
