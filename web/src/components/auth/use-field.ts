import { type ChangeEvent, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { fieldMessages, focusFirstInvalid } from '@/components/form-field';

/** Returns the message for an invalid value, or null. */
export type Validator = (value: string) => string | null;

const emailPattern =
  /^(?=.{1,254}$)(?=.{1,64}@)[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-zA-Z0-9!#$%&'*+/=?^_`{|}~-]+)*@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

/** Not empty. */
export const required: Validator = (value) => (value ? null : fieldMessages.required);

/** Not empty and shaped like an email address. */
export const email: Validator = (value) => required(value) ?? (emailPattern.test(value) ? null : fieldMessages.email);

/** Not empty and at least `length` characters. */
export const minLength =
  (length: number): Validator =>
  (value) =>
    required(value) ?? (value.length >= length ? null : fieldMessages.minLength(length));

/** One text field's value and validation; `error` is shown only after blur or a submit attempt. */
export interface Field {
  value: string;
  invalid: boolean;
  error: string | null;
  touch(): void;
  /** Spread onto the `Input`. */
  input: {
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    onBlur: () => void;
  };
}

/** Holds a text field's value, starting at `initial`, and checks it with `validate`. */
export function useField(validate: Validator, initial = ''): Field {
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const message = validate(value);
  return {
    value,
    invalid: message !== null,
    error: touched ? message : null,
    touch: () => setTouched(true),
    input: {
      value,
      onChange: (event) => setValue(event.target.value),
      onBlur: () => setTouched(true),
    },
  };
}

/** Shows every field's error, then focuses the first invalid control in `form`. True when all fields are valid. */
export function validateAll(form: HTMLFormElement | null, fields: Field[]): boolean {
  flushSync(() => fields.forEach((field) => field.touch()));
  if (fields.every((field) => !field.invalid)) return true;
  focusFirstInvalid(form);
  return false;
}

/** Focuses the page `h1` whenever `key` changes after the first render, for example when a form turns into its "sent" view. */
export function useFocusHeadingOnChange(key: unknown): void {
  const previous = useRef(key);
  useEffect(() => {
    if (Object.is(previous.current, key)) return;
    previous.current = key;
    document.querySelector<HTMLElement>('#main h1')?.focus();
  }, [key]);
}
