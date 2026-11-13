import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BusyButton } from '@/components/auth/busy-button';
import { type Field, useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { useJournal } from '@/components/journal/journal-context';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { JournalLockedError, WrongSecretError } from '@/lib/journal/types';
import type { Me } from '@/lib/models';
import { ApiError, problemToMessage } from '@/lib/problem';
import { CopyButton, GroupedCode } from './secret-codes';

const passphraseRule: Validator = (value) => {
  if (!value) return t('journalSettings.passphrase.empty');
  return value.length >= 10 ? null : t('journalSettings.passphrase.short');
};
const requiredPassphrase: Validator = (value) => (value ? null : t('journalSettings.passphrase.required'));
const requiredRecovery: Validator = (value) =>
  value.trim() ? null : t('journalSettings.recovery.required');
const loginPasswordRule: Validator = (value) =>
  value ? null : t('journalSettings.loginPassword.required');
const noRule: Validator = () => null;
const deleteRule: Validator = (value) => {
  const word = value.trim();
  if (!word) return t('settings.delete.typeDelete');
  return word === 'DELETE' ? null : t('settings.delete.typeDeleteCaps');
};

/** A gentle message for a failed journal action, or null when the app already handled it. */
export function journalProblem(error: unknown): string | null {
  if (error instanceof JournalLockedError) return t('journalSettings.problem.locked');
  if (error instanceof ApiError) return error.handled ? null : problemToMessage(error).message;
  return t('journalSettings.problem.device');
}

function ProblemNotice({ text }: { text: string | null }) {
  return text ? (
    <Notice tone="notice">
      <p>{text}</p>
    </Notice>
  ) : null;
}

function Remember({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  const { t } = useTranslation();
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
      <div className="flex min-w-0 flex-col pt-[10px]">
        <Label htmlFor={id} className="font-normal">
          {t('journalSettings.remember.label')}
        </Label>
        <p id={`${id}-hint`} className="text-[14px] text-muted-foreground">
          {t('journalSettings.remember.hint')}
        </p>
      </div>
    </div>
  );
}

/** The login password, for accounts that have one, with a hidden username for password managers. */
function LoginPassword({ me, field, error }: { me: Me; field: Field; error: string | null }) {
  const { t } = useTranslation();
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
        label={t('journalSettings.loginPassword.label')}
        hint={t('journalSettings.loginPassword.hint')}
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
      ? t('journalSettings.passphrase.againEmpty')
      : value === passphrase.value
        ? null
        : t('journalSettings.passphrase.mismatch'),
  );
  return { passphrase, confirm };
}

function NewPassphraseFields({
  passphrase,
  confirm,
  label,
}: {
  passphrase: Field;
  confirm: Field;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <>
      <FormField
        label={label ?? t('journalSettings.passphrase.label')}
        hint={t('journalSettings.passphrase.hint')}
        error={passphrase.error}
      >
        {(control) => (
          <PasswordInput {...control} {...passphrase.input} autoComplete="new-password" />
        )}
      </FormField>
      <FormField label={t('journalSettings.passphrase.again')} error={confirm.error}>
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
  const { t } = useTranslation();
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
      if (error instanceof ApiError && error.status === 400 && me.hasPassword && error.problem?.errors?.['password']) {
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
        error={password.error ?? (mismatch ? t('journalSettings.loginPassword.mismatch') : null)}
      />
      <ProblemNotice text={problem} />
      <div>
        <BusyButton type="submit" busy={busy} busyLabel={t('settings.turningOn')}>
          {t('journalSettings.turnOn')}
        </BusyButton>
      </div>
      {busy && progress}
    </form>
  );
}

/** The one-time journal recovery code; finishing needs the "saved it" tick. */
export function RecoveryStep({ code, onFinish }: { code: string; onFinish: () => void }) {
  const { t } = useTranslation();
  const id = useId();
  const box = useRef<HTMLButtonElement>(null);
  const [saved, setSaved] = useState(false);
  const [tried, setTried] = useState(false);
  const error = tried && !saved ? t('journalSettings.recoveryStep.tick') : null;

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
      <Notice tone="info" heading={t('journalSettings.recoveryStep.heading')}>
        <p>{t('journalSettings.recoveryStep.text')}</p>
      </Notice>
      <GroupedCode value={code} label={t('journalSettings.recoveryStep.code')} />
      <CopyButton text={code}>{t('journalSettings.recoveryStep.copy')}</CopyButton>
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
          <Label htmlFor={id} className="min-w-0 font-normal">
            {t('journalSettings.recoveryStep.saved')}
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
          {t('journalSettings.recoveryStep.finish')}
        </Button>
      </div>
    </div>
  );
}

/** Unlocks this device with the passphrase or the recovery code. */
export function UnlockForm({ onUnlocked }: { onUnlocked: (needsNewPassphrase: boolean) => void }) {
  const { t } = useTranslation();
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

  const error =
    field.error ??
    (wrong ? (useRecovery ? t('journalSettings.recovery.wrong') : t('journalSettings.passphrase.wrong')) : null);
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
          label={t('journalSettings.recovery.label')}
          hint={t('journalSettings.recovery.hint')}
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
        <FormField key="passphrase" label={t('journalSettings.passphrase.label')} error={error}>
          {(control) => <PasswordInput {...control} {...passphrase.input} autoComplete="current-password" />}
        </FormField>
      )}
      <div>
        <Button type="button" variant="link" className="px-0 text-left [overflow-wrap:anywhere]" onClick={toggle}>
          {useRecovery ? t('journalSettings.unlock.usePassphrase') : t('journalSettings.unlock.useRecovery')}
        </Button>
      </div>
      <Remember checked={remember} onChange={setRemember} />
      <ProblemNotice text={problem} />
      <div>
        <BusyButton type="submit" busy={busy} busyLabel={t('journalSettings.unlock.busy')}>
          {t('journalSettings.unlock.submit')}
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
  const { t } = useTranslation();
  const journal = useJournal();
  const form = useRef<HTMLFormElement>(null);
  const old = useField(current ? requiredPassphrase : noRule);
  const { passphrase, confirm } = useNewPassphrase();
  const password = useField(me.hasPassword ? loginPasswordRule : noRule);
  const [remember, setRemember] = useState(() => journal.remembered.get());
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
      } else if (error instanceof ApiError && error.status === 400 && me.hasPassword && error.problem?.errors?.['password']) {
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
          label={t('journalSettings.passphrase.current')}
          error={old.error ?? (wrong === 'old' ? t('journalSettings.passphrase.wrong') : null)}
        >
          {(control) => <PasswordInput {...control} {...old.input} autoComplete="current-password" />}
        </FormField>
      )}
      <NewPassphraseFields passphrase={passphrase} confirm={confirm} label={t('journalSettings.passphrase.new')} />
      {current && <Remember checked={remember} onChange={setRemember} />}
      <LoginPassword
        me={me}
        field={password}
        error={password.error ?? (wrong === 'password' ? t('journalSettings.loginPassword.mismatch') : null)}
      />
      <ProblemNotice text={problem} />
      <div className="flex flex-wrap gap-3">
        <BusyButton type="submit" busy={busy} busyLabel={t('settings.saving')}>
          {submitLabel}
        </BusyButton>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('settings.cancel')}
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
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
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
      if (error instanceof ApiError && error.status === 400 && me.hasPassword && error.problem?.errors?.['password']) {
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
        error={password.error ?? (mismatch ? t('journalSettings.loginPassword.mismatch') : null)}
      />
      {typeDelete && (
        <FormField label={t('settings.delete.confirmLabel')} error={confirm.error}>
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
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('settings.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
