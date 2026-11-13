import { LifeBuoy } from 'lucide-react';
import { type KeyboardEvent, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';

/**
 * The moment flow's persistent header: Leave, and "Urgent help" opening the crisis lines in place. With an unsaved
 * `draft`, Leave first asks inline; Escape or "Keep writing" cancels.
 */
export function MomentHeader({
  onLeave,
  open,
  onToggle,
  draft = false,
}: {
  onLeave: () => void;
  open: boolean;
  onToggle: () => void;
  draft?: boolean;
}) {
  useTranslation();
  const panelId = useId();
  const confirmId = useId();
  const leaveRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [confirming, setConfirming] = useState(false);

  function leave(): void {
    if (!draft) {
      onLeave();
      return;
    }
    flushSync(() => setConfirming(true));
    confirmRef.current?.focus();
  }

  function keepWriting(): void {
    flushSync(() => setConfirming(false));
    leaveRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') keepWriting();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button ref={leaveRef} type="button" variant="ghost" className="-ml-2" onClick={leave}>
          {momentCopy.leave}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <LifeBuoy aria-hidden />
          {momentCopy.urgentHelp}
        </Button>
      </div>
      {confirming && draft && (
        <div
          ref={confirmRef}
          role="group"
          aria-labelledby={`${confirmId}-question`}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          className="flex flex-col gap-3 rounded-lg border border-border p-4 focus:outline-none"
        >
          <p id={`${confirmId}-question`}>{momentCopy.leaveDraft}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={keepWriting}>
              {momentCopy.keepWriting}
            </Button>
            <Button type="button" variant="outline" onClick={onLeave}>
              {momentCopy.leave}
            </Button>
          </div>
        </div>
      )}
      <div id={panelId} hidden={!open} className="rounded-lg border border-border p-4">
        {open && <CrisisLines />}
      </div>
    </div>
  );
}
