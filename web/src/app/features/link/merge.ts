import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { timeZoneLabel } from '../../core/local-date';
import { MergePreview } from '../../core/models';
import { ApiError, asApiError, problemToMessage } from '../../core/problem';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

@Component({
  selector: 'app-merge-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageComponent, NoticeComponent, SpinnerComponent],
  template: `
    <app-page heading="Bring your Discord habits over">
      @if (state() === 'loading') {
        <div class="stack" aria-busy="true">
          <span class="visually-hidden" role="status">Loading…</span>
          <div class="skeleton line"></div>
          <div class="skeleton line short"></div>
        </div>
      } @else if (state() === 'none') {
        <app-notice heading="Nothing to bring over">
          There's nothing waiting to be merged (links expire after 15 minutes).
        </app-notice>
        <div class="row">
          <a class="btn btn-secondary" routerLink="/settings">Go to Settings</a>
        </div>
      } @else if (preview(); as p) {
        <div class="card stack">
          <p>{{ summary() }}</p>
          @if (p.habitNames.length) {
            <ul class="names">
              @for (name of p.habitNames; track $index) {
                <li>{{ name }}</li>
              }
            </ul>
          }
          <p class="muted">If a habit has the same name in both accounts, Ember keeps both.</p>
          <p>{{ kept() }}</p>
        </div>
        @if (problem(); as message) {
          <app-notice tone="notice">{{ message }}</app-notice>
        }
        <div class="row">
          <button
            class="btn btn-primary"
            type="button"
            [attr.aria-disabled]="busy() ? 'true' : null"
            (click)="merge()"
          >
            @if (busy() === 'merge') {
              <app-spinner />
              Moving…
            } @else {
              Move everything here
            }
          </button>
          <button
            class="btn btn-secondary"
            type="button"
            [attr.aria-disabled]="busy() ? 'true' : null"
            (click)="cancel()"
          >
            @if (busy() === 'cancel') {
              <app-spinner />
              Cancelling…
            } @else {
              Cancel
            }
          </button>
        </div>
      } @else {
        @if (problem(); as message) {
          <app-notice tone="notice">{{ message }}</app-notice>
        }
        <div class="row">
          <button class="btn btn-secondary" type="button" (click)="load()">Try again</button>
          <a class="btn btn-quiet" routerLink="/settings">Go to Settings</a>
        </div>
      }
    </app-page>
  `,
  styles: `
    .line {
      height: 1.25rem;
    }
    .short {
      width: 60%;
    }
    .names {
      margin: 0;
      padding-inline-start: var(--space-5);
    }
  `,
})
export class MergePage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly state = signal<'loading' | 'ready' | 'none' | 'error'>('loading');
  protected readonly preview = signal<MergePreview | null>(null);
  protected readonly problem = signal<string | null>(null);
  protected readonly busy = signal<'merge' | 'cancel' | null>(null);

  protected readonly summary = computed(() => {
    const p = this.preview();
    if (!p) return '';
    return (
      `This will move ${count(p.habits, 'habit', 'habits')}, ${count(p.logs, 'check-in', 'check-ins')} and ` +
      `${count(p.dayMarks, 'low day', 'low days')} from your Discord-only Ember account into this account.`
    );
  });

  protected readonly kept = computed(() => {
    const k = this.preview()?.kept;
    if (!k) return '';
    const grace =
      k.graceDaysPerWeek === 0
        ? 'no grace days'
        : count(k.graceDaysPerWeek, 'grace day', 'grace days') + ' a week';
    return `Your settings stay as they are: timezone ${timeZoneLabel(k.timezone)}, ${grace}, leaderboards ${k.leaderboardOptIn ? 'on' : 'off'}.`;
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.state.set('loading');
    this.problem.set(null);
    try {
      this.preview.set(await this.api.getMergePreview());
      this.state.set('ready');
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 404) {
        this.state.set('none');
        return;
      }
      if (!apiError.handled) this.problem.set(problemToMessage(apiError).message);
      this.state.set('error');
    }
  }

  protected async merge(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('merge');
    this.problem.set(null);
    try {
      await this.api.confirmMerge();
      await this.auth.refreshAntiforgery();
      await this.auth.loadMe(true).catch(() => null);
      await this.router.navigateByUrl('/settings?discord=linked');
    } catch (error) {
      this.handleFailure(asApiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async cancel(): Promise<void> {
    if (this.busy()) return;
    this.busy.set('cancel');
    this.problem.set(null);
    try {
      await this.api.cancelMerge();
      await this.router.navigateByUrl('/settings');
    } catch (error) {
      this.handleFailure(asApiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  private handleFailure(error: ApiError): void {
    if (error.status === 404) {
      this.state.set('none');
    } else if (!error.handled) {
      this.problem.set(problemToMessage(error).message);
    }
  }
}
