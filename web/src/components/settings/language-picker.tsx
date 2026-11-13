import { useTranslation } from 'react-i18next';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { isLanguage, type Language } from '@/lib/i18n';

const choices: { id: Language; label: string }[] = [
  { id: 'en', label: 'English' },
  { id: 'de', label: 'Deutsch' },
];

/** Settings → Appearance: English or Deutsch, each named in its own language; `onChoose` applies and saves it. */
export function LanguagePicker({
  local,
  onChoose,
}: {
  local: boolean;
  onChoose: (language: Language) => void;
}) {
  const { t, i18n } = useTranslation();

  function choose(value: string): void {
    if (isLanguage(value) && value !== i18n.language) onChoose(value);
  }

  return (
    <div className="flex flex-col gap-2">
      <p id="language-label" className="font-medium">
        {t('language.label')}
      </p>
      <RadioGroup
        aria-labelledby="language-label"
        aria-describedby="language-hint"
        value={i18n.language}
        onValueChange={choose}
        className="flex flex-wrap gap-2"
      >
        {choices.map((choice) => (
          <label
            key={choice.id}
            htmlFor={`language-${choice.id}`}
            lang={choice.id}
            className="flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border-[length:max(1px,var(--border-width))] border-border px-3 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-accent has-[[data-state=checked]]:text-accent-foreground has-[[data-state=checked]]:ring-1 has-[[data-state=checked]]:ring-primary"
          >
            <RadioGroupItem id={`language-${choice.id}`} value={choice.id} />
            {choice.label}
          </label>
        ))}
      </RadioGroup>
      <p id="language-hint" className="text-[14px] text-muted-foreground">
        {local ? t('language.hintDevice') : t('language.hintAccount')}
      </p>
    </div>
  );
}
