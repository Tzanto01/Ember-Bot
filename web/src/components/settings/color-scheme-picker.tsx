import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { chooseColorScheme, type ColorScheme, colorScheme } from '@/lib/theme';

const choices = [
  { id: 'system', label: 'settings.colorScheme.system' },
  { id: 'light', label: 'settings.colorScheme.light' },
  { id: 'dark', label: 'settings.colorScheme.dark' },
] as const satisfies readonly { id: ColorScheme; label: string }[];

/** Settings → Appearance: System, Light or Dark for this device; applies at once. */
export function ColorSchemePicker() {
  const { t } = useTranslation();
  const [scheme, setScheme] = useState(colorScheme);

  function choose(value: string): void {
    const next = choices.find((choice) => choice.id === value)?.id;
    if (!next) return;
    chooseColorScheme(next);
    setScheme(next);
  }

  return (
    <div className="flex flex-col gap-2">
      <p id="color-scheme-label" className="font-medium">
        {t('settings.colorScheme.label')}
      </p>
      <RadioGroup
        aria-labelledby="color-scheme-label"
        aria-describedby="color-scheme-hint"
        value={scheme}
        onValueChange={choose}
        className="flex flex-wrap gap-2"
      >
        {choices.map((choice) => (
          <label
            key={choice.id}
            htmlFor={`color-scheme-${choice.id}`}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border-[length:max(1px,var(--border-width))] border-border px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
          >
            <RadioGroupItem id={`color-scheme-${choice.id}`} value={choice.id} />
            {t(choice.label)}
          </label>
        ))}
      </RadioGroup>
      <p id="color-scheme-hint" className="text-[14px] text-muted-foreground">
        {t('settings.colorScheme.hint')}
      </p>
    </div>
  );
}
