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
      <Link to="/moment" className={cn(buttonVariants(), 'min-h-[56px] gap-3 px-6 text-[1.125rem]')}>
        <Flame aria-hidden />
        {label}
      </Link>
    );
  }

  return (
    <Link
      to="/moment"
      className="flex min-h-[64px] w-full items-center gap-3 rounded-xl border-[length:var(--border-width)] border-border bg-secondary p-4 text-secondary-foreground no-underline transition-colors duration-[var(--ember-dur-fast)] hover:bg-accent hover:text-accent-foreground"
    >
      <span
        aria-hidden
        className="inline-flex size-[40px] shrink-0 items-center justify-center rounded-full bg-card text-primary"
      >
        <Flame className="size-[20px]" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="font-semibold">{label}</span>
        <span className="text-[0.875rem] text-muted-foreground">{t('moment.door.lede')}</span>
      </span>
    </Link>
  );
}
