import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

export const cardVariants = cva(
  'rounded-xl border-[length:var(--border-width)] border-border bg-card text-card-foreground shadow-card',
  {
    variants: {
      variant: {
        default: 'flex flex-col gap-3 p-4 md:p-5',
        farewell: 'flex flex-col gap-3 border-notice-border bg-notice p-4 text-notice-foreground md:p-5',
        stat: 'flex flex-col gap-1 bg-secondary p-3 text-secondary-foreground shadow-none',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

/** shadcn Card: `default`, `farewell` (notice background and border, for goodbyes and deletes), `stat` (compact secondary tile). */
export function Card({ className, variant, ...props }: ComponentProps<'div'> & VariantProps<typeof cardVariants>) {
  return <div className={cn(cardVariants({ variant }), className)} {...props} />;
}
