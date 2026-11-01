import { ChangeDetectionStrategy, Component, computed, inject, signal, effect, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { formatDate } from '../../core/local-date';
import { Habit, WeeklyStats } from '../../core/models';
import { asApiError, problemToMessage } from '../../core/problem';
import { EmptyStateComponent } from '../../shared/empty-state';
import { IconComponent } from '../../shared/icon';
import { DeviceSync } from '../../core/device-sync';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

interface TodayRow {
  habit: Habit;
  checkable: boolean;
  done: boolean;
  note: string;
}

const shortDate: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'long' };

function progressText(habit: Habit): string {
  const week = habit.stats.week;
  if (week) {
    if (week.done > 0) return `${week.done} of ${week.target} this week`;
    return week.target === 1 ? 'Once a week' : `${week.target} times a week`;
  }
  const streak = habit.stats.streak ?? 0;
  return streak > 0 ? `${streak}-day streak` : 'Every day';
}

function rowFor(habit: Habit): TodayRow {
  const state = habit.today.state;
  const done = state === 'done';
  let note: string;
  if (state === 'paused' || habit.pausedToday) {
    note = habit.pausedUntil
      ? `Paused until ${formatDate(habit.pausedUntil, shortDate)}. You can resume it any time under Edit.`
      : 'Paused. You can resume it any time under Edit.';
    return { habit, checkable: false, done: false, note };
  }
  if (state === 'beforestart') {
    return {
      habit,
      checkable: false,
      done: false,
      note: `Starts ${formatDate(habit.startDate, shortDate)}.`,
    };
  }
  if (done) note = `Done today · ${progressText(habit)}`;
  else if (state === 'lowday') note = 'Low day, resting. Checking in is still welcome.';
  else note = progressText(habit);
  return { habit, checkable: true, done, note };
}

@Component({
  selector: 'app-today-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    PageComponent,
    NoticeComponent,
    EmptyStateComponent,
    IconComponent,
    SpinnerComponent,
  ],
  template: `
    <app-page heading="Today" [lede]="lede()">
      <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>

      @if (problem(); as p) {
        <app-notice tone="notice" [heading]="p.heading">{{ p.message }}</app-notice>
      }

      @switch (status()) {
        @case ('loading') {
          <div class="stack" aria-busy="true">
            <span class="visually-hidden">Loading your habits…</span>
            @for (i of placeholders; track i) {
              <div class="skeleton row-skeleton"></div>
            }
          </div>
        }
        @case ('error') {
          @if (loadProblem(); as message) {
            <app-notice tone="notice" heading="Your habits didn't load">
              <p>{{ message }}</p>
              <div>
                <button class="btn btn-secondary" type="button" (click)="load()">Try again</button>
              </div>
            </app-notice>
          }
        }
        @default {
          @if (rows().length === 0) {
            <app-empty-state heading="Ready when you are.">
              <p>Start with one small habit. You can add more any time.</p>
              <a class="btn btn-primary" routerLink="/habits/new">Create your first habit</a>
            </app-empty-state>
          } @else {
            <ul class="habits" role="list">
              @for (row of rows(); track row.habit.id) {
                <li class="card habit">
                  <div class="habit-main">
                    <h2 class="habit-name">{{ row.habit.name }}</h2>
                    <p class="habit-note muted">
                      @if (row.habit.today.state === 'lowday') {
                        <app-icon class="note-icon" name="moon" />
                      } @else if (!row.checkable) {
                        <app-icon class="note-icon" name="pause" />
                      }
                      {{ row.note }}
                    </p>
                    <a class="tap-link edit" [routerLink]="['/habits', row.habit.id, 'edit']">
                      Edit<span class="visually-hidden"> {{ row.habit.name }}</span>
                    </a>
                  </div>
                  @if (row.checkable) {
                    <button
                      type="button"
                      class="check"
                      [attr.aria-pressed]="row.done"
                      [attr.aria-label]="'Check in ' + row.habit.name + ' for today'"
                      [attr.aria-disabled]="busy().has(row.habit.id) ? 'true' : null"
                      (click)="toggle(row.habit)"
                    >
                      @if (busy().has(row.habit.id)) {
                        <app-spinner />
                      } @else {
                        <app-icon name="check" />
                      }
                    </button>
                  }
                </li>
              }
            </ul>

            @if (lowDayToday() === true) {
              <app-notice tone="lowday" heading="Today is a low day">
                <p>Go gently. Checking in is still welcome if you feel like it.</p>
                <div>
                  <button
                    class="btn btn-quiet"
                    type="button"
                    [attr.aria-disabled]="lowDayBusy() ? 'true' : null"
                    (click)="toggleLowDay()"
                  >
                    Clear low day
                  </button>
                </div>
              </app-notice>
            }

            <div class="row">
              <a class="btn btn-secondary" routerLink="/habits/new">New habit</a>
              @if (lowDayToday() === false) {
                <button
                  class="btn btn-quiet"
                  type="button"
                  [attr.aria-disabled]="lowDayBusy() ? 'true' : null"
                  (click)="toggleLowDay()"
                >
                  <app-icon name="moon" />
                  Mark today as a low day
                </button>
              }
            </div>

            @if (weekly(); as w) {
              <section class="card stack weekly" aria-labelledby="weekly-heading">
                <h2 id="weekly-heading">Your week</h2>
                <p>{{ w.headline }}</p>
                @if (w.footer) {
                  <p class="muted">{{ w.footer }}</p>
                }
              </section>
            }
          }
        }
      }
    </app-page>
  `,
  styles: `
    .habits {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-3);
    }
    .habit {
      display: flex;
      align-items: center;
      gap: var(--space-4);
      padding: var(--space-4) var(--space-4) var(--space-2);
    }
    .habit-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
    }
    .habit-name {
      font-size: var(--text-md);
    }
    .habit-note {
      font-size: var(--text-sm);
    }
    .note-icon {
      display: inline-flex;
      vertical-align: -0.2em;
      --icon-size: 1rem;
    }
    .edit {
      align-self: flex-start;
      min-width: var(--tap);
      font-size: var(--text-sm);
    }
    .check {
      flex: none;
      display: grid;
      place-items: center;
      width: 3.25rem;
      height: 3.25rem;
      border-radius: var(--radius-full);
      border: 2px solid var(--color-primary);
      background: var(--color-surface);
      color: var(--color-primary);
      cursor: pointer;
      --icon-size: 1.5rem;
      transition:
        background-color var(--dur) var(--ease-out),
        border-color var(--dur) var(--ease-out),
        transform var(--dur-fast) var(--ease-out);
    }
    .check[aria-pressed='true'] {
      background: var(--color-done);
      border-color: var(--color-done);
      color: var(--color-on-done);
    }
    .check:active:not([aria-disabled='true']) {
      transform: scale(0.94);
    }
    .check[aria-disabled='true'] {
      cursor: progress;
    }
    .row-skeleton {
      height: 5.5rem;
    }
    .weekly p {
      white-space: pre-line;
    }
  `,
})
export class TodayPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly sync = inject(DeviceSync);

  protected readonly placeholders = [1, 2, 3];
  protected readonly today = computed(() => this.auth.me()?.localToday ?? null);
  protected readonly lede = computed(() => {
    const today = this.today();
    return today
      ? formatDate(today, { weekday: 'long', day: 'numeric', month: 'long' })
      : undefined;
  });

  protected readonly status = signal<'loading' | 'error' | 'ready'>('loading');
  protected readonly loadProblem = signal<string | null>(null);
  protected readonly habits = signal<Habit[]>([]);
  protected readonly rows = computed(() => this.habits().map(rowFor));
  protected readonly weekly = signal<WeeklyStats | null>(null);
  /** Null when the low-day lookup failed; the low-day action is hidden then. */
  protected readonly lowDayToday = signal<boolean | null>(null);
  protected readonly busy = signal<ReadonlySet<number>>(new Set());
  protected readonly lowDayBusy = signal(false);
  protected readonly problem = signal<{ heading: string; message: string } | null>(null);
  protected readonly announcement = signal('');

  constructor() {
    effect(() => {
      this.sync.synced();
      untracked(() => void this.load());
    });
  }

  protected async load(): Promise<void> {
    this.status.set('loading');
    this.loadProblem.set(null);
    await this.auth.loadMe(true).catch(() => null);
    const today = this.today();
    const [habits, lowDays, weekly] = await Promise.allSettled([
      this.api.listHabits(),
      today ? this.api.listLowDays(today, today) : Promise.reject(new Error('no local day')),
      this.api.weeklyStats(),
    ]);
    if (habits.status === 'rejected') {
      const error = asApiError(habits.reason);
      this.loadProblem.set(error.handled ? null : problemToMessage(error).message);
      this.status.set('error');
      return;
    }
    this.habits.set(habits.value);
    this.lowDayToday.set(
      lowDays.status === 'fulfilled' && today ? lowDays.value.includes(today) : null,
    );
    this.weekly.set(weekly.status === 'fulfilled' ? weekly.value : null);
    this.status.set('ready');
  }

  protected async toggle(habit: Habit): Promise<void> {
    if (this.busy().has(habit.id)) return;
    const checkIn = habit.today.state !== 'done';
    const restingState = this.lowDayToday() ? 'lowday' : 'pending';
    this.setBusy(habit.id, true);
    this.problem.set(null);
    this.replace({
      ...habit,
      today: {
        ...habit.today,
        state: checkIn ? 'done' : restingState,
        completed: checkIn ? true : null,
      },
    });
    try {
      const updated = checkIn
        ? await this.api.setDay(habit.id, habit.today.date, true)
        : await this.api.clearDay(habit.id, habit.today.date);
      this.replace(updated);
      this.announcement.set(
        checkIn ? `${habit.name}: checked in for today.` : `${habit.name}: check-in cleared.`,
      );
    } catch (error) {
      this.replace(habit);
      const apiError = asApiError(error);
      if (!apiError.handled) {
        this.problem.set({
          heading: checkIn
            ? `Your check-in for ${habit.name} didn't save`
            : `${habit.name} didn't change`,
          message: problemToMessage(apiError).message,
        });
      }
    } finally {
      this.setBusy(habit.id, false);
    }
  }

  protected async toggleLowDay(): Promise<void> {
    const today = this.today();
    if (!today || this.lowDayBusy()) return;
    const mark = !this.lowDayToday();
    this.lowDayBusy.set(true);
    this.problem.set(null);
    try {
      if (mark) await this.api.markLowDay(today);
      else await this.api.clearLowDay(today);
      this.lowDayToday.set(mark);
      this.announcement.set(mark ? 'Today is marked as a low day.' : 'Low day cleared.');
      this.habits.set(await this.api.listHabits().catch(() => this.habits()));
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) {
        this.problem.set({
          heading: mark
            ? "Today couldn't be marked as a low day"
            : "The low day couldn't be cleared",
          message: problemToMessage(apiError).message,
        });
      }
    } finally {
      this.lowDayBusy.set(false);
    }
  }

  private replace(habit: Habit): void {
    this.habits.update((list) => list.map((h) => (h.id === habit.id ? habit : h)));
  }

  private setBusy(id: number, on: boolean): void {
    this.busy.update((set) => {
      const next = new Set(set);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
}
