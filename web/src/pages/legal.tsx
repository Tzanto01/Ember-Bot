import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { TapLink } from '@/components/auth/busy-button';
import { renderLegal } from '@/components/legal/markdown';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

type LegalDoc = 'privacy' | 'terms' | 'imprint';

const documents = {
  privacy: { file: 'datenschutzerklaerung.md', title: 'title.privacy' },
  terms: { file: 'nutzungsbedingungen.md', title: 'title.terms' },
  imprint: { file: 'impressum.md', title: 'title.imprint' },
} as const satisfies Record<LegalDoc, { file: string; title: string }>;

const prose = [
  'flex max-w-[38rem] flex-col gap-4 [overflow-wrap:anywhere] hyphens-auto',
  '[&_h2]:mt-4 [&_h2]:text-[1.375rem] [&_h3]:text-[1.125rem]',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li+li]:mt-1',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
  '[&_blockquote]:rounded-sm [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:bg-muted [&_blockquote]:px-4 [&_blockquote]:py-3',
  '[&_hr]:border-border',
  '[&_table]:block [&_table]:overflow-x-auto [&_table]:text-[0.875rem] [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left sm:[&_table]:[overflow-wrap:normal] sm:[&_table]:hyphens-manual',
  'max-sm:[&_thead]:hidden max-sm:[&_tbody]:block max-sm:[&_tr]:mb-3 max-sm:[&_tr]:block max-sm:[&_tr]:border max-sm:[&_tr]:border-border max-sm:[&_tr]:rounded-sm max-sm:[&_td]:block max-sm:[&_td]:border-0 max-sm:[&_td]:hyphens-manual max-sm:[&_td]:before:block max-sm:[&_td]:before:font-semibold max-sm:[&_td]:before:content-[attr(data-label)]',
].join(' ');

async function loadDocument(file: string, hideEnglishSummary: boolean) {
  const response = await fetch(`/legal/${file}`);
  if (!response.ok) throw new Error(`Legal document answered ${response.status}`);
  const markdown = await response.text();
  if (/^\s*<!doctype/i.test(markdown)) throw new Error('Expected markdown, got the app shell');
  return renderLegal(markdown, hideEnglishSummary);
}

/**
 * `/legal/privacy`, `/legal/terms`, `/legal/imprint`: the German legal text from `/legal/*.md`, its `#` heading as the
 * `h1`, and the English summary quote only on an English UI.
 */
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const { t, i18n } = useTranslation();
  const { file, title } = documents[doc];
  const german = i18n.language === 'de';
  const query = useQuery({
    queryKey: ['legal', doc, german],
    queryFn: () => loadDocument(file, german),
    staleTime: Infinity,
  });
  const loaded = query.data;

  return (
    <div lang={loaded ? 'de' : undefined} className="flex w-full flex-col gap-6">
      <PageHeader title={loaded?.heading ?? t(title)} />
      {loaded ? (
        <div className={prose} dangerouslySetInnerHTML={{ __html: loaded.html }} />
      ) : query.isError && !query.isFetching ? (
        <Notice tone="notice">
          <p>{t('legal.loadFailed')}</p>
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            {t('legal.retry')}
          </Button>
        </Notice>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p role="status" className="sr-only">
            {t('legal.loading')}
          </p>
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}
      <p lang={i18n.language}>
        <TapLink to="/" className="gap-2">
          <ArrowLeft aria-hidden className="size-[18px]" />
          {t('legal.back')}
        </TapLink>
      </p>
    </div>
  );
}
