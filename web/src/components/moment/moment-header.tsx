import { LifeBuoy } from 'lucide-react';
import { useId } from 'react';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { Button } from '@/components/ui/button';
import { momentCopy } from '@/lib/moment/copy';

/** The moment flow's persistent header: Leave, and "Urgent help" opening the crisis lines in place. */
export function MomentHeader({
  onLeave,
  open,
  onToggle,
}: {
  onLeave: () => void;
  open: boolean;
  onToggle: () => void;
}) {
  const panelId = useId();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="ghost" className="-ml-2" onClick={onLeave}>
          {momentCopy.leave}
        </Button>
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
        >
          <LifeBuoy aria-hidden />
          {momentCopy.urgentHelp}
        </Button>
      </div>
      <div id={panelId} hidden={!open} className="rounded-lg border border-border p-4">
        {open && <CrisisLines />}
      </div>
    </div>
  );
}
