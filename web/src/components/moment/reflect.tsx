import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { FormField } from '@/components/form-field';
import { useJournal } from '@/components/journal/journal-context';
import { UnlockForm } from '@/components/settings/journal-forms';
import { Button } from '@/components/ui/button';
import { controlClass } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { momentCopy } from '@/lib/moment/copy';
import { momentTime, reflectionBlock } from '@/lib/moment/reflection';
import type { Intensity, Practice } from '@/lib/moment/types';
import { auth, localMode } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';
import { IntensityScale } from './intensity-scale';

const maxTrigger = 300;
const nothing = 'nothing';

type SaveCase = 'unlocked' | 'locked' | 'plain' | 'consent' | 'none';

function useSaveCase(): SaveCase {
  const me = useStore(auth.me);
  const mode = useStore(localMode.mode);
  const journal = useJournal();
  const state = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
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
 * Optional reflection at the end of a moment. Whether it can be saved is decided from memory before any field shows;
 * only an unlocked private journal saves, through `appendPrivate`. The draft survives every error.
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
}: {
  heading: string;
  startedAt: Date;
  tile?: string;
  before?: Intensity;
  after?: Intensity;
  tried: Practice[];
  used?: Practice;
  onLeave: () => void;
}) {
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
  const savedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (saved) savedRef.current?.focus();
  }, [saved]);

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const me = auth.me.get();
    if (busy || saveCase !== 'unlocked' || !me) return;
    setBusy(true);
    setProblem(null);
    try {
      await journal.appendPrivate(
        me.localToday,
        reflectionBlock({
          time: momentTime(startedAt, me.timezone),
          tile,
          before: before && momentCopy.intensity[before],
          after: now && momentCopy.intensity[now],
          trigger,
          helped:
            tried.find((practice) => practice.id === helped)?.title ?? momentCopy.nothingHelped,
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
          <Notice tone="success" ref={savedRef} tabIndex={-1} className="focus:outline-none">
            <p>{momentCopy.saved}</p>
          </Notice>
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
              <UnlockForm onUnlocked={setNewPassphrase} />
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
                    {momentCopy.charactersLeft(maxTrigger - trigger.length)}
                  </p>
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
