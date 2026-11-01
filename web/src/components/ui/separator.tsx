import { Separator as SeparatorPrimitive } from 'radix-ui';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

type SeparatorProps = ComponentProps<typeof SeparatorPrimitive.Root>;

function Line({ className, orientation = 'horizontal', decorative = true, ...props }: SeparatorProps) {
  return (
    <SeparatorPrimitive.Root
      orientation={orientation}
      decorative={decorative}
      className={cn('shrink-0 bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
      {...props}
    />
  );
}

/** shadcn Separator (decorative by default). With `children` it renders a horizontal rule with centred text, for example "or". */
export function Separator({ children, className, ...props }: SeparatorProps) {
  if (children === undefined) return <Line className={className} {...props} />;
  return (
    <div className={cn('flex items-center gap-3 text-[14px] text-muted-foreground', className)}>
      <Line className="flex-1" {...props} />
      <span>{children}</span>
      <Line className="flex-1" {...props} />
    </div>
  );
}
