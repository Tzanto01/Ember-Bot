import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { momentCopy } from '@/lib/moment/copy';
import type { Intensity } from '@/lib/moment/types';

const levels = [1, 2, 3, 4, 5] as const;

/** The five worded intensity options as a radiogroup named by the element `labelledBy`. */
export function IntensityScale({
  name,
  labelledBy,
  value,
  onChange,
}: {
  name: string;
  labelledBy: string;
  value: Intensity | undefined;
  onChange: (value: Intensity) => void;
}) {
  useTranslation();
  return (
    <RadioGroup
      aria-labelledby={labelledBy}
      value={value ? String(value) : ''}
      onValueChange={(next) => onChange(Number(next) as Intensity)}
      className="flex flex-col gap-2"
    >
      {levels.map((level) => (
        <label
          key={level}
          htmlFor={`${name}-${level}`}
          className="flex min-h-[52px] cursor-pointer items-center gap-3 rounded-lg border-[length:max(1px,var(--border-width))] border-border px-4 text-[18px] has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
        >
          <RadioGroupItem id={`${name}-${level}`} value={String(level)} />
          {momentCopy.intensity[level]}
        </label>
      ))}
    </RadioGroup>
  );
}
