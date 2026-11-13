import { useEffect, useState } from 'react';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** A timer with explicit Start and Pause and the remaining time on screen; announces only its start and its end. */
export function TimerStep({ seconds }: { seconds: number }) {
  const [left, setLeft] = useState(seconds);
  const [running, setRunning] = useState(false);
  const [announce, setAnnounce] = useState('');

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setLeft((value) => Math.max(0, value - 1)), 1000);
    return () => clearInterval(id);
  }, [running]);

  useEffect(() => {
    if (left > 0 || !running) return;
    setRunning(false);
    setAnnounce(momentCopy.timerDone);
  }, [left, running]);

  function toggle(): void {
    if (running) {
      setRunning(false);
      return;
    }
    if (left === 0 || left === seconds) {
      setLeft(seconds);
      setAnnounce(momentCopy.timerStarted(`${seconds} seconds`));
    }
    setRunning(true);
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <p className="flex flex-col items-center gap-1">
        <span className="text-muted-foreground">{momentCopy.timerLabel}</span>
        <span role="timer" className="font-display text-[44px] font-semibold tabular-nums">
          {clock(left)}
        </span>
      </p>
      <Button type="button" variant="secondary" className="min-w-[10rem]" onClick={toggle}>
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
