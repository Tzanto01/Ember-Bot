import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BusyButton } from '@/components/auth/busy-button';
import type { Validator } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import { JournalLockedError } from '@/lib/journal/types';
import type { OwnMood } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { useStore } from '@/lib/store';
import { JournalLocked, journalKey } from './day-journal';
import { useJournal } from './journal-context';
import { isSingleEmoji } from './moods';

const moodsKey = [...journalKey, 'moods'] as const;

const labelRule: Validator = (value) => {
  const length = value.trim().length;
  if (length === 0) return t('moods.nameRequired');
  return length > 24 ? t('moods.nameTooLong') : null;
};

const emojiRule: Validator = (value) =>
  !value.trim() || isSingleEmoji(value.trim()) ? null : t('moods.emojiInvalid');

function failureMessage(error: unknown): string | null {
  if (error instanceof JournalLockedError) return error.message;
  const apiError = asApiError(error);
  if (apiError.handled) return null;
  if (apiError.status === 409) return t('moods.limit');
  return problemToMessage(apiError).message;
}

type MoodValues = { label: string; emoji: string | null };

/** Name and emoji fields with their own validation; errors show after blur or a submit attempt. */
function MoodForm({
  idPrefix,
  name,
  initial = { label: '', emoji: null },
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: {
  idPrefix: string;
  name: string;
  initial?: MoodValues;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (values: MoodValues) => Promise<boolean>;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const [label, setLabel] = useState(initial.label);
  const [emoji, setEmoji] = useState(initial.emoji ?? '');
  const [touched, setTouched] = useState({ label: false, emoji: false });
  const [busy, setBusy] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const labelError = labelRule(label);
  const emojiError = emojiRule(emoji);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    if (labelError || emojiError) {
      flushSync(() => setTouched({ label: true, emoji: true }));
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    await onSubmit({ label: label.trim(), emoji: emoji.trim() || null });
    setBusy(false);
  }

  return (
    <form ref={formRef} noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3" aria-label={name}>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
        <FormField id={`${idPrefix}-label`} label={t('moods.name')} error={touched.label ? labelError : null}>
          {(field) => (
            <Input
              {...field}
              value={label}
              autoComplete="off"
              autoFocus={!!onCancel}
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, label: true }))}
            />
          )}
        </FormField>
        <FormField id={`${idPrefix}-emoji`} label={t('moods.emoji')} optional error={touched.emoji ? emojiError : null}>
          {(field) => (
            <Input
              {...field}
              value={emoji}
              autoComplete="off"
              onChange={(e) => setEmoji(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, emoji: true }))}
            />
          )}
        </FormField>
      </div>
      <div className="flex flex-wrap gap-3">
        <BusyButton type="submit" variant={onCancel ? 'default' : 'secondary'} busy={busy} busyLabel={busyLabel}>
          {submitLabel}
        </BusyButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('moods.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}

type MoodPatch = { label?: string; emoji?: string | null; archived?: boolean };

function MoodRow({
  mood,
  onChange,
  focusArchive,
  onArchived,
}: {
  mood: OwnMood;
  onChange: (patch: MoodPatch, words: string) => Promise<boolean>;
  /** Focus the Archive / Unarchive button on mount: the row just moved between the lists. */
  focusArchive: boolean;
  onArchived: (moodId: number | null) => void;
}) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!focusArchive) return;
    document.getElementById(`mood-${mood.id}-archive`)?.focus();
    onArchived(null);
  }, []);

  function closeEdit() {
    flushSync(() => setEditing(false));
    changeRef.current?.focus();
  }

  if (editing) {
    return (
      <li className="rounded-md border-[length:var(--border-width)] border-border p-3">
        <MoodForm
          idPrefix={`mood-${mood.id}`}
          name={t('moods.changeLabel', { label: mood.label })}
          initial={mood}
          submitLabel={t('moods.save')}
          busyLabel={t('moods.saving')}
          onCancel={closeEdit}
          onSubmit={async (values) => {
            const ok = await onChange(values, t('moods.saved', { label: values.label }));
            if (ok) closeEdit();
            return ok;
          }}
        />
      </li>
    );
  }

  async function toggleArchive() {
    if (busy) return;
    setBusy(true);
    const ok = await onChange(
      { archived: !mood.archived },
      t(mood.archived ? 'moods.unarchived' : 'moods.archivedDone', { label: mood.label }),
    );
    setBusy(false);
    if (ok) onArchived(mood.id);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex min-w-0 flex-[1_1_10rem] items-center gap-2">
        {mood.emoji && <span aria-hidden="true">{mood.emoji}</span>}
        <span className="[overflow-wrap:anywhere]">{mood.label}</span>
      </span>
      <span className="flex gap-x-3">
        <Button ref={changeRef} variant="ghost" onClick={() => setEditing(true)} aria-label={t('moods.changeLabel', { label: mood.label })}>
          {t('moods.change')}
        </Button>
        <BusyButton
          id={`mood-${mood.id}-archive`}
          variant="secondary"
          busy={busy}
          busyLabel={mood.archived ? t('moods.bringingBack') : t('moods.archiving')}
          onClick={() => void toggleArchive()}
          aria-label={t(mood.archived ? 'moods.unarchiveLabel' : 'moods.archiveLabel', { label: mood.label })}
        >
          {mood.archived ? t('moods.unarchive') : t('moods.archive')}
        </BusyButton>
      </span>
    </li>
  );
}

/** Settings section for the user's own moods: add, rename or change the emoji, archive and unarchive (no delete). */
export function MoodManager() {
  const { t } = useTranslation();
  const journal = useJournal();
  const queryClient = useQueryClient();
  const state = useStore(journal.state);
  const query = useQuery({ queryKey: moodsKey, queryFn: () => journal.moods(), enabled: state !== 'locked' });
  const [formKey, setFormKey] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [movedId, setMovedId] = useState<number | null>(null);

  function remember(mood: OwnMood) {
    queryClient.setQueryData<OwnMood[]>(moodsKey, (list) =>
      list?.some((m) => m.id === mood.id) ? list.map((m) => (m.id === mood.id ? mood : m)) : [...(list ?? []), mood],
    );
    void queryClient.invalidateQueries({ queryKey: [...journalKey, 'day'] });
  }

  async function run(write: () => Promise<OwnMood>, words: (mood: OwnMood) => string): Promise<boolean> {
    setProblem(null);
    try {
      const mood = await write();
      remember(mood);
      setAnnouncement(words(mood));
      return true;
    } catch (error) {
      setProblem(failureMessage(error));
      return false;
    }
  }

  useEffect(() => {
    if (formKey > 0) document.getElementById('new-mood-label')?.focus();
  }, [formKey]);

  if (state === 'locked') {
    return <JournalLocked>{t('moods.locked')}</JournalLocked>;
  }

  const moods = query.data;
  const active = moods?.filter((m) => !m.archived) ?? [];
  const archived = moods?.filter((m) => m.archived) ?? [];
  const rows = (list: OwnMood[]) => (
    <ul className="flex flex-col gap-2">
      {list.map((mood) => (
        <MoodRow
          key={mood.id}
          mood={mood}
          onChange={(patch, words) => run(() => journal.updateMood(mood.id, patch), () => words)}
          focusArchive={movedId === mood.id}
          onArchived={setMovedId}
        />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={announcement} />
      <p className="text-muted-foreground">
        {t('moods.intro')}
      </p>
      {!moods ? (
        query.isError && !query.isFetching ? (
          <Notice tone="notice" heading={t('moods.loadError')}>
            {failureMessage(query.error) && <p>{failureMessage(query.error)}</p>}
            <Button variant="secondary" onClick={() => void query.refetch()}>
              {t('history.tryAgain')}
            </Button>
          </Notice>
        ) : (
          <div aria-busy="true">
            <span role="status" className="sr-only">
              {t('moods.loading')}
            </span>
            <Skeleton className="h-[44px] rounded-md" />
          </div>
        )
      ) : (
        <>
          {active.length > 0 ? rows(active) : <p className="text-muted-foreground">{t('moods.none')}</p>}
          {archived.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[18px]">{t('moods.archivedHeading')}</h3>
              {rows(archived)}
            </div>
          )}
        </>
      )}
      {problem && (
        <Notice tone="notice" heading={t('moods.failed')}>
          <p>{problem}</p>
        </Notice>
      )}
      <MoodForm
        key={formKey}
        idPrefix="new-mood"
        name={t('moods.addForm')}
        submitLabel={t('moods.add')}
        busyLabel={t('moods.adding')}
        onSubmit={async (values) => {
          const ok = await run(() => journal.addMood(values), (mood) => t('moods.added', { label: mood.label }));
          if (ok) setFormKey((k) => k + 1);
          return ok;
        }}
      />
    </div>
  );
}
