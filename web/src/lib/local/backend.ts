import type { Method } from '../http';
import { addDays, daysBetween, isLocalDate, isValidTimeZone } from '../local-date';
import {
  builtinMoods,
  type DayNote,
  type Frequency,
  type Me,
  type MoodKey,
  type OwnMood,
  type ReminderChannel,
  reminderTimesOf,
  type Routine,
  secondReminderChoices,
  type SecondReminderMinutes,
  type TimeOfDay,
  type Weekday,
  weekdays,
} from '../models';
import { themes } from '../theme';
import {
  dayStats,
  habitDays,
  habitStartDate,
  habitView,
  localToday,
  pause,
  retarget,
  weeklySummary,
  writeDay,
} from './rules';
import type { LocalStore } from './store';
import { habitTemplates } from './templates';
import type { LocalData, LocalRoutine } from './types';

/** Core limits the local backend enforces like the API. */
export const limits = {
  habits: 25,
  routines: 10,
  activeMoods: 20,
  habitName: 100,
  routineName: 50,
  moodLabel: 24,
  noteText: 2000,
  timesPerDay: 10,
  rangeDays: 366,
} as const;

/** The consent policy version no-account mode reports: consent is implied by keeping the data on the device. */
export const devicePolicyVersion = 'device';

type Errors = Record<string, string[]>;
type Body = Record<string, unknown>;

class Problem {
  constructor(
    readonly status: number,
    readonly type: string | null,
    readonly detail?: string,
    readonly errors?: Errors,
  ) {}
}

const invalid = (errors: Errors) => new Problem(400, 'validation', undefined, errors);
const invalidField = (field: string, message: string) => invalid({ [field]: [message] });
const notFound = () => new Problem(404, 'not_found');
const dateMessage = 'Must be a date as yyyy-MM-dd.';
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const channelNames: readonly ReminderChannel[] = ['discord', 'webpush', 'mobile'];
const themeIds: readonly string[] = themes.map((theme) => theme.id);
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** The trimmed name when `value` is a string of 1 to `max` characters after trimming, else null. */
export function validName(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : null;
}

/** True for a time of day as `HH:mm`. */
export function isTime(value: unknown): value is TimeOfDay {
  return typeof value === 'string' && timePattern.test(value);
}

/** True for a real calendar day as `yyyy-MM-dd`. */
export function isDate(value: unknown): value is string {
  return typeof value === 'string' && isLocalDate(value);
}

/** True for one emoji grapheme (the API's rule). */
export function isEmoji(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 32) return false;
  if ([...graphemes.segment(value)].length !== 1) return false;
  if (/^[0-9#*]/.test(value) && value.endsWith('⃣')) return true;
  return /^[\p{So}\p{Sk}]/u.test(value);
}

/** The frequency, or null when `value` isn't one. */
export function parseFrequency(value: unknown): Frequency | null {
  return value === 'daily' || value === 'weekly' || value === 'weekdays' ? value : null;
}

/** 1 to 6 distinct weekdays, Monday first, or null when `value` isn't that. */
export function parseWeekdays(value: unknown): Weekday[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 6) return null;
  if (!value.every((day) => weekdays.includes(day as Weekday)) || new Set(value).size !== value.length) return null;
  return weekdays.filter((day) => value.includes(day));
}

/** Distinct reminder channels, or null when `value` isn't an array of channel names. */
export function parseChannels(value: unknown): ReminderChannel[] | null {
  if (!Array.isArray(value) || !value.every((c) => channelNames.includes(c as ReminderChannel))) return null;
  return channelNames.filter((c) => value.includes(c));
}

/** The JSON export format v2 document (`format_version: 2`) of the device data; `journal` false leaves moods and entries out. */
export function exportDocument(data: LocalData, journal = true): Record<string, unknown> {
  const order = new Map(data.habits.map((habit, index) => [habit.id, index]));
  const timesPerDay = new Map(data.habits.map((habit) => [habit.id, habit.timesPerDay]));
  return {
    format_version: 2,
    settings: {
      timezone: data.profile.timezone,
      grace_days_per_week: data.profile.graceDaysPerWeek,
      theme: data.profile.theme,
    },
    habits: data.habits.map((h) => ({
      id: h.id,
      name: h.name,
      frequency: h.frequency,
      weekly_target: h.weeklyTarget,
      reminder_time: h.reminderTime,
      reminder_times: reminderTimesOf(h),
      paused_until: h.pausedUntil,
      paused_from: h.pausedFrom,
      created_at: h.createdAt,
      reminder_channels: h.reminderChannels,
      days: h.days,
      times_per_day: h.timesPerDay,
      routine_id: h.routineId,
      routine_position: h.routinePosition,
    })),
    logs: data.logs
      .filter((log) => order.has(log.habitId))
      .sort((a, b) => order.get(a.habitId)! - order.get(b.habitId)! || a.date.localeCompare(b.date))
      .map((log) => ({
        habit_id: log.habitId,
        date: log.date,
        completed: log.completed,
        count: Math.min(log.count, timesPerDay.get(log.habitId)!),
      })),
    day_marks: [...data.lowDays].sort().map((date) => ({ date, kind: 'low_day' })),
    routines: data.routines.map((r) => ({
      id: r.id,
      name: r.name,
      reminder_time: r.reminderTime,
      reminder_channels: r.reminderChannels,
    })),
    moods: journal
      ? data.moods.map((m) => ({ id: m.id, label: m.label, emoji: m.emoji, archived: m.archived }))
      : [],
    day_notes: journal
      ? [...data.notes]
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((n) => ({ date: n.date, text: n.text, mood: n.mood }))
      : [],
    journal_key: null,
  };
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function empty(status = 204): Response {
  return new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
}

function problemResponse(problem: Problem): Response {
  return new Response(
    JSON.stringify({
      type: problem.type ?? undefined,
      status: problem.status,
      detail: problem.detail,
      errors: problem.errors,
    }),
    { status: problem.status, headers: { 'Content-Type': 'application/problem+json', 'Cache-Control': 'no-store' } },
  );
}

function bodyOf(input: unknown): Body {
  if (input === null || input === undefined) return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw invalidField('body', 'Must be a JSON object.');
  return input as Body;
}

function reminderField(value: unknown, errors: Errors): TimeOfDay | null {
  if (value === null || value === undefined) return null;
  if (isTime(value)) return value;
  errors['reminderTime'] = ['Must be a time as HH:mm.'];
  return null;
}

function reminderTimesField(value: unknown, limit: number, errors: Errors): TimeOfDay[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || !value.every(isTime)) {
    errors['reminderTimes'] = ['Each must be a time as HH:mm.'];
    return null;
  }
  const times = [...new Set(value)].sort();
  if (times.length < value.length) errors['reminderTimes'] = ['Each time can only be listed once.'];
  else if (times.length > limit) errors['reminderTimes'] = [`At most ${limit}, one per check-in.`];
  else return times;
  return null;
}

function channelsField(value: unknown, errors: Errors): ReminderChannel[] | null {
  if (value === null || value === undefined) return null;
  const channels = parseChannels(value);
  if (!channels) errors['reminderChannels'] = ['Each must be discord, webpush or mobile.'];
  return channels;
}

function weeklyTargetField(value: unknown, frequency: Frequency | null, errors: Errors): void {
  if (value === null || value === undefined) return;
  if (frequency !== 'weekly') errors['weeklyTarget'] = ['Only for weekly habits.'];
  else if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > 6)
    errors['weeklyTarget'] = ['Must be between 1 and 6.'];
}

function daysField(
  value: unknown,
  frequency: Frequency | null,
  current: Weekday[] | null,
  errors: Errors,
): Weekday[] | null {
  if (!frequency) return null;
  if (value === null || value === undefined) {
    if (frequency !== 'weekdays') return null;
    if (current?.length) return current;
    errors['days'] = ['Required for weekdays habits.'];
    return null;
  }
  const days = parseWeekdays(value);
  if (frequency !== 'weekdays') errors['days'] = ['Only for weekdays habits.'];
  else if (Array.isArray(value) && value.length === 7 && new Set(value).size === 7)
    errors['days'] = ['All seven days: use daily instead.'];
  else if (Array.isArray(value) && value.length === 0) errors['days'] = ['Pick 1 to 6 days.'];
  else if (!days) errors['days'] = ['Each must be one of mon, tue, wed, thu, fri, sat, sun, without repeats.'];
  else return days;
  return null;
}

function timesPerDayField(value: unknown, frequency: Frequency | null, errors: Errors): number {
  const times = value as number;
  if (frequency === 'weekly' && times !== 1) errors['timesPerDay'] = ['Always 1 for weekly habits.'];
  else if (!Number.isInteger(value) || times < 1 || times > limits.timesPerDay)
    errors['timesPerDay'] = [`Must be between 1 and ${limits.timesPerDay}.`];
  return times;
}

function habitIdsField(value: unknown, errors: Errors): number[] | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value) || !value.every((id) => Number.isInteger(id))) {
    errors['habitIds'] = ['Must be a list of habit ids.'];
    return null;
  }
  if (new Set(value).size !== value.length) errors['habitIds'] = ['Each habit can be listed once.'];
  return value as number[];
}

function rangeOf(
  query: URLSearchParams,
  today: string,
  backDays: number,
  options: { notAfterToday: boolean },
): { from: string; to: string } {
  const errors: Errors = {};
  const toParam = query.get('to');
  const fromParam = query.get('from');
  let to = today;
  if (toParam !== null) {
    if (isDate(toParam)) to = toParam;
    else errors['to'] = [dateMessage];
  }
  let from = addDays(to, -backDays);
  if (fromParam !== null) {
    if (isDate(fromParam)) from = fromParam;
    else errors['from'] = [dateMessage];
  }
  if (!Object.keys(errors).length) {
    if (options.notAfterToday && to > today) errors['to'] = ["Can't be after today."];
    else if (from > to) errors['from'] = ["Can't be after to."];
    else if (daysBetween(from, to) + 1 > limits.rangeDays) errors['from'] = [`At most ${limits.rangeDays} days per request.`];
  }
  if (Object.keys(errors).length) throw invalid(errors);
  return { from, to };
}

function moodDto(mood: OwnMood): OwnMood {
  return { id: mood.id, label: mood.label, emoji: mood.emoji, archived: mood.archived };
}

function routineDto(data: LocalData, routine: LocalRoutine): Routine {
  return {
    id: routine.id,
    name: routine.name,
    reminderTime: routine.reminderTime,
    reminderChannels: routine.reminderChannels,
    habitIds: data.habits
      .filter((h) => h.routineId === routine.id)
      .sort((a, b) => (a.routinePosition ?? 0) - (b.routinePosition ?? 0) || a.id - b.id)
      .map((h) => h.id),
  };
}

function setMembers(data: LocalData, routineId: number, habitIds: number[]): void {
  if (habitIds.some((id) => !data.habits.some((h) => h.id === id))) throw notFound();
  for (const habit of data.habits) {
    const position = habitIds.indexOf(habit.id);
    if (position >= 0) {
      habit.routineId = routineId;
      habit.routinePosition = position;
    } else if (habit.routineId === routineId) {
      habit.routineId = null;
      habit.routinePosition = null;
    }
  }
}

/** The earliest start day of the device's habits, or null without habits. */
export function earliestStart(data: LocalData): string | null {
  const starts = data.habits.map((h) => habitStartDate(h, data.profile.timezone)).sort();
  return starts[0] ?? null;
}

function journalDayCheck(data: LocalData, date: string, today: string): void {
  if (date > today) throw new Problem(422, 'in_future');
  const start = earliestStart(data);
  if (start === null || date < start) throw new Problem(422, 'before_habit_start');
}

type Handler = (match: RegExpExecArray, query: URLSearchParams, body: unknown) => Promise<Response>;

/**
 * No-account mode's in-process API: answers the app's own `/api/*` requests from the device data with the API contract's
 * shapes, validation and problem types, so the screens and services work unchanged. Private journal, two-factor sign-in,
 * Discord, merge, import and the auth endpoints (apart from antiforgery and logout) answer 404; push answers 501.
 */
export class LocalBackend {
  private readonly routes: [Method, RegExp, Handler][];
  private readonly now: () => Date;

  constructor(
    private readonly store: LocalStore,
    private readonly options: { native: boolean; now?: () => Date },
  ) {
    this.now = options.now ?? (() => new Date());
    const id = (m: RegExpExecArray, index = 1) => Number(m[index]);
    const date = (m: RegExpExecArray, index: number) => {
      try {
        return decodeURIComponent(m[index]);
      } catch {
        throw invalidField('date', dateMessage);
      }
    };
    this.routes = [
      ['GET', /^\/api\/auth\/antiforgery$/, async () => empty()],
      ['POST', /^\/api\/auth\/logout$/, async () => empty()],
      ['GET', /^\/api\/me$/, async () => json(200, this.me(await this.data()))],
      ['PATCH', /^\/api\/me$/, (_m, _q, b) => this.patchMe(bodyOf(b))],
      ['POST', /^\/api\/me\/consent$/, (_m, _q, b) => this.consent(bodyOf(b))],
      ['POST', /^\/api\/me\/dm-reminders\/resume$/, async () => empty()],
      ['GET', /^\/api\/me\/export$/, (_m, q) => this.exportFile(q)],
      ['GET', /^\/api\/push\/vapid-public-key$/, async () => empty(501)],
      ['POST', /^\/api\/me\/push-subscriptions$/, async () => empty(501)],
      ['DELETE', /^\/api\/me\/push-subscriptions$/, async () => empty(501)],
      ['GET', /^\/api\/habit-templates$/, async () => json(200, habitTemplates)],
      ['GET', /^\/api\/habits$/, () => this.listHabits()],
      ['POST', /^\/api\/habits$/, (_m, _q, b) => this.createHabit(bodyOf(b))],
      ['GET', /^\/api\/habits\/(\d+)$/, async (m) => this.habitResult(await this.data(), id(m))],
      ['PATCH', /^\/api\/habits\/(\d+)$/, (m, _q, b) => this.patchHabit(id(m), bodyOf(b))],
      ['DELETE', /^\/api\/habits\/(\d+)$/, (m) => this.deleteHabit(id(m))],
      ['POST', /^\/api\/habits\/(\d+)\/pause$/, (m, _q, b) => this.pauseHabit(id(m), bodyOf(b))],
      ['GET', /^\/api\/habits\/(\d+)\/days$/, (m, q) => this.habitDays(id(m), q)],
      ['PUT', /^\/api\/habits\/(\d+)\/days\/([^/]+)$/, (m, _q, b) => this.writeDay(id(m), date(m, 2), bodyOf(b))],
      ['DELETE', /^\/api\/habits\/(\d+)\/days\/([^/]+)$/, (m) => this.writeDay(id(m), date(m, 2), null)],
      ['GET', /^\/api\/routines$/, async () => this.listRoutines()],
      ['POST', /^\/api\/routines$/, (_m, _q, b) => this.createRoutine(bodyOf(b))],
      ['PATCH', /^\/api\/routines\/(\d+)$/, (m, _q, b) => this.patchRoutine(id(m), bodyOf(b))],
      ['DELETE', /^\/api\/routines\/(\d+)$/, (m) => this.deleteRoutine(id(m))],
      ['GET', /^\/api\/low-days$/, (_m, q) => this.listLowDays(q)],
      ['PUT', /^\/api\/low-days\/([^/]+)$/, (m) => this.setLowDay(date(m, 1), true)],
      ['DELETE', /^\/api\/low-days\/([^/]+)$/, (m) => this.setLowDay(date(m, 1), false)],
      ['GET', /^\/api\/stats\/weekly$/, async () => this.weekly()],
      ['GET', /^\/api\/stats\/days$/, (_m, q) => this.dayStats(q)],
      ['GET', /^\/api\/day-notes$/, (_m, q) => this.listNotes(q)],
      ['PUT', /^\/api\/day-notes\/([^/]+)$/, (m, _q, b) => this.putNote(date(m, 1), bodyOf(b))],
      ['DELETE', /^\/api\/day-notes\/([^/]+)$/, (m) => this.deleteNote(date(m, 1))],
      ['GET', /^\/api\/moods$/, async () => json(200, (await this.data()).moods.map(moodDto))],
      ['POST', /^\/api\/moods$/, (_m, _q, b) => this.createMood(bodyOf(b))],
      ['PATCH', /^\/api\/moods\/(\d+)$/, (m, _q, b) => this.patchMood(id(m), bodyOf(b))],
    ];
  }

  /** Answers one request; `url` is the path with its query string (no API base). Never rejects. */
  readonly handle = async (method: Method, url: string, body: unknown): Promise<Response> => {
    try {
      const parsed = new URL(url, 'http://ember.local');
      const input: unknown = body === undefined || body === null ? null : JSON.parse(JSON.stringify(body));
      for (const [routeMethod, pattern, handler] of this.routes) {
        const match = routeMethod === method ? pattern.exec(parsed.pathname) : null;
        if (match) return await handler(match, parsed.searchParams, input);
      }
      throw notFound();
    } catch (error) {
      return problemResponse(error instanceof Problem ? error : new Problem(500, 'internal'));
    }
  };

  private async data(): Promise<LocalData> {
    const data = await this.store.load();
    if (!data) throw new Problem(401, 'unauthenticated');
    return data;
  }

  private update(fn: (data: LocalData) => LocalData): Promise<LocalData> {
    return this.store.update(fn);
  }

  private today(data: LocalData): string {
    return localToday(data.profile.timezone, this.now());
  }

  private me(data: LocalData): Me {
    const profile = data.profile;
    return {
      id: profile.userId,
      email: null,
      emailConfirmed: false,
      hasPassword: false,
      discord: { linked: false, id: null },
      timezone: profile.timezone,
      timezoneSet: true,
      localToday: this.today(data),
      graceDaysPerWeek: profile.graceDaysPerWeek,
      secondReminderMinutes: profile.secondReminderMinutes ?? 0,
      theme: profile.theme,
      consent: { given: true, policyVersion: devicePolicyVersion, currentPolicyVersion: devicePolicyVersion },
      dmReminders: { paused: false },
      journal: { encrypted: false, turningOff: false, plaintextLeft: 0, encryptedLeft: 0 },
    };
  }

  private async patchMe(b: Body): Promise<Response> {
    const errors: Errors = {};
    const timezone = b['timezone'];
    if (timezone !== null && timezone !== undefined && (typeof timezone !== 'string' || !isValidTimeZone(timezone)))
      errors['timezone'] = ['Unknown IANA timezone.'];
    const grace = b['graceDaysPerWeek'];
    if (grace !== null && grace !== undefined && (!Number.isInteger(grace) || (grace as number) < 0 || (grace as number) > 3))
      errors['graceDaysPerWeek'] = ['Must be between 0 and 3.'];
    const theme = b['theme'];
    if (theme !== null && theme !== undefined && !themeIds.includes(theme as string)) errors['theme'] = ['Unknown theme.'];
    const second = b['secondReminderMinutes'];
    if (second !== null && second !== undefined && !(secondReminderChoices as readonly unknown[]).includes(second))
      errors['secondReminderMinutes'] = ['Must be 0, 15, 30, 60 or 120.'];
    if (Object.keys(errors).length) throw invalid(errors);
    const data = await this.update((d) => {
      if (typeof timezone === 'string') d.profile.timezone = timezone;
      if (typeof grace === 'number') d.profile.graceDaysPerWeek = grace;
      if (typeof theme === 'string') d.profile.theme = theme as LocalData['profile']['theme'];
      if (typeof second === 'number') d.profile.secondReminderMinutes = second as SecondReminderMinutes;
      return d;
    });
    return json(200, this.me(data));
  }

  private async consent(b: Body): Promise<Response> {
    if (b['policyVersion'] !== devicePolicyVersion) throw invalidField('policyVersion', 'Not the current policy version.');
    return empty();
  }

  private async exportFile(query: URLSearchParams): Promise<Response> {
    const format = query.get('format');
    if (format === 'csv') throw invalidField('format', 'Only json is available on this device.');
    if (format !== null && format !== 'json') throw invalidField('format', 'Must be json or csv.');
    const file = await backupText(this.store, this.now());
    return new Response(file.text, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${file.fileName}"`,
      },
    });
  }

  private habitResult(data: LocalData, id: number, status = 200): Response {
    if (!data.habits.some((h) => h.id === id)) throw notFound();
    return json(status, habitView(data, id, this.today(data)));
  }

  private async listHabits(): Promise<Response> {
    const data = await this.data();
    const today = this.today(data);
    return json(
      200,
      data.habits.map((h) => habitView(data, h.id, today)),
    );
  }

  private async createHabit(b: Body): Promise<Response> {
    const errors: Errors = {};
    const name = validName(b['name'], limits.habitName);
    if (name === null) errors['name'] = [`Must be 1 to ${limits.habitName} characters.`];
    const reminder = reminderField(b['reminderTime'], errors);
    const frequency = parseFrequency(b['frequency']);
    if (!frequency) errors['frequency'] = ['Must be daily, weekly or weekdays.'];
    weeklyTargetField(b['weeklyTarget'], frequency, errors);
    const days = daysField(b['days'], frequency, null, errors);
    const timesPerDay = timesPerDayField(b['timesPerDay'] ?? 1, frequency, errors);
    const times =
      reminderTimesField(b['reminderTimes'], frequency === 'weekly' ? 1 : timesPerDay, errors) ??
      (reminder ? [reminder] : []);
    const channels = channelsField(b['reminderChannels'], errors);
    if (Object.keys(errors).length) throw invalid(errors);

    let created = 0;
    const data = await this.update((d) => {
      if (d.habits.length >= limits.habits) throw new Problem(409, 'habit_limit');
      created = d.profile.nextIds.habit++;
      d.habits.push({
        id: created,
        name: name!,
        frequency: frequency!,
        weeklyTarget: frequency === 'weekly' ? ((b['weeklyTarget'] as number | null | undefined) ?? 3) : null,
        days: frequency === 'weekdays' ? days : null,
        timesPerDay: frequency === 'weekly' ? 1 : timesPerDay,
        reminderTime: times[0] ?? null,
        reminderTimes: times,
        reminderChannels: channels ?? (this.options.native ? ['mobile'] : []),
        pausedFrom: null,
        pausedUntil: null,
        createdAt: this.now().toISOString(),
        routineId: null,
        routinePosition: null,
      });
      return d;
    });
    return this.habitResult(data, created, 201);
  }

  private async patchHabit(id: number, b: Body): Promise<Response> {
    const habit = (await this.data()).habits.find((h) => h.id === id);
    if (!habit) throw notFound();
    const errors: Errors = {};
    const nameGiven = b['name'] !== null && b['name'] !== undefined;
    const name = nameGiven ? validName(b['name'], limits.habitName) : null;
    if (nameGiven && name === null) errors['name'] = [`Must be 1 to ${limits.habitName} characters.`];
    const reminder = reminderField(b['reminderTime'], errors);
    const clearReminder = b['clearReminder'] === true;
    if (b['reminderTime'] !== null && b['reminderTime'] !== undefined && clearReminder)
      errors['reminderTime'] = ["Can't be combined with clearReminder."];
    const frequencyGiven = b['frequency'] !== null && b['frequency'] !== undefined;
    const frequency = parseFrequency(b['frequency']);
    if (frequencyGiven && !frequency) errors['frequency'] = ['Must be daily, weekly or weekdays.'];
    const newFrequency = frequencyGiven ? frequency : habit.frequency;
    weeklyTargetField(b['weeklyTarget'], frequency ?? habit.frequency, errors);
    const days = daysField(b['days'], newFrequency, habit.days, errors);
    const timesPerDay = timesPerDayField(
      b['timesPerDay'] ?? (newFrequency === 'weekly' ? 1 : habit.timesPerDay),
      newFrequency,
      errors,
    );
    const times = reminderTimesField(b['reminderTimes'], newFrequency === 'weekly' ? 1 : timesPerDay, errors);
    if (times !== null && clearReminder) errors['reminderTimes'] = ["Can't be combined with clearReminder."];
    const channels = channelsField(b['reminderChannels'], errors);
    if (Object.keys(errors).length) throw invalid(errors);

    const scheduleGiven = [b['frequency'], b['weeklyTarget'], b['days'], b['timesPerDay']].some(
      (value) => value !== null && value !== undefined,
    );
    const data = await this.update((d) => {
      const h = d.habits.find((x) => x.id === id);
      if (!h) throw notFound();
      if (name !== null) h.name = name;
      let kept = times ?? (clearReminder ? [] : reminder !== null ? [reminder] : reminderTimesOf(h));
      if (channels) h.reminderChannels = channels;
      if (scheduleGiven) {
        const target = newFrequency === 'weekly' ? 1 : timesPerDay;
        if (target !== h.timesPerDay) d.logs = retarget(d, id, target, this.today(d));
        h.weeklyTarget =
          newFrequency === 'weekly' ? ((b['weeklyTarget'] as number | null | undefined) ?? h.weeklyTarget ?? 3) : null;
        h.frequency = newFrequency!;
        h.days = newFrequency === 'weekdays' ? days : null;
        h.timesPerDay = target;
        kept = kept.slice(0, target);
      }
      h.reminderTimes = kept;
      h.reminderTime = kept[0] ?? null;
      return d;
    });
    return this.habitResult(data, id);
  }

  private async deleteHabit(id: number): Promise<Response> {
    await this.update((d) => {
      if (!d.habits.some((h) => h.id === id)) throw notFound();
      d.habits = d.habits.filter((h) => h.id !== id);
      d.logs = d.logs.filter((log) => log.habitId !== id);
      return d;
    });
    return empty();
  }

  private async pauseHabit(id: number, b: Body): Promise<Response> {
    const until = b['until'];
    if (until !== null && until !== undefined && !isDate(until)) throw invalidField('until', dateMessage);
    const data = await this.update((d) => {
      const today = this.today(d);
      if (typeof until === 'string' && until < today) throw invalidField('until', "Can't be before today.");
      const habit = d.habits.find((h) => h.id === id);
      if (!habit) throw notFound();
      Object.assign(habit, pause(habit, typeof until === 'string' ? until : null, today));
      return d;
    });
    return this.habitResult(data, id);
  }

  private async habitDays(id: number, query: URLSearchParams): Promise<Response> {
    const data = await this.data();
    const today = this.today(data);
    const { from, to } = rangeOf(query, today, 13, { notAfterToday: true });
    if (!data.habits.some((h) => h.id === id)) throw notFound();
    return json(200, habitDays(data, id, from, to, today));
  }

  private async writeDay(id: number, date: string, b: Body | null): Promise<Response> {
    const errors: Errors = {};
    if (!isDate(date)) errors['date'] = [dateMessage];
    const completed = b?.['completed'];
    const count = b?.['count'];
    if (b) {
      const hasCompleted = completed !== null && completed !== undefined;
      const hasCount = count !== null && count !== undefined;
      if (!hasCompleted && !hasCount) errors['completed'] = ['Send completed or count.'];
      if (hasCompleted && hasCount) errors['count'] = ["Can't be combined with completed."];
      if (hasCompleted && typeof completed !== 'boolean') errors['completed'] = ['Must be true or false.'];
      if (hasCount && !Number.isInteger(count)) errors['count'] = ['Must be a whole number.'];
    }
    if (Object.keys(errors).length) throw invalid(errors);

    const data = await this.update((d) => {
      const habit = d.habits.find((h) => h.id === id);
      if (!habit) throw notFound();
      if (typeof count === 'number' && (count < 0 || count > habit.timesPerDay))
        throw invalidField('count', `Must be between 0 and ${habit.timesPerDay}.`);
      if (date > this.today(d)) throw new Problem(422, 'in_future');
      if (date < habitStartDate(habit, d.profile.timezone)) throw new Problem(422, 'before_habit_start');
      d.logs = writeDay(
        d,
        id,
        date,
        typeof count === 'number' ? { count } : { completed: b ? (completed as boolean) : null },
      );
      return d;
    });
    return this.habitResult(data, id);
  }

  private async listRoutines(): Promise<Response> {
    const data = await this.data();
    return json(
      200,
      data.routines.map((r) => routineDto(data, r)),
    );
  }

  private async createRoutine(b: Body): Promise<Response> {
    const errors: Errors = {};
    const name = validName(b['name'], limits.routineName);
    if (name === null) errors['name'] = [`Must be 1 to ${limits.routineName} characters.`];
    const reminder = reminderField(b['reminderTime'], errors);
    const channels = channelsField(b['reminderChannels'], errors);
    const habitIds = habitIdsField(b['habitIds'], errors);
    if (Object.keys(errors).length) throw invalid(errors);

    let created = 0;
    const data = await this.update((d) => {
      if (d.routines.length >= limits.routines)
        throw new Problem(
          409,
          'conflict',
          `You already have ${limits.routines} routines, the most Ember can hold. Delete one to add another.`,
        );
      created = d.profile.nextIds.routine++;
      d.routines.push({
        id: created,
        name: name!,
        reminderTime: reminder,
        reminderChannels: channels ?? (this.options.native ? ['mobile'] : []),
      });
      if (habitIds) setMembers(d, created, habitIds);
      return d;
    });
    return json(201, routineDto(data, data.routines.find((r) => r.id === created)!));
  }

  private async patchRoutine(id: number, b: Body): Promise<Response> {
    const errors: Errors = {};
    const nameGiven = b['name'] !== null && b['name'] !== undefined;
    const name = nameGiven ? validName(b['name'], limits.routineName) : null;
    if (nameGiven && name === null) errors['name'] = [`Must be 1 to ${limits.routineName} characters.`];
    const reminder = reminderField(b['reminderTime'], errors);
    const clearReminder = b['clearReminder'] === true;
    if (b['reminderTime'] !== null && b['reminderTime'] !== undefined && clearReminder)
      errors['reminderTime'] = ["Can't be combined with clearReminder."];
    const channels = channelsField(b['reminderChannels'], errors);
    const habitIds = habitIdsField(b['habitIds'], errors);
    if (Object.keys(errors).length) throw invalid(errors);

    const data = await this.update((d) => {
      const routine = d.routines.find((r) => r.id === id);
      if (!routine) throw notFound();
      if (habitIds) setMembers(d, id, habitIds);
      if (name !== null) routine.name = name;
      if (channels) routine.reminderChannels = channels;
      if (clearReminder) routine.reminderTime = null;
      else if (reminder !== null) routine.reminderTime = reminder;
      return d;
    });
    return json(200, routineDto(data, data.routines.find((r) => r.id === id)!));
  }

  private async deleteRoutine(id: number): Promise<Response> {
    await this.update((d) => {
      if (!d.routines.some((r) => r.id === id)) throw notFound();
      d.routines = d.routines.filter((r) => r.id !== id);
      for (const habit of d.habits) {
        if (habit.routineId !== id) continue;
        habit.routineId = null;
        habit.routinePosition = null;
      }
      return d;
    });
    return empty();
  }

  private async listLowDays(query: URLSearchParams): Promise<Response> {
    const data = await this.data();
    const today = this.today(data);
    const errors: Errors = {};
    const toParam = query.get('to');
    const fromParam = query.get('from');
    if (toParam !== null && !isDate(toParam)) errors['to'] = [dateMessage];
    if (fromParam !== null && !isDate(fromParam)) errors['from'] = [dateMessage];
    if (Object.keys(errors).length) throw invalid(errors);
    const to = toParam ?? today;
    const from = fromParam ?? addDays(to, -365);
    if (from > to) throw invalidField('from', "Can't be after to.");
    return json(
      200,
      data.lowDays.filter((d) => d >= from && d <= to).sort(),
    );
  }

  private async setLowDay(date: string, on: boolean): Promise<Response> {
    if (!isDate(date)) throw invalidField('date', dateMessage);
    await this.update((d) => {
      if (on) {
        journalDayCheck(d, date, this.today(d));
        if (!d.lowDays.includes(date)) d.lowDays.push(date);
      } else {
        d.lowDays = d.lowDays.filter((day) => day !== date);
      }
      return d;
    });
    return empty();
  }

  private async weekly(): Promise<Response> {
    const data = await this.data();
    return json(200, weeklySummary(data, this.today(data)));
  }

  private async dayStats(query: URLSearchParams): Promise<Response> {
    const data = await this.data();
    const today = this.today(data);
    const { from, to } = rangeOf(query, today, limits.rangeDays - 1, { notAfterToday: true });
    return json(200, dayStats(data, from, to, today));
  }

  private async listNotes(query: URLSearchParams): Promise<Response> {
    const data = await this.data();
    const { from, to } = rangeOf(query, this.today(data), limits.rangeDays - 1, { notAfterToday: false });
    return json(
      200,
      data.notes
        .filter((n) => n.date >= from && n.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((n): DayNote => ({ date: n.date, text: n.text, mood: n.mood })),
    );
  }

  private async putNote(date: string, b: Body): Promise<Response> {
    if (!isDate(date)) throw invalidField('date', dateMessage);
    let note: DayNote = { date, text: null, mood: null };
    await this.update((d) => {
      journalDayCheck(d, date, this.today(d));
      const errors: Errors = {};
      if (b['encrypted'] !== null && b['encrypted'] !== undefined)
        errors['encrypted'] = ['The private journal is off. Send this as plaintext.'];
      const rawText = b['text'];
      let text: string | null = null;
      if (rawText !== null && rawText !== undefined) {
        if (typeof rawText !== 'string') errors['text'] = ['Must be text.'];
        else text = rawText.trim() || null;
        if (text !== null && text.length > limits.noteText)
          errors['text'] = [`Must be at most ${limits.noteText} characters.`];
      }
      const rawMood = b['mood'];
      const mood = rawMood === null || rawMood === undefined ? null : (rawMood as MoodKey);
      const existing = d.notes.find((n) => n.date === date);
      if (mood !== null && !(existing?.mood === mood || allowedMood(d, mood)))
        errors['mood'] = ['Must be low, meh, okay, good, great or one of your own active moods.'];
      if (Object.keys(errors).length) throw invalid(errors);
      d.notes = d.notes.filter((n) => n.date !== date);
      if (text !== null || mood !== null) {
        note = { date, text, mood };
        d.notes.push(note);
      }
      return d;
    });
    return json(200, note);
  }

  private async deleteNote(date: string): Promise<Response> {
    if (!isDate(date)) throw invalidField('date', dateMessage);
    await this.update((d) => {
      d.notes = d.notes.filter((n) => n.date !== date);
      return d;
    });
    return empty();
  }

  private async createMood(b: Body): Promise<Response> {
    const errors: Errors = {};
    if (b['encrypted'] !== null && b['encrypted'] !== undefined)
      errors['encrypted'] = ['The private journal is off. Send this as plaintext.'];
    const label = validName(b['label'], limits.moodLabel);
    if (label === null) errors['label'] = [`Must be 1 to ${limits.moodLabel} characters.`];
    const emoji = b['emoji'] ?? null;
    if (emoji !== null && !isEmoji(emoji)) errors['emoji'] = ['Must be a single emoji.'];
    const archived = b['archived'] === true;
    if (Object.keys(errors).length) throw invalid(errors);

    let mood: OwnMood | null = null;
    await this.update((d) => {
      if (!archived && activeMoods(d) >= limits.activeMoods) throw moodLimit();
      mood = { id: d.profile.nextIds.mood++, label: label!, emoji: emoji as string | null, archived };
      d.moods.push(mood);
      return d;
    });
    return json(201, mood);
  }

  private async patchMood(id: number, b: Body): Promise<Response> {
    const errors: Errors = {};
    if (b['encrypted'] !== null && b['encrypted'] !== undefined)
      errors['encrypted'] = ['The private journal is off. Send this as plaintext.'];
    const labelGiven = b['label'] !== null && b['label'] !== undefined;
    const label = labelGiven ? validName(b['label'], limits.moodLabel) : null;
    if (labelGiven && label === null) errors['label'] = [`Must be 1 to ${limits.moodLabel} characters.`];
    const emojiGiven = Object.hasOwn(b, 'emoji');
    const emoji = b['emoji'] ?? null;
    if (emojiGiven && emoji !== null && !isEmoji(emoji)) errors['emoji'] = ['Must be a single emoji.'];
    const archived = b['archived'];
    if (archived !== null && archived !== undefined && typeof archived !== 'boolean')
      errors['archived'] = ['Must be true or false.'];
    if (Object.keys(errors).length) throw invalid(errors);

    let result: OwnMood | null = null;
    await this.update((d) => {
      const mood = d.moods.find((m) => m.id === id);
      if (!mood) throw notFound();
      if (archived === false && mood.archived && activeMoods(d) >= limits.activeMoods) throw moodLimit();
      if (label !== null) mood.label = label;
      if (emojiGiven) mood.emoji = emoji as string | null;
      if (typeof archived === 'boolean') mood.archived = archived;
      result = moodDto(mood);
      return d;
    });
    return json(200, result);
  }
}

function activeMoods(data: LocalData): number {
  return data.moods.filter((m) => !m.archived).length;
}

function moodLimit(): Problem {
  return new Problem(
    409,
    'conflict',
    `You already have ${limits.activeMoods} active moods. Archive one to add another.`,
  );
}

function allowedMood(data: LocalData, mood: string): boolean {
  if ((builtinMoods as readonly string[]).includes(mood)) return true;
  const match = /^custom:([1-9]\d*)$/.exec(mood);
  return !!match && data.moods.some((m) => m.id === Number(match[1]) && !m.archived);
}

async function backupText(store: LocalStore, now: Date): Promise<{ text: string; fileName: string }> {
  const data = await store.load();
  if (!data) throw new Error('No device data.');
  return {
    text: JSON.stringify(exportDocument(data)),
    fileName: `ember-backup-${localToday(data.profile.timezone, now)}.json`,
  };
}

/** Builds the backup file (`ember-backup-<local today>.json`); the backup time is recorded once the file is saved. */
export async function exportBackupFile(store: LocalStore, now: Date = new Date()): Promise<{ blob: Blob; fileName: string }> {
  const { text, fileName } = await backupText(store, now);
  return { blob: new Blob([text], { type: 'application/json' }), fileName };
}

/** A fresh device profile and empty data for no-account mode. */
export function newLocalData(profile: Pick<LocalData['profile'], 'timezone' | 'theme'>, now: Date): LocalData {
  return {
    profile: {
      userId: crypto.randomUUID(),
      timezone: profile.timezone,
      graceDaysPerWeek: 1,
      theme: profile.theme,
      createdAt: now.toISOString(),
      lastBackupAt: null,
      backupReminderSnoozedUntil: null,
      nextIds: { habit: 1, routine: 1, mood: 1 },
    },
    habits: [],
    logs: [],
    lowDays: [],
    routines: [],
    moods: [],
    notes: [],
  };
}

