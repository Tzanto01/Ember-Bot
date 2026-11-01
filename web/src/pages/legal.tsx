import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { TapLink } from '@/components/auth/busy-button';
import { renderLegal } from '@/components/legal/markdown';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { Skeleton } from '@/components/ui/skeleton';

type LegalDoc = 'privacy' | 'terms' | 'imprint';

const documents: Record<LegalDoc, { file: string; title: string }> = {
  privacy: { file: 'datenschutzerklaerung.md', title: 'Privacy' },
  terms: { file: 'nutzungsbedingungen.md', title: 'Terms' },
  imprint: { file: 'impressum.md', title: 'Imprint' },
};

const prose = [
  'flex max-w-[38rem] flex-col gap-4 [overflow-wrap:anywhere] hyphens-auto',
  '[&_h2]:mt-4 [&_h2]:text-[22px] [&_h3]:text-[18px]',
  '[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5 [&_li+li]:mt-1',
  '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4',
  '[&_blockquote]:rounded-sm [&_blockquote]:border-l-[3px] [&_blockquote]:border-border [&_blockquote]:bg-muted [&_blockquote]:px-4 [&_blockquote]:py-3',
  '[&_hr]:border-border',
  '[&_table]:block [&_table]:overflow-x-auto [&_table]:text-[14px] [&_td]:border [&_td]:border-border [&_td]:p-2 [&_td]:align-top [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left',
].join(' ');

async function loadDocument(file: string) {
  const response = await fetch(`/legal/${file}`);
  if (!response.ok) throw new Error(`Legal document answered ${response.status}`);
  const markdown = await response.text();
  if (/^\s*<!doctype/i.test(markdown)) throw new Error('Expected markdown, got the app shell');
  return renderLegal(markdown);
}

/** `/legal/privacy`, `/legal/terms`, `/legal/imprint`: the German legal text from `/legal/*.md`, its `#` heading as the `h1`. */
export default function LegalPage({ doc }: { doc: LegalDoc }) {
  const { file, title } = documents[doc];
  const query = useQuery({ queryKey: ['legal', doc], queryFn: () => loadDocument(file), staleTime: Infinity });
  const loaded = query.data;

  return (
    <div lang={loaded ? 'de' : undefined} className="flex w-full flex-col gap-6">
      <PageHeader title={loaded?.heading ?? title} />
      {loaded ? (
        <div className={prose} dangerouslySetInnerHTML={{ __html: loaded.html }} />
      ) : query.isError && !query.isFetching ? (
        <Notice tone="notice">
          <p>This page couldn't be loaded. Check your connection and try again.</p>
          <Button type="button" variant="secondary" onClick={() => void query.refetch()}>
            Try again
          </Button>
        </Notice>
      ) : (
        <div className="flex flex-col gap-3" aria-busy="true">
          <p role="status" className="sr-only">
            Loading…
          </p>
          <Skeleton className="h-5" />
          <Skeleton className="h-5" />
          <Skeleton className="h-5 w-3/5" />
        </div>
      )}
      <p lang="en">
        <TapLink to="/" className="gap-2">
          <ArrowLeft aria-hidden className="size-[18px]" />
          Back to Ember
        </TapLink>
      </p>
    </div>
  );
}
