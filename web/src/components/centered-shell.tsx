import { useTranslation } from 'react-i18next';
import { Link, Outlet, useLocation } from 'react-router';
import { AmbientScene } from '@/components/ambient-scene';
import { BetaBadge } from '@/components/beta-badge';
import { DayCell, joinsRun } from '@/components/day-cell';
import { FlameMark } from '@/components/flame-mark';
import { LegalLinks } from '@/components/legal-links';
import { Card } from '@/components/ui/card';
import { pitch } from '@/content/pitch';
import { useArrival } from '@/lib/arrival';
import type { DayState } from '@/lib/models';
import { cn } from '@/lib/utils';

const sampleWeek: DayState[] = ['done', 'done', 'lowday', 'done', 'pending'];

/**
 * Centred frame without the app nav: brand header linking to `/`, the page in a Card, legal footer.
 * `auth` (sign-up, login, password and email links, consent): from `lg` a decorative brand panel on the left and the
 * form Card (max 28rem) on the right; below `lg` a 48 px flame mark above the Card.
 * `page` (legal, not found): one column, Card max 40rem.
 */
export function CenteredShell({ variant = 'page' }: { variant?: 'auth' | 'page' }) {
  useTranslation();
  const auth = variant === 'auth';
  const { pathname } = useLocation();
  const arriving = useArrival(pathname);
  const still = pathname.startsWith('/legal/');
  const moment = /^\/moment\/?$/.test(pathname);
  return (
    <div
      data-motion={still ? 'off' : undefined}
      className="relative isolate flex min-h-dvh flex-col bg-[radial-gradient(60rem_30rem_at_50%_-10rem,var(--notice),transparent_70%)] pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]"
    >
      <AmbientScene variant={still ? 'still' : moment ? 'moment' : 'full'} />
      <header
        data-motion={moment ? 'off' : undefined}
        className={cn(
          'flex items-center justify-center gap-2 px-4 pt-4',
          auth && 'lg:mx-auto lg:w-full lg:max-w-[72rem] lg:justify-start lg:px-6',
        )}
      >
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center gap-2 font-display text-[1.375rem] font-bold text-foreground no-underline"
        >
          <FlameMark />
          Ember
        </Link>
        <BetaBadge />
      </header>
      <div
        className={cn(
          'mx-auto flex w-full flex-1 flex-col items-center px-4 py-6',
          auth && 'lg:grid lg:max-w-[72rem] lg:grid-cols-12 lg:items-stretch lg:gap-10 lg:px-6',
        )}
      >
        {auth && (
          <div
            aria-hidden="true"
            className="hidden flex-col items-start justify-center gap-6 rounded-xl bg-secondary p-10 text-secondary-foreground lg:col-span-5 lg:flex"
          >
            <FlameMark className="size-[96px]" />
            <p className="font-display text-[1.75rem] leading-tight">{pitch.hero}</p>
            <div className="flex [--day-gap:8px] gap-[8px]">
              {sampleWeek.map((state, i) => (
                <DayCell
                  key={i}
                  state={state}
                  size="slot"
                  runToNext={joinsRun(state, sampleWeek[i + 1])}
                />
              ))}
            </div>
          </div>
        )}
        <main
          id="main"
          tabIndex={-1}
          data-arrive={arriving && !still && !moment ? 'card' : undefined}
          className={cn(
            'flex w-full flex-col items-center gap-4 focus:outline-none',
            auth ? 'max-w-[28rem] lg:col-span-7 lg:max-w-none lg:justify-center' : 'max-w-[40rem]',
          )}
        >
          <Card className={cn('w-full gap-6',auth && 'lg:max-w-[28rem]')}>
            <Outlet />
          </Card>
        </main>
      </div>
      <footer className="px-4 pb-4">
        <LegalLinks />
      </footer>
    </div>
  );
}
