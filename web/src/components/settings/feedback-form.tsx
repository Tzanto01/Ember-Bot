import { ImagePlus, Info, X } from 'lucide-react';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { fieldMessages, FormField, focusFirstInvalid } from '@/components/form-field';
import { controlClass, Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Switch } from '@/components/ui/switch';
import { env } from '@/lib/env';
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
  return remaining === 1 ? '1 character left' : `${remaining} characters left`;
}

function sizeText(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function picturesText(pictures: Picture[]): string {
  if (!pictures.length) return 'Up to 5 pictures, 10 MB together. Screenshots help a lot.';
  const bytes = pictures.reduce((sum, picture) => sum + picture.blob.size, 0);
  return `${pictures.length} of ${maxPictures} pictures · ${sizeText(bytes)} of 10 MB`;
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
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const addRef = useRef<HTMLButtonElement>(null);
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
  const [announced, setAnnounced] = useState('');
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
    const timer = setTimeout(() => setAnnounced(remainingText(remaining)), 1000);
    return () => clearTimeout(timer);
  }, [remaining]);

  useEffect(() => () => picturesRef.current.forEach((picture) => URL.revokeObjectURL(picture.url)), []);

  function clearPictures() {
    picturesRef.current.forEach((picture) => URL.revokeObjectURL(picture.url));
    setPictures([]);
    setPictureError(null);
  }

  function pickPictures() {
    if (preparing || busy) return;
    if (pictures.length >= maxPictures) {
      setPictureError("That's 5 pictures, the most one report can carry. Remove one to add another.");
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
      messages.push(
        `Only ${room === 1 ? '1 more picture fits' : `${room} more pictures fit`}, so the rest weren't added.`,
      );
    }
    setPreparing(true);
    try {
      for (const file of files.slice(0, room)) {
        const blob = await shrinkImage(file);
        if (!blob) {
          messages.push(`${file.name} couldn't be opened as a picture. A JPEG, PNG or WebP works.`);
          continue;
        }
        if (bytes + blob.size > maxPictureBytes) {
          messages.push(`${file.name} would go over 10 MB together, so it wasn't added.`);
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
        setProblem(
          attached.length
            ? 'Ember has had a lot of feedback and pictures in a short time. Please try again a little later, or send just the text. Your words and pictures are still here.'
            : 'Ember has had a lot of feedback in a short time. Please try again a little later, your text is still here.',
        );
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

  return (
    <form ref={formRef} noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-3">
      <FormField label="Title" hint='A few words, like "Reminder came late".' error={titleMessage}>
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
        label="Description"
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
      {canAttach ? (
        <div className="flex flex-col gap-2">
          {pictures.length > 0 && (
            <ul aria-label="Pictures to send" className="flex flex-wrap gap-3 pt-2">
              {pictures.map((picture, index) => (
                <li key={picture.key} className="relative">
                  <img
                    src={picture.url}
                    alt={`Picture ${index + 1}`}
                    className="size-24 rounded-md border border-input bg-muted object-cover"
                  />
                  <button
                    type="button"
                    aria-label={`Remove picture ${index + 1}`}
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
            Pictures you add help us fix the problem; we keep them until it's handled.
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
              busyLabel="Preparing pictures…"
              aria-describedby={cn(`${picturesId}-why`, `${picturesId}-count`, pictureError && `${picturesId}-error`)}
              onClick={pickPictures}
            >
              <ImagePlus aria-hidden />
              Add pictures
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
        <p className="text-[14px] text-muted-foreground">With an account you can add pictures too.</p>
      )}
      {canAttach && (
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${picturesId}-anonymous`}>Send feedback anonymously</Label>
            <p id={`${picturesId}-anonymous-hint`} className="text-[14px] text-muted-foreground">
              Leaves your account off this report.
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
      <p id={sentId} className="text-[14px] text-muted-foreground">
        {canAttach ? (
          <>
            Ember sends the title, description and any pictures, the app version, the time and whether you use the web
            or the Android app. Your account goes with it unless you send anonymously. Never your habits or check-ins,
            and please keep private entries and other people out of pictures.{' '}
          </>
        ) : (
          <>
            Ember sends the title, description, the app version, the time and whether you use the web or the Android
            app, plus your account if you're signed in. Never your habits or check-ins.{' '}
          </>
        )}
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
        <BusyButton type="submit" busy={busy || preparing} busyLabel={busy ? 'Sending…' : 'Preparing pictures…'}>
          Send
        </BusyButton>
      </div>
    </form>
  );
}
