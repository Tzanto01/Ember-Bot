import { Check, ChevronDown } from 'lucide-react';
import { Select as SelectPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { controlClass } from './input';

/** shadcn Select root (radix). Compose with `SelectTrigger`, `SelectValue`, `SelectContent` and `SelectItem`. */
export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

/** The 44 px field that opens the list; give it the `id` the `Label` points at. */
export function SelectTrigger({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(controlClass, 'flex items-center justify-between gap-2 text-left', className)}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDown aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

/** The popover list, as wide as the trigger. */
export function SelectContent({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        position="popper"
        sideOffset={4}
        className={cn(
          'z-50 max-h-[var(--radix-select-content-available-height)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-card',
          className,
        )}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

/** One option: 44 px row, `--accent` while focused, a check on the chosen one. */
export function SelectItem({ className, children, ...props }: ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex min-h-[44px] cursor-default items-center rounded-sm py-2 pr-3 pl-9 text-base outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground',
        className,
      )}
      {...props}
    >
      <SelectPrimitive.ItemIndicator className="absolute left-3 inline-flex">
        <Check aria-hidden className="size-[16px]" />
      </SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

/** A plain native `<select>` with the same look, for simple option lists. */
export function NativeSelect({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'cursor-pointer', className)} {...props} />;
}
