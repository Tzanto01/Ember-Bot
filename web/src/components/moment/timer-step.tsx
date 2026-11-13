import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * A timer with explicit Start and Pause and the remaining time on screen; announces start, pause, resume and end.
 * While `halted` (urgent help open) a running timer pauses silently; the user resumes.
 */
export function TimerStep({ seconds, halted = false }: { seconds: number; halted?: boolean }) {
  useTranslation();
  const labelId = useId();
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (halted) setRunning(false);
  }, [halted]);

  useEffect(() => {
    if (left > 0 || !running) return;
    setRunning(false);
    setAnnounce(momentCopy.timerDone);
  }, [left, running]);

  function toggle(): void {
    if (running) {
      setRunning(false);
      setAnnounce(momentCopy.breathPaused);
      return;
    }
    if (left === 0 || left === seconds) {
      setLeft(seconds);
      setAnnounce(momentCopy.timerStarted(momentCopy.seconds(seconds)));
    } else {
      setAnnounce(momentCopy.timerResumed);
    }
    setRunning(true);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="flex flex-col items-center gap-1">
        <span id={labelId} className="text-muted-foreground">
          {momentCopy.timerLabel}
        </span>
        <span
          role="timer"
          aria-labelledby={labelId}
          className="font-display text-[44px] font-semibold tabular-nums"
        >
          {clock(left)}
        </span>
      </p>
      <Button type="button" variant="secondary" className="min-w-[min(10rem,100%)]" onClick={toggle}>
        {running
          ? momentCopy.pause
          : left === 0
            ? momentCopy.startAgain
            : left < seconds
              ? momentCopy.resume
              : momentCopy.start}
      </Button>
      <LiveRegion message={announce} />
    </div>
  );
}
