import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { reminderNames } from '@/lib/native/reminder-names';
import { useStore } from '@/lib/store';

/** Native only: the per-device "Show habit names in reminders" switch, bound to `reminderNames`. */
export function ReminderNamesSetting() {
  const { t } = useTranslation();
  const id = useId();
  const on = useStore(reminderNames);
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <Label htmlFor={id}>{t('settings.reminderNames.label')}</Label>
        <p id={`${id}-hint`} className="text-[0.875rem] text-muted-foreground">
          {t('settings.reminderNames.hint')}
        </p>
      </div>
      <Switch
        id={id}
        checked={on}
        aria-describedby={`${id}-hint`}
        onCheckedChange={(checked) => reminderNames.set(checked)}
        className="mt-[2px]"
      />
    </div>
  );
}
