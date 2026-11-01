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
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { asApiError, FriendlyProblem, problemToMessage } from '../../core/problem';
import { FieldInputDirective, focusFirstInvalid, FormFieldComponent } from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { focusPageHeading, PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

@Component({
  selector: 'app-reset-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PageComponent, FormFieldComponent, FieldInputDirective, NoticeComponent, SpinnerComponent],
  template: `
    @if (done()) {
      <app-page heading="Your password is updated" lede="Sign in with your new password whenever you're ready.">
        <a class="btn btn-primary btn-block" routerLink="/login">Sign in</a>
      </app-page>
    } @else if (!email || !code) {
      <app-page heading="Let's get you a fresh link">
        <app-notice>This link looks incomplete. Open it again from the email, or ask for a new one.</app-notice>
        <a class="btn btn-primary btn-block" routerLink="/forgot-password">Send me a new link</a>
      </app-page>
    } @else {
      <app-page heading="Choose a new password" [lede]="'For ' + email">
        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <input class="visually-hidden" type="email" name="username" autocomplete="username" [value]="email" readonly tabindex="-1" aria-hidden="true" />
          <app-form-field
            label="New password"
            hint="At least 10 characters. A short phrase you'll remember works well."
            [serverError]="fieldErrors()['password'] || fieldErrors()['newPassword']"
          >
            <input appFieldInput class="input" type="password" formControlName="newPassword" autocomplete="new-password" />
          </app-form-field>
          @if (problem(); as p) {
            <app-notice tone="notice">
              <p>{{ p.message }}</p>
              @if (linkExpired()) {
                <p><a routerLink="/forgot-password">Send me a new link</a></p>
              }
            </app-notice>
          }
          <button class="btn btn-primary btn-block" type="submit" [attr.aria-disabled]="pending() ? 'true' : null">
            @if (pending()) {
              <app-spinner />
              Saving…
            } @else {
              Save new password
            }
          </button>
        </form>
      </app-page>
    }
  `,
})
export class ResetPasswordPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly email = this.route.snapshot.queryParamMap.get('email');
  protected readonly code = this.route.snapshot.queryParamMap.get('code');

  protected readonly form = new FormGroup({
    newPassword: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.minLength(10)] }),
  });
  protected readonly pending = signal(false);
  protected readonly done = signal(false);
  protected readonly problem = signal<FriendlyProblem | null>(null);
  protected readonly fieldErrors = computed<Record<string, string>>(() => this.problem()?.fields ?? {});
  protected readonly linkExpired = signal(false);

  constructor() {
    afterNextRender(() => {
      if (this.code !== null) {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { code: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      }
    });
  }

  protected async submit(): Promise<void> {
    if (this.pending() || !this.email || !this.code) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    this.linkExpired.set(false);
    try {
      await this.api.resetPassword({ email: this.email, resetCode: this.code, newPassword: this.form.controls.newPassword.value });
      this.done.set(true);
      afterNextRender(() => focusPageHeading(this.host.nativeElement), { injector: this.injector });
    } catch (error) {
      const apiError = asApiError(error);
      this.linkExpired.set(apiError.status === 401 || !!apiError.problem?.errors?.['InvalidToken']);
      this.problem.set(problemToMessage(apiError, 'reset-password'));
    } finally {
      this.pending.set(false);
    }
  }
}
