import { DayCell } from '@/components/day-cell';
import type { DayState } from '@/lib/models';

const items: { state: DayState; text: string }[] = [
  { state: 'done', text: 'Done' },
  { state: 'notdone', text: 'Not checked in' },
  { state: 'pending', text: 'Still open' },
  { state: 'lowday', text: 'Low day' },
  { state: 'paused', text: 'Paused' },
  { state: 'beforestart', text: 'Before the habit started' },
];

/** The History legend: a 24 px swatch per day state with its name. */
export function Legend() {
  return (
    <ul aria-label="Legend" className="grid grid-cols-2 gap-x-4 gap-y-2 text-[14px] md:flex md:flex-wrap">
      {items.map((item) => (
        <li key={item.state} className="flex items-center gap-2">
          <DayCell state={item.state} size="swatch" />
          {item.text}
        </li>
      ))}
    </ul>
  );
}
