import { Check } from 'lucide-react';
import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn Checkbox: 24 px box with an invisible 44 px hit area, `--input` edge, `--primary` when checked. */
export function Checkbox({ className, ...props }: ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      className={cn(
        'relative inline-flex size-[24px] shrink-0 items-center justify-center rounded-sm border-[length:max(1.5px,var(--border-width))] border-input bg-card after:absolute after:-inset-[10px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
        className,
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator>
        <Check aria-hidden className="size-[18px]" strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}
