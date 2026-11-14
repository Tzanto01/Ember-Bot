import { useTranslation } from 'react-i18next';
import { DayCell } from '@/components/day-cell';
import type { DayState, LocalDateString } from '@/lib/models';

const items: { state: DayState; date?: LocalDateString }[] = [
  { state: 'done' },
  { state: 'notdone' },
  { state: 'partial' },
  { state: 'pending' },
  { state: 'offday' },
  { state: 'lowday' },
  { state: 'paused' },
  { state: 'beforestart', date: '2026-01-07' },
];

/** The History legend: a 24 px swatch per day state with its name. */
export function Legend() {
  const { t } = useTranslation();
  return (
    <ul aria-label={t('calendar.legendLabel')} className="grid grid-cols-2 gap-x-4 gap-y-2 text-[0.875rem] md:flex md:flex-wrap">
      {items.map((item) => (
        <li key={item.state} className="flex items-center gap-2">
          {item.date ? (
            <span aria-hidden="true" className="flex">
              <DayCell state={item.state} date={item.date} size="swatch" />
            </span>
          ) : (
            <DayCell state={item.state} size="swatch" />
          )}
          {t(`calendar.legend.${item.state}`)}
        </li>
      ))}
    </ul>
  );
}
