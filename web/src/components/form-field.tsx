import { Info } from 'lucide-react';
import { type ReactNode, useId } from 'react';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

/** Default field validation messages. */
export const fieldMessages = {
  required: 'Please fill this in.',
  email: "That doesn't look like an email address yet.",
  minLength: (length: number) => `Use at least ${length} characters.`,
  maxLength: (length: number) => `Keep it to ${length} characters or fewer.`,
};

/** Attributes `FormField` hands to its control. */
export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
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
 * `--destructive`. Wires `id`, `aria-describedby` and `aria-invalid` onto the control.
 *
 * ```tsx
 * <FormField label="Email" error={errors.email}>
 *   {(field) => <Input {...field} type="email" autoComplete="email" value={email} onChange={…} />}
 * </FormField>
 * ```
 */
export function FormField({ label, hint, optional, error, id, className, children }: FormFieldProps) {
  const generated = useId();
  const inputId = id ?? `field-${generated}`;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const describedBy = [hint ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ');
  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <Label htmlFor={inputId}>
        {label}
        {optional && <span className="font-normal text-muted-foreground"> (optional)</span>}
      </Label>
      {hint && (
        <p id={hintId} className="-mt-1 text-[14px] text-muted-foreground">
          {hint}
        </p>
      )}
      {children({
        id: inputId,
        ...(describedBy ? { 'aria-describedby': describedBy } : {}),
        ...(error ? { 'aria-invalid': true as const } : {}),
      })}
      {error && (
        <p id={errorId} className="flex items-start gap-2 text-[14px] text-destructive">
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
