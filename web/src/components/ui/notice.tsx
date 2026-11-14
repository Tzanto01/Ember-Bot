import { Check, CircleAlert, Info, type LucideIcon, Moon } from 'lucide-react';
import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** `notice` is the calm "something needs attention" tone (honey, never red); the others are informational. */
export type NoticeTone = 'info' | 'success' | 'lowday' | 'notice';

const tones: Record<NoticeTone, { icon: LucideIcon; box: string; iconClass?: string }> = {
  info: { icon: Info, box: 'border-border bg-muted text-foreground', iconClass: 'text-muted-foreground' },
  success: { icon: Check, box: 'border-transparent bg-success text-success-foreground' },
  lowday: { icon: Moon, box: 'border-transparent bg-lowday text-lowday-foreground' },
  notice: { icon: CircleAlert, box: 'border-notice-border bg-notice text-notice-foreground' },
};

export type NoticeProps = Omit<ComponentProps<'div'>, 'role'> & {
  tone?: NoticeTone;
  /** Optional bold first line. */
  heading?: ReactNode;
};

/**
 * Inline message (restyled shadcn Alert) with an icon per tone. `notice` is announced as an alert
 * (`role="alert"`), the other tones as a polite status. Put the text and any action as children.
 */
export function Notice({ tone = 'info', heading, className, children, ...props }: NoticeProps) {
  const { icon: Icon, box, iconClass } = tones[tone];
  return (
    <div
      role={tone === 'notice' ? 'alert' : 'status'}
      data-tone={tone}
      className={cn('flex items-start gap-3 rounded-md border px-4 py-3', box, className)}
      {...props}
    >
      <Icon aria-hidden className={cn('mt-[0.1875rem] size-[1.125rem] shrink-0', iconClass)} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 [overflow-wrap:anywhere]">
        {heading && <p className="font-semibold">{heading}</p>}
        {children}
      </div>
    </div>
  );
}
