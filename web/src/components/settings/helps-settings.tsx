import { ArrowDown, ArrowUp } from 'lucide-react';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { FormField } from '@/components/form-field';
import { JournalLocked } from '@/components/journal/day-journal';
import { useJournal } from '@/components/journal/journal-context';
import { LiveRegion } from '@/components/live-region';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { helpsProblem } from '@/lib/helps/helps';
import { type HelpItem, maxHelps, maxHelpText } from '@/lib/helps/types';
import { helps, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';

const textError = (text: string): 'helps.error.text' | null => {
  const length = text.trim().length;
  return length === 0 || length > maxHelpText ? 'helps.error.text' : null;
};

function CharactersLeft({ id, text }: { id: string; text: string }) {
  const { t } = useTranslation();
  return (
    <p id={id} className="self-end text-[0.875rem] text-muted-foreground">
      {t('moment.reflect.charactersLeft', { left: maxHelpText - text.length })}
    </p>
  );
}

function EditForm({
  item,
  onSave,
  onCancel,
}: {
  item: HelpItem;
  onSave: (text: string) => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState(item.text);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const error = touched ? textError(text) : null;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (textError(text)) {
      setTouched(true);
      document.getElementById(`help-${item.id}-text`)?.focus();
      return;
    }
    setBusy(true);
    await onSave(text);
    setBusy(false);
  }

  return (
    <form
      noValidate
      aria-label={t('helps.editLabel', { text: item.text })}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3"
    >
      <FormField
        id={`help-${item.id}-text`}
        label={t('helps.editField')}
        error={error && t(error, { max: maxHelpText })}
      >
        {(field) => (
          <>
            <Input
              {...field}
              aria-describedby={[field['aria-describedby'], `help-${item.id}-count`]
                .filter(Boolean)
                .join(' ')}
              value={text}
              maxLength={maxHelpText}
              autoComplete="off"
              autoFocus
              onChange={(event) => setText(event.target.value)}
              onBlur={() => setTouched(true)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') onCancel();
              }}
            />
            <CharactersLeft id={`help-${item.id}-count`} text={text} />
          </>
        )}
      </FormField>
      <div className="flex flex-wrap gap-3">
        <BusyButton type="submit" busy={busy} busyLabel={t('helps.saving')}>
          {t('helps.save')}
        </BusyButton>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('helps.cancel')}
        </Button>
      </div>
    </form>
  );
}

/**
 * Settings body for "What helps me" (contract companion-v1): the end-to-end encrypted list with add, inline edit,
 * remove and reorder by up and down buttons, at most 20 items. Without an account or the private journal it explains
 * that the list needs the private journal; locked, it points to the unlock.
 */
export function HelpsSettings() {
  const { t } = useTranslation();
  const journal = useJournal();
  const local = useStore(localMode.mode) === 'local';
  const state = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
  const items = useStore(helps.items);
  const failed = useStore(helps.loadFailed);
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [focus, setFocus] = useState<string | null>(null);
  const addError = touched ? textError(text) : null;

  useEffect(() => {
    if (!focus) return;
    document.getElementById(focus)?.focus();
    setFocus(null);
  }, [focus, items, editing]);

  async function act(
    key: string,
    action: () => Promise<string | null>,
    focusAfter?: string,
  ): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setProblem(null);
    setAnnouncement('');
    try {
      const words = await action();
      if (words) setAnnouncement(words);
      if (focusAfter) setFocus(focusAfter);
      return true;
    } catch (error) {
      setProblem(helpsProblem(error));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function add(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (textError(text)) {
      setTouched(true);
      document.getElementById('helps-new')?.focus();
      return;
    }
    const entry = text.trim();
    const ok = await act('add', async () =>
      t((await helps.add({ text: entry })) ? 'helps.added' : 'helps.already', { text: entry }),
      'helps-new',
    );
    if (ok) {
      setText('');
      setTouched(false);
    }
  }

  function move(list: HelpItem[], index: number, delta: -1 | 1): void {
    const item = list[index]!;
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    void act(
      `${item.id}-move`,
      async () => {
        await helps.move(item.id, delta);
        const now = (helps.items.get() ?? []).findIndex((other) => other.id === item.id);
        return t('helps.moved', { text: item.text, position: now + 1, total: list.length });
      },
      `help-${item.id}-${delta < 0 ? 'up' : 'down'}`,
    );
  }

  function remove(list: HelpItem[], index: number): void {
    const item = list[index]!;
    const neighbour = list[index + 1] ?? list[index - 1];
    void act(
      item.id,
      async () => {
        await helps.remove(item.id);
        return t('helps.removed', { text: item.text });
      },
      neighbour ? `help-${neighbour.id}-remove` : 'helps-new',
    );
  }

  if (local) return <p>{t('helps.needsAccount')}</p>;
  if (state === 'off' || turningOff) {
    return (
      <>
        <p>{t('helps.needsPrivate')}</p>
        <div>
          <TapLink to="/settings/privacy#journal">{t('helps.openJournal')}</TapLink>
        </div>
      </>
    );
  }
  if (state === 'locked') return <JournalLocked>{t('helps.locked')}</JournalLocked>;

  if (!items) {
    return failed ? (
      <Notice tone="notice">
        <p>{t('helps.loadFailed')}</p>
        <Button
          type="button"
          variant="secondary"
          onClick={() => void helps.load().catch(() => undefined)}
        >
          {t('helps.retry')}
        </Button>
      </Notice>
    ) : (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span role="status" className="sr-only">
          {t('helps.loading')}
        </span>
        <Skeleton className="h-[44px] rounded-md" />
        <Skeleton className="h-[44px] rounded-md" />
      </div>
    );
  }

  return (
    <>
      <p className="text-muted-foreground">{t('helps.intro')}</p>
      {items.length === 0 ? (
        <p>{t('helps.empty')}</p>
      ) : (
        <ol role="list" aria-labelledby="helps-heading" className="flex flex-col divide-y divide-border">
          {items.map((item, index) => (
            <li key={item.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              {editing === item.id ? (
                <EditForm
                  item={item}
                  onCancel={() => {
                    setEditing(null);
                    setFocus(`help-${item.id}-edit`);
                  }}
                  onSave={async (next) => {
                    const trimmed = next.trim();
                    const ok = await act(item.id, async () => {
                      await helps.edit(item.id, trimmed);
                      return t('helps.saved', { text: trimmed });
                    });
                    if (ok) {
                      setEditing(null);
                      setFocus(`help-${item.id}-edit`);
                    }
                  }}
                />
              ) : (
                <>
                  <p className="flex flex-wrap items-center gap-2 [overflow-wrap:anywhere]">
                    <span>{item.text}</span>
                    {item.practiceId && <Badge variant="secondary">{t('helps.practice')}</Badge>}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      id={`help-${item.id}-up`}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('helps.up', { text: item.text })}
                      aria-disabled={index === 0 || !!busy || undefined}
                      onClick={() => move(items, index, -1)}
                    >
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button
                      id={`help-${item.id}-down`}
                      type="button"
                      variant="ghost"
                      size="icon"
                      aria-label={t('helps.down', { text: item.text })}
                      aria-disabled={index === items.length - 1 || !!busy || undefined}
                      onClick={() => move(items, index, 1)}
                    >
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button
                      id={`help-${item.id}-edit`}
                      type="button"
                      variant="ghost"
                      aria-label={t('helps.editLabel', { text: item.text })}
                      onClick={() => {
                        setProblem(null);
                        setEditing(item.id);
                      }}
                    >
                      {t('helps.edit')}
                    </Button>
                    <BusyButton
                      id={`help-${item.id}-remove`}
                      type="button"
                      variant="ghost"
                      busy={busy === item.id}
                      busyLabel={t('helps.saving')}
                      aria-label={
                        busy === item.id ? undefined : t('helps.removeLabel', { text: item.text })
                      }
                      onClick={() => remove(items, index)}
                    >
                      {t('helps.remove')}
                    </BusyButton>
                  </div>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {problem && (
        <Notice tone="notice">
          <p>{problem}</p>
        </Notice>
      )}
      {items.length >= maxHelps ? (
        <p id="helps-new" tabIndex={-1} className="text-muted-foreground focus:outline-none">
          {t('helps.full', { max: maxHelps })}
        </p>
      ) : (
        <form noValidate onSubmit={(event) => void add(event)} className="flex flex-col gap-3">
          <FormField
            id="helps-new"
            label={t('helps.new')}
            hint={t('helps.newHint')}
            error={addError && t(addError, { max: maxHelpText })}
          >
            {(field) => (
              <>
                <Input
                  {...field}
                  aria-describedby={[field['aria-describedby'], 'helps-new-count']
                    .filter(Boolean)
                    .join(' ')}
                  value={text}
                  maxLength={maxHelpText}
                  autoComplete="off"
                  onChange={(event) => setText(event.target.value)}
                  onBlur={() => text && setTouched(true)}
                />
                <CharactersLeft id="helps-new-count" text={text} />
              </>
            )}
          </FormField>
          <div>
            <BusyButton
              type="submit"
              variant="secondary"
              busy={busy === 'add'}
              busyLabel={t('helps.adding')}
            >
              {t('helps.add')}
            </BusyButton>
          </div>
        </form>
      )}
      <LiveRegion message={announcement} />
    </>
  );
}
