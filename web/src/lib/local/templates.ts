import { t } from '../i18n';
import type { HabitTemplate } from '../models';

const rows = [
  ['morning_routine', '☀️', '08:00', null],
  ['medication', '💊', '09:00', null],
  ['hydration', '💧', '10:00', null],
  ['exercise', '🏃', '18:00', 3],
  ['sleep', '😴', '22:00', null],
  ['journaling', '📓', '21:00', null],
  ['reading', '📚', '20:00', null],
  ['no_phone_morning', '📵', '07:30', null],
  ['outside', '🌿', '12:00', 5],
  ['deep_work', '🧠', '09:00', 5],
] as const;

/** `GET /api/habit-templates` as Core `HabitTemplates` answers it, for no-account mode; names and descriptions in the current language. */
export const habitTemplates: readonly HabitTemplate[] = rows.map(([key, emoji, suggestedReminderTime, weeklyTarget]) => ({
  key,
  get name() {
    return `${emoji} ${t(`templates.${key}.name`)}`;
  },
  get description() {
    return t(`templates.${key}.description`);
  },
  suggestedReminderTime,
  frequency: weeklyTarget === null ? 'daily' : 'weekly',
  weeklyTarget,
}));
