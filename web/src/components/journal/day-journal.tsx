import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, CloudOff, Lock } from 'lucide-react';
import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { FormField } from '@/components/form-field';
import { PassphraseForm, UnlockForm } from '@/components/settings/journal-forms';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { controlClass } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { JournalLockedError } from '@/lib/journal/types';
import { formatDate } from '@/lib/local-date';
import { hasMoments } from '@/lib/moment/moments';
import type { DayNote, LocalDateString, MoodKey } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { auth, offlineQueue } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { useJournal } from './journal-context';
import { moodChoices } from './moods';

/** Longest journal text after trimming (contract "Journal for the day"). */
export const maxJournalText = 2000;
const counterFrom = 1800;
const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

/** Query key prefix of every journal read, so writes elsewhere can refresh them. */
export const journalKey = ['journal'] as const;

/** "Your private journal is locked on this device" with the way to Settings. Shows no journal data. */
export function JournalLocked({ children }: { children?: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-start gap-3 text-muted-foreground">
      <Lock aria-hidden className="mt-[3px] size-[18px] shrink-0" />
      <div className="flex flex-col items-start">
        <p>{children ?? t('journal.locked')}</p>
        <TapLink to="/settings#journal">{t('journal.unlockInSettings')}</TapLink>
      </div>
    </div>
  );
}

type Draft = { text: string; mood: MoodKey | null };
type Status = 'saved' | 'queued' | 'cleared' | 'mood' | 'moodCleared' | null;

const statusText = {
  saved: 'journal.status.saved',
  cleared: 'journal.status.cleared',
  mood: 'journal.status.mood',
  moodCleared: 'journal.status.moodCleared',
} as const satisfies Record<Exclude<Status, 'queued' | null>, string>;

/**
 * The journal card for one local day (today or any past day): a mood picker that saves on tap (with the day's
 * saved text) and free text saved with an explicit Save. Both empty deletes the day's entry. While the private
 * journal is locked it shows the locked message with the unlock form, then the new-passphrase step after a
 * recovery-code unlock.
 */
export function DayJournal({ date, className }: { date: LocalDateString; className?: string }) {
  const { t } = useTranslation();
  const journal = useJournal();
  const queryClient = useQueryClient();
  const state = useStore(journal.state);
  const changed = useStore(journal.changed);
  const turningOff = useStore(journal.turningOff);
  const me = useStore(auth.me);
  const today = me?.localToday;
  const moodLabelId = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [newPassphrase, setNewPassphrase] = useState(false);
  const [unlockStatus, setUnlockStatus] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeading = useRef(false);
  const statusRef = useRef<HTMLParagraphElement>(null);
  const focusStatus = useRef(false);

  useEffect(() => {
    if (focusStatus.current) {
      focusStatus.current = false;
      statusRef.current?.focus();
    }
    if (!focusHeading.current) return;
    focusHeading.current = false;
    headingRef.current?.focus();
  });

  function step(message: string) {
    setUnlockStatus(message);
    focusHeading.current = true;
  }

  async function expired() {
    await journal.forget();
    setNewPassphrase(false);
    step(t('journal.expired'));
  }

  const queryKey = [...journalKey, 'day', date];
  const query = useQuery({
    queryKey,
    queryFn: async () => {
      const [{ notes }, moods] = await Promise.all([journal.notes(date, date), journal.moods()]);
      return { note: notes.find((n) => n.date === date) ?? null, moods };
    },
    enabled: state !== 'locked',
  });

  const seenChange = useRef(changed);
  useEffect(() => {
    if (seenChange.current === changed) return;
    seenChange.current = changed;
    void queryClient.invalidateQueries({ queryKey: journalKey });
  }, [changed, queryClient]);

  const [forDate, setForDate] = useState(date);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tooLong, setTooLong] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useStore(offlineQueue.pending);
  const [seenPending, setSeenPending] = useState(pending);
  if (pending !== seenPending) {
    setSeenPending(pending);
    if (pending === 0 && status === 'queued') setStatus('saved');
  }
  if (forDate !== date) {
    setForDate(date);
    setDraft(null);
    setStatus(null);
    setProblem(null);
    setTooLong(false);
    setUnlockStatus('');
  }

  const heading = date === today ? t('journal.headingToday') : t('journal.heading', { date: formatDate(date, longDate) });
  const privacy = t('journal.privacy');

  if (state === 'locked' || (newPassphrase && me)) {
    return (
      <Card className={className}>
        <h2 ref={headingRef} tabIndex={-1} className="text-[22px] focus:outline-none">
          {heading}
        </h2>
        <p role="status" className={unlockStatus ? 'text-[14px] text-muted-foreground' : 'sr-only'}>
          {unlockStatus}
        </p>
        {newPassphrase && me ? (
          <>
            <p>{t('journal.recoveryNewPassphrase')}</p>
            <PassphraseForm
              me={me}
              current={false}
              submitLabel={t('journal.saveNewPassphrase')}
              onDone={() => {
                setNewPassphrase(false);
                step(t('journal.newPassphraseSet'));
              }}
              onExpired={() => void expired()}
            />
          </>
        ) : (
          <>
            <div className="flex items-start gap-3 text-muted-foreground">
              <Lock aria-hidden className="mt-[3px] size-[18px] shrink-0" />
              <p>{t('journal.locked')}</p>
            </div>
            <UnlockForm
              onUnlocked={(needsNew) => {
                const next = needsNew && !turningOff;
                setNewPassphrase(next);
                step(next ? t('journal.recoveryWorked') : t('journal.unlocked'));
              }}
            />
          </>
        )}
      </Card>
    );
  }

  const note = query.data?.note ?? null;
  const text = draft?.text ?? note?.text ?? '';
  const mood = draft ? draft.mood : (note?.mood ?? null);
  const trimmedLength = text.trim().length;
  const stored = !!note && text === (note.text ?? '') && mood === note.mood;
  const lengthError = tooLong && trimmedLength > maxJournalText ? t('journal.tooLong', { max: maxJournalText }) : null;

  function edit(next: Partial<Draft>) {
    setDraft({ text, mood, ...next });
    setStatus(null);
    setProblem(null);
  }

  async function persist(entry: { text: string | null; mood: MoodKey | null }, onMood: boolean, base = entry.text ?? '') {
    setBusy(true);
    setProblem(null);
    try {
      const { queued } = await journal.save(date, entry);
      const saved: DayNote | null = entry.text === null && entry.mood === null ? null : { date, ...entry };
      queryClient.setQueryData<typeof query.data>(queryKey, (old) => (old ? { ...old, note: saved } : old));
      if (onMood) {
        setDraft((current) => (current && current.text !== base ? { ...current, mood: entry.mood } : null));
        setStatus(queued ? 'queued' : entry.mood ? 'mood' : 'moodCleared');
      } else {
        setDraft(null);
        setTooLong(false);
        focusStatus.current = saved !== null;
        setStatus(queued ? 'queued' : saved ? 'saved' : 'cleared');
      }
    } catch (error) {
      if (error instanceof JournalLockedError) {
        setProblem(error.message);
      } else {
        const apiError = asApiError(error);
        if (!apiError.handled) setProblem(problemToMessage(apiError).message);
      }
    } finally {
      setBusy(false);
    }
  }

  function save(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const trimmed = text.trim();
    if (trimmed.length > maxJournalText) {
      setTooLong(true);
      formRef.current?.querySelector<HTMLElement>('textarea')?.focus();
      return;
    }
    void persist({ text: trimmed || null, mood }, false);
  }

  async function pickMood(next: MoodKey | null) {
    if (busy) return;
    edit({ mood: next });
    setBusy(true);
    const fresh = await journal
      .notes(date, date)
      .then(({ notes }) => notes.find((n) => n.date === date) ?? null)
      .catch(() => note);
    await persist({ text: fresh?.text ?? null, mood: next }, true, note?.text ?? '');
  }

  function clearMood() {
    formRef.current?.querySelector<HTMLElement>('[role="radio"]')?.focus();
    void pickMood(null);
  }

  function clearAll() {
    edit({ text: '', mood: null });
    formRef.current?.querySelector<HTMLElement>('textarea')?.focus();
  }

  let body;
  if (!query.data) {
    body =
      query.isError && !query.isFetching ? (
        <Notice tone="notice" heading={t('journal.loadError')}>
          {!asApiError(query.error).handled && <p>{problemToMessage(asApiError(query.error)).message}</p>}
          <Button variant="secondary" onClick={() => void query.refetch()}>
            {t('history.tryAgain')}
          </Button>
        </Notice>
      ) : (
        <div aria-busy="true" className="flex flex-col gap-3">
          <span role="status" className="sr-only">
            {t('journal.loading')}
          </span>
          <Skeleton className="h-[44px] rounded-md" />
          <Skeleton className="h-[8rem] rounded-md" />
        </div>
      );
  } else {
    const choices = moodChoices(query.data.moods, mood);
    body = (
      <form ref={formRef} noValidate onSubmit={save} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <p id={moodLabelId} className="font-medium">
            <Trans i18nKey="journal.mood" components={{ muted: <span className="font-normal text-muted-foreground" /> }} />
          </p>
          <RadioGroupPrimitive.Root
            aria-labelledby={moodLabelId}
            value={mood ?? ''}
            onValueChange={(value) => void pickMood(value as MoodKey)}
            className="flex flex-wrap gap-2"
          >
            {choices.map((choice) => (
              <RadioGroupPrimitive.Item
                key={choice.key}
                value={choice.key}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-full border-[length:max(1px,var(--border-width))] border-input bg-card px-3 text-base text-card-foreground transition-colors hover:bg-accent data-[state=checked]:border-primary data-[state=checked]:bg-accent data-[state=checked]:font-semibold data-[state=checked]:text-accent-foreground"
              >
                {choice.emoji && <span aria-hidden="true">{choice.emoji}</span>}
                <span>{choice.label}</span>
                {choice.archived && <span className="text-[14px] font-normal text-muted-foreground">{t('journal.archived')}</span>}
                <RadioGroupPrimitive.Indicator asChild>
                  <Check aria-hidden className="size-[16px]" />
                </RadioGroupPrimitive.Indicator>
              </RadioGroupPrimitive.Item>
            ))}
          </RadioGroupPrimitive.Root>
          {mood && (
            <Button type="button" variant="link" className="self-start px-0" onClick={clearMood}>
              {t('journal.clearMood')}
            </Button>
          )}
        </div>
        <FormField label={t('journal.fewWords')} optional hint={privacy} error={lengthError}>
          {(field) => (
            <>
              <textarea
                {...field}
                aria-describedby={cn(field['aria-describedby'], trimmedLength >= counterFrom && `${field.id}-count`) || undefined}
                value={text}
                rows={5}
                onChange={(e) => edit({ text: e.target.value })}
                className={cn(controlClass, 'min-h-[8rem] resize-y leading-relaxed')}
              />
              {trimmedLength >= counterFrom && (
                <p id={`${field.id}-count`} className="self-end text-[14px] text-muted-foreground">
                  {t('journal.counter', { count: trimmedLength, max: maxJournalText })}
                </p>
              )}
            </>
          )}
        </FormField>
        {problem && (
          <Notice tone="notice" heading={t('journal.notSaved')}>
            <p>{problem}</p>
          </Notice>
        )}
        <div className="flex flex-wrap items-center gap-3">
          {!stored && (
            <BusyButton type="submit" busy={busy} busyLabel={t('journal.saving')}>
              {t('journal.save')}
            </BusyButton>
          )}
          <p
            ref={statusRef}
            role="status"
            tabIndex={-1}
            className="flex items-center gap-2 text-muted-foreground empty:sr-only focus:outline-none"
          >
            {status === 'queued' ? (
              <>
                <CloudOff aria-hidden className="size-[18px] shrink-0" />
                {t('journal.queued')}
              </>
            ) : status || stored ? (
              <>
                <Check aria-hidden className="size-[18px] shrink-0" />
                {t(statusText[status ?? 'saved'])}
              </>
            ) : null}
          </p>
          {(text || mood) && (
            <Button type="button" variant="ghost" onClick={clearAll}>
              {t('journal.clear')}
            </Button>
          )}
        </div>
        {hasMoments(note?.text ?? null) && (
          <div>
            <TapLink to="/moments">{t('journal.yourMoments')}</TapLink>
          </div>
        )}
      </form>
    );
  }

  return (
    <Card className={className}>
      <h2 ref={headingRef} tabIndex={-1} className="text-[22px] focus:outline-none">
        {heading}
      </h2>
      <p role="status" className={unlockStatus ? 'text-[14px] text-muted-foreground' : 'sr-only'}>
        {unlockStatus}
      </p>
      {body}
    </Card>
  );
}
