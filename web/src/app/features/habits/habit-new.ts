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
import { ReactiveFormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { HabitTemplate, NewHabit } from '../../core/models';
import { asApiError, FriendlyProblem, problemToMessage } from '../../core/problem';
import { focusFirstInvalid } from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { focusPageHeading, PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';
import { cadenceText, createHabitForm, HabitFieldsComponent, habitFormValue } from './habit-form';

@Component({
  selector: 'app-habit-new-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageComponent,
    NoticeComponent,
    SpinnerComponent,
    HabitFieldsComponent,
  ],
  template: `
    @if (step() === 'choose') {
      <app-page
        heading="New habit"
        lede="Pick a starting point, or begin from scratch. You can change everything later."
      >
        @if (cards(); as list) {
          <ul class="templates" role="list">
            @for (card of list; track card.template.key) {
              <li>
                <button type="button" class="card template" (click)="pick(card.template)">
                  <span class="template-name">{{ card.template.name }}</span>
                  <span class="muted">{{ card.template.description }}</span>
                  <span class="template-meta">{{ card.meta }}</span>
                </button>
              </li>
            }
          </ul>
          <button class="btn btn-secondary btn-block" type="button" (click)="scratch()">
            Start from scratch
          </button>
        } @else {
          <div class="templates" aria-busy="true">
            <span class="visually-hidden">Loading suggestions…</span>
            @for (i of placeholders; track i) {
              <div class="skeleton template-skeleton"></div>
            }
          </div>
        }
      </app-page>
    } @else {
      <app-page heading="New habit" [lede]="lede()">
        <form class="stack-lg" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <app-habit-fields [form]="form" [errors]="fieldErrors()" />

          @if (problem(); as p) {
            <app-notice tone="notice">{{ p.message }}</app-notice>
          }

          <div class="stack">
            <button
              class="btn btn-primary btn-block"
              type="submit"
              [attr.aria-disabled]="pending() ? 'true' : null"
            >
              @if (pending()) {
                <app-spinner />
                Creating your habit…
              } @else {
                Create habit
              }
            </button>
            @if (cards()?.length) {
              <button class="btn btn-quiet btn-block" type="button" (click)="backToSuggestions()">
                Back to suggestions
              </button>
            }
            <a class="btn btn-quiet btn-block" routerLink="/today">Cancel</a>
          </div>
        </form>
      </app-page>
    }
  `,
  styles: `
    .templates {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--space-3);
      grid-template-columns: repeat(auto-fill, minmax(16rem, 1fr));
    }
    .templates li {
      display: flex;
    }
    .template {
      display: flex;
      flex-direction: column;
      gap: var(--space-1);
      width: 100%;
      padding: var(--space-4);
      font: inherit;
      color: inherit;
      text-align: start;
      cursor: pointer;
      transition: border-color var(--dur-fast) var(--ease-out);
    }
    .template:hover {
      border-color: var(--color-border-strong);
    }
    .template-name {
      font-family: var(--font-display);
      font-weight: var(--weight-bold);
      font-size: var(--text-md);
    }
    .template-meta {
      font-size: var(--text-sm);
      color: var(--color-text-muted);
    }
    .template-skeleton {
      height: 7rem;
    }
  `,
})
export class HabitNewPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly placeholders = [1, 2, 3, 4];
  protected readonly form = createHabitForm();
  protected readonly step = signal<'choose' | 'form'>('choose');
  protected readonly templates = signal<HabitTemplate[] | null>(null);
  protected readonly cards = computed(() =>
    this.templates()?.map((template) => ({
      template,
      meta: `${cadenceText(template.frequency, template.weeklyTarget)} · reminder at ${template.suggestedReminderTime}`,
    })),
  );
  protected readonly picked = signal<string | null>(null);
  protected readonly lede = computed(() => {
    const picked = this.picked();
    return picked
      ? `Based on ${picked}. Adjust anything you like.`
      : 'Keep it small. Small is how habits start.';
  });

  protected readonly pending = signal(false);
  protected readonly problem = signal<FriendlyProblem | null>(null);
  protected readonly fieldErrors = computed<Record<string, string>>(
    () => this.problem()?.fields ?? {},
  );

  constructor() {
    void this.loadTemplates();
  }

  protected pick(template: HabitTemplate): void {
    this.form.reset();
    this.form.patchValue({
      name: template.name,
      frequency: template.frequency,
      weeklyTarget: template.weeklyTarget ?? 3,
      reminderTime: template.suggestedReminderTime,
    });
    this.picked.set(template.name);
    this.showForm();
  }

  protected scratch(): void {
    this.form.reset();
    this.picked.set(null);
    this.showForm();
  }

  protected backToSuggestions(): void {
    this.problem.set(null);
    this.step.set('choose');
    afterNextRender(() => focusPageHeading(this.host.nativeElement), { injector: this.injector });
  }

  protected async submit(): Promise<void> {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    const value = habitFormValue(this.form);
    const body: NewHabit = { name: value.name, frequency: value.frequency };
    if (value.weeklyTarget !== null) body.weeklyTarget = value.weeklyTarget;
    if (value.reminderTime) body.reminderTime = value.reminderTime;
    this.pending.set(true);
    this.problem.set(null);
    try {
      await this.api.createHabit(body);
      await this.router.navigateByUrl('/today');
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) this.problem.set(problemToMessage(apiError));
    } finally {
      this.pending.set(false);
    }
  }

  private async loadTemplates(): Promise<void> {
    try {
      const templates = await this.api.listTemplates();
      this.templates.set(templates);
      if (templates.length === 0) this.step.set('form');
    } catch {
      this.templates.set([]);
      this.step.set('form');
    }
  }

  private showForm(): void {
    this.problem.set(null);
    this.step.set('form');
    afterNextRender(
      () =>
        this.host.nativeElement
          .querySelector<HTMLInputElement>('input[formcontrolname="name"]')
          ?.focus(),
      { injector: this.injector },
    );
  }
}
