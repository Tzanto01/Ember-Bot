import { Copy, Download } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';

/** Copies `text` to the clipboard and says whether it worked, in a polite status next to the button. */
export function CopyButton({ text, children }: { text: string; children?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<'copied' | 'failed' | null>(null);

  async function copy(): Promise<void> {
    setStatus(null);
    try {
      await navigator.clipboard.writeText(text);
      setStatus('copied');
    } catch {
      setStatus('failed');
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        <Copy aria-hidden />
        {children ?? t('twoFactor.copy')}
      </Button>
      <p role="status" className="text-[14px] text-muted-foreground">
        {status === 'copied' ? t('twoFactor.copied') : status === 'failed' ? t('twoFactor.copyFailed') : ''}
      </p>
    </div>
  );
}

/** `value` without spaces or dashes, in groups of four. */
export function groupCode(value: string): string {
  return (
    value
      .replace(/[\s-]/g, '')
      .match(/.{1,4}/g)
      ?.join(' ') ?? ''
  );
}

/** A secret shown in groups of four as selectable text. */
export function GroupedCode({ value, label }: { value: string; label: string }) {
  return (
    <p className="flex flex-col gap-1">
      <span className="text-[14px] text-muted-foreground">{label}</span>
      <code className="select-all break-words rounded-md bg-muted px-3 py-2 font-mono text-[18px] tracking-wider text-foreground">
        {groupCode(value)}
      </code>
    </p>
  );
}

/**
 * Two-step sign-in recovery codes, shown once: copy, download as a text file (web) and "I've saved them", which
 * calls `onDone` so the caller drops them.
 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useTranslation();
  const text = codes.join('\n');
  const notice = useRef<HTMLDivElement>(null);
  useEffect(() => notice.current?.focus(), []);

  function download(): void {
    saveFile({
      blob: new Blob([`${t('twoFactor.codes.fileHeading')}\n\n${text}\n`], {
        type: 'text/plain',
      }),
      fileName: 'ember-recovery-codes.txt',
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice ref={notice} tabIndex={-1} tone="info" heading={t('twoFactor.codes.heading')} className="focus:outline-none">
        <p>{t('twoFactor.codes.text')}</p>
      </Notice>
      <ol
        aria-label={t('twoFactor.codes.listLabel')}
        className="grid select-all grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono text-[18px] text-foreground sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-start gap-3">
        <CopyButton text={text}>{t('twoFactor.codes.copy')}</CopyButton>
        {!env.native && (
          <Button type="button" variant="secondary" onClick={download}>
            <Download aria-hidden />
            {t('twoFactor.codes.download')}
          </Button>
        )}
      </div>
      <div>
        <Button type="button" onClick={onDone}>
          {t('twoFactor.codes.saved')}
        </Button>
      </div>
    </div>
  );
}
