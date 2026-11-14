import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ListOrdered, Moon, Pencil, Plus } from 'lucide-react';
import { useReducedMotion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { EmptyState } from '@/components/empty-state';
import { useReminderReach, useReminderSettingsHash } from '@/components/habits/reminder-reach';
import { isPausedOn } from '@/components/history/kept-days';
import { DayJournal } from '@/components/journal/day-journal';
import { DeviceNotices } from '@/components/local/device-notices';
import { LiveRegion } from '@/components/live-region';
import { MomentDoor } from '@/components/moment/moment-door';
import { PageHeader } from '@/components/page-header';
import { routineTitle } from '@/components/routines/routine-title';
import { TipSlot } from '@/components/tips/tip-slot';
import { checkButtonId } from '@/components/today/check-button';
import { HabitRow } from '@/components/today/habit-row';
import { HearthIllustration } from '@/components/today/hearth-illustration';
import { readReward, type RewardKeyword } from '@/components/today/reward';
import { TodaysEmber } from '@/components/today/todays-ember';
import { WhatsNewCard } from '@/components/today/whats-new-card';
import { Button } from '@/components/ui/button';
import { Card, cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { isOffday } from '@/lib/calendar';
import { t } from '@/lib/i18n';
import { addDays, formatDate } from '@/lib/local-date';
import type { DayState, Habit, LocalDateString, Routine, WeeklyStats } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { loadFreshMe } from '@/components/today/fresh-me';
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

/** Today's body: one column, from `lg` the door, notices and habits left and the day's cards right. */
const columns =
  'flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start 2xl:grid-cols-[minmax(0,1fr)_24rem] 2xl:gap-8 min-[137.5rem]:grid-cols-[minmax(0,1fr)_28rem] min-[200rem]:grid-cols-[minmax(0,1fr)_30rem]';

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

/** True when nothing was checked in yesterday and it wasn't a low day; ask only when a habit was due yesterday. */
async function loadYesterdayOpen(yesterday: LocalDateString): Promise<boolean> {
  const [[stat], lowDays] = await Promise.all([
    api.dayStats(yesterday, yesterday),
    api.listLowDays(yesterday, yesterday),
  ]);
  return !!stat && !stat.showedUp && !lowDays.includes(yesterday);
}

/** The weekly card's first line: the count without a grade when some but not all check-ins happened. */
function weeklyHeadline(weekly: WeeklyStats): string {
  if (weekly.totalDone === 0 || weekly.totalDone >= weekly.totalPossible) return weekly.headline;
  return t('weekly.partial', { count: weekly.totalDone });
}

async function loadToday(): Promise<TodayData> {
  await loadFreshMe().catch(() => null);
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
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: todayKey, queryFn: loadToday, structuralSharing: false });
  const { data, refetch } = query;
  const me = useStore(auth.me);
  const today: LocalDateString | null = me?.localToday ?? null;
  const showStreaks = me?.showStreaks !== false;
  const synced = useStore(deviceSync.synced);
  const firstSynced = useRef(synced);
  const reduceMotion = useReducedMotion();
  const reach = useReminderReach();
  const reminderHash = useReminderSettingsHash();
  const yesterday = today ? addDays(today, -1) : null;
  const tracksYesterday =
    !!yesterday &&
    !!data?.habits.some(
      (h) =>
        h.frequency !== 'weekly' && h.startDate <= yesterday && !isOffday(h, yesterday) && !isPausedOn(h, yesterday),
    );
  const yesterdayQuery = useQuery({
    queryKey: [...todayKey, 'yesterday', yesterday],
    queryFn: () => loadYesterdayOpen(yesterday!),
    enabled: tracksYesterday,
  });
  const focusAfter = useRef<string | null>(null);

  const inFlight = useRef(new Set<number>());
  const [busy, setBusy] = useState<ReadonlySet<number>>(new Set());
  const [rewards, setRewards] = useState<ReadonlyMap<number, RewardKeyword>>(new Map());
  const [lowDayBusy, setLowDayBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [announcement, setAnnouncement] = useState('');

  useEffect(() => {
    if (synced !== firstSynced.current) void refetch();
  }, [synced, refetch]);

  useEffect(() => {
    const target = focusAfter.current && document.getElementById(focusAfter.current);
    if (!target) return;
    focusAfter.current = null;
    target.focus();
  });

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
    if (undoOne && current === 1) focusAfter.current = checkButtonId(habit.id);
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
            ? t('today.announce.checkedIn', { name: habit.name })
            : t('today.announce.cleared', { name: habit.name })
          : nextCount === 0
            ? t('today.announce.allCleared', { name: habit.name })
            : t(reaches ? 'today.announce.countDone' : 'today.announce.count', {
                name: habit.name,
                n: nextCount,
                target,
              }),
      );
    } catch (error) {
      updateHabit(habit.id, (current) => (current === optimistic ? habit : current));
      setReward(habit.id, null);
      const apiError = asApiError(error);
      if (!apiError.handled) {
        setProblem({
          heading: checkIn
            ? t('today.problem.checkIn', { name: habit.name })
            : t('today.problem.change', { name: habit.name }),
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
      focusAfter.current = marking ? 'clear-low-day' : 'mark-low-day';
      setData((d) => ({ ...d, lowDayToday: marking }));
      setAnnouncement(marking ? t('today.lowDay.marked') : t('today.lowDay.cleared'));
      const habits = await api.listHabits().catch(() => null);
      if (habits) setData((d) => ({ ...d, habits }));
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) {
        setProblem({
          heading: marking ? t('today.lowDay.markFailed') : t('today.lowDay.clearFailed'),
          message: problemToMessage(apiError).message,
        });
      }
    } finally {
      setLowDayBusy(false);
    }
  }

  const doneCount = data?.habits.filter((h) => h.today.state === 'done').length ?? 0;
  const lowDay = data?.lowDayToday === true;
  const allDone =
    doneCount > 0 &&
    !!data?.habits.every(
      (h) =>
        ['done', 'offday', 'lowday', 'paused', 'beforestart'].includes(h.today.state) ||
        h.pausedToday ||
        (h.frequency === 'weekly' && h.today.state === 'pending'),
    );
  const oldestStart = data?.habits.reduce<LocalDateString | null>(
    (min, h) => (min === null || h.startDate < min ? h.startDate : min),
    null,
  );
  const showWeekly =
    !!data?.weekly && data.weekly.totalPossible > 0 && !!today && !!oldestStart && oldestStart <= addDays(today, -7);
  const remindersUnheard = reach === 'none' && !!data?.habits.some((h) => h.reminderTime);
  const ember = (className: string) => (
    <TodaysEmber
      count={doneCount}
      lowDay={lowDay}
      allDone={allDone}
      stepping={rewards.size > 0}
      className={className}
    />
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
          showStreaks={showStreaks}
          busy={busy.has(habit.id)}
          reward={rewards.get(habit.id) ?? null}
          onToggle={() => void toggle(habit)}
          onUndoOne={() => void toggle(habit, true)}
          onRewardEnd={() => setReward(habit.id, null)}
        />
      ))}
    </ul>
  );

  const top = (
    <>
      <MomentDoor variant="today" />
      <LiveRegion message={announcement} />
      {problem && (
        <Notice tone="notice" heading={problem.heading}>
          <p>{problem.message}</p>
        </Notice>
      )}
      <DeviceNotices />
      <WhatsNewCard />
      <TipSlot place="top" habits={data?.habits} routines={data?.routines} />
    </>
  );

  let body: ReactNode;
  if (!data) {
    const loadProblem = query.isError && !query.isFetching ? asApiError(query.error) : null;
    body = (
      <div className={columns}>
        <div className="flex min-w-0 flex-col gap-6">
          {top}
          {loadProblem ? (
            !loadProblem.handled && (
              <Notice tone="notice" heading={t('today.loadFailed')}>
                <p>{problemToMessage(loadProblem).message}</p>
                <Button variant="secondary" onClick={() => void refetch()}>
                  {t('today.tryAgain')}
                </Button>
              </Notice>
            )
          ) : (
            <div aria-busy="true" className="flex flex-col gap-3">
              <span role="status" className="sr-only">
                {t('today.loading')}
              </span>
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-[88px] rounded-xl" />
              ))}
            </div>
          )}
        </div>
      </div>
    );
  } else if (!hasHabits) {
    body = (
      <div className={columns}>
        <div className="flex min-w-0 flex-col gap-6">
          {top}
          <Card className="items-center">
            <EmptyState
              illustration={<HearthIllustration />}
              title={t('today.empty.title')}
              action={
                <>
                  <Button asChild>
                    <Link to="/habits/new">{t('today.empty.create')}</Link>
                  </Button>
                  <p className="text-[0.875rem] text-muted-foreground">{t('today.empty.never')}</p>
                </>
              }
            >
              <p>{t('today.empty.body')}</p>
            </EmptyState>
          </Card>
        </div>
        <div className="flex flex-col gap-6">
          {today && <DayJournal date={today} />}
          <TipSlot place="journal" habits={data.habits} routines={data.routines} />
        </div>
      </div>
    );
  } else {
    body = (
      <div className={columns}>
        <div className="flex min-w-0 flex-col gap-6">
          {top}
          {lowDay && (
            <Notice tone="lowday" heading={t('today.lowDay.heading')}>
              <p>{t('today.lowDay.body')}</p>
              <Button
                id="clear-low-day"
                variant="ghost"
                aria-disabled={lowDayBusy || undefined}
                onClick={() => void toggleLowDay()}
              >
                {t('today.lowDay.clear')}
              </Button>
            </Notice>
          )}
          {yesterdayQuery.data === true && (
            <p className="flex flex-wrap items-center gap-x-2 text-muted-foreground">
              <CalendarDays aria-hidden className="size-[18px] shrink-0" />
              {t('today.yesterdayOpen')}
              <TapLink to="/history">{t('today.openHistory')}</TapLink>
            </p>
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
                    className="min-w-0 text-[1.25rem] [overflow-wrap:anywhere]"
                  >
                    {routine?.name ?? t('today.otherHabits')}
                  </h2>
                  {!routine && (
                    <TapLink to="/routines" className="shrink-0 px-2">
                      {t('today.routines')}
                    </TapLink>
                  )}
                  {routine && (
                    <Button asChild variant="ghost" size="icon" className="shrink-0 text-muted-foreground">
                      <Link to={`/routines/${routine.id}/edit`} aria-label={t('today.edit', { name: routineTitle(routine.name) })}>
                        <Pencil aria-hidden />
                      </Link>
                    </Button>
                  )}
                </div>
                {habitList(habits, 'h3')}
              </section>
            ))
          )}
          {remindersUnheard && (
            <Notice tone="info" heading={t('today.unheard.heading')}>
              <p>{t('today.unheard.body')}</p>
              <TapLink to={{ pathname: '/settings', hash: reminderHash }}>{t('today.unheard.link')}</TapLink>
            </Notice>
          )}
          <TipSlot place="below" habits={data.habits} routines={data.routines} />
          <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap">
            <Button asChild variant="secondary" className="w-full lg:w-auto">
              <Link to="/habits/new">
                <Plus aria-hidden />
                {t('today.newHabit')}
              </Link>
            </Button>
            <Button asChild variant="ghost" className="w-full lg:w-auto">
              <Link to="/routines">
                <ListOrdered aria-hidden />
                {t('today.routines')}
              </Link>
            </Button>
          </div>
        </div>
        <div className="flex flex-col gap-6">
          <Card className="hidden lg:flex">
            {ember('')}
          </Card>
          {showWeekly && data.weekly && (
            <section aria-labelledby="weekly-heading" className={cardVariants()}>
              <h2 id="weekly-heading" className="text-[1.375rem]">
                {t('weekly.heading')}
              </h2>
              <p className="whitespace-pre-line">{weeklyHeadline(data.weekly)}</p>
              {data.weekly.footer && weeklyHeadline(data.weekly) === data.weekly.headline && (
                <p className="whitespace-pre-line text-[0.875rem] text-muted-foreground">{data.weekly.footer}</p>
              )}
            </section>
          )}
          {today && <DayJournal date={today} />}
          <TipSlot place="journal" habits={data.habits} routines={data.routines} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={t('today.title')}
        lede={
          today ? (
            <span className="sm:whitespace-nowrap">
              {formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })}
            </span>
          ) : undefined
        }
        aside={hasHabits ? ember('lg:hidden') : undefined}
      />
      {hasHabits && data.lowDayToday === false && (
        <Button
          id="mark-low-day"
          variant="ghost"
          className="-mt-3 self-start md:-ml-4"
          aria-disabled={lowDayBusy || undefined}
          onClick={() => void toggleLowDay()}
        >
          <Moon aria-hidden />
          {t('today.lowDay.mark')}
        </Button>
      )}
      {body}
    </div>
  );
}
