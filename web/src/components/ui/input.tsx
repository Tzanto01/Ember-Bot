import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** Shared look of text-like controls: 44 px, 16 px text, `--input` edge, `--destructive` edge while invalid. */
export const controlClass =
  'min-h-[44px] w-full rounded-md border-[length:max(1px,var(--border-width))] border-input bg-card px-3 py-2 text-base text-card-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

/** shadcn Input. Pair it with `FormField` for the label, hint and error wiring. */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(controlClass, className)} {...props} />;
}
