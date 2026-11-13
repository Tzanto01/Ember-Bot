import { Eye, EyeOff } from 'lucide-react';
import { type ComponentProps, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';

/** Shared look of text-like controls: 44 px, 16 px text, `--input` edge, `--destructive` edge while invalid. */
export const controlClass =
  'min-h-[44px] w-full rounded-md border-[length:max(1px,var(--border-width))] border-input bg-card px-3 py-2 text-base text-card-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive';

/** shadcn Input. Pair it with `FormField` for the label, hint and error wiring. */
export function Input({ className, type = 'text', ...props }: ComponentProps<'input'>) {
  return <input type={type} className={cn(controlClass, className)} {...props} />;
}

/** A password {@link Input} with a "Show password" toggle button (`aria-pressed`) that reveals what was typed. */
export function PasswordInput({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={cn('pr-12', className)} />
      <button
        type="button"
        aria-label={t('form.showPassword')}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
        className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        {shown ? <EyeOff aria-hidden className="size-5" /> : <Eye aria-hidden className="size-5" />}
      </button>
    </div>
  );
}
