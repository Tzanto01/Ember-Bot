import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormControl,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { formatDate } from '../../core/local-date';
import { Habit, HabitPatch, ReminderChannel } from '../../core/models';
import { asApiError, FriendlyProblem, problemToMessage } from '../../core/problem';
import { EmptyStateComponent } from '../../shared/empty-state';
import {
  FieldInputDirective,
  focusFirstInvalid,
  FormFieldComponent,
} from '../../shared/form-field';
import { NoticeComponent, NoticeTone } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';
import { createHabitForm, HabitFieldsComponent, habitFormValue } from './habit-form';

interface Feedback {
  tone: NoticeTone;
  text: string;
}

const longDate: Intl.DateTimeFormatOptions = { weekday: 'long', day: 'numeric', month: 'long' };

@Component({
  selector: 'app-habit-edit-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageComponent,
    NoticeComponent,
    SpinnerComponent,
    EmptyStateComponent,
    FormFieldComponent,
    FieldInputDirective,
    HabitFieldsComponent,
  ],
  template: `
    <app-page heading="Edit habit" [lede]="habit()?.name">
      @switch (status()) {
        @case ('loading') {
          <div class="stack" aria-busy="true">
            <span class="visually-hidden">Loading your habit…</span>
            <div class="skeleton block-skeleton"></div>
          </div>
        }
        @case ('notfound') {
          <app-empty-state heading="This habit wandered off.">
            <p>It may have been removed, or the link is out of date.</p>
            <a class="btn btn-primary" routerLink="/today">Back to Today</a>
          </app-empty-state>
        }
        @case ('error') {
          @if (loadProblem(); as message) {
            <app-notice tone="notice" heading="This habit didn't load">
              <p>{{ message }}</p>
              <div>
                <button class="btn btn-secondary" type="button" (click)="load()">Try again</button>
              </div>
            </app-notice>
          }
        }
        @default {
          @if (habit(); as h) {
            <form
              class="card stack-lg"
              [formGroup]="form"
              (ngSubmit)="save()"
              novalidate
              aria-labelledby="details-heading"
            >
              <h2 id="details-heading">Details</h2>
              <app-habit-fields [form]="form" [errors]="fieldErrors()" />
              <p class="muted small">
                Grace days apply to all your habits. You can change them in
                <a routerLink="/settings">Settings</a>.
              </p>
              @if (saveFeedback(); as f) {
                <app-notice [tone]="f.tone">{{ f.text }}</app-notice>
              }
              <button
                class="btn btn-primary btn-block"
                type="submit"
                [attr.aria-disabled]="saving() ? 'true' : null"
              >
                @if (saving()) {
                  <app-spinner />
                  Saving…
                } @else {
                  Save changes
                }
              </button>
            </form>

            @if (h.reminderChannels; as channels) {
              <section class="card stack" aria-labelledby="channels-heading">
                <h2 id="channels-heading">Where reminders go</h2>
                <fieldset class="plain">
                  <legend class="visually-hidden">Reminder channels</legend>
                  <label class="checkbox">
                    <input
                      #discordBox
                      type="checkbox"
                      [checked]="channels.includes('discord')"
                      (change)="toggleChannel('discord', discordBox)"
                    />
                    Discord DM
                  </label>
                  <label class="checkbox">
                    <input
                      #pushBox
                      type="checkbox"
                      [checked]="channels.includes('webpush')"
                      (change)="toggleChannel('webpush', pushBox)"
                    />
                    Web push
                  </label>
                </fieldset>
                @if (channels.length === 0) {
                  <p class="muted small">
                    No reminders will go out for this habit. That's fine too.
                  </p>
                } @else if (!h.reminderTime) {
                  <p class="muted small">
                    Set a reminder time above so these have a moment to arrive.
                  </p>
                }
                <p class="muted small">
                  Web push also needs this browser turned on for notifications in
                  <a routerLink="/settings" fragment="push">Settings</a>.
                </p>
                @if (channelFeedback(); as f) {
                  <app-notice [tone]="f.tone">{{ f.text }}</app-notice>
                }
              </section>
            }

            <section class="card stack" aria-labelledby="pause-heading">
              <h2 id="pause-heading" tabindex="-1">Take a break</h2>
              @if (paused()) {
                <p>
                  @if (h.pausedUntil) {
                    Paused until {{ formatLong(h.pausedUntil) }}.
                  } @else {
                    Paused for now.
                  }
                  Pick it up again whenever you like.
                </p>
                <button
                  class="btn btn-secondary btn-block"
                  type="button"
                  [attr.aria-disabled]="pauseBusy() ? 'true' : null"
                  (click)="resume()"
                >
                  Resume now
                </button>
              } @else {
                <p class="muted small">
                  Pausing keeps your history and skips reminders until the day you choose.
                </p>
                <form class="stack" (submit)="pause($event)" novalidate>
                  <app-form-field
                    label="Pause until"
                    [messages]="{
                      required: 'Choose the day the pause ends.',
                      min: 'Pick today or a later day.',
                    }"
                  >
                    <input
                      appFieldInput
                      class="input date"
                      type="date"
                      [formControl]="pauseUntil"
                      [min]="today() ?? ''"
                    />
                  </app-form-field>
                  <button
                    class="btn btn-secondary btn-block"
                    type="submit"
                    [attr.aria-disabled]="pauseBusy() ? 'true' : null"
                  >
                    Pause habit
                  </button>
                </form>
              }
              @if (pauseFeedback(); as f) {
                <app-notice [tone]="f.tone">{{ f.text }}</app-notice>
              }
            </section>

            <section class="card stack" aria-labelledby="delete-heading">
              <h2 id="delete-heading">Delete habit</h2>
              @if (confirmingDelete()) {
                <div
                  id="delete-confirm"
                  (keydown.escape)="cancelDelete()"
                  class="stack"
                  role="group"
                  aria-labelledby="delete-question"
                  tabindex="-1"
                >
                  <p id="delete-question">
                    Delete {{ h.name }} and all its check-ins? This can't be undone.
                  </p>
                  <div class="row">
                    <button
                      class="btn btn-primary"
                      type="button"
                      [attr.aria-disabled]="deleting() ? 'true' : null"
                      (click)="confirmDelete()"
                    >
                      @if (deleting()) {
                        <app-spinner />
                        Deleting…
                      } @else {
                        Yes, delete it
                      }
                    </button>
                    <button class="btn btn-secondary" type="button" (click)="cancelDelete()">
                      Keep it
                    </button>
                  </div>
                </div>
              } @else {
                <p class="muted small">If this habit no longer fits, you can let it go.</p>
                <button
                  id="delete-start"
                  class="btn btn-secondary btn-block"
                  type="button"
                  (click)="askDelete()"
                >
                  Delete habit
                </button>
              }
              @if (deleteProblem(); as p) {
                <app-notice tone="notice">{{ p.message }}</app-notice>
              }
            </section>
          }
        }
      }
    </app-page>
  `,
  styles: `
    .small {
      font-size: var(--text-sm);
    }
    .plain {
      margin: 0;
      padding: 0;
      border: 0;
      min-width: 0;
    }
    .date {
      max-width: 14rem;
    }
    .block-skeleton {
      height: 22rem;
    }
    #delete-confirm:focus {
      outline: none;
    }
  `,
})
export class HabitEditPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly id = Number(inject(ActivatedRoute).snapshot.paramMap.get('id'));

  protected readonly today = computed(() => this.auth.me()?.localToday ?? null);
  protected readonly status = signal<'loading' | 'notfound' | 'error' | 'ready'>('loading');
  protected readonly loadProblem = signal<string | null>(null);
  protected readonly habit = signal<Habit | null>(null);
  protected readonly paused = computed(() => {
    const habit = this.habit();
    return !!habit && (habit.pausedToday || habit.pausedUntil !== null);
  });

  protected readonly form = createHabitForm();
  protected readonly saving = signal(false);
  protected readonly saveProblem = signal<FriendlyProblem | null>(null);
  protected readonly saveFeedback = signal<Feedback | null>(null);
  protected readonly fieldErrors = computed<Record<string, string>>(
    () => this.saveProblem()?.fields ?? {},
  );

  protected readonly channelsBusy = signal(false);
  protected readonly channelFeedback = signal<Feedback | null>(null);

  protected readonly pauseUntil = new FormControl('', {
    nonNullable: true,
    validators: [
      Validators.required,
      (control: AbstractControl<string>) => this.notBeforeToday(control),
    ],
  });
  protected readonly pauseBusy = signal(false);
  protected readonly pauseFeedback = signal<Feedback | null>(null);

  protected readonly confirmingDelete = signal(false);
  protected readonly deleting = signal(false);
  protected readonly deleteProblem = signal<FriendlyProblem | null>(null);

  constructor() {
    void this.load();
  }

  protected formatLong(date: string): string {
    return formatDate(date, longDate);
  }

  protected async load(): Promise<void> {
    if (!Number.isInteger(this.id) || this.id <= 0) {
      this.status.set('notfound');
      return;
    }
    this.status.set('loading');
    this.loadProblem.set(null);
    await this.auth.loadMe(true).catch(() => null);
    try {
      this.setHabit(await this.api.getHabit(this.id));
      this.status.set('ready');
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 404) {
        this.status.set('notfound');
        return;
      }
      this.loadProblem.set(apiError.handled ? null : problemToMessage(apiError).message);
      this.status.set('error');
    }
  }

  protected async save(): Promise<void> {
    const habit = this.habit();
    if (!habit || this.saving()) return;
    this.saveFeedback.set(null);
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    const value = habitFormValue(this.form);
    const patch: HabitPatch = {};
    if (value.name !== habit.name) patch.name = value.name;
    if (value.frequency !== habit.frequency) patch.frequency = value.frequency;
    if (value.frequency === 'weekly' && value.weeklyTarget !== habit.weeklyTarget)
      patch.weeklyTarget = value.weeklyTarget;
    if (value.reminderTime === null && habit.reminderTime !== null) patch.clearReminder = true;
    else if (value.reminderTime !== null && value.reminderTime !== habit.reminderTime)
      patch.reminderTime = value.reminderTime;
    if (Object.keys(patch).length === 0) {
      this.saveFeedback.set({ tone: 'info', text: 'Nothing has changed yet.' });
      return;
    }
    this.saving.set(true);
    this.saveProblem.set(null);
    try {
      this.setHabit(await this.api.updateHabit(habit.id, patch));
      this.saveFeedback.set({ tone: 'success', text: 'Saved.' });
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) {
        const problem = problemToMessage(apiError);
        this.saveProblem.set(problem);
        this.saveFeedback.set({ tone: 'notice', text: problem.message });
      }
    } finally {
      this.saving.set(false);
    }
  }

  protected async toggleChannel(channel: ReminderChannel, box: HTMLInputElement): Promise<void> {
    const habit = this.habit();
    if (!habit?.reminderChannels || this.channelsBusy()) {
      box.checked = !box.checked;
      return;
    }
    const others = habit.reminderChannels.filter((c) => c !== channel);
    const next = box.checked ? [...others, channel] : others;
    this.channelsBusy.set(true);
    this.channelFeedback.set(null);
    try {
      this.habit.set(await this.api.updateHabit(habit.id, { reminderChannels: next }));
      this.channelFeedback.set({ tone: 'success', text: 'Reminder channels saved.' });
    } catch (error) {
      box.checked = !box.checked;
      const apiError = asApiError(error);
      if (!apiError.handled)
        this.channelFeedback.set({ tone: 'notice', text: problemToMessage(apiError).message });
    } finally {
      this.channelsBusy.set(false);
    }
  }

  protected async pause(event: Event): Promise<void> {
    event.preventDefault();
    const habit = this.habit();
    if (!habit || this.pauseBusy()) return;
    this.pauseUntil.markAsTouched();
    if (this.pauseUntil.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    const until = this.pauseUntil.value;
    await this.runPause(habit.id, until, `Paused until ${formatDate(until, longDate)}.`);
  }

  protected async resume(): Promise<void> {
    const habit = this.habit();
    if (!habit || this.pauseBusy()) return;
    await this.runPause(habit.id, null, 'Welcome back. This habit is active again.');
  }

  protected askDelete(): void {
    this.deleteProblem.set(null);
    this.confirmingDelete.set(true);
    this.focusAfterRender('#delete-confirm');
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
    this.focusAfterRender('#delete-start');
  }

  protected async confirmDelete(): Promise<void> {
    const habit = this.habit();
    if (!habit || this.deleting()) return;
    this.deleting.set(true);
    this.deleteProblem.set(null);
    try {
      await this.api.deleteHabit(habit.id);
      await this.router.navigateByUrl('/today');
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) this.deleteProblem.set(problemToMessage(apiError));
    } finally {
      this.deleting.set(false);
    }
  }

  private async runPause(id: number, until: string | null, successText: string): Promise<void> {
    this.pauseBusy.set(true);
    this.pauseFeedback.set(null);
    try {
      this.habit.set(await this.api.pauseHabit(id, until));
      this.pauseUntil.reset();
      this.pauseFeedback.set({ tone: 'success', text: successText });
      this.focusAfterRender('#pause-heading');
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled)
        this.pauseFeedback.set({ tone: 'notice', text: problemToMessage(apiError).message });
    } finally {
      this.pauseBusy.set(false);
    }
  }

  private setHabit(habit: Habit): void {
    this.habit.set(habit);
    this.form.reset({
      name: habit.name,
      frequency: habit.frequency,
      weeklyTarget: habit.weeklyTarget ?? 3,
      reminderTime: habit.reminderTime ?? '',
    });
  }

  private notBeforeToday(control: AbstractControl<string>): ValidationErrors | null {
    const today = this.today();
    return control.value && today && control.value < today ? { min: true } : null;
  }

  private focusAfterRender(selector: string): void {
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>(selector)?.focus(), {
      injector: this.injector,
    });
  }
}
