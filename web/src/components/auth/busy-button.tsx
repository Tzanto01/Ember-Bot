import type { ComponentProps, ReactNode } from 'react';
import { Link } from 'react-router';
import { Spinner } from '@/components/spinner';
import { Button, type ButtonProps } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/** Button that shows a spinner and `busyLabel` while `busy`, and stays focusable but inert (`aria-disabled`) meanwhile. */
export function BusyButton({
  busy,
  busyLabel,
  children,
  ...props
}: Omit<ButtonProps, 'asChild'> & { busy: boolean; busyLabel: ReactNode }) {
  return (
    <Button {...props} aria-disabled={busy || undefined}>
      {busy ? (
        <>
          <Spinner />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

/** Router link styled as a text link with a 44 px tall target. */
export function TapLink({ className, ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn('inline-flex min-h-[44px] items-center font-medium text-primary underline underline-offset-4', className)}
      {...props}
    />
  );
}
