import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  ElementRef,
  inject,
  Injector,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Location } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import {
  addMonths,
  formatDate,
  monthLabel,
  startOfMonth,
  weekdayLabels,
} from '../../core/local-date';
import { DayEntry, Habit, LocalDateString } from '../../core/models';
import { asApiError, problemToMessage } from '../../core/problem';
import { EmptyStateComponent } from '../../shared/empty-state';
import { IconComponent } from '../../shared/icon';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';
import {
  buildMonth,
  CalendarDay,
  canGoNext,
  canGoPrevious,
  dayLabel,
  monthRange,
} from './calendar';

interface Cell extends CalendarDay {
  num: number;
  name: string;
}

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

const legend = [
  { state: 'done', text: 'Done' },
  { state: 'notdone', text: 'Not checked in' },
  { state: 'pending', text: 'Still open' },
  { state: 'lowday', text: 'Low day' },
  { state: 'paused', text: 'Paused' },
  { state: 'beforestart', text: 'Before the habit started' },
] as const;

@Component({
  selector: 'app-history-page',
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
    <app-page heading="History" lede="Any day can be filled in later. Tap a day to change it.">
      <p class="visually-hidden" aria-live="polite">{{ announcement() }}</p>

      @if (habits(); as list) {
        @if (list.length === 0) {
          <app-empty-state heading="Nothing to look back on yet">
            <p>Once you have a habit, its days show up here.</p>
            <a class="btn btn-primary" routerLink="/habits/new">Create a habit</a>
          </app-empty-state>
        } @else {
          @if (list.length > 1) {
            <div class="picker">
              <label class="label" for="habit-picker">Habit</label>
              <select id="habit-picker" class="input" (change)="choose($event)">
                @for (h of list; track h.id) {
                  <option [value]="h.id" [selected]="h.id === selected()?.id">{{ h.name }}</option>
                }
              </select>
            </div>
          }

          @if (selected(); as habit) {
            <section class="stack" aria-labelledby="month-heading">
              @if (list.length === 1) {
                <p class="muted">{{ habit.name }}</p>
              }
              <div class="pager">
                <button
                  class="btn btn-quiet"
                  type="button"
                  aria-label="Previous month"
                  [attr.aria-disabled]="canPrev() ? null : 'true'"
                  (click)="shiftMonth(-1)"
                >
                  <app-icon name="arrow-left" />
                </button>
                <h2 id="month-heading" aria-live="polite">{{ monthTitle() }}</h2>
                <button
                  class="btn btn-quiet"
                  type="button"
                  aria-label="Next month"
                  [attr.aria-disabled]="canNext() ? null : 'true'"
                  (click)="shiftMonth(1)"
                >
                  <app-icon class="flip" name="arrow-left" />
                </button>
              </div>

              @if (monthProblem(); as message) {
                <app-notice tone="notice" heading="These days didn't load">
                  <p>{{ message }}</p>
                  <div>
                    <button class="btn btn-secondary" type="button" (click)="loadMonth(false)">
                      Try again
                    </button>
                  </div>
                </app-notice>
              } @else {
                <table
                  class="grid"
                  aria-labelledby="month-heading"
                  [attr.aria-busy]="monthLoading() ? 'true' : null"
                >
                  <thead>
                    <tr>
                      @for (w of weekdays; track $index) {
                        <th scope="col">
                          <span aria-hidden="true">{{ w.short }}</span>
                          <span class="visually-hidden">{{ w.long }}</span>
                        </th>
                      }
                    </tr>
                  </thead>
                  <tbody>
                    @for (week of cells(); track week[0].date) {
                      <tr>
                        @for (day of week; track day.date) {
                          <td>
                            @if (day.inMonth) {
                              @if (day.editable) {
                                <button
                                  type="button"
                                  class="day"
                                  [id]="'day-' + day.date"
                                  [attr.data-state]="day.state"
                                  [attr.aria-label]="day.name"
                                  [attr.aria-current]="day.isToday ? 'date' : null"
                                  [attr.aria-expanded]="openDate() === day.date"
                                  [attr.aria-controls]="
                                    openDate() === day.date ? 'day-panel' : null
                                  "
                                  (click)="toggleDay(day.date)"
                                >
                                  <span class="num">{{ day.num }}</span>
                                  @if (day.state === 'done') {
                                    <app-icon name="check" />
                                  } @else if (day.state === 'lowday') {
                                    <app-icon name="moon" />
                                  }
                                </button>
                              } @else {
                                <span class="day" [attr.data-state]="day.state ?? 'future'">
                                  <span class="num" aria-hidden="true">{{ day.num }}</span>
                                  <span class="visually-hidden">{{ day.name }}</span>
                                </span>
                              }
                            }
                          </td>
                        }
                      </tr>
                    }
                  </tbody>
                </table>
              }

              @if (openCell(); as day) {
                <section
                  id="day-panel"
                  class="card stack panel"
                  aria-labelledby="day-panel-heading"
                  (keydown.escape)="closeDay()"
                >
                  <div>
                    <h3 id="day-panel-heading" tabindex="-1">{{ day.longDate }}</h3>
                    <p class="muted">{{ day.stateText }}</p>
                  </div>
                  <div class="row">
                    <button
                      class="btn btn-primary"
                      type="button"
                      [attr.aria-disabled]="busy() ? 'true' : null"
                      (click)="editDay('done')"
                    >
                      Done
                    </button>
                    <button
                      class="btn btn-secondary"
                      type="button"
                      [attr.aria-disabled]="busy() ? 'true' : null"
                      (click)="editDay('notdone')"
                    >
                      Not done
                    </button>
                    <button
                      class="btn btn-secondary"
                      type="button"
                      [attr.aria-disabled]="busy() ? 'true' : null"
                      (click)="editDay('clear')"
                    >
                      Clear
                    </button>
                  </div>
                  <div class="stack-tight">
                    <button
                      class="btn btn-quiet lowday"
                      type="button"
                      [attr.aria-disabled]="busy() ? 'true' : null"
                      (click)="toggleLowDay()"
                    >
                      <app-icon name="moon" />
                      {{ day.lowDay ? 'Clear low day' : 'Mark as a low day' }}
                    </button>
                    <p class="muted small">Low days apply to all your habits.</p>
                  </div>
                  @if (busy()) {
                    <p class="row muted small"><app-spinner /> Saving…</p>
                  }
                  @if (dayProblem(); as message) {
                    <app-notice tone="notice">{{ message }}</app-notice>
                  }
                  <div>
                    <button class="btn btn-quiet" type="button" (click)="closeDay()">Close</button>
                  </div>
                </section>
              }

              <ul class="legend" aria-label="Legend">
                @for (item of legend; track item.state) {
                  <li>
                    <span class="day" [attr.data-state]="item.state" aria-hidden="true">
                      @if (item.state === 'done') {
                        <app-icon name="check" />
                      } @else if (item.state === 'lowday') {
                        <app-icon name="moon" />
                      }
                    </span>
                    {{ item.text }}
                  </li>
                }
              </ul>
            </section>
          } @else {
            <app-notice tone="notice" heading="We couldn't find that habit">
              <p>It may have been removed.</p>
              <div>
                <a class="btn btn-secondary" routerLink="/history">Show my history</a>
              </div>
            </app-notice>
          }
        }
      } @else if (listProblem(); as message) {
        <app-notice tone="notice" heading="Your habits didn't load">
          <p>{{ message }}</p>
          <div>
            <button class="btn btn-secondary" type="button" (click)="loadHabits()">
              Try again
            </button>
          </div>
        </app-notice>
      } @else {
        <div class="stack" aria-busy="true">
          <span class="visually-hidden">Loading your history…</span>
          <div class="skeleton grid-skeleton"></div>
        </div>
      }
    </app-page>
  `,
  styles: `
    .picker {
      display: flex;
      flex-direction: column;
      gap: var(--space-2);
    }
    .label {
      font-weight: var(--weight-medium);
    }
    .pager {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--space-2);
    }
    .flip {
      transform: scaleX(-1);
    }
    .grid {
      border-collapse: separate;
      border-spacing: 2px;
      margin-inline: auto;
    }
    .grid[aria-busy='true'] {
      opacity: 0.6;
    }
    th {
      padding-bottom: var(--space-1);
      font-size: var(--text-xs);
      font-weight: var(--weight-medium);
      color: var(--color-text-muted);
    }
    td {
      padding: 0;
      text-align: center;
    }
    .day {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 0;
      font: inherit;
      font-size: var(--text-sm);
      line-height: 1.1;
      --icon-size: 0.875rem;
    }
    button.day {
      cursor: pointer;
      transition: transform var(--dur-fast) var(--ease-out);
    }
    button.day:active {
      transform: scale(0.94);
    }
    .day[data-state='future'] {
      border-color: transparent;
      background: transparent;
    }
    .day[aria-current='date'] .num {
      font-weight: var(--weight-bold);
      text-decoration: underline;
    }
    .day[aria-expanded='true'] {
      box-shadow:
        0 0 0 2px var(--color-bg),
        0 0 0 4px var(--color-text);
    }
    .panel {
      padding: var(--space-4);
    }
    .stack-tight {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }
    .small {
      font-size: var(--text-sm);
    }
    .legend {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2) var(--space-4);
      font-size: var(--text-sm);
    }
    .legend li {
      display: flex;
      align-items: center;
      gap: var(--space-2);
    }
    .legend .day {
      width: 1.75rem;
      height: 1.75rem;
    }
    .grid-skeleton {
      height: 20rem;
    }
    @media (min-width: 48rem) {
      .grid {
        border-spacing: var(--space-1);
      }
      .grid .day {
        width: 3.25rem;
        height: 3.25rem;
      }
    }
  `,
})
export class HistoryPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly location = inject(Location);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly params = toSignal(inject(ActivatedRoute).paramMap, { requireSync: true });
  private requestId = 0;

  protected readonly legend = legend;
  private readonly weekdayNames = weekdayLabels(undefined, 'long');
  protected readonly weekdays = weekdayLabels(undefined, 'short').map((short, i) => ({
    short,
    long: this.weekdayNames[i],
  }));

  protected readonly today = computed(() => this.auth.me()?.localToday ?? null);
  protected readonly habits = signal<Habit[] | null>(null);
  protected readonly listProblem = signal<string | null>(null);

  private readonly routeHabitId = computed(() => {
    const raw = this.params().get('habitId');
    return raw === null ? null : Number(raw);
  });
  private readonly chosenId = linkedSignal(() => this.routeHabitId());
  protected readonly selected = computed(() => {
    const list = this.habits();
    if (!list?.length) return null;
    const id = this.chosenId();
    return id === null ? list[0] : (list.find((h) => h.id === id) ?? null);
  });
  private readonly selectedId = computed(() => this.selected()?.id ?? null);
  private readonly selectedStart = computed(() => this.selected()?.startDate ?? null);

  private readonly month = linkedSignal<number | null, LocalDateString | null>({
    source: this.selectedId,
    computation: () => {
      const today = this.today();
      return today ? startOfMonth(today) : null;
    },
  });
  protected readonly monthTitle = computed(() => {
    const month = this.month();
    return month ? monthLabel(month) : '';
  });
  protected readonly canPrev = computed(() => {
    const month = this.month();
    const start = this.selectedStart();
    return !!month && !!start && canGoPrevious(month, start);
  });
  protected readonly canNext = computed(() => {
    const month = this.month();
    const today = this.today();
    return !!month && !!today && canGoNext(month, today);
  });

  private readonly days = signal<DayEntry[]>([]);
  private readonly lowDays = signal<LocalDateString[]>([]);
  protected readonly monthLoading = signal(true);
  protected readonly monthProblem = signal<string | null>(null);

  protected readonly cells = computed<Cell[][]>(() => {
    const month = this.month();
    const start = this.selectedStart();
    const today = this.today();
    if (!month || !start || !today) return [];
    return buildMonth(month, this.days(), this.lowDays(), start, today).map((week) =>
      week.map((day) => ({
        ...day,
        num: Number(day.date.slice(8)),
        name: `${formatDate(day.date, longDate)}, ${dayLabel(day)}`,
      })),
    );
  });

  protected readonly openDate = linkedSignal<LocalDateString | null, LocalDateString | null>({
    source: this.month,
    computation: () => null,
  });
  protected readonly openCell = computed(() => {
    const date = this.openDate();
    const day = date
      ? this.cells()
          .flat()
          .find((c) => c.date === date && c.editable)
      : undefined;
    if (!day) return null;
    const text = dayLabel(day);
    return {
      ...day,
      longDate: formatDate(day.date, longDate),
      stateText: text.charAt(0).toUpperCase() + text.slice(1),
    };
  });

  protected readonly busy = signal(false);
  protected readonly dayProblem = signal<string | null>(null);
  protected readonly announcement = signal('');

  constructor() {
    void this.loadHabits();
    effect(() => {
      const ready =
        this.selectedId() !== null &&
        this.selectedStart() !== null &&
        this.month() !== null &&
        this.today() !== null;
      if (ready) untracked(() => void this.loadMonth(false));
    });
  }

  protected async loadHabits(): Promise<void> {
    this.listProblem.set(null);
    await this.auth.loadMe(true).catch(() => null);
    try {
      this.habits.set(await this.api.listHabits());
    } catch (error) {
      const apiError = asApiError(error);
      this.listProblem.set(apiError.handled ? null : problemToMessage(apiError).message);
    }
  }

  /** Fetches the visible month; `quiet` keeps the grid steady after an edit. */
  protected async loadMonth(quiet: boolean): Promise<void> {
    const habitId = this.selectedId();
    const start = this.selectedStart();
    const month = this.month();
    const today = this.today();
    if (habitId === null || !start || !month || !today) return;
    const request = ++this.requestId;
    const range = monthRange(month, start, today);
    if (!quiet) {
      this.monthLoading.set(true);
      this.monthProblem.set(null);
    }
    if (!range) {
      this.days.set([]);
      this.lowDays.set([]);
      this.monthLoading.set(false);
      return;
    }
    try {
      const [days, lowDays] = await Promise.all([
        this.api.getDays(habitId, range.from, range.to),
        this.api.listLowDays(range.from, range.to),
      ]);
      if (request !== this.requestId) return;
      this.days.set(days);
      this.lowDays.set(lowDays);
    } catch (error) {
      if (request !== this.requestId) return;
      const apiError = asApiError(error);
      if (!quiet && !apiError.handled) this.monthProblem.set(problemToMessage(apiError).message);
    } finally {
      if (request === this.requestId) this.monthLoading.set(false);
    }
  }

  protected choose(event: Event): void {
    const id = Number((event.target as HTMLSelectElement).value);
    this.chosenId.set(id);
    this.location.replaceState(`/history/${id}`);
  }

  protected shiftMonth(step: 1 | -1): void {
    const month = this.month();
    if (!month || !(step < 0 ? this.canPrev() : this.canNext())) return;
    this.month.set(addMonths(month, step));
  }

  protected toggleDay(date: LocalDateString): void {
    if (this.openDate() === date) {
      this.closeDay();
      return;
    }
    this.dayProblem.set(null);
    this.openDate.set(date);
    this.focusAfterRender('#day-panel-heading');
  }

  protected closeDay(): void {
    const date = this.openDate();
    this.openDate.set(null);
    this.dayProblem.set(null);
    if (date) this.focusAfterRender(`#day-${date}`);
  }

  protected async editDay(action: 'done' | 'notdone' | 'clear'): Promise<void> {
    const habit = this.selected();
    const date = this.openDate();
    if (!habit || !date || this.busy()) return;
    await this.runEdit(async () => {
      const updated =
        action === 'clear'
          ? await this.api.clearDay(habit.id, date)
          : await this.api.setDay(habit.id, date, action === 'done');
      this.habits.update((list) => list?.map((h) => (h.id === updated.id ? updated : h)) ?? null);
      const words =
        action === 'done' ? 'marked done' : action === 'notdone' ? 'marked not done' : 'cleared';
      return `${formatDate(date, longDate)} ${words}.`;
    });
  }

  protected async toggleLowDay(): Promise<void> {
    const day = this.openCell();
    if (!day || this.busy()) return;
    await this.runEdit(async () => {
      if (day.lowDay) await this.api.clearLowDay(day.date);
      else await this.api.markLowDay(day.date);
      return `${day.longDate} ${day.lowDay ? 'is no longer a low day' : 'marked as a low day'}.`;
    });
  }

  private async runEdit(action: () => Promise<string>): Promise<void> {
    this.busy.set(true);
    this.dayProblem.set(null);
    try {
      const message = await action();
      await this.loadMonth(true);
      this.announcement.set(message);
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) this.dayProblem.set(problemToMessage(apiError).message);
    } finally {
      this.busy.set(false);
    }
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
