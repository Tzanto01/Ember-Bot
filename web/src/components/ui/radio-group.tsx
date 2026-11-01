import { RadioGroup as RadioGroupPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn RadioGroup root (a `radiogroup`; name it with `aria-labelledby` or wrap it in a `fieldset`). */
export function RadioGroup({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Root>) {
  return <RadioGroupPrimitive.Root className={cn('grid gap-3', className)} {...props} />;
}

/** One 24 px radio with an invisible 44 px hit area; label it with a `Label htmlFor`. */
export function RadioGroupItem({ className, ...props }: ComponentProps<typeof RadioGroupPrimitive.Item>) {
  return (
    <RadioGroupPrimitive.Item
      className={cn(
        'relative inline-flex size-[24px] shrink-0 items-center justify-center rounded-full border-[length:max(1.5px,var(--border-width))] border-input bg-card after:absolute after:-inset-[10px] disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary',
        className,
      )}
      {...props}
    >
      <RadioGroupPrimitive.Indicator className="size-[12px] rounded-full bg-primary" />
    </RadioGroupPrimitive.Item>
  );
}
