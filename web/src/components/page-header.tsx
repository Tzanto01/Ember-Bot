import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface PageHeaderProps {
  /** The screen's single `h1` (28 px, 36 px from `md`); the router focuses it after navigation. */
  title: ReactNode;
  lede?: ReactNode;
  /** Content to the right of the heading, for example the Today's ember summary on small screens. */
  aside?: ReactNode;
  className?: string;
}

/** Page heading block: `h1`, optional muted lede, optional aside. */
export function PageHeader({ title, lede, aside, className }: PageHeaderProps) {
  return (
    <header className={cn('flex items-start justify-between gap-4', className)}>
      <div className="flex min-w-0 flex-col gap-2">
        <h1 tabIndex={-1} className="text-[28px] [overflow-wrap:anywhere] focus:outline-none md:text-[36px]">
          {title}
        </h1>
        {lede && <p className="max-w-[38rem] text-muted-foreground">{lede}</p>}
      </div>
      {aside}
    </header>
  );
}
