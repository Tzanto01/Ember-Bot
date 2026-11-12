import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { fieldMessages, FormField, focusFirstInvalid } from '@/components/form-field';
import { controlClass } from '@/components/ui/input';
import { Notice } from '@/components/ui/notice';
import { env } from '@/lib/env';
import type { FeedbackRequest } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { api } from '@/lib/services';
import { cn } from '@/lib/utils';

const maxFeedback = 2000;
const announceFrom = 200;

function remainingText(remaining: number): string {
  return remaining === 1 ? '1 character left' : `${remaining} characters left`;
}

async function feedbackBody(text: string): Promise<FeedbackRequest> {
  if (!env.native) return { text, platform: 'web' };
  const version = await import('@capacitor/app')
    .then(({ App }) => App.getInfo())
    .then(
      (info) => info.version || undefined,
      () => undefined,
    );
  return version ? { text, platform: 'android', version } : { text, platform: 'android' };
}

/**
 * The "Send feedback" form (Settings card and the public `/feedback` page): one text field sent to
 * `POST /api/feedback` with the platform and, in the app, its version. Never sends habit data.
 */
export function FeedbackForm() {
  const formRef = useRef<HTMLFormElement>(null);
  const sentId = useId();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announced, setAnnounced] = useState('');
  const remaining = maxFeedback - text.length;
  const error = (touched && !text.trim() ? fieldMessages.required : null) ?? serverError;

  useEffect(() => {
    if (remaining > announceFrom) return;
    const timer = setTimeout(() => setAnnounced(remainingText(remaining)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setSent(false);
    setProblem(null);
    const trimmed = text.trim();
    if (!trimmed) {
      flushSync(() => setTouched(true));
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      await api.sendFeedback(await feedbackBody(trimmed));
      setText('');
      setTouched(false);
      setServerError(null);
      setSent(true);
    } catch (caught) {
      const apiError = asApiError(caught);
      if (apiError.status === 429) {
        setProblem('Ember has had a lot of feedback in a short time. Please try again a little later, your text is still here.');
        return;
      }
      const friendly = problemToMessage(apiError);
      const fieldError = friendly.fields['text'];
      if (fieldError) {
        flushSync(() => setServerError(fieldError));
        focusFirstInvalid(formRef.current);
      } else {
        setProblem(friendly.message);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <FormField
        label="Your feedback"
        hint="What would make Ember better? Ideas, bugs, or anything that got in your way."
        error={error}
      >
        {(field) => (
          <>
            <textarea
              {...field}
              aria-describedby={cn(field['aria-describedby'], `${field.id}-count`, sentId)}
              value={text}
              rows={5}
              maxLength={maxFeedback}
              onChange={(event) => {
                setText(event.target.value);
                setServerError(null);
                setSent(false);
              }}
              className={cn(controlClass, 'min-h-[8rem] resize-y leading-relaxed')}
            />
            <p id={`${field.id}-count`} className="self-end text-[14px] text-muted-foreground">
              {remainingText(remaining)}
            </p>
            <p role="status" className="sr-only">
              {remaining <= announceFrom ? announced : ''}
            </p>
          </>
        )}
      </FormField>
      <p id={sentId} className="text-[14px] text-muted-foreground">
        Ember sends your text, the app version and whether you use the web or the Android app, plus your account if
        you're signed in. Never your habits or check-ins.{' '}
        <TapLink to="/legal/privacy">Privacy notice</TapLink>
      </p>
      {sent && (
        <Notice tone="success" heading="Thank you, that really helps.">
          <p>Your feedback is on its way to the Ember team.</p>
        </Notice>
      )}
      {problem && (
        <Notice tone="notice" heading="That wasn't sent yet">
          <p>{problem}</p>
        </Notice>
      )}
      <div>
        <BusyButton type="submit" busy={busy} busyLabel="Sending…">
          Send
        </BusyButton>
      </div>
    </form>
  );
}
