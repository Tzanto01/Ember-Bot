import { type ReactNode, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { useFocusHeadingOnChange } from '@/components/auth/use-field';
import { BreathingPlayer } from '@/components/moment/breathing-player';
import { IntensityScale } from '@/components/moment/intensity-scale';
import { MomentHeader } from '@/components/moment/moment-header';
import { Reflect } from '@/components/moment/reflect';
import { TimerStep } from '@/components/moment/timer-step';
import { HearthIllustration } from '@/components/today/hearth-illustration';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';
import { breathingPractice, practices, practicesFor } from '@/lib/moment/practices';
import type { Intensity, MomentState, Practice } from '@/lib/moment/types';

type Step =
  | { kind: 'catch' }
  | { kind: 'name' }
  | { kind: 'intensity' }
  | { kind: 'practice'; index: number }
  | { kind: 'after' }
  | { kind: 'end' }
  | { kind: 'reflect' };

const headingId = 'moment-heading';

const states = Object.keys(momentCopy.tiles) as MomentState[];

function Heading({
  eyebrow,
  children,
  large,
}: {
  eyebrow?: string;
  children: ReactNode;
  large?: boolean;
}) {
  return (
    <h1 id={headingId} tabIndex={-1} className="flex flex-col gap-2 focus:outline-none">
      {eyebrow && (
        <span className="font-sans text-base font-normal text-muted-foreground">{eyebrow}</span>
      )}
      <span
        className={large ? 'text-[26px] leading-snug md:text-[32px]' : 'text-[28px] md:text-[36px]'}
      >
        {children}
      </span>
    </h1>
  );
}

/** `/moment`, public: the "I need a moment" flow (Catch, Name, Ride it out, optional Reflect). State lives in memory only. */
export default function MomentPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [startedAt] = useState(() => new Date());
  const [step, setStep] = useState<Step>({ kind: 'catch' });
  const [named, setNamed] = useState<MomentState>();
  const [before, setBefore] = useState<Intensity>();
  const [after, setAfter] = useState<Intensity>();
  const [practice, setPractice] = useState<Practice>(breathingPractice);
  const [tried, setTried] = useState<Practice[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [draft, setDraft] = useState(false);

  useFocusHeadingOnChange(
    step.kind === 'practice' ? `practice:${practice.id}:${step.index}` : step.kind,
  );

  function leave(): void {
    if (location.key !== 'default') void navigate(-1);
    else void navigate('/');
  }

  function begin(next: Practice): void {
    setPractice(next);
    setTried((list) => (list.includes(next) ? list : [...list, next]));
    setStep({ kind: 'practice', index: 0 });
  }

  function candidates(): Practice[] {
    const matching = named ? practicesFor(named) : [];
    return [...matching, ...practices.filter((p) => !matching.includes(p))];
  }

  function tryAnother(): void {
    const list = candidates();
    setAfter(undefined);
    begin(list[(list.indexOf(practice) + 1) % list.length]!);
  }

  function pickTile(state: MomentState): void {
    setNamed(state);
    setStep({ kind: 'intensity' });
  }

  function rideItOut(): void {
    begin(named ? practicesFor(named)[0]! : breathingPractice);
  }

  let body: ReactNode;
  switch (step.kind) {
    case 'catch':
      body = (
        <div className="flex flex-col items-center gap-8 text-center">
          <div className="opacity-80">
            <HearthIllustration />
          </div>
          <Heading>{momentCopy.catchHeading}</Heading>
          <div className="flex w-full flex-col gap-3">
            <Button
              type="button"
              block
              className="min-h-[56px] text-[18px]"
              onClick={() => setStep({ kind: 'name' })}
            >
              {momentCopy.catchName}
            </Button>
            <Button
              type="button"
              variant="secondary"
              block
              className="min-h-[56px] text-[18px]"
              onClick={() => begin(breathingPractice)}
            >
              {momentCopy.catchBreathe}
            </Button>
          </div>
        </div>
      );
      break;
    case 'name':
      body = (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Heading>{momentCopy.nameHeading}</Heading>
            <p className="text-muted-foreground">{momentCopy.nameLede}</p>
          </div>
          <ul className="flex flex-col gap-3">
            {states.map((state) => (
              <li key={state}>
                <Button
                  type="button"
                  variant="outline"
                  block
                  className="min-h-[56px] justify-start text-left text-[18px]"
                  onClick={() => pickTile(state)}
                >
                  {momentCopy.tiles[state]}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      );
      break;
    case 'intensity':
    case 'after': {
      const isBefore = step.kind === 'intensity';
      body = (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Heading>{isBefore ? momentCopy.intensityHeading : momentCopy.afterHeading}</Heading>
            <p className="text-muted-foreground">
              {isBefore ? momentCopy.intensityLede : momentCopy.afterLede}
            </p>
          </div>
          <IntensityScale
            name={step.kind}
            labelledBy={headingId}
            value={isBefore ? before : after}
            onChange={isBefore ? setBefore : setAfter}
          />
          <div className="flex flex-wrap gap-3">
            <Button
              type="button"
              onClick={() => (isBefore ? rideItOut() : setStep({ kind: 'end' }))}
            >
              {momentCopy.continue}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                if (isBefore) {
                  setBefore(undefined);
                  rideItOut();
                } else {
                  setAfter(undefined);
                  setStep({ kind: 'end' });
                }
              }}
            >
              {momentCopy.skip}
            </Button>
          </div>
        </div>
      );
      break;
    }
    case 'practice': {
      const current = practice.steps[step.index]!;
      const last = step.index === practice.steps.length - 1;
      body = (
        <div className="flex flex-col gap-8">
          <Heading
            eyebrow={momentCopy.stepOf(practice.title, step.index + 1, practice.steps.length)}
            large
          >
            {current.kind === 'breath' ? momentCopy.breathHeading : current.text}
          </Heading>
          {current.kind === 'breath' && (
            <BreathingPlayer key={`${practice.id}:${step.index}`} {...current} halted={helpOpen} />
          )}
          {current.kind === 'timer' && (
            <TimerStep
              key={`${practice.id}:${step.index}`}
              seconds={current.seconds}
              halted={helpOpen}
            />
          )}
          <div className="flex flex-col gap-3">
            <div className="flex gap-3">
              {step.index > 0 && (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => setStep({ kind: 'practice', index: step.index - 1 })}
                >
                  {momentCopy.back}
                </Button>
              )}
              <Button
                type="button"
                className="flex-1"
                onClick={() =>
                  setStep(last ? { kind: 'after' } : { kind: 'practice', index: step.index + 1 })
                }
              >
                {last ? momentCopy.finish : momentCopy.next}
              </Button>
            </div>
            <div className="flex flex-wrap justify-between gap-3">
              <Button type="button" variant="ghost" onClick={tryAnother}>
                {momentCopy.tryAnother}
              </Button>
              {!last && (
                <Button type="button" variant="ghost" onClick={() => setStep({ kind: 'after' })}>
                  {momentCopy.skipPractice}
                </Button>
              )}
            </div>
          </div>
        </div>
      );
      break;
    }
    case 'end':
      body = (
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-2">
            <Heading>{momentCopy.endHeading}</Heading>
            <p className="text-muted-foreground">{momentCopy.endLede}</p>
          </div>
          <div className="flex flex-col gap-3">
            <Button type="button" block onClick={() => setStep({ kind: 'reflect' })}>
              {momentCopy.reflect}
            </Button>
            <Button type="button" variant="outline" block onClick={tryAnother}>
              {momentCopy.tryAnother}
            </Button>
            <Button type="button" variant="ghost" block onClick={leave}>
              {momentCopy.done}
            </Button>
          </div>
        </div>
      );
      break;
    case 'reflect':
      body = (
        <Reflect
          heading={momentCopy.reflectHeading}
          startedAt={startedAt}
          tile={named && momentCopy.tiles[named]}
          before={before}
          after={after}
          tried={tried}
          used={practice}
          onLeave={leave}
          onDraft={setDraft}
        />
      );
      break;
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <MomentHeader
        onLeave={leave}
        open={helpOpen}
        onToggle={() => setHelpOpen((value) => !value)}
        draft={step.kind === 'reflect' && draft}
      />
      {body}
    </div>
  );
}
