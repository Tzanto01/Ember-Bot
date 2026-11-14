import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { TapLink } from '@/components/auth/busy-button';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * The "I need a moment" entry to `/moment`. `today`: a calm full-width card at the top of Today; `hero`: the large
 * primary call on the landing page; `quiet`: a link-sized door for sign-in and `/local`.
 */
export function MomentDoor({ variant }: { variant: 'today' | 'hero' | 'quiet' }) {
  const { t } = useTranslation();
  const label = t('moment.door.label');

  if (variant === 'quiet') return <TapLink to="/moment">{label}</TapLink>;

  if (variant === 'hero') {
    return (
      <Link to="/moment" className={cn(buttonVariants(), 'isolate min-h-[56px] gap-3 px-6 text-[1.125rem]')}>
        <span aria-hidden className="relative inline-flex">
          <span data-calm-hide className="ember-halo absolute -inset-2 -z-10 rounded-full opacity-50" />
          <Flame className="ember-fire" />
        </span>
        {label}
      </Link>
    );
  }

  return (
    <Link
      to="/moment"
      className="group relative isolate flex min-h-[64px] w-full items-center gap-3 rounded-xl border-[length:var(--border-width)] border-border bg-secondary p-4 text-secondary-foreground no-underline transition-[color,background-color,scale] duration-[var(--ember-dur-fast)] ease-ember hover:bg-accent hover:text-accent-foreground active:scale-[0.99]"
    >
      <span aria-hidden className="ember-sheen" />
      <span
        aria-hidden
        className="relative inline-flex size-[40px] shrink-0 items-center justify-center rounded-full bg-card text-primary"
      >
        <span
          data-calm-hide
          className="ember-halo absolute -inset-2 -z-10 rounded-full opacity-75 transition-opacity duration-[var(--ember-dur)] group-hover:opacity-100"
        />
        <Flame className="ember-fire size-[20px] transition-transform duration-[var(--ember-dur)] ease-ember group-hover:-translate-y-px" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{label}</span>
        <span className="text-[0.875rem] text-muted-foreground">{t('moment.door.lede')}</span>
      </span>
    </Link>
  );
}
