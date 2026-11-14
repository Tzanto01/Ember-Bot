import { Info } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

/** Default field validation messages, in the current language. */
export const fieldMessages = {
  get required() {
    return t('form.required');
  },
  get email() {
    return t('form.email');
  },
  minLength: (length: number) => t('form.minLength', { count: length }),
  maxLength: (length: number) => t('form.maxLength', { count: length }),
};

/** Attributes `FormField` hands to its control. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  /** Set on fields that aren't marked optional. */
  'aria-required'?: true;
}

export interface FormFieldProps {
  label: string;
  /** Shown under the label and linked with `aria-describedby`. */
  hint?: string;
  /** Shows "(optional)" after the label. */
  optional?: boolean;
  /**
   * The message to show, or null. The page decides when (after blur or submit); a client error wins over a
   * server error from `problemToMessage(...).fields`.
   */
  error?: string | null;
  /** Fixed control id; generated when omitted. */
  id?: string;
  className?: string;
  /** Renders the control; spread the given props onto it. */
  children: (control: FieldControlProps) => ReactNode;
}

/**
 * Labelled form field: Label above, hint under the label, the control, then the error with an info icon in
 * `--destructive` (announced as an alert). Wires `id`, `aria-describedby`, `aria-invalid` and, unless optional,
 * `aria-required` onto the control.
 *
 * ```tsx
 * <FormField label="Email" error={errors.email}>
 *   {(field) => <Input {...field} type="email" autoComplete="email" value={email} onChange={…} />}
 * </FormField>
 * ```
 */
export function FormField({ label, hint, optional, error, id, className, children }: FormFieldProps) {
  const { t } = useTranslation();
  const generated = useId();
  const inputId = id ?? `field-${generated}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={inputId}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> {t('form.optional')}</span>}
      </Label>
      {hint && (
        <p id={hintId} className="-mt-1 text-[0.875rem] text-muted-foreground">
          {hint}
        </p>
      )}
      {children({
        id: inputId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
        ...(optional ? {} : { 'aria-required': true as const }),
      })}
      {error && (
        <p id={errorId} role="alert" className="flex items-start gap-2 text-[0.875rem] text-destructive">
          <Info aria-hidden className="mt-[2px] size-[18px] shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}

/** Focuses the first control marked `aria-invalid="true"` inside `root`; call after a failed submit. */
export function focusFirstInvalid(root: ParentNode | null): void {
  root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
}
