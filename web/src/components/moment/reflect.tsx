import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { FormField } from '@/components/form-field';
import { LiveRegion } from '@/components/live-region';
import { useJournal } from '@/components/journal/journal-context';
import { UnlockForm } from '@/components/settings/journal-forms';
import { Spinner } from '@/components/spinner';
import { Button } from '@/components/ui/button';
import { controlClass } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { momentCopy } from '@/lib/moment/copy';
import { momentTime, reflectionBlock } from '@/lib/moment/reflection';
import type { Intensity, Practice } from '@/lib/moment/types';
import { deviceToday } from '@/lib/guards';
import { auth, deviceSync, localMode, offlineQueue } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { IntensityScale } from './intensity-scale';

const maxTrigger = 300;
const nothing = 'nothing';
const announceFrom = 20;

type SaveCase = 'checking' | 'unlocked' | 'locked' | 'plain' | 'consent' | 'none';

function useSaveCase(): SaveCase {
  const me = useStore(auth.me);
  const mode = useStore(localMode.mode);
  const journal = useJournal();
  const state = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
  const [checking, setChecking] = useState(
    () => !auth.me.get() && localMode.mode.get() === 'account',
  );

  useEffect(() => {
    if (!checking) return;
    let live = true;
    void auth
      .loadMe()
      .catch(() => null)
      .then((loaded) => (loaded ? journal.restore().catch(() => undefined) : undefined))
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [checking, journal]);

  if (checking && mode === 'account') return 'checking';
  if (!me || mode !== 'account') return 'none';
  if (!me.consent.given || me.consent.policyVersion !== me.consent.currentPolicyVersion)
    return 'consent';
  if (state === 'off' || turningOff) return 'plain';
  return state;
}

function problemText(error: unknown): string {
  if ((error instanceof Error && error.message === 'Offline.') || navigator.onLine === false)
    return momentCopy.offline;
  if (error instanceof RangeError) return momentCopy.full;
  return momentCopy.saveFailed;
}

/**
 * Optional reflection at the end of a moment. Whether it can be saved is decided before any field shows: from memory,
 * or on a cold start with `me` not loaded yet by loading it once (which restores a remembered journal key). Only an
 * unlocked private journal saves, through `appendPrivate`. The draft survives every error; `onDraft` reports whether
 * there is unsaved text.
 */
export function Reflect({
  heading,
  startedAt,
  tile,
  before,
  after,
  tried,
  used,
  onLeave,
  onDraft,
}: {
  heading: string;
  startedAt: Date;
  tile?: string;
  before?: Intensity;
  after?: Intensity;
  tried: Practice[];
  used?: Practice;
  onLeave: () => void;
  onDraft?: (draft: boolean) => void;
}) {
  useTranslation();
  const id = useId();
  const saveCase = useSaveCase();
  const journal = useJournal();
  const [trigger, setTrigger] = useState('');
  const [helped, setHelped] = useState(used?.id ?? nothing);
  const [now, setNow] = useState(after);
  const [newPassphrase, setNewPassphrase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const savedRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLTextAreaElement>(null);
  const left = maxTrigger - trigger.length;

  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  const draft = !saved && trigger.trim() !== '';
  useEffect(() => {
    onDraft?.(draft);
  }, [draft, onDraft]);

  useEffect(() => {
    if (!unlocked || saveCase !== 'unlocked') return;
    setUnlocked(false);
    triggerRef.current?.focus();
  }, [unlocked, saveCase]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const me = auth.me.get();
    if (busy || saveCase !== 'unlocked' || !me) return;
    setBusy(true);
    setProblem(null);
    try {
      if (offlineQueue.pending.get() > 0) await deviceSync.sync();
      if (offlineQueue.pending.get() > 0) throw new Error('Offline.');
      await journal.appendPrivate(
        deviceToday(me.timezone) ?? me.localToday,
        reflectionBlock({
          time: momentTime(startedAt, me.timezone),
          tile,
          before: before && momentCopy.intensity[before],
          after: now && momentCopy.intensity[now],
          trigger,
          helped: tried.find((practice) => practice.id === helped)?.title,
        }),
      );
      setSaved(true);
    } catch (error) {
      setProblem(problemText(error));
    } finally {
      setBusy(false);
    }
  }

  const done = (
    <div>
      <Button
        type="button"
        variant={saveCase === 'unlocked' && !saved ? 'ghost' : 'default'}
        onClick={onLeave}
      >
        {momentCopy.done}
      </Button>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <h1 tabIndex={-1} className="text-[28px] focus:outline-none md:text-[36px]">
        {heading}
      </h1>
      {saved ? (
        <>
          <div
            ref={savedRef}
            tabIndex={-1}
            className="flex items-start gap-3 rounded-md border border-transparent bg-success px-4 py-3 text-success-foreground focus:outline-none"
          >
            <Check aria-hidden className="mt-[3px] size-[18px] shrink-0" />
            <p>{momentCopy.saved}</p>
          </div>
          {done}
        </>
      ) : saveCase === 'checking' ? (
        <>
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Spinner />
            {momentCopy.checking}
          </p>
          {done}
        </>
      ) : (
        <>
          {saveCase === 'unlocked' && (
            <Notice>
              <p>{momentCopy.savesPrivate}</p>
              {newPassphrase && (
                <p>
                  {momentCopy.newPassphraseLater}{' '}
                  <TapLink to="/settings/privacy">{momentCopy.openPrivacy}</TapLink>
                </p>
              )}
            </Notice>
          )}
          {saveCase === 'locked' && (
            <section aria-labelledby={`${id}-unlock`} className="flex flex-col gap-4">
              <p id={`${id}-unlock`}>{momentCopy.savesAfterUnlock}</p>
              <UnlockForm
                onUnlocked={(needsNewPassphrase) => {
                  setNewPassphrase(needsNewPassphrase);
                  setUnlocked(true);
                }}
              />
            </section>
          )}
          {saveCase === 'plain' && (
            <Notice>
              <p>{momentCopy.needsPrivate}</p>
              <TapLink to="/settings/privacy">{momentCopy.openPrivacy}</TapLink>
            </Notice>
          )}
          {saveCase === 'consent' && (
            <Notice>
              <p>{momentCopy.needsConsent}</p>
              <TapLink to="/consent?returnUrl=/today">{momentCopy.openConsent}</TapLink>
            </Notice>
          )}
          {saveCase === 'none' && (
            <Notice>
              <p>{momentCopy.notSaved}</p>
            </Notice>
          )}
          <form noValidate onSubmit={(event) => void save(event)} className="flex flex-col gap-6">
            <FormField label={momentCopy.setItOff} hint={momentCopy.setItOffHint} optional>
              {(field) => (
                <>
                  <textarea
                    {...field}
                    ref={triggerRef}
                    aria-describedby={cn(field['aria-describedby'], `${field.id}-count`)}
                    value={trigger}
                    rows={3}
                    maxLength={maxTrigger}
                    onChange={(event) => setTrigger(event.target.value)}
                    className={cn(controlClass, 'min-h-[6rem] resize-y leading-relaxed')}
                  />
                  <p
                    id={`${field.id}-count`}
                    className="self-end text-[14px] text-muted-foreground"
                  >
                    {momentCopy.charactersLeft(left)}
                  </p>
                  <LiveRegion
                    message={
                      left === 0
                        ? momentCopy.limitReached
                        : left <= announceFrom
                          ? momentCopy.charactersLeft(announceFrom)
                          : ''
                    }
                  />
                </>
              )}
            </FormField>
            <div className="flex flex-col gap-2">
              <p id={`${id}-helped`} className="font-medium">
                {momentCopy.helped}
              </p>
              <RadioGroup
                aria-labelledby={`${id}-helped`}
                value={helped}
                onValueChange={setHelped}
                className="flex flex-col gap-2"
              >
                {[
                  ...tried.map((practice) => ({ value: practice.id, label: practice.title })),
                  { value: nothing, label: momentCopy.nothingHelped },
                ].map((option) => (
                  <label
                    key={option.value}
                    htmlFor={`${id}-helped-${option.value}`}
                    className="flex min-h-[48px] cursor-pointer items-center gap-3 rounded-lg border-[length:max(1px,var(--border-width))] border-border px-4 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground"
                  >
                    <RadioGroupItem id={`${id}-helped-${option.value}`} value={option.value} />
                    {option.label}
                  </label>
                ))}
              </RadioGroup>
            </div>
            <div className="flex flex-col gap-2">
              <p id={`${id}-now`} className="font-medium">
                {momentCopy.howNow}
              </p>
              <IntensityScale
                name={`${id}-now`}
                labelledBy={`${id}-now`}
                value={now}
                onChange={setNow}
              />
            </div>
            {problem && (
              <Notice tone="notice">
                <p>{problem}</p>
              </Notice>
            )}
            {saveCase === 'unlocked' && (
              <div>
                <BusyButton type="submit" busy={busy} busyLabel={momentCopy.saving}>
                  {momentCopy.save}
                </BusyButton>
              </div>
            )}
          </form>
          {done}
        </>
      )}
    </div>
  );
}
