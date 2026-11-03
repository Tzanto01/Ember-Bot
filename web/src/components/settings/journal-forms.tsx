import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton } from '@/components/auth/busy-button';
import { type Field, useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { useJournal } from '@/components/journal/journal-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { JournalLockedError, WrongSecretError } from '@/lib/journal/types';
import type { Me } from '@/lib/models';
import { ApiError, problemToMessage } from '@/lib/problem';
import { CopyButton, GroupedCode } from './secret-codes';

const passphraseRule: Validator = (value) => {
  if (!value) return 'Please choose a passphrase.';
  return value.length >= 10
    ? null
    : 'Use at least 10 characters. A few words make a good passphrase.';
};
const requiredPassphrase: Validator = (value) => (value ? null : 'Please enter your passphrase.');
const requiredRecovery: Validator = (value) =>
  value.trim() ? null : 'Please enter your recovery code.';
const loginPasswordRule: Validator = (value) =>
  value ? null : 'Please enter your login password.';
const noRule: Validator = () => null;
const deleteRule: Validator = (value) => {
  const word = value.trim();
  if (!word) return 'Type DELETE to confirm.';
  return word === 'DELETE' ? null : 'Type DELETE in capital letters to confirm.';
};

/** Shown for a 400 on a journal-key change: the login password didn't match. */
const passwordMismatch = "That login password doesn't match. Try again.";
const wrongPassphrase = "That passphrase doesn't open your journal. Check it and try again.";
const wrongRecovery = "That recovery code doesn't open your journal. Check it and try again.";

/** A gentle message for a failed journal action, or null when the app already handled it. */
export function journalProblem(error: unknown): string | null {
  if (error instanceof JournalLockedError)
    return 'Your journal is locked on this device again. Unlock it, then try once more.';
  if (error instanceof ApiError) return error.handled ? null : problemToMessage(error).message;
  return 'Something went wrong on this device. You can try again.';
}

function ProblemNotice({ text }: { text: string | null }) {
  return text ? (
    <Notice tone="notice">
      <p>{text}</p>
    </Notice>
  ) : null;
}

function Remember({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <div className="flex min-h-[44px] items-center">
        <Checkbox
          id={id}
          checked={checked}
          aria-describedby={`${id}-hint`}
          onCheckedChange={(value) => onChange(value === true)}
        />
      </div>
      <div className="flex flex-col pt-[10px]">
        <Label htmlFor={id} className="font-normal">
          Remember on this device
        </Label>
        <p id={`${id}-hint`} className="text-[14px] text-muted-foreground">
          Stay unlocked here until you sign out. Leave it off on a shared device.
        </p>
      </div>
    </div>
  );
}

/** The login password, for accounts that have one, with a hidden username for password managers. */
function LoginPassword({ me, field, error }: { me: Me; field: Field; error: string | null }) {
  if (!me.hasPassword) return null;
  return (
    <>
      <input
        className="sr-only"
        type="email"
        name="username"
        autoComplete="username"
        value={me.email ?? ''}
        readOnly
        tabIndex={-1}
        aria-hidden="true"
      />
      <FormField
        label="Your login password"
        hint="Ember checks it before changing your journal key."
        error={error}
      >
        {(control) => (
          <PasswordInput {...control} {...field.input} autoComplete="current-password" />
        )}
      </FormField>
    </>
  );
}

/** A new passphrase typed twice. */
function useNewPassphrase() {
  const passphrase = useField(passphraseRule);
  const confirm = useField((value) =>
    !value
      ? 'Please type your passphrase again.'
      : value === passphrase.value
        ? null
        : "The two passphrases don't match yet.",
  );
  return { passphrase, confirm };
}

function NewPassphraseFields({
  passphrase,
  confirm,
  label = 'Journal passphrase',
}: {
  passphrase: Field;
  confirm: Field;
  label?: string;
}) {
  return (
    <>
      <FormField
        label={label}
        hint="At least 10 characters. Pick something different from your login password."
        error={passphrase.error}
      >
        {(control) => (
          <PasswordInput {...control} {...passphrase.input} autoComplete="new-password" />
        )}
      </FormField>
      <FormField label="Type it again" error={confirm.error}>
        {(control) => <PasswordInput {...control} {...confirm.input} autoComplete="new-password" />}
      </FormField>
    </>
  );
}

/** Turns the private journal on. `onSubmit` resolves once the key exists and entries are encrypted. */
export function EnableForm({
  me,
  onSubmit,
  progress,
}: {
  me: Me;
  onSubmit: (passphrase: string, remember: boolean, password?: string) => Promise<void>;
  progress: ReactNode;
}) {
  const form = useRef<HTMLFormElement>(null);
  const { passphrase, confirm } = useNewPassphrase();
  const password = useField(me.hasPassword ? loginPasswordRule : noRule);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (
      busy ||
      !validateAll(
        form.current,
        me.hasPassword ? [passphrase, confirm, password] : [passphrase, confirm],
      )
    )
      return;
    setBusy(true);
    setMismatch(false);
    setProblem(null);
    try {
      await onSubmit(passphrase.value, remember, me.hasPassword ? password.value : undefined);
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && me.hasPassword) {
        flushSync(() => setMismatch(true));
        focusFirstInvalid(form.current);
      } else {
        setProblem(journalProblem(error));
      }
      setBusy(false);
    }
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      <NewPassphraseFields passphrase={passphrase} confirm={confirm} />
      <Remember checked={remember} onChange={setRemember} />
      <LoginPassword
        me={me}
        field={password}
        error={password.error ?? (mismatch ? passwordMismatch : null)}
      />
      <ProblemNotice text={problem} />
      <div>
        <BusyButton type="submit" busy={busy} busyLabel="Turning on…">
          Turn on the private journal
        </BusyButton>
      </div>
      {busy && progress}
    </form>
  );
}

/** The one-time journal recovery code; finishing needs the "saved it" tick. */
export function RecoveryStep({ code, onFinish }: { code: string; onFinish: () => void }) {
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const error = tried && !saved ? 'Tick this once your recovery code is somewhere safe.' : null;

  function finish(): void {
    if (saved) {
      onFinish();
      return;
    }
    flushSync(() => setTried(true));
    box.current?.focus();
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="success" heading="Your private journal is on">
        <p>
          Here is your recovery code. It opens your journal if you forget your passphrase. Write it
          down or keep it in a password manager: you'll only see it now.
        </p>
      </Notice>
      <GroupedCode value={code} label="Your recovery code" />
      <CopyButton text={code}>Copy recovery code</CopyButton>
      <div className="flex flex-col gap-2">
        <div className="flex min-h-[44px] items-center gap-3">
          <Checkbox
            ref={box}
            id={id}
            checked={saved}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
            onCheckedChange={(value) => setSaved(value === true)}
          />
          <Label htmlFor={id} className="font-normal">
            I've saved my recovery code
          </Label>
        </div>
        {error && (
          <p id={`${id}-error`} className="text-[14px] text-destructive">
            {error}
          </p>
        )}
      </div>
      <div>
        <Button type="button" onClick={finish}>
          Finish
        </Button>
      </div>
    </div>
  );
}

/** Unlocks this device with the passphrase or the recovery code. */
export function UnlockForm({ onUnlocked }: { onUnlocked: (needsNewPassphrase: boolean) => void }) {
  const journal = useJournal();
  const form = useRef<HTMLFormElement>(null);
  const [useRecovery, setUseRecovery] = useState(false);
  const passphrase = useField(requiredPassphrase);
  const recovery = useField(requiredRecovery);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRecovery ? recovery : passphrase;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, [field])) return;
    setBusy(true);
    setWrong(false);
    setProblem(null);
    try {
      const result = await journal.unlock(
        useRecovery ? { recoveryCode: recovery.value } : { passphrase: passphrase.value },
        remember,
      );
      onUnlocked(result.needsNewPassphrase);
    } catch (error) {
      if (error instanceof WrongSecretError) {
        flushSync(() => setWrong(true));
        focusFirstInvalid(form.current);
      } else {
        setProblem(journalProblem(error));
      }
      setBusy(false);
    }
  }

  function toggle(): void {
    setUseRecovery((value) => !value);
    setWrong(false);
    setProblem(null);
  }

  const error = field.error ?? (wrong ? (useRecovery ? wrongRecovery : wrongPassphrase) : null);
  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      {useRecovery ? (
        <FormField
          key="recovery"
          label="Recovery code"
          hint="8 groups of 4 letters and numbers. Spaces and dashes are fine."
          error={error}
        >
          {(control) => (
            <Input
              {...control}
              {...recovery.input}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-mono"
            />
          )}
        </FormField>
      ) : (
        <FormField key="passphrase" label="Journal passphrase" error={error}>
          {(control) => <PasswordInput {...control} {...passphrase.input} autoComplete="off" />}
        </FormField>
      )}
      <div>
        <Button type="button" variant="link" className="px-0" onClick={toggle}>
          {useRecovery ? 'Use my passphrase instead' : 'Use my recovery code'}
        </Button>
      </div>
      <Remember checked={remember} onChange={setRemember} />
      <ProblemNotice text={problem} />
      <div>
        <BusyButton type="submit" busy={busy} busyLabel="Unlocking…">
          Unlock
        </BusyButton>
      </div>
    </form>
  );
}

/**
 * Chooses a new passphrase (`setPassphrase`). With `current`, it first unlocks with the current passphrase (change
 * passphrase); without, it follows a recovery-code unlock.
 */
export function PassphraseForm({
  me,
  current,
  submitLabel,
  onDone,
  onCancel,
  onExpired,
}: {
  me: Me;
  current: boolean;
  submitLabel: string;
  onDone: () => void;
  onCancel?: () => void;
  /** The recovery unlock is too old to re-wrap the key. */
  onExpired?: () => void;
}) {
  const journal = useJournal();
  const form = useRef<HTMLFormElement>(null);
  const old = useField(current ? requiredPassphrase : noRule);
  const { passphrase, confirm } = useNewPassphrase();
  const password = useField(me.hasPassword ? loginPasswordRule : noRule);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<'old' | 'password' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fields = [
      ...(current ? [old] : []),
      passphrase,
      confirm,
      ...(me.hasPassword ? [password] : []),
    ];
    if (busy || !validateAll(form.current, fields)) return;
    setBusy(true);
    setWrong(null);
    setProblem(null);
    try {
      if (current) await journal.unlock({ passphrase: old.value }, remember);
      await journal.setPassphrase(passphrase.value, me.hasPassword ? password.value : undefined);
      onDone();
      return;
    } catch (error) {
      if (error instanceof WrongSecretError) {
        flushSync(() => setWrong('old'));
        focusFirstInvalid(form.current);
      } else if (error instanceof ApiError && error.status === 400 && me.hasPassword) {
        flushSync(() => setWrong('password'));
        focusFirstInvalid(form.current);
      } else if (error instanceof JournalLockedError && onExpired) {
        onExpired();
        return;
      } else {
        setProblem(journalProblem(error));
      }
    }
    setBusy(false);
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      {current && (
        <FormField
          label="Current passphrase"
          error={old.error ?? (wrong === 'old' ? wrongPassphrase : null)}
        >
          {(control) => <PasswordInput {...control} {...old.input} autoComplete="off" />}
        </FormField>
      )}
      <NewPassphraseFields passphrase={passphrase} confirm={confirm} label="New passphrase" />
      {current && <Remember checked={remember} onChange={setRemember} />}
      <LoginPassword
        me={me}
        field={password}
        error={password.error ?? (wrong === 'password' ? passwordMismatch : null)}
      />
      <ProblemNotice text={problem} />
      <div className="flex flex-wrap gap-3">
        <BusyButton type="submit" busy={busy} busyLabel="Saving…">
          {submitLabel}
        </BusyButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/**
 * Confirms a journal-wide action with the login password (when the account has one) and, with `typeDelete`, a
 * typed DELETE.
 */
export function ConfirmJournalForm({
  me,
  typeDelete,
  submitLabel,
  busyLabel,
  onSubmit,
  onCancel,
}: {
  me: Me;
  typeDelete?: boolean;
  submitLabel: string;
  busyLabel: string;
  onSubmit: (password?: string) => Promise<void>;
  onCancel: () => void;
}) {
  const form = useRef<HTMLFormElement>(null);
  const password = useField(me.hasPassword ? loginPasswordRule : noRule);
  const confirm = useField(typeDelete ? deleteRule : noRule);
  const [busy, setBusy] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busy || !validateAll(form.current, [password, confirm])) return;
    setBusy(true);
    setMismatch(false);
    setProblem(null);
    try {
      await onSubmit(me.hasPassword ? password.value : undefined);
      return;
    } catch (error) {
      if (error instanceof ApiError && error.status === 400 && me.hasPassword) {
        flushSync(() => setMismatch(true));
        focusFirstInvalid(form.current);
      } else {
        setProblem(journalProblem(error));
      }
    }
    setBusy(false);
  }

  return (
    <form
      ref={form}
      noValidate
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-4"
    >
      <LoginPassword
        me={me}
        field={password}
        error={password.error ?? (mismatch ? passwordMismatch : null)}
      />
      {typeDelete && (
        <FormField label="Type DELETE to confirm" error={confirm.error}>
          {(control) => (
            <Input
              {...control}
              {...confirm.input}
              type="text"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
            />
          )}
        </FormField>
      )}
      <ProblemNotice text={problem} />
      <div className="flex flex-wrap gap-3">
        <BusyButton
          type="submit"
          variant={typeDelete ? 'destructive' : 'default'}
          busy={busy}
          busyLabel={busyLabel}
        >
          {submitLabel}
        </BusyButton>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
