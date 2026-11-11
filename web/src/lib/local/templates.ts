import type { HabitTemplate } from '../models';

/** `GET /api/habit-templates` as Core `HabitTemplates` answers it, for no-account mode. */
export const habitTemplates: readonly HabitTemplate[] = [
  ['morning_routine', '☀️ Morning start', 'Start the day with intention', '08:00', null],
  ['medication', '💊 Medication', 'Take meds on schedule', '09:00', null],
  ['hydration', '💧 Hydration', 'Drink enough water today', '10:00', null],
  ['exercise', '🏃 Exercise', 'Move your body, any amount counts', '18:00', 3],
  ['sleep', '😴 Sleep', 'Wind down and get to bed on time', '22:00', null],
  ['journaling', '📓 Journaling', 'Reflect on your day in writing', '21:00', null],
  ['reading', '📚 Reading', 'Read for at least 10 minutes', '20:00', null],
  ['no_phone_morning', '📵 Phone-free morning', 'No phone for the first 30 min', '07:30', null],
  ['outside', '🌿 Go outside', 'Get some fresh air and daylight', '12:00', 5],
  ['deep_work', '🧠 Deep work', 'One focused work session', '09:00', 5],
].map(([key, name, description, suggestedReminderTime, weeklyTarget]) => ({
  key: key as string,
  name: name as string,
  description: description as string,
  suggestedReminderTime: suggestedReminderTime as string,
  frequency: weeklyTarget === null ? 'daily' : 'weekly',
  weeklyTarget: weeklyTarget as number | null,
}));
