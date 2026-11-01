import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  Injector,
  signal,
} from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { asApiError, problemToMessage } from '../../core/problem';
import { FieldInputDirective, focusFirstInvalid, FormFieldComponent } from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { focusPageHeading, PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

@Component({
  selector: 'app-forgot-password-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, RouterLink, PageComponent, FormFieldComponent, FieldInputDirective, NoticeComponent, SpinnerComponent],
  template: `
    @if (sent()) {
      <app-page heading="Check your inbox" lede="If that address has an account, a link is on its way. It can take a minute or two.">
        <a class="btn btn-quiet btn-block" routerLink="/login">Back to sign in</a>
      </app-page>
    } @else {
      <app-page heading="Reset your password" lede="Tell us your email and we'll send you a link to choose a new one.">
        <form class="stack" [formGroup]="form" (ngSubmit)="submit()" novalidate>
          <app-form-field label="Email">
            <input appFieldInput class="input" type="email" formControlName="email" autocomplete="email" inputmode="email" spellcheck="false" />
          </app-form-field>
          @if (problem(); as message) {
            <app-notice tone="notice">{{ message }}</app-notice>
          }
          <button class="btn btn-primary btn-block" type="submit" [attr.aria-disabled]="pending() ? 'true' : null">
            @if (pending()) {
              <app-spinner />
              Sending…
            } @else {
              Send the link
            }
          </button>
        </form>
        <a class="btn btn-quiet btn-block" routerLink="/login">Back to sign in</a>
      </app-page>
    }
  `,
})
export class ForgotPasswordPage {
  private readonly api = inject(ApiClient);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] }),
  });
  protected readonly pending = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly sent = signal(false);

  protected async submit(): Promise<void> {
    if (this.pending()) return;
    this.form.markAllAsTouched();
    if (this.form.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.pending.set(true);
    this.problem.set(null);
    try {
      await this.api.forgotPassword(this.form.controls.email.value.trim());
      this.sent.set(true);
      afterNextRender(() => focusPageHeading(this.host.nativeElement), { injector: this.injector });
    } catch (error) {
      this.problem.set(problemToMessage(asApiError(error)).message);
    } finally {
      this.pending.set(false);
    }
  }
}
