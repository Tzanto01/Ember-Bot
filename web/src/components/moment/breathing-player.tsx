import { useEffect, useReducer } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveRegion } from '@/components/live-region';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';
import { cn } from '@/lib/utils';
import { useReduceMotion } from './use-reduce-motion';

interface Phase {
  label: string;
  seconds: number;
  from: number;
  to: number;
}

interface Player {
  running: boolean;
  started: boolean;
  finished: boolean;
  phase: number;
  round: number;
  left: number;
  announce: string;
}

/** Where the player is: before Start, breathing, paused mid-way, or all rounds done. */
export type BreathStatus = 'ready' | 'running' | 'paused' | 'done';

const small = 0.6;

function phasesOf(inhale: number, hold: number, exhale: number): Phase[] {
  return [
    { label: momentCopy.breatheIn, seconds: inhale, from: small, to: 1 },
    { label: momentCopy.hold, seconds: hold, from: 1, to: 1 },
    { label: momentCopy.breatheOut, seconds: exhale, from: 1, to: small },
  ].filter((phase) => phase.seconds > 0);
}

/**
 * Paced-breathing player: explicit Start and Pause, phases as visible text, one polite announcement per phase change
 * (the inhale names the round, so repeats still announce). The circle is decorative and doesn't scale under reduced
 * motion. Start is the primary action until the breathing runs or is done; `onStatusChange` reports each status so
 * the page can move the emphasis to Next.
 */
export function BreathingPlayer({
  inhale,
  hold,
  exhale,
  rounds,
  halted = false,
  onStatusChange,
}: {
  inhale: number;
  hold: number;
  exhale: number;
  rounds: number;
  /** While true (urgent help open), a running player pauses silently; the user resumes. */
  halted?: boolean;
  onStatusChange?: (status: BreathStatus) => void;
}) {
  useTranslation();
  const phases = phasesOf(inhale, hold, exhale);
  const reduce = useReduceMotion();

  function enter(state: Player, phase: number, round: number): Player {
    const { label, seconds } = phases[phase]!;
    const text = `${label}, ${seconds}`;
    return {
      ...state,
      phase,
      round,
      left: seconds,
      announce: phase === 0 ? `${momentCopy.round(round, rounds)}. ${text}` : text,
    };
  }

  const [player, dispatch] = useReducer(
    (state: Player, action: 'toggle' | 'tick' | 'halt'): Player => {
      if (action === 'halt') return state.running ? { ...state, running: false } : state;
      if (action === 'toggle') {
        if (state.running) return { ...state, running: false, announce: momentCopy.breathPaused };
        if (state.started && !state.finished)
          return {
            ...state,
            running: true,
            announce: `${phases[state.phase]!.label}, ${state.left}`,
          };
        return enter({ ...state, running: true, started: true, finished: false }, 0, 1);
      }
      if (!state.running) return state;
      if (state.left > 1) return { ...state, left: state.left - 1 };
      if (state.phase + 1 < phases.length) return enter(state, state.phase + 1, state.round);
      if (state.round < rounds) return enter(state, 0, state.round + 1);
      return { ...state, running: false, finished: true, left: 0, announce: momentCopy.breathDone };
    },
    { running: false, started: false, finished: false, phase: 0, round: 1, left: 0, announce: '' },
  );

  useEffect(() => {
    if (halted) dispatch('halt');
  }, [halted]);

  useEffect(() => {
    if (!player.running) return;
    const id = setInterval(() => dispatch('tick'), 1000);
    return () => clearInterval(id);
  }, [player.running]);

  const status: BreathStatus = player.running
    ? 'running'
    : player.finished
      ? 'done'
      : player.started
        ? 'paused'
        : 'ready';

  useEffect(() => {
    onStatusChange?.(status);
  }, [status, onStatusChange]);

  const active = player.started && !player.finished;
  const phase = phases[player.phase]!;
  const scale = active
    ? phase.from +
      (phase.to - phase.from) * Math.min(1, (phase.seconds - player.left + 1) / phase.seconds)
    : small;

  return (
    <div data-breath={status} className="flex flex-col items-center gap-6">
      <div
        aria-hidden="true"
        data-calm-hide
        className="flex size-[200px] max-w-[60vw] items-center justify-center"
      >
        <div
          data-testid="breath-circle"
          className={cn(
            'size-full rounded-full border-2 border-primary bg-[color-mix(in_oklch,var(--primary)_22%,transparent)]',
            reduce && active && phase.to < phase.from && 'opacity-60',
          )}
          style={
            reduce ? undefined : { transform: `scale(${scale})`, transition: 'transform 1s linear' }
          }
        />
      </div>
      <div className="flex min-h-[4.5rem] flex-col items-center gap-1 text-center">
        {active && (
          <>
            <p className="font-display text-[1.75rem] font-semibold">
              {phase.label}, {player.left}
            </p>
            <p className="text-muted-foreground">{momentCopy.round(player.round, rounds)}</p>
          </>
        )}
        {player.finished && <p className="font-display text-[1.375rem]">{momentCopy.breathDone}</p>}
        {!player.running && active && (
          <p className="text-muted-foreground">{momentCopy.breathPaused}</p>
        )}
      </div>
      <Button
        type="button"
        variant={status === 'running' || status === 'done' ? 'secondary' : 'default'}
        className="min-w-[min(10rem,100%)]"
        onClick={() => dispatch('toggle')}
      >
        {player.running
          ? momentCopy.pause
          : player.finished
            ? momentCopy.startAgain
            : player.started
              ? momentCopy.resume
              : momentCopy.start}
      </Button>
      <LiveRegion message={player.announce} />
    </div>
  );
}
