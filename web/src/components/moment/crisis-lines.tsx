import { ExternalLink, Phone } from 'lucide-react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LiveRegion } from '@/components/live-region';
import { Label } from '@/components/ui/label';
import { NativeSelect } from '@/components/ui/select';
import { momentCopy } from '@/lib/moment/copy';
import {
  CRISIS_REGIONS,
  type CrisisRegion,
  detectRegion,
  linesForRegion,
} from '@/lib/moment/region';

let sessionRegion: CrisisRegion | null = null;

/**
 * The crisis lines for the picked region with a country select. The choice lives in memory for this session only;
 * nothing is stored and nothing is sent.
 */
export function CrisisLines() {
  const { t } = useTranslation();
  const selectId = useId();
  const [region, setRegion] = useState<CrisisRegion>(() => sessionRegion ?? detectRegion());
  const [announce, setAnnounce] = useState('');
  const lines = linesForRegion(region);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor={selectId}>{t('crisis.where')}</Label>
        <NativeSelect
          id={selectId}
          value={region}
          onChange={(event) => {
            const next = event.target.value as CrisisRegion;
            sessionRegion = next;
            setRegion(next);
            const place = CRISIS_REGIONS.find((option) => option.region === next)?.label;
            if (place) setAnnounce(momentCopy.showingLines(place));
          }}
        >
          {CRISIS_REGIONS.map((option) => (
            <option key={option.region} value={option.region}>
              {option.label}
            </option>
          ))}
        </NativeSelect>
      </div>
      <ul role="list" aria-label={t('crisis.list')} className="flex flex-col gap-3">
        {lines.map((line) => (
          <li
            key={`${line.region}-${line.name}`}
            className="flex flex-col gap-2 rounded-xl border-[length:var(--border-width)] border-border bg-card p-4 text-card-foreground"
          >
            <p className="font-semibold">{line.name}</p>
            <p className="text-[14px] text-muted-foreground">{line.hours}</p>
            <div className="flex flex-wrap gap-2">
              {line.numbers.map((number) => (
                <a
                  key={number}
                  href={`tel:${number.replace(/[^\d+]/g, '')}`}
                  aria-label={t('crisis.call', { name: line.name, number })}
                  className="inline-flex min-h-[44px] items-center gap-2 rounded-md bg-secondary px-4 py-2 text-[18px] font-semibold whitespace-nowrap text-secondary-foreground no-underline"
                >
                  <Phone aria-hidden className="size-[18px] shrink-0" />
                  {number}
                </a>
              ))}
            </div>
            {line.url && (
              <a
                href={line.url}
                target="_blank"
                rel="noopener"
                className="inline-flex min-h-[44px] items-center gap-2 self-start font-medium text-primary underline underline-offset-4"
              >
                {new URL(line.url).hostname.replace(/^www\./, '')}
                <span className="sr-only">{t('crisis.newTab')}</span>
                <ExternalLink aria-hidden className="size-[16px] shrink-0" />
              </a>
            )}
          </li>
        ))}
      </ul>
      <p className="text-[14px] text-muted-foreground">{t('crisis.notice')}</p>
      <LiveRegion message={announce} />
    </div>
  );
}
