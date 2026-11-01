import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { asApiError, FriendlyProblem, problemToMessage } from '../../core/problem';
import { safeReturnUrl } from '../../core/return-url';
import {
  FieldInputDirective,
  focusFirstInvalid,
  FormFieldComponent,
} from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';
import { environment } from '../../../environments/environment';
import { openOnWeb } from '../../core/native/browser';

@Component({
  selector: 'app-login-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    PageComponent,
    FormFieldComponent,
    FieldInputDirective,
    NoticeComponent,
    SpinnerComponent,
  ],
  template: `
    <app-page heading="Welcome back" lede="Sign in to check in on your habits.">
      @if (discordFailed) {
        <app-notice tone="notice">Discord sign-in didn't finish. You can try again.</app-notice>
      }
      @if (reason === 'session') {
        <app-notice>Your session ended. Sign in again to pick up where you left off.</app-notice>
      } @else if (reason === 'offline') {
        <app-notice tone="notice"
          >Ember can't be reached right now. Check your connection, then try again.</app-notice
        >
      } @else if (reason === 'deleted') {
        <app-notice tone="info"
          >Your account and everything in it are deleted. Thank you for spending time with
          Ember.</app-notice
        >
      }

      <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
        <app-form-field label="Email" [serverError]="fieldErrors()['email']">
          <input
            appFieldInput
            class="input"
            type="email"
            formControlName="email"
            autocomplete="email"
            inputmode="email"
            spellcheck="false"
          />
        </app-form-field>
        <app-form-field label="Password">
          <input
            appFieldInput
            class="input"
            type="password"
            formControlName="password"
            autocomplete="current-password"
          />
        </app-form-field>
        <div class="row row-between">
          <label class="checkbox">
            <input type="checkbox" formControlName="staySignedIn" />
            Stay signed in
          </label>
          <a class="tap-link" routerLink="/forgot-password">Forgot password?</a>
        </div>

        @if (problem(); as p) {
          <app-notice tone="notice">
            <p>{{ p.message }}</p>
            @if (p.offerResend) {
              @if (resend() === 'sent') {
                <p>If that address still needs confirming, a fresh link is on its way.</p>
              } @else {
                <div>
                  <button
                    class="btn btn-secondary"
                    type="button"
                    [attr.aria-disabled]="resend() === 'sending' ? 'true' : null"
                    (click)="resendConfirmation()"
                  >
                    Send the link again
                  </button>
                </div>
              }
            }
          </app-notice>
        }

        <button
          class="btn btn-primary btn-block"
          type="submit"
          [attr.aria-disabled]="pending() ? 'true' : null"
        >
          @if (pending()) {
            <app-spinner />
            Signing in…
          } @else {
            Sign in
          }
        </button>
      </form>

      @if (native) {
        <p class="muted">
          Started with the Ember bot on Discord? Discord sign-in works on the web. Create an email
          login there, then link Discord in Settings: your habits come along.
        </p>
        <button class="btn btn-secondary btn-block" type="button" (click)="openWebSignup()">
          Open Ember on the web
        </button>
      } @else {
        <p class="divider">or</p>
        <a class="btn btn-secondary btn-block" [href]="discordUrl">Sign in with Discord</a>
      }
      <p class="text-center muted">
        New to Ember? <a class="tap-link" routerLink="/signup">Create an account</a>
      </p>
    </app-page>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly returnUrl = safeReturnUrl(this.query.get('returnUrl'));
  protected readonly discordFailed = this.query.get('discord') === 'error';
  protected readonly reason = this.query.get('reason');
  protected readonly discordUrl = this.api.discordLoginUrl(this.returnUrl);
  protected readonly native = environment.native;

  protected openWebSignup(): void {
    void openOnWeb('/signup');
  }

  protected readonly form = new FormGroup({
    email: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, Validators.email],
    }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
    staySignedIn: new FormControl(true, { nonNullable: true }),
  });

  protected readonly pending = signal(false);
  protected readonly problem = signal<FriendlyProblem | null>(null);
  protected readonly fieldErrors = computed<Record<string, string>>(
    () => this.problem()?.fields ?? {},
  );
  protected readonly resend = signal<'idle' | 'sending' | 'sent'>('idle');

  protected async submit(): Promise<void> {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    this.resend.set('idle');
    const { email, password, staySignedIn } = this.form.getRawValue();
    try {
      await this.auth.login(email.trim(), password, staySignedIn);
      if (this.auth.needsConsent()) {
        await this.router.navigate(['/consent'], { queryParams: { returnUrl: this.returnUrl } });
      } else {
        await this.router.navigateByUrl(this.returnUrl);
      }
    } catch (error) {
      this.problem.set(problemToMessage(asApiError(error), 'login'));
    } finally {
      this.pending.set(false);
    }
  }

  protected async resendConfirmation(): Promise<void> {
    if (this.resend() === 'sending') return;
    this.resend.set('sending');
    try {
      await this.api.resendConfirmationEmail(this.form.controls.email.value.trim());
      this.resend.set('sent');
    } catch (error) {
      this.resend.set('idle');
      this.problem.set(problemToMessage(asApiError(error)));
    }
  }
}
