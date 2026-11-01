import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { asApiError, problemToMessage } from '../../core/problem';
import { safeReturnUrl } from '../../core/return-url';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

@Component({
  selector: 'app-consent-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, PageComponent, NoticeComponent, SpinnerComponent],
  template: `
    <app-page [heading]="policyChanged() ? 'Our privacy policy changed' : 'One quick question'">
      <div class="stack">
        <p>
          Habit names, check-ins and low days can say something about your health (think "take my meds" or
          "sleep 8 hours"). Under the GDPR (Article 9) that counts as health data, so Ember asks before saving it.
        </p>
        <p>
          Ember stores it only to run your habit tracker for you. It's never shared or sold. You can change your mind
          any time by deleting your account in Settings, which removes everything.
        </p>
        <p><a routerLink="/legal/privacy">Read the privacy policy</a></p>
      </div>

      @if (problem(); as message) {
        <app-notice tone="notice">{{ message }}</app-notice>
      }

      <div class="stack">
        <button class="btn btn-primary btn-block" type="button" [attr.aria-disabled]="pending() ? 'true' : null" (click)="agree()">
          @if (pending()) {
            <app-spinner />
            Saving…
          } @else {
            I agree
          }
        </button>
        <a class="btn btn-quiet btn-block" routerLink="/settings">Not now</a>
        <p class="muted text-center">
          Without it you can still read your history, change settings, and export or delete your data.
        </p>
      </div>
    </app-page>
  `,
})
export class ConsentPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly returnUrl = safeReturnUrl(inject(ActivatedRoute).snapshot.queryParamMap.get('returnUrl'));

  protected readonly policyChanged = computed(() => !!this.auth.me()?.consent.given && this.auth.needsConsent());
  protected readonly pending = signal(false);
  protected readonly problem = signal<string | null>(null);

  protected async agree(): Promise<void> {
    const me = this.auth.me();
    if (this.pending() || !me) return;
    this.pending.set(true);
    this.problem.set(null);
    try {
      await this.api.giveConsent(me.consent.currentPolicyVersion);
      await this.auth.loadMe(true);
      await this.router.navigateByUrl(this.returnUrl.startsWith('/consent') ? '/today' : this.returnUrl);
    } catch (error) {
      const apiError = asApiError(error);
      if (!apiError.handled) this.problem.set(problemToMessage(apiError).message);
    } finally {
      this.pending.set(false);
    }
  }
}
