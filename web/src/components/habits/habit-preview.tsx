import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** Decorative preview (`aria-hidden`) of the row the form will put on Today: the typed name and its cadence. */
export function HabitPreview({ name, cadence, className }: { name: string; cadence: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <div aria-hidden="true" className={cn('flex flex-col gap-3', className)}>
      <p className="text-[14px] text-muted-foreground">{t('habitFields.preview')}</p>
      <Card className="flex-row items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-[18px] break-words">{name.trim() || t('habitFields.previewName')}</h2>
          <p className="text-[14px] text-muted-foreground">{cadence}</p>
        </div>
        <span className="size-[56px] shrink-0 rounded-cell border-2 border-pending" />
      </Card>
    </div>
  );
}
