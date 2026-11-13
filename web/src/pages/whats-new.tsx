import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { currentLanguage } from '@/lib/i18n';
import { formatDate } from '@/lib/local-date';
import { markVersionSeen, notesIn, releaseNotesQuery } from '@/lib/release-notes';

/** `/whats-new`: every version from `/release-notes.json`, newest first. Opening it marks the newest one as seen. */
export default function WhatsNewPage() {
  const { t } = useTranslation();
  const query = useQuery(releaseNotesQuery);
  const latest = query.data?.[0]?.version;

  useEffect(() => {
    if (latest) markVersionSeen(latest);
  }, [latest]);

  return (
    <div className="flex max-w-[40rem] flex-col gap-6">
      <PageHeader title={t('whatsNew.title')} lede={t('whatsNew.lede')} />
      {query.data ? (
        query.data.map((entry) => (
          <section
            key={entry.version}
            aria-labelledby={`version-${entry.version}`}
            className={cardVariants()}
          >
            <div className="flex flex-col gap-1">
              <h2 id={`version-${entry.version}`} className="text-[22px] [overflow-wrap:anywhere]">
                {t('whatsNew.version', { version: entry.version })}
              </h2>
              <p className="text-[14px] text-muted-foreground">
                <time dateTime={entry.date}>{formatDate(entry.date)}</time>
              </p>
            </div>
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {notesIn(entry.notes, currentLanguage()).map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </section>
        ))
      ) : query.isError && !query.isFetching ? (
        <Notice tone="notice">
          <p>{t('whatsNew.loadFailed')}</p>
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            {t('whatsNew.retry')}
          </Button>
        </Notice>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p role="status" className="sr-only">
            {t('whatsNew.loading')}
          </p>
          <Skeleton className="h-[10rem] rounded-xl" />
          <Skeleton className="h-[10rem] rounded-xl" />
        </div>
      )}
      <p>
        <TapLink to="/settings" className="gap-2">
          <ArrowLeft aria-hidden className="size-[18px]" />
          {t('whatsNew.back')}
        </TapLink>
      </p>
    </div>
  );
}
