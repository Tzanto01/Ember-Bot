import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';
import { t } from '@/lib/i18n';
import { timeZoneLabel } from '@/lib/local-date';
import type { MergePreview } from '@/lib/models';
import { type ApiError, asApiError, problemToMessage } from '@/lib/problem';
import { api, auth } from '@/lib/services';

function summary(p: MergePreview): string {
  return t('linkMerge.summary', {
    habits: t('linkMerge.count.habits', { count: p.habits }),
    logs: t('linkMerge.count.checkIns', { count: p.logs }),
    lowDays: t('linkMerge.count.lowDays', { count: p.dayMarks }),
  });
}

function kept({ kept: k }: MergePreview): string {
  const grace =
    k.graceDaysPerWeek === 0 ? t('linkMerge.noGrace') : t('linkMerge.grace', { count: k.graceDaysPerWeek });
  return t('linkMerge.kept', { timezone: timeZoneLabel(k.timezone), grace });
}

/** `/link/merge`: preview of the Discord-only account's data, then move it here or cancel. */
export default function LinkMergePage() {
  useTranslation();
  const navigate = useNavigate();
  const query = useQuery({ queryKey: ['merge-preview'], queryFn: () => api.getMergePreview(), gcTime: 0 });
  const busyRef = useRef<'merge' | 'cancel' | null>(null);
  const [busy, setBusy] = useState<'merge' | 'cancel' | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  const loadError = query.isError ? asApiError(query.error) : null;
  const preview = query.data;

  function handleFailure(error: ApiError): void {
    if (error.status === 404) setGone(true);
    else if (!error.handled) setProblem(problemToMessage(error).message);
  }

  async function run(kind: 'merge' | 'cancel', action: () => Promise<void>): Promise<void> {
    if (busyRef.current) return;
    busyRef.current = kind;
    setBusy(kind);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      handleFailure(asApiError(error));
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }

  const merge = () =>
    run('merge', async () => {
      await api.confirmMerge();
      await auth.refreshAntiforgery();
      await auth.loadMe(true).catch(() => null);
      await navigate('/settings?discord=linked');
    });

  const cancel = () =>
    run('cancel', async () => {
      await api.cancelMerge();
      await navigate('/settings');
    });

  let content: ReactNode;
  if (gone || loadError?.status === 404) {
    content = (
      <>
        <Notice heading={t('linkMerge.gone.heading')}>
          <p>{t('linkMerge.gone.text')}</p>
        </Notice>
        <div>
          <Button asChild variant="secondary">
            <Link to="/settings">{t('linkMerge.settings')}</Link>
          </Button>
        </div>
      </>
    );
  } else if (preview) {
    content = (
      <>
        <Card>
          <p>{summary(preview)}</p>
          {preview.habitNames.length > 0 && (
            <ul aria-label={t('linkMerge.habitsLabel')} className="flex flex-wrap gap-2">
              {preview.habitNames.map((name, index) => (
                <li key={index} className="rounded-full bg-secondary px-3 py-1 text-secondary-foreground">
                  {name}
                </li>
              ))}
            </ul>
          )}
          <p className="text-[14px] text-muted-foreground">
            {t('linkMerge.sameName')}
          </p>
          <p>{kept(preview)}</p>
        </Card>
        {problem && (
          <Notice tone="notice">
            <p>{problem}</p>
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <BusyButton type="button" busy={busy === 'merge'} busyLabel={t('linkMerge.moving')} onClick={() => void merge()}>
            {t('linkMerge.merge')}
          </BusyButton>
          <BusyButton
            type="button"
            variant="secondary"
            busy={busy === 'cancel'}
            busyLabel={t('linkMerge.cancelling')}
            onClick={() => void cancel()}
          >
            {t('linkMerge.cancel')}
          </BusyButton>
        </div>
      </>
    );
  } else if (loadError && !query.isFetching) {
    content = (
      <>
        {!loadError.handled && (
          <Notice tone="notice">
            <p>{problemToMessage(loadError).message}</p>
          </Notice>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            {t('linkMerge.retry')}
          </Button>
          <Button asChild variant="ghost">
            <Link to="/settings">{t('linkMerge.settings')}</Link>
          </Button>
        </div>
      </>
    );
  } else {
    content = (
      <div className="flex flex-col gap-3" aria-busy="true">
        <p role="status" className="sr-only">
          {t('linkMerge.loading')}
        </p>
        <Skeleton className="h-5" />
        <Skeleton className="h-5 w-3/5" />
      </div>
    );
  }

  return (
    <div className="flex max-w-[40rem] flex-col gap-6">
      <PageHeader title={t('linkMerge.title')} />
      {content}
    </div>
  );
}
