import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { markVersionSeen, readSeenVersion, releaseNotesQuery } from '@/lib/release-notes';

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
    <Notice tone="info" heading={t('whatsNew.card.heading', { version: latest })}>
      <div className="-my-1 flex flex-wrap items-center gap-x-4">
        <TapLink to="/whats-new">{t('whatsNew.card.link')}</TapLink>
        <Button type="button" variant="ghost" className="-ml-2 px-2" onClick={dismiss}>
          {t('whatsNew.card.dismiss')}
        </Button>
      </div>
    </Notice>
  );
}
