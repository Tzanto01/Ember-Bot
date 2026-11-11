import { useState } from 'react';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { chooseColorScheme, type ColorScheme, colorScheme } from '@/lib/theme';

const choices: { id: ColorScheme; label: string }[] = [
  { id: 'system', label: 'System' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

/** Settings → Appearance: System, Light or Dark for this device; applies at once. */
export function ColorSchemePicker() {
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
        Light or dark
      </p>
      <RadioGroup
        aria-labelledby="color-scheme-label"
        aria-describedby="color-scheme-hint"
        value={scheme}
        onValueChange={choose}
        className="grid grid-cols-3 gap-2"
      >
        {choices.map((choice) => (
          <label
            key={choice.id}
            htmlFor={`color-scheme-${choice.id}`}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border-[length:max(1px,var(--border-width))] border-border px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
          >
            <RadioGroupItem id={`color-scheme-${choice.id}`} value={choice.id} />
            {choice.label}
          </label>
        ))}
      </RadioGroup>
      <p id="color-scheme-hint" className="text-[14px] text-muted-foreground">
        System follows your device. This choice stays on this device.
      </p>
    </div>
  );
}
