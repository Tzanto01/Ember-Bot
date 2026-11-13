import type { Ref } from 'react';
import type { Field, Validator } from '@/components/auth/use-field';
import type { FieldControlProps } from '@/components/form-field';
import { Input } from '@/components/ui/input';
import { t } from '@/lib/i18n';

/** The digits of an authenticator code, without spaces. */
export function cleanCode(value: string): string {
  return value.replace(/\s/g, '');
}

/** Six digits, spaces allowed. */
export const codeRule: Validator = (value) => {
  const code = cleanCode(value);
  if (!code) return t('twoFactor.code.empty');
  return /^\d{6}$/.test(code) ? null : t('twoFactor.code.invalid');
};

/** Not empty. */
export const recoveryRule: Validator = (value) =>
  value.trim() ? null : t('twoFactor.recovery.empty');

/** Shown when the server turns a code down. */
export function wrongCodeText(): string {
  return t('twoFactor.code.wrong');
}

/** The 6-digit authenticator code control; spread `FormField`'s props and the field onto it. */
export function CodeInput({
  field,
  control,
  ref,
}: {
  field: Field;
  control: FieldControlProps;
  ref?: Ref<HTMLInputElement>;
}) {
  return (
    <Input
      {...control}
      {...field.input}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      spellCheck={false}
      className="max-w-[12rem] font-mono tracking-widest"
    />
  );
}
