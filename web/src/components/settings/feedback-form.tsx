import { ImagePlus, Info, X } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { Button } from '@/components/ui/button';
import { fieldMessages, FormField, focusFirstInvalid } from '@/components/form-field';
import { controlClass, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { env } from '@/lib/env';
import { currentLanguage, t } from '@/lib/i18n';
import type { FeedbackRequest } from '@/lib/models';
import { asApiError, problemToMessage } from '@/lib/problem';
import { auth, api, localMode } from '@/lib/services';
import { shrinkImage, toBase64 } from '@/lib/shrink-image';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const maxTitle = 100;
const maxFeedback = 2000;
const announceFrom = 200;
const maxPictures = 5;
const maxPictureBytes = 10 * 1024 * 1024;

interface Picture {
  key: number;
  blob: Blob;
  url: string;
}

function remainingText(remaining: number): string {
  return t('feedback.remaining', { count: remaining });
}

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024
    ? t('feedback.kb', { size: Math.max(1, Math.round(bytes / 1024)) })
    : t('feedback.mb', {
        size: new Intl.NumberFormat(currentLanguage(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(
          bytes / (1024 * 1024),
        ),
      });
}

function picturesText(pictures: Picture[]): string {
  if (!pictures.length) return t('feedback.pictures.none');
  const bytes = pictures.reduce((sum, picture) => sum + picture.blob.size, 0);
  return t('feedback.pictures.count', { count: pictures.length, max: maxPictures, size: sizeText(bytes) });
}

async function feedbackBody(title: string, text: string): Promise<FeedbackRequest> {
  if (!env.native) return { title, text, platform: 'web' };
  const version = await import('@capacitor/app')
    .then(({ App }) => App.getInfo())
    .then(
      (info) => info.version || undefined,
      () => undefined,
    );
  return version
    ? { title, text, platform: 'android', version }
    : { title, text, platform: 'android' };
}

/**
 * The "Send feedback" form (Settings card and the public `/feedback` page): a title and a description sent to
 * `POST /api/feedback` with the platform and, in the app, its version. Signed in with an account, up to 5 pictures
 * (shrunk on the device, 10 MB together) can go along and the report can be sent anonymously. Never sends habit data.
 */
export function FeedbackForm() {
  const { t } = useTranslation();
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const sentId = useId();
  const picturesId = useId();
  const me = useStore(auth.me);
  const mode = useStore(localMode.mode);
  const canAttach = me !== null && mode === 'account';
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [announced, setAnnounced] = useState<number | null>(null);
  const [pictures, setPictures] = useState<Picture[]>([]);
  const [pictureError, setPictureError] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const picturesRef = useRef(pictures);
  picturesRef.current = pictures;
  const nextKey = useRef(0);
  const remaining = maxFeedback - text.length;
  const error = (touched && !text.trim() ? fieldMessages.required : null) ?? serverError;
  const titleMessage = (touched && !title.trim() ? fieldMessages.required : null) ?? titleError;
  const attached = canAttach ? pictures : [];

  useEffect(() => {
    if (remaining > announceFrom) return;
    const timer = setTimeout(() => setAnnounced(remaining), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  useEffect(() => () => picturesRef.current.forEach((picture) => URL.revokeObjectURL(picture.url)), []);

  useEffect(() => {
    if (sent) moreRef.current?.focus();
  }, [sent]);

  function clearPictures() {
    picturesRef.current.forEach((picture) => URL.revokeObjectURL(picture.url));
    setPictures([]);
    setPictureError(null);
  }

  function pickPictures() {
    if (preparing || busy) return;
    if (pictures.length >= maxPictures) {
      setPictureError(t('feedback.pictures.full'));
      return;
    }
    fileRef.current?.click();
  }

  async function addPictures(files: File[]) {
    setPictureError(null);
    setSent(false);
    let bytes = pictures.reduce((sum, picture) => sum + picture.blob.size, 0);
    const messages: string[] = [];
    const room = maxPictures - pictures.length;
    if (files.length > room) {
      messages.push(t('feedback.pictures.room', { count: room }));
    }
    setPreparing(true);
    try {
      for (const file of files.slice(0, room)) {
        const blob = await shrinkImage(file);
        if (!blob) {
          messages.push(t('feedback.pictures.unreadable', { name: file.name }));
          continue;
        }
        if (bytes + blob.size > maxPictureBytes) {
          messages.push(t('feedback.pictures.tooBig', { name: file.name }));
          continue;
        }
        bytes += blob.size;
        const picture = { key: nextKey.current++, blob, url: URL.createObjectURL(blob) };
        setPictures((current) => [...current, picture]);
      }
    } finally {
      setPreparing(false);
    }
    if (messages.length) setPictureError(messages.join(' '));
  }

  function removePicture(key: number) {
    const picture = pictures.find((p) => p.key === key);
    if (picture) URL.revokeObjectURL(picture.url);
    setPictures(pictures.filter((p) => p.key !== key));
    setPictureError(null);
    addRef.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || preparing) return;
    setSent(false);
    setProblem(null);
    const trimmed = text.trim();
    const trimmedTitle = title.trim();
    if (!trimmed || !trimmedTitle) {
      flushSync(() => setTouched(true));
      focusFirstInvalid(formRef.current);
      return;
    }
    setBusy(true);
    try {
      const body = await feedbackBody(trimmedTitle, trimmed);
      if (canAttach && anonymous) body.anonymous = true;
      if (attached.length) body.images = await Promise.all(attached.map((picture) => toBase64(picture.blob)));
      await api.sendFeedback(body);
      setTitle('');
      setTitleError(null);
      setText('');
      setTouched(false);
      setServerError(null);
      clearPictures();
      setSent(true);
    } catch (caught) {
      const apiError = asApiError(caught);
      if (apiError.handled) return;
      if (apiError.status === 429) {
        setProblem(attached.length ? t('feedback.tooManyPictures') : t('feedback.tooMany'));
        return;
      }
      const friendly = problemToMessage(apiError);
      const titleField = friendly.fields['title'];
      const fieldError = friendly.fields['text'];
      const imagesError = attached.length ? friendly.fields['images'] : undefined;
      if (titleField || fieldError) {
        flushSync(() => {
          setTitleError(titleField ?? null);
          setServerError(fieldError ?? null);
        });
        focusFirstInvalid(formRef.current);
      } else if (imagesError) {
        flushSync(() => setPictureError(imagesError));
        addRef.current?.focus();
      } else {
        setProblem(friendly.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function sendMore() {
    flushSync(() => setSent(false));
    formRef.current?.querySelector('input')?.focus();
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-3">
        <Notice tone="success" heading={t('feedback.sent.heading')}>
          <p>{t('feedback.sent.text')}</p>
        </Notice>
        <div>
          <Button ref={moreRef} type="button" variant="outline" onClick={sendMore}>
            {t('feedback.sent.more')}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <FormField label={t('feedback.title.label')} hint={t('feedback.title.hint')} error={titleMessage}>
        {(field) => (
          <Input
            {...field}
            value={title}
            maxLength={maxTitle}
            autoComplete="off"
            onChange={(event) => {
              setTitle(event.target.value.replace(/[\t\r\n]+/g, ' '));
              setTitleError(null);
              setSent(false);
            }}
          />
        )}
      </FormField>
      <FormField
        label={t('feedback.description.label')}
        hint={t('feedback.description.hint')}
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
              {remaining <= announceFrom && announced !== null ? remainingText(announced) : ''}
            </p>
          </>
        )}
      </FormField>
      {canAttach ? (
        <div className="flex flex-col gap-2">
          {pictures.length > 0 && (
            <ul aria-label={t('feedback.pictures.list')} className="flex flex-wrap gap-3 pt-2">
              {pictures.map((picture, index) => (
                <li key={picture.key} className="relative">
                  <img
                    src={picture.url}
                    alt={t('feedback.pictures.alt', { number: index + 1 })}
                    className="size-24 rounded-md border border-input bg-muted object-cover"
                  />
                  <button
                    type="button"
                    aria-label={t('feedback.pictures.remove', { number: index + 1 })}
                    onClick={() => removePicture(picture.key)}
                    className="absolute -right-3 -top-3 grid size-[44px] place-items-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring"
                  >
                    <span className="grid size-7 place-items-center rounded-full border border-input bg-card text-card-foreground shadow-sm">
                      <X aria-hidden className="size-4" />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p id={`${picturesId}-why`} className="text-[14px] text-muted-foreground">
            {t('feedback.pictures.why')}
          </p>
          <p id={`${picturesId}-check`} className="text-[14px] text-muted-foreground">
            {t('feedback.pictures.check')}
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = '';
              if (files.length) void addPictures(files);
            }}
          />
          <div>
            <BusyButton
              ref={addRef}
              type="button"
              variant="outline"
              busy={preparing}
              busyLabel={t('feedback.pictures.preparing')}
              aria-describedby={cn(`${picturesId}-why`, `${picturesId}-check`, `${picturesId}-count`, pictureError && `${picturesId}-error`)}
              onClick={pickPictures}
            >
              <ImagePlus aria-hidden />
              {t('feedback.pictures.add')}
            </BusyButton>
          </div>
          <p id={`${picturesId}-count`} aria-live="polite" className="text-[14px] text-muted-foreground">
            {picturesText(pictures)}
          </p>
          {pictureError && (
            <p id={`${picturesId}-error`} role="alert" className="flex items-start gap-2 text-[14px] text-destructive">
              <Info aria-hidden className="mt-[2px] size-[18px] shrink-0" />
              <span>{pictureError}</span>
            </p>
          )}
        </div>
      ) : (
        <p className="text-[14px] text-muted-foreground">{t('feedback.pictures.accountOnly')}</p>
      )}
      {canAttach && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <Label htmlFor={`${picturesId}-anonymous`}>{t('feedback.anonymous.label')}</Label>
            <p id={`${picturesId}-anonymous-hint`} className="text-[14px] text-muted-foreground">
              {t('feedback.anonymous.hint')}
            </p>
          </div>
          <Switch
            id={`${picturesId}-anonymous`}
            checked={anonymous}
            aria-describedby={`${picturesId}-anonymous-hint`}
            onCheckedChange={setAnonymous}
            className="mt-[2px]"
          />
        </div>
      )}
      <div id={sentId} className="flex flex-col items-start text-[14px] text-muted-foreground">
        {canAttach ? (
          <p>{t('feedback.sends.account')}</p>
        ) : (
          <p>{t('feedback.sends.plain')}</p>
        )}
        <TapLink to="/legal/privacy">{t('feedback.privacy')}</TapLink>
      </div>
      {problem && (
        <Notice tone="notice" heading={t('feedback.notSent')}>
          <p>{problem}</p>
        </Notice>
      )}
      <div>
        <BusyButton
          type="submit"
          busy={busy || preparing}
          busyLabel={busy ? t('feedback.sending') : t('feedback.pictures.preparing')}
        >
          {t('feedback.send')}
        </BusyButton>
      </div>
    </form>
  );
}
