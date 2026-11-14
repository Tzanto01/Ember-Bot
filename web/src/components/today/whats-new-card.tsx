import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { markVersionSeen, readSeenVersion, releaseNotesQuery } from '@/lib/release-notes';

/**
 * Whether Today shows the What's new card now: undefined while the release notes load (or `enabled` is false), false
 * when they fail or this version is already seen (or nothing is recorded yet).
 */
export function useWhatsNewShowing(enabled = true): boolean | undefined {
  const notes = useQuery({ ...releaseNotesQuery, enabled });
  if (notes.isPending) return undefined;
  const latest = notes.data?.[0]?.version;
  const seen = readSeenVersion();
  return !!latest && !!seen && seen !== latest;
}

/**
 * Today's one-time "Ember <version> is here" note after an update, once per version on this device. The very first
 * visit only records the current version; nothing shows when storage fails or the notes don't load. Dismissing it,
 * or opening What's new, records the version.
 */
export function WhatsNewCard() {
  const { t } = useTranslation();
  const latest = useQuery(releaseNotesQuery).data?.[0]?.version;
  const [seen, setSeen] = useState(readSeenVersion);

  useEffect(() => {
    if (latest && seen === null) {
      markVersionSeen(latest);
      setSeen(latest);
    }
  }, [latest, seen]);

  if (!latest || !seen || seen === latest) return null;

  function dismiss(): void {
    markVersionSeen(latest!);
    flushSync(() => setSeen(latest));
    document.querySelector<HTMLElement>('#main h1')?.focus();
  }

  return (
    <Notice tone="info" heading={t('whatsNew.card.heading', { version: latest })} data-calm-hide>
      <div className="-my-1 flex flex-wrap items-center gap-x-4">
        <TapLink to="/whats-new">{t('whatsNew.card.link')}</TapLink>
        <Button type="button" variant="ghost" className="-ml-2 px-2" onClick={dismiss}>
          {t('whatsNew.card.dismiss')}
        </Button>
      </div>
    </Notice>
  );
}
