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
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { asApiError, FriendlyProblem, problemToMessage } from '../../core/problem';
import { FieldInputDirective, focusFirstInvalid, FormFieldComponent } from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { focusPageHeading, PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

@Component({
  selector: 'app-signup-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PageComponent, FormFieldComponent, FieldInputDirective, NoticeComponent, SpinnerComponent],
  template: `
    @if (sentTo(); as email) {
      <app-page heading="Check your inbox" [lede]="'We sent an email to ' + email + '. Open the link inside to finish setting up.'">
        @if (resend() === 'sent') {
          <app-notice tone="success">Sent again. It can take a minute or two to arrive.</app-notice>
        }
        @if (problem(); as p) {
          <app-notice tone="notice">{{ p.message }}</app-notice>
        }
        <p class="muted">Nothing there? Check your spam folder, or we can send it again.</p>
        <button class="btn btn-secondary btn-block" type="button" [attr.aria-disabled]="resend() === 'sending' ? 'true' : null" (click)="resendConfirmation(email)">
          Send it again
        </button>
        <a class="btn btn-quiet btn-block" routerLink="/login">Back to sign in</a>
      </app-page>
    } @else {
      <app-page heading="Create your account" lede="A calm place for your habits. It takes a minute.">
        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <app-form-field label="Email" [serverError]="fieldErrors()['email']">
            <input appFieldInput class="input" type="email" formControlName="email" autocomplete="email" inputmode="email" spellcheck="false" />
          </app-form-field>
          <app-form-field
            label="Password"
            hint="At least 10 characters. A short phrase you'll remember works well."
            [serverError]="fieldErrors()['password']"
          >
            <input appFieldInput class="input" type="password" formControlName="password" autocomplete="new-password" />
          </app-form-field>

          @if (problem(); as p) {
            <app-notice tone="notice">{{ p.message }}</app-notice>
          }

          <p class="muted">
            Creating an account means you accept the <a routerLink="/legal/terms">terms</a>. The
            <a routerLink="/legal/privacy">privacy policy</a> explains what Ember stores and why.
          </p>

          <button class="btn btn-primary btn-block" type="submit" [attr.aria-disabled]="pending() ? 'true' : null">
            @if (pending()) {
              <app-spinner />
              Creating your account…
            } @else {
              Create account
            }
          </button>
        </form>
        <p class="text-center muted">Already have an account? <a class="tap-link" routerLink="/login">Sign in</a></p>
      </app-page>
    }
  `,
})
export class SignupPage {
  private readonly api = inject(ApiClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
    password: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(10)] }),
  });

  protected readonly pending = signal(false);
  protected readonly problem = signal<FriendlyProblem | null>(null);
  protected readonly fieldErrors = computed<Record<string, string>>(() => this.problem()?.fields ?? {});
  protected readonly sentTo = signal<string | null>(null);
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
    const { email, password } = this.form.getRawValue();
    try {
      await this.api.register({ email: email.trim(), password });
      this.sentTo.set(email.trim());
      afterNextRender(() => focusPageHeading(this.host.nativeElement), { injector: this.injector });
    } catch (error) {
      this.problem.set(problemToMessage(asApiError(error), 'register'));
    } finally {
      this.pending.set(false);
    }
  }

  protected async resendConfirmation(email: string): Promise<void> {
    if (this.resend() === 'sending') return;
    this.resend.set('sending');
    this.problem.set(null);
    try {
      await this.api.resendConfirmationEmail(email);
      this.resend.set('sent');
    } catch (error) {
      this.resend.set('idle');
      this.problem.set(problemToMessage(asApiError(error)));
    }
  }
}
