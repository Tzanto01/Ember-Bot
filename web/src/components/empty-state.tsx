import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  /** Small inline SVG drawn with token colours; rendered `aria-hidden`. */
  illustration?: ReactNode;
  title: string;
  /** The supporting text. */
  children?: ReactNode;
  /** Usually one primary Button link. */
  action?: ReactNode;
  className?: string;
}

/** Friendly empty view: illustration, `h2`, text and an action, centred. */
export function EmptyState({ illustration, title, children, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-4 py-8 text-center', className)}>
      {illustration && (
        <div aria-hidden="true" data-calm-hide>
          {illustration}
        </div>
      )}
      <h2 className="text-[22px] text-foreground">{title}</h2>
      {children && <div className="max-w-[38rem] text-muted-foreground">{children}</div>}
      {action && <div className="mt-2 flex w-full flex-col items-center gap-3">{action}</div>}
    </div>
  );
}
