import { Link } from 'react-router';
import { cn } from '@/lib/utils';

const views = [
  { view: 'month', to: '/history', label: 'Month' },
  { view: 'year', to: '/history/year', label: 'Year' },
] as const;

/** History's Month / Year switch: two links in a labelled nav, the shown view marked `aria-current="page"`. */
export function HistoryViewSwitch({ view }: { view: 'month' | 'year' }) {
  return (
    <nav aria-label="History view" className="self-start">
      <ul role="list" className="flex rounded-full border border-border bg-card p-1">
        {views.map((item) => (
          <li key={item.view}>
            <Link
              to={item.to}
              aria-current={item.view === view ? 'page' : undefined}
              className={cn(
                'inline-flex min-h-[44px] min-w-[88px] items-center justify-center rounded-full px-4 font-medium text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground',
                item.view === view &&
                  'bg-secondary font-semibold text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground',
              )}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
