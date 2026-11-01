import { Switch as SwitchPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** shadcn Switch: 44 × 26 px track with a 44 px tall hit area, `--primary` when on. */
export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        'relative inline-flex h-[26px] w-[44px] shrink-0 items-center rounded-full border-[length:max(1.5px,var(--border-width))] border-input bg-muted p-[2px] transition-colors after:absolute after:-inset-y-[9px] after:inset-x-0 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-[18px] rounded-full bg-card shadow-card transition-transform data-[state=checked]:translate-x-[18px]" />
    </SwitchPrimitive.Root>
  );
}
