import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Decorative busy indicator (18 px); pair it with visible text such as "Saving…". */
export function Spinner({ className }: { className?: string }) {
  return <LoaderCircle aria-hidden className={cn('size-[18px] shrink-0 animate-spin', className)} />;
}
