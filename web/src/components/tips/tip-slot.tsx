import { useQuery } from '@tanstack/react-query';
import { Lightbulb, X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { To } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { anyNoteKey } from '@/components/journal/day-journal';
import { useWhatsNewShowing } from '@/components/today/whats-new-card';
import { Button } from '@/components/ui/button';
import { env } from '@/lib/env';
import type { Habit, Me, Routine, TipId } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api, auth, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';
import { useCalmMode } from '@/lib/theme';
import { pickTip, readTipMemory, type TipPlace, tipMemoryChanged, tipPlaces, writeTipMemory } from '@/lib/tips';

const fiveMinutes = 5 * 60_000;
const sending = new Set<string>();
const flushed = new Set<string>();
let listening = false;

function seenHere(userId: string, id: TipId): void {
  const current = auth.me.get();
  if (current?.id === userId && current.tipsSeen && !current.tipsSeen.includes(id))
    auth.me.set({ ...current, tipsSeen: [...current.tipsSeen, id] });
}

function dropPending(userId: string, id: TipId): void {
  writeTipMemory(userId, { pending: readTipMemory(userId).pending.filter((p) => p !== id) });
}

async function send(userId: string, id: TipId): Promise<void> {
  const key = `${userId}:${id}`;
  if (sending.has(key)) return;
  sending.add(key);
  try {
    await api.markTipSeen(id);
    seenHere(userId, id);
    dropPending(userId, id);
  } catch (error) {
    const { status } = asApiError(error);
    if (status === 400) dropPending(userId, id);
  } finally {
    sending.delete(key);
  }
}

function flushPending(userId: string): void {
  for (const id of readTipMemory(userId).pending) void send(userId, id);
}

function markSeen(me: Me, id: TipId): void {
  const memory = readTipMemory(me.id);
  writeTipMemory(me.id, { wait: me.localToday, pending: memory.pending.includes(id) ? memory.pending : [...memory.pending, id] });
  seenHere(me.id, id);
  void send(me.id, id);
}

function focusHeading(): void {
  document.querySelector<HTMLElement>('#main h1')?.focus({ preventScroll: true });
}

/** The tip to show now for the signed-in user (account or device), or null while none applies or facts still load. */
function useTip(habits: Habit[] | undefined, routines: Routine[] | null | undefined): TipId | null {
  const me = useStore(auth.me);
  const mode = useStore(localMode.mode);
  const calm = useCalmMode();
  useStore(tipMemoryChanged);
  const memory = me ? readTipMemory(me.id) : null;
  const seen = me?.tipsSeen && memory ? [...me.tipsSeen, ...memory.pending] : null;
  const account = mode === 'account';
  const plainJournal = !me?.journal.encrypted;
  const whatsNewShowing = useWhatsNewShowing(!!seen && !calm);
  const whatsNew = calm ? false : whatsNewShowing;
  const firstDay =
    me && memory && habits ? [memory.first ?? me.localToday, ...habits.map((h) => h.startDate)].sort()[0]! : null;
  const later =
    !!me && !calm && firstDay !== null && me.localToday > firstDay && (memory!.wait === null || me.localToday > memory!.wait);

  const notes = useQuery({
    queryKey: anyNoteKey,
    queryFn: async () => (await api.listDayNotes()).length > 0,
    enabled: !!seen && later && account && plainJournal && !seen.includes('private-journal'),
    staleTime: fiveMinutes,
  });
  const days = useQuery({
    queryKey: ['tips', 'check-in-days', me?.localToday],
    queryFn: async () => (await api.dayStats()).filter((d) => d.showedUp).length,
    enabled:
      !!seen &&
      later &&
      !!habits?.length &&
      ((!env.native && !seen.includes('android')) || (account && !me?.discord.linked && !seen.includes('discord'))),
    staleTime: fiveMinutes,
  });

  const userId = me?.id;
  const today = me?.localToday;
  const missingFirst = !!memory && !memory.first;
  const hasSeen = !!seen;
  useEffect(() => {
    if (userId && today && missingFirst) writeTipMemory(userId, { first: today });
  }, [userId, today, missingFirst]);
  useEffect(() => {
    if (userId && today && whatsNew) writeTipMemory(userId, { wait: today });
  }, [userId, today, whatsNew]);
  useEffect(() => {
    if (!userId || !hasSeen) return;
    if (!flushed.has(userId)) {
      flushed.add(userId);
      flushPending(userId);
    }
    if (!listening) {
      listening = true;
      window.addEventListener('online', () => {
        const current = auth.me.get();
        if (current) flushPending(current.id);
      });
    }
  }, [userId, hasSeen]);

  if (!me || !memory || !seen || !habits || firstDay === null || whatsNew === undefined) return null;
  return pickTip({
    today: me.localToday,
    firstDay,
    waitDay: memory.wait,
    seen,
    whatsNew,
    calm,
    native: env.native,
    account,
    showStreaks: me.showStreaks,
    plainJournal,
    discordLinked: me.discord.linked,
    habits: habits.length,
    activeHabits: habits.filter((h) => !h.pausedToday).length,
    routines: routines === undefined || routines === null ? null : routines.length,
    checkInDays: habits.length === 0 || days.isError ? 0 : (days.data ?? null),
    hasNote: notes.isError ? false : (notes.data ?? null),
  });
}

const links: Record<Exclude<TipId, 'streaks'>, To> = {
  'private-journal': '/settings/privacy#journal',
  routines: '/routines/new',
  android: '/download',
  discord: { pathname: '/settings', hash: 'discord' },
};

function TipCard({ id, heading, dismiss, children }: { id: TipId; heading: string; dismiss?: ReactNode; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      data-tip={id}
      className="flex items-start gap-3 rounded-md border border-border bg-muted px-4 py-3 text-foreground"
    >
      <Lightbulb aria-hidden className="mt-[0.1875rem] size-[1.125rem] shrink-0 text-muted-foreground" />
      <div className="flex min-w-0 max-w-[38rem] flex-1 flex-col items-start gap-2 [overflow-wrap:anywhere]">
        <h2 id={headingId} className="text-base font-semibold">
          {heading}
        </h2>
        {children}
      </div>
      {dismiss}
    </section>
  );
}

function StreaksTip({ me }: { me: Me }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function show(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const updated = await api.updateMe({ showStreaks: true });
      writeTipMemory(me.id, { wait: me.localToday });
      focusHeading();
      auth.setMe(updated);
    } catch (error) {
      setProblem(problemToMessage(asApiError(error)).message);
      setBusy(false);
    }
  }

  function decline(): void {
    focusHeading();
    markSeen(me, 'streaks');
  }

  return (
    <TipCard id="streaks" heading={t('tips.streaks.heading')}>
      <p>{t('tips.streaks.body')}</p>
      <p className="text-[0.875rem] text-muted-foreground">{t('tips.streaks.change')}</p>
      {problem && <p role="alert">{problem}</p>}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button type="button" variant="secondary" aria-disabled={busy || undefined} onClick={() => void show()}>
          {t('tips.streaks.show')}
        </Button>
        <Button type="button" variant="secondary" aria-disabled={busy || undefined} onClick={() => !busy && decline()}>
          {t('tips.streaks.decline')}
        </Button>
      </div>
    </TipCard>
  );
}

function LinkTip({ me, id }: { me: Me; id: Exclude<TipId, 'streaks'> }) {
  const { t } = useTranslation();

  function dismiss(): void {
    focusHeading();
    markSeen(me, id);
  }

  return (
    <TipCard
      id={id}
      heading={t(`tips.${id}.heading`)}
      dismiss={
        <Button type="button" variant="ghost" size="icon" className="-my-2 -mr-2 shrink-0" aria-label={t('tips.dismiss')} onClick={dismiss}>
          <X aria-hidden />
        </Button>
      }
    >
      <TapLink to={links[id]} className="-my-1" onClick={() => markSeen(me, id)}>
        {t(`tips.${id}.link`)}
      </TapLink>
    </TipCard>
  );
}

/**
 * One-time tips (contract "Tips"): renders the single tip due now when it belongs in `place`, else nothing. Pass the
 * habits the page loaded (undefined while loading) and, on Today, its routines. Never steals focus or announces.
 */
export function TipSlot({
  place,
  habits,
  routines,
}: {
  place: TipPlace;
  habits: Habit[] | undefined;
  routines?: Routine[] | null;
}) {
  const tip = useTip(habits, routines);
  const me = useStore(auth.me);
  if (!tip || !me || tipPlaces[tip] !== place) return null;
  return tip === 'streaks' ? <StreaksTip me={me} /> : <LinkTip me={me} id={tip} />;
}
