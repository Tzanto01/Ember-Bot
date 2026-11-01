import { afterNextRender, ChangeDetectionStrategy, Component, ElementRef, inject, signal } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { asApiError, problemToMessage } from '../../core/problem';
import { FieldInputDirective, focusFirstInvalid, FormFieldComponent } from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

type ConfirmState = 'working' | 'confirmed' | 'expired' | 'incomplete' | 'failed';

@Component({
  selector: 'app-confirm-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PageComponent, FormFieldComponent, FieldInputDirective, NoticeComponent, SpinnerComponent],
  template: `
    @switch (state()) {
      @case ('working') {
        <app-page heading="Confirming your email">
          <p class="row muted"><app-spinner label="Confirming" /> One moment…</p>
        </app-page>
      }
      @case ('confirmed') {
        <app-page heading="You're confirmed" lede="Welcome to Ember. Sign in whenever you're ready.">
          <a class="btn btn-primary btn-block" routerLink="/login">Sign in</a>
        </app-page>
      }
      @default {
        <app-page heading="Let's get you a fresh link">
          <app-notice>{{ message() }}</app-notice>
          @if (resent()) {
            <app-notice tone="success">If that address still needs confirming, a fresh link is on its way.</app-notice>
          } @else {
            <form class="stack" (submit)="resend($event)" novalidate>
              <app-form-field label="Email" [serverError]="resendError()">
                <input appFieldInput class="input" type="email" [formControl]="email" autocomplete="email" inputmode="email" spellcheck="false" />
              </app-form-field>
              <button class="btn btn-primary btn-block" type="submit" [attr.aria-disabled]="sending() ? 'true' : null">
                {{ sending() ? 'Sending…' : 'Send a new link' }}
              </button>
            </form>
          }
          <a class="btn btn-quiet btn-block" routerLink="/login">Back to sign in</a>
        </app-page>
      }
    }
  `,
})
export class ConfirmEmailPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly state = signal<ConfirmState>('working');
  protected readonly message = signal('');
  protected readonly email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });
  protected readonly sending = signal(false);
  protected readonly resent = signal(false);
  protected readonly resendError = signal<string | null>(null);

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    const userId = query.get('userId');
    const code = query.get('code');

    afterNextRender(() => {
      if (code !== null) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { code: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });

    if (!userId || !code) {
      this.message.set('This link looks incomplete. Open it again from the email, or ask for a new one here.');
      this.state.set('incomplete');
      return;
    }
    void this.confirm(userId, code);
  }

  private async confirm(userId: string, code: string): Promise<void> {
    try {
      await this.api.confirmEmail(userId, code);
      this.state.set('confirmed');
    } catch (error) {
      const apiError = asApiError(error);
      this.message.set(problemToMessage(apiError, 'confirm-email').message);
      this.state.set(apiError.status === 401 ? 'expired' : 'failed');
    }
  }

  protected async resend(event: Event): Promise<void> {
    event.preventDefault();
    if (this.sending()) return;
    this.email.markAsTouched();
    if (this.email.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.sending.set(true);
    this.resendError.set(null);
    try {
      await this.api.resendConfirmationEmail(this.email.value.trim());
      this.resent.set(true);
    } catch (error) {
      this.resendError.set(problemToMessage(asApiError(error)).message);
    } finally {
      this.sending.set(false);
    }
  }
}
