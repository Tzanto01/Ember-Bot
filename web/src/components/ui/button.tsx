import { cva, type VariantProps } from 'class-variance-authority';
import { Slot } from 'radix-ui';
import type { ComponentProps, MouseEvent } from 'react';
import { cn } from '@/lib/utils';

export const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md text-center text-base font-medium leading-tight no-underline transition-[color,background-color,border-color,box-shadow,transform] duration-[var(--ember-dur-fast)] ease-ember active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:active:scale-100 [&_svg]:size-[18px] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary)_88%,var(--foreground))]',
        secondary:
          'border-[length:max(1px,var(--border-width))] border-input bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary)_85%,var(--foreground))]',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
        link: 'text-primary underline underline-offset-4 hover:decoration-2',
        destructive:
          'bg-destructive text-destructive-foreground hover:bg-[color-mix(in_oklch,var(--destructive)_88%,var(--foreground))]',
        outline:
          'border-[length:max(1px,var(--border-width))] border-input bg-card text-card-foreground hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'min-h-[44px] px-4 py-2',
        icon: 'size-[44px] p-0',
      },
      block: {
        true: 'w-full',
        false: '',
      },
    },
    compoundVariants: [
      {
        variant: 'secondary',
        size: 'default',
        className:
          'px-[calc(1rem-max(1px,var(--border-width)))] py-[calc(0.5rem-max(1px,var(--border-width)))]',
      },
    ],
    defaultVariants: { variant: 'default', size: 'default', block: false },
  },
);

export type ButtonProps = ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    /** Renders the child element (for example a router `Link`) with the button's look instead of a `<button>`. */
    asChild?: boolean;
  };

/**
 * shadcn Button. Variants `default` (primary), `secondary`, `ghost`, `link`, `destructive` (honey notice family)
 * and `outline`; sizes `default` (44 px min height) and `icon` (44 × 44); `block` for full width.
 * While `aria-disabled` is true, clicks are swallowed (and a submit button does not submit), so a busy action
 * can't run twice while the button stays focusable.
 */
export function Button({ className, variant, size, block, asChild = false, onClick, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : 'button';
  const ariaDisabled = props['aria-disabled'] === true || props['aria-disabled'] === 'true';
  return (
    <Comp
      className={cn(buttonVariants({ variant, size, block }), className)}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (ariaDisabled) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
      {...props}
    />
  );
}
