import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton } from '@/components/auth/busy-button';
import type { Validator } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
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
  if (length === 0) return 'Please give it a name.';
  return length > 24 ? 'Keep it to 24 characters or fewer.' : null;
};

const emojiRule: Validator = (value) =>
  !value.trim() || isSingleEmoji(value.trim()) ? null : 'Use a single emoji, or leave this empty.';

function failureMessage(error: unknown): string | null {
  if (error instanceof JournalLockedError) return error.message;
  const apiError = asApiError(error);
  if (apiError.handled) return null;
  if (apiError.status === 409) return 'You have 20 moods in use. Archive one to make room for another.';
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
        <FormField id={`${idPrefix}-label`} label="Name" error={touched.label ? labelError : null}>
          {(field) => (
            <Input
              {...field}
              value={label}
              autoComplete="off"
              onChange={(e) => setLabel(e.target.value)}
              onBlur={() => setTouched((t) => ({ ...t, label: true }))}
            />
          )}
        </FormField>
        <FormField id={`${idPrefix}-emoji`} label="Emoji" optional error={touched.emoji ? emojiError : null}>
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
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

type MoodPatch = { label?: string; emoji?: string | null; archived?: boolean };

function MoodRow({ mood, onChange }: { mood: OwnMood; onChange: (patch: MoodPatch, words: string) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);

  function closeEdit() {
    flushSync(() => setEditing(false));
    changeRef.current?.focus();
  }

  if (editing) {
    return (
      <li className="rounded-md border-[length:var(--border-width)] border-border p-3">
        <MoodForm
          idPrefix={`mood-${mood.id}`}
          name={`Change ${mood.label}`}
          initial={mood}
          submitLabel="Save"
          busyLabel="Saving…"
          onCancel={closeEdit}
          onSubmit={async (values) => {
            const ok = await onChange(values, `${values.label} saved.`);
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
    await onChange(
      { archived: !mood.archived },
      mood.archived ? `${mood.label} is back in the picker.` : `${mood.label} archived.`,
    );
    setBusy(false);
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="flex min-w-0 flex-1 items-center gap-2">
        {mood.emoji && <span aria-hidden="true">{mood.emoji}</span>}
        <span className="truncate">{mood.label}</span>
      </span>
      <Button ref={changeRef} variant="ghost" onClick={() => setEditing(true)} aria-label={`Change ${mood.label}`}>
        Change
      </Button>
      <BusyButton
        variant="secondary"
        busy={busy}
        busyLabel={mood.archived ? 'Bringing back…' : 'Archiving…'}
        onClick={() => void toggleArchive()}
        aria-label={`${mood.archived ? 'Unarchive' : 'Archive'} ${mood.label}`}
      >
        {mood.archived ? 'Unarchive' : 'Archive'}
      </BusyButton>
    </li>
  );
}

/** Settings section for the user's own moods: add, rename or change the emoji, archive and unarchive (no delete). */
export function MoodManager() {
  const journal = useJournal();
  const queryClient = useQueryClient();
  const state = useStore(journal.state);
  const query = useQuery({ queryKey: moodsKey, queryFn: () => journal.moods(), enabled: state !== 'locked' });
  const [formKey, setFormKey] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');

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

  if (state === 'locked') {
    return <JournalLocked>Your own moods are in your private journal, which is locked on this device.</JournalLocked>;
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
        />
      ))}
    </ul>
  );

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={announcement} />
      <p className="text-muted-foreground">
        Add your own moods next to the five built-in ones. Archiving hides a mood from the picker; days you already
        gave it keep showing it.
      </p>
      {!moods ? (
        query.isError && !query.isFetching ? (
          <Notice tone="notice" heading="Your moods didn't load">
            {failureMessage(query.error) && <p>{failureMessage(query.error)}</p>}
            <Button variant="secondary" onClick={() => void query.refetch()}>
              Try again
            </Button>
          </Notice>
        ) : (
          <div aria-busy="true">
            <span role="status" className="sr-only">
              Loading your moods…
            </span>
            <Skeleton className="h-[44px] rounded-md" />
          </div>
        )
      ) : (
        <>
          {active.length > 0 ? rows(active) : <p className="text-muted-foreground">No own moods yet.</p>}
          {archived.length > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-[18px]">Archived</h3>
              {rows(archived)}
            </div>
          )}
        </>
      )}
      {problem && (
        <Notice tone="notice" heading="That didn't go through">
          <p>{problem}</p>
        </Notice>
      )}
      <MoodForm
        key={formKey}
        idPrefix="new-mood"
        name="Add a mood"
        submitLabel="Add mood"
        busyLabel="Adding…"
        onSubmit={async (values) => {
          const ok = await run(() => journal.addMood(values), (mood) => `${mood.label} added.`);
          if (ok) setFormKey((k) => k + 1);
          return ok;
        }}
      />
    </div>
  );
}
