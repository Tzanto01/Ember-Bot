import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Static placeholder block in `--muted`, hidden from assistive tech; size it to the content it stands in for. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('rounded-md bg-muted', className)} {...props} />;
}
