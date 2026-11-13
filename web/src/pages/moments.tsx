import { useQuery } from '@tanstack/react-query';
import { Check, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { EmptyState } from '@/components/empty-state';
import { journalKey } from '@/components/journal/day-journal';
import { useJournal } from '@/components/journal/journal-context';
import { LiveRegion } from '@/components/live-region';
import { PageHeader } from '@/components/page-header';
import { UnlockForm } from '@/components/settings/journal-forms';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { hasHelp, helpsProblem } from '@/lib/helps/helps';
import type { HelpItem } from '@/lib/helps/types';
import { addDays, formatDate, monthLabel } from '@/lib/local-date';
import {
  helpedPractice,
  helpedSomething,
  parseMoments,
  type SavedMoment,
} from '@/lib/moment/moments';
import { practices } from '@/lib/moment/practices';
import { auth, helps, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';

type Listed = SavedMoment & { key: string };
type Entry = { text: string; practiceId?: string };

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

const sortKey = (moment: Listed) => `${moment.date} ${moment.time.padStart(5, '0')}`;

function entryFor(helped: string): Entry {
  const practiceId = helpedPractice(helped);
  const practice = practiceId ? practices().find((p) => p.id === practiceId) : undefined;
  return practice ? { text: practice.title, practiceId: practice.id } : { text: helped };
}

function byMonth(moments: Listed[]): [string, Listed[]][] {
  const months = new Map<string, Listed[]>();
  for (const moment of moments) {
    const month = moment.date.slice(0, 7);
    months.set(month, [...(months.get(month) ?? []), moment]);
  }
  return [...months];
}

function MomentItem({
  moment,
  items,
  busy,
  problem,
  onAdd,
}: {
  moment: Listed;
  items: HelpItem[] | null;
  busy: boolean;
  problem: string | null;
  onAdd: (entry: Entry) => void;
}) {
  const { t } = useTranslation();
  const entry = helpedSomething(moment.helped) ? entryFor(moment.helped) : null;
  const inList = !!entry && !!items && hasHelp(items, entry);
  const id = `moment-${moment.key}`;

  return (
    <li className={cardVariants()}>
      <h3 id={`${id}-heading`} className="text-[18px]">
        {t('moments.at', { date: formatDate(moment.date, longDate), time: moment.time })}
      </h3>
      {moment.tile && <p className="font-medium">{moment.tile}</p>}
      {(moment.before || moment.after || moment.setItOff || moment.helped) && (
        <dl className="flex flex-col gap-3">
          {(moment.before || moment.after) && (
            <div>
              <dt className="text-[14px] text-muted-foreground">{t('moments.intensity')}</dt>
              <dd>
                {moment.before}
                {moment.after && (
                  <>
                    {moment.before && ' '}
                    <span aria-hidden="true">→</span>
                    <span className="sr-only">{t('moments.then')}</span> {moment.after}
                  </>
                )}
              </dd>
            </div>
          )}
          {moment.setItOff && (
            <div>
              <dt className="text-[14px] text-muted-foreground">{t('moment.reflect.setItOff')}</dt>
              <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{moment.setItOff}</dd>
            </div>
          )}
          {moment.helped && (
            <div>
              <dt className="text-[14px] text-muted-foreground">{t('moment.reflect.helped')}</dt>
              <dd className="whitespace-pre-line [overflow-wrap:anywhere]">{moment.helped}</dd>
            </div>
          )}
        </dl>
      )}
      {entry &&
        (inList ? (
          <p
            id={`${id}-in-list`}
            tabIndex={-1}
            className="flex min-h-[44px] items-center gap-2 text-muted-foreground focus:outline-none"
          >
            <Check aria-hidden className="size-[18px] shrink-0" />
            {t('moments.inList')}
          </p>
        ) : (
          <div>
            <BusyButton
              type="button"
              variant="secondary"
              busy={busy}
              busyLabel={t('moments.adding')}
              aria-label={busy ? undefined : t('moments.addLabel', { text: entry.text })}
              onClick={() => onAdd(entry)}
            >
              <Plus aria-hidden />
              {t('moments.add')}
            </BusyButton>
          </div>
        ))}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
    </li>
  );
}

/**
 * `/moments`: the moment reflections saved in the private journal over the last 12 months, newest first and grouped by
 * month, read from the day notes and decrypted on this device. Each can go to "What helps me". Nothing new is stored.
 */
export default function MomentsPage() {
  const { t } = useTranslation();
  const journal = useJournal();
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const state = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
  const changed = useStore(journal.changed);
  const items = useStore(helps.items);
  const [newPassphrase, setNewPassphrase] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ key: string; text: string } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [added, setAdded] = useState<string | null>(null);
  const today = me?.localToday;
  const ready = !local && !!today && state === 'unlocked' && !turningOff;

  const query = useQuery({
    queryKey: [...journalKey, 'moments', today, changed],
    queryFn: async () => {
      const { notes } = await journal.notes(addDays(today!, -365), today);
      const moments = notes.flatMap((note) =>
        parseMoments(note.date, note.text).map((moment, index) => ({
          ...moment,
          key: `${note.date}-${index}`,
        })),
      );
      return moments.sort((a, b) => sortKey(b).localeCompare(sortKey(a)));
    },
    enabled: ready,
  });

  useEffect(() => {
    if (!added) return;
    document.getElementById(`moment-${added}-in-list`)?.focus();
    setAdded(null);
  }, [added, items]);

  async function add(key: string, entry: Entry): Promise<void> {
    if (busy) return;
    setBusy(key);
    setProblem(null);
    setAnnouncement('');
    try {
      const fresh = await helps.add(entry);
      setAnnouncement(t(fresh ? 'helps.added' : 'helps.already', { text: entry.text }));
      setAdded(key);
    } catch (error) {
      const text = helpsProblem(error);
      if (text) setProblem({ key, text });
    } finally {
      setBusy(null);
    }
  }

  let body;
  if (local || !me) {
    body = (
      <Notice>
        <p>{t('moments.needsAccount')}</p>
      </Notice>
    );
  } else if (state === 'off' || turningOff) {
    body = (
      <Notice>
        <p>{t('moments.needsPrivate')}</p>
        <TapLink to="/settings/privacy#journal">{t('moment.reflect.openPrivacy')}</TapLink>
      </Notice>
    );
  } else if (state === 'locked') {
    body = (
      <section aria-labelledby="moments-unlock" className={cardVariants()}>
        <p id="moments-unlock">{t('moments.locked')}</p>
        <UnlockForm
          onUnlocked={(needsNewPassphrase) => {
            setNewPassphrase(needsNewPassphrase);
            setAnnouncement(t('journal.unlocked'));
            document.querySelector<HTMLElement>('#main h1')?.focus();
          }}
        />
      </section>
    );
  } else if (query.isPending) {
    body = (
      <div aria-busy="true" className="flex flex-col gap-4">
        <span role="status" className="sr-only">
          {t('moments.loading')}
        </span>
        <Skeleton className="h-[8rem] rounded-xl" />
        <Skeleton className="h-[8rem] rounded-xl" />
      </div>
    );
  } else if (query.isError) {
    body = (
      <Notice tone="notice">
        <p>{t('moments.loadFailed')}</p>
        <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
          {t('moments.retry')}
        </Button>
      </Notice>
    );
  } else if (query.data.length === 0) {
    body = <EmptyState title={t('moments.empty.title')}>{t('moments.empty.body')}</EmptyState>;
  } else {
    body = (
      <div className="flex flex-col gap-8">
        {byMonth(query.data).map(([month, moments]) => (
          <section key={month} aria-labelledby={`moments-${month}`} className="flex flex-col gap-4">
            <h2 id={`moments-${month}`} className="text-[22px]">
              {monthLabel(`${month}-01`)}
            </h2>
            <ul role="list" className="flex flex-col gap-4">
              {moments.map((moment) => (
                <MomentItem
                  key={moment.key}
                  moment={moment}
                  items={items}
                  busy={busy === moment.key}
                  problem={problem?.key === moment.key ? problem.text : null}
                  onAdd={(entry) => void add(moment.key, entry)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="flex max-w-[40rem] flex-col gap-6">
      <PageHeader title={t('title.moments')} lede={t('moments.lede')} />
      {newPassphrase && state === 'unlocked' && (
        <Notice>
          <p>{t('moment.reflect.newPassphraseLater')}</p>
          <TapLink to="/settings/privacy">{t('moment.reflect.openPrivacy')}</TapLink>
        </Notice>
      )}
      {body}
      <LiveRegion message={announcement} />
    </div>
  );
}
