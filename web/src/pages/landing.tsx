import { BellRing, LockKeyhole, Moon, Smartphone } from 'lucide-react';
import { Link } from 'react-router';
import { DayCell, joinsRun } from '@/components/day-cell';
import { FlameMark } from '@/components/flame-mark';
import { LegalLinks } from '@/components/legal-links';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { DayState } from '@/lib/models';

const sampleWeek: DayState[] = ['done', 'done', 'lowday', 'done', 'pending'];

const features = [
  {
    icon: BellRing,
    title: 'Reminders in your Discord DMs',
    text: 'A nudge at your local time with Done, Skip and Snooze buttons. Forgot yesterday? A gentle check-in lets you log it the next day.',
  },
  {
    icon: Smartphone,
    title: 'On the web and on Android',
    text: 'Check in from any browser, or use the Android app with reminders that work offline and a home-screen widget.',
  },
  {
    icon: Moon,
    title: 'Streaks that bend',
    text: 'Daily, weekdays, a few times a week or several times a day. Call a hard day a low day and your streak stays safe.',
  },
  {
    icon: LockKeyhole,
    title: 'Private by design',
    text: 'Try it without an account and your data stays on this device. Keep an end-to-end encrypted journal, and export everything any time.',
  },
];

/** `/` for signed-out visitors on the web: what Ember is, four highlights, and the ways in. */
export default function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col bg-[radial-gradient(60rem_30rem_at_50%_-10rem,var(--notice),transparent_70%)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <header className="mx-auto flex w-full max-w-[72rem] px-4 pt-4 lg:px-6">
        <span className="inline-flex min-h-[44px] items-center gap-2 font-display text-[22px] font-bold text-foreground">
          <FlameMark />
          Ember
        </span>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-[72rem] flex-1 flex-col gap-12 px-4 py-8 focus:outline-none lg:gap-16 lg:px-6 lg:py-14"
      >
        <section className="grid items-center gap-8 lg:grid-cols-12 lg:gap-10">
          <div className="flex flex-col gap-6 lg:col-span-7">
            <div className="flex flex-col gap-3">
              <h1 tabIndex={-1} className="text-[36px] focus:outline-none md:text-[48px]">
                A calm place for your habits.
              </h1>
              <p className="max-w-[36rem] text-[18px] text-muted-foreground">
                Ember reminds you kindly, counts what you did, and never makes you feel bad about a
                hard day. No streak is worth burning yourself out for.
              </p>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button asChild>
                <Link to="/signup">Create account</Link>
              </Button>
              <Button asChild variant="secondary">
                <Link to="/login">Sign in</Link>
              </Button>
              <Button asChild variant="ghost">
                <Link to="/local">Try without an account</Link>
              </Button>
            </div>
            <p className="text-[14px] text-muted-foreground">
              Sign in with email and password, or with Discord.
            </p>
          </div>
          <Card aria-hidden="true" className="gap-4 lg:col-span-5 lg:p-8">
            <div className="flex items-baseline justify-between gap-3">
              <p className="font-display text-[20px] font-semibold">Drink a glass of water</p>
              <p className="text-[14px] text-muted-foreground">3-day streak</p>
            </div>
            <div className="grid grid-cols-5 [--day-gap:8px] gap-[8px]">
              {sampleWeek.map((state, i) => (
                <DayCell key={i} state={state} runToNext={joinsRun(state, sampleWeek[i + 1])} />
              ))}
            </div>
            <p className="text-[14px] text-muted-foreground">
              One low day in between, and the streak held.
            </p>
          </Card>
        </section>
        <section aria-labelledby="landing-features" className="flex flex-col gap-6">
          <h2 id="landing-features" className="text-[24px] md:text-[28px]">
            What Ember does
          </h2>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {features.map(({ icon: Icon, title, text }) => (
              <li key={title}>
                <Card className="h-full">
                  <Icon aria-hidden className="size-[24px] text-primary" />
                  <h3 className="text-[18px]">{title}</h3>
                  <p className="text-muted-foreground">{text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      </main>
      <footer className="px-4 pb-4">
        <LegalLinks />
      </footer>
    </div>
  );
}
