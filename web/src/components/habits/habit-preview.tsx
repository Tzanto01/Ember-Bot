import { DayCell } from '@/components/day-cell';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Decorative preview (`aria-hidden`) of the row the form will put on Today: the typed name and its cadence. */
export function HabitPreview({ name, cadence, className }: { name: string; cadence: string; className?: string }) {
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
      <p className="text-[14px] text-muted-foreground">On your Today page</p>
      <Card className="flex-row items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="truncate font-display text-[18px] text-foreground">{name.trim() || 'Your habit'}</p>
          <p className="text-[14px] text-muted-foreground">{cadence}</p>
        </div>
        <DayCell state="pending" size="slot" />
      </Card>
    </div>
  );
}
