import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { reminderNames } from '@/lib/native/reminder-names';
import { useStore } from '@/lib/store';

/** Native only: the per-device "Show habit names in reminders" switch, bound to `reminderNames`. */
export function ReminderNamesSetting() {
  const id = useId();
  const on = useStore(reminderNames);
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id}>Show habit names in reminders</Label>
        <p id={`${id}-hint`} className="text-[14px] text-muted-foreground">
          Reminders can show on your lock screen, so by default they only say "Ember". With names
          on, they say which habit or routine is due.
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
