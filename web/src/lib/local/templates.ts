import i18next from 'i18next';
import { t } from '../i18n';
import type { HabitTemplate } from '../models';

const rows = [
  ['morning_routine', '08:00', null],
  ['medication', '09:00', null],
  ['hydration', '10:00', null],
  ['exercise', '18:00', 3],
  ['sleep', '22:00', null],
  ['journaling', '21:00', null],
  ['reading', '20:00', null],
  ['no_phone_morning', '07:30', null],
  ['outside', '12:00', 5],
  ['deep_work', '09:00', 5],
] as const;

/** A template's name in the current language by its `key`; the API's English text when the key is unknown. */
export function templateName(template: Pick<HabitTemplate, 'key' | 'name'>): string {
  const key = `templates.${template.key}.name`;
  return i18next.exists(key) ? (t as (key: string) => string)(key) : template.name;
}

/** A template's description in the current language by its `key`; the API's English text when the key is unknown. */
export function templateDescription(template: Pick<HabitTemplate, 'key' | 'description'>): string {
  const key = `templates.${template.key}.description`;
  return i18next.exists(key) ? (t as (key: string) => string)(key) : template.description;
}

/** `GET /api/habit-templates` as Core `HabitTemplates` answers it, for no-account mode; names and descriptions in the current language. */
export const habitTemplates: readonly HabitTemplate[] = rows.map(([key, suggestedReminderTime, weeklyTarget]) => ({
  key,
  get name() {
    return t(`templates.${key}.name`);
  },
  get description() {
    return t(`templates.${key}.description`);
  },
  suggestedReminderTime,
  frequency: weeklyTarget === null ? 'daily' : 'weekly',
  weeklyTarget,
}));
