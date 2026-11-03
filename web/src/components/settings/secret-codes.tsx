import { Copy, Download } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';

/** Copies `text` to the clipboard and says whether it worked, in a polite status next to the button. */
export function CopyButton({ text, children = 'Copy' }: { text: string; children?: string }) {
  const [status, setStatus] = useState('');

  async function copy(): Promise<void> {
    setStatus('');
    try {
      await navigator.clipboard.writeText(text);
      setStatus('Copied.');
    } catch {
      setStatus("Copying didn't work here. Select the text and copy it instead.");
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="button" variant="secondary" onClick={() => void copy()}>
        <Copy aria-hidden />
        {children}
      </Button>
      <p role="status" className="text-[14px] text-muted-foreground">
        {status}
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
  const text = codes.join('\n');

  function download(): void {
    saveFile({
      blob: new Blob([`Ember recovery codes. Each one works once.\n\n${text}\n`], {
        type: 'text/plain',
      }),
      fileName: 'ember-recovery-codes.txt',
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <Notice tone="info" heading="Your recovery codes">
        <p>
          Keep these somewhere safe; each works once. If you lose your phone, a recovery code signs
          you in instead of the authenticator code. You won't see them again here.
        </p>
      </Notice>
      <ol
        aria-label="Recovery codes"
        className="grid select-all grid-cols-1 gap-x-6 gap-y-1 rounded-md bg-muted px-4 py-3 font-mono text-[18px] text-foreground sm:grid-cols-2"
      >
        {codes.map((code) => (
          <li key={code}>{code}</li>
        ))}
      </ol>
      <div className="flex flex-wrap items-start gap-3">
        <CopyButton text={text}>Copy codes</CopyButton>
        {!env.native && (
          <Button type="button" variant="secondary" onClick={download}>
            <Download aria-hidden />
            Download as a text file
          </Button>
        )}
      </div>
      <div>
        <Button type="button" onClick={onDone}>
          I've saved them
        </Button>
      </div>
    </div>
  );
}
