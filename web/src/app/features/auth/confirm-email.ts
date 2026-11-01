import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient } from '../../core/api-client';
import { asApiError, problemToMessage } from '../../core/problem';
import {
  FieldInputDirective,
  focusFirstInvalid,
  FormFieldComponent,
} from '../../shared/form-field';
import { NoticeComponent } from '../../shared/notice';
import { PageComponent } from '../../shared/page';

type ConfirmState = 'password' | 'confirmed' | 'incomplete';

@Component({
  selector: 'app-confirm-email-page',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NgTemplateOutlet,
    ReactiveFormsModule,
    RouterLink,
    PageComponent,
    FormFieldComponent,
    FieldInputDirective,
    NoticeComponent,
  ],
  template: `
    @switch (state()) {
      @case ('password') {
        <app-page
          heading="Confirm your email"
          lede="Enter the password you chose when you signed up."
        >
          @if (problem()) {
            <app-notice>
              {{ problem() }}
              <a routerLink="/forgot-password">Reset your password</a>
            </app-notice>
          }
          <form class="stack" (submit)="confirm($event)" novalidate>
            <app-form-field label="Password">
              <input
                appFieldInput
                class="input"
                type="password"
                [formControl]="password"
                autocomplete="current-password"
              />
            </app-form-field>
            <button
              class="btn btn-primary btn-block"
              type="submit"
              [attr.aria-disabled]="confirming() ? 'true' : null"
            >
              {{ confirming() ? 'Confirming…' : 'Confirm email' }}
            </button>
          </form>
          @if (problem()) {
            <ng-container *ngTemplateOutlet="resendForm" />
          }
        </app-page>
      }
      @case ('confirmed') {
        <app-page
          heading="You're confirmed"
          lede="Welcome to Ember. Sign in whenever you're ready."
        >
          <a class="btn btn-primary btn-block" routerLink="/login">Sign in</a>
        </app-page>
      }
      @default {
        <app-page heading="Let's get you a fresh link">
          <app-notice
            >This link looks incomplete. Open it again from the email, or ask for a new one
            here.</app-notice
          >
          <ng-container *ngTemplateOutlet="resendForm" />
          <a class="btn btn-quiet btn-block" routerLink="/login">Back to sign in</a>
        </app-page>
      }
    }

    <ng-template #resendForm>
      @if (resent()) {
        <app-notice tone="success"
          >If that address still needs confirming, a fresh link is on its way.</app-notice
        >
      } @else {
        <form class="stack" (submit)="resend($event)" novalidate>
          <app-form-field label="Email for a new link" [serverError]="resendError()">
            <input
              appFieldInput
              class="input"
              type="email"
              [formControl]="email"
              autocomplete="email"
              inputmode="email"
              spellcheck="false"
            />
          </app-form-field>
          <button
            class="btn btn-secondary btn-block"
            type="submit"
            [attr.aria-disabled]="sending() ? 'true' : null"
          >
            {{ sending() ? 'Sending…' : 'Send a new link' }}
          </button>
        </form>
      }
    </ng-template>
  `,
})
export class ConfirmEmailPage {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  private readonly userId: string | null;
  private readonly code: string | null;

  protected readonly state = signal<ConfirmState>('password');
  protected readonly password = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required],
  });
  protected readonly confirming = signal(false);
  protected readonly problem = signal<string | null>(null);
  protected readonly email = new FormControl('', {
    nonNullable: true,
    validators: [Validators.required, Validators.email],
  });
  protected readonly sending = signal(false);
  protected readonly resent = signal(false);
  protected readonly resendError = signal<string | null>(null);

  constructor() {
    const query = this.route.snapshot.queryParamMap;
    this.userId = query.get('userId');
    this.code = query.get('code');

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

    if (!this.userId || !this.code) this.state.set('incomplete');
  }

  protected async confirm(event: Event): Promise<void> {
    event.preventDefault();
    if (this.confirming() || !this.userId || !this.code) return;
    this.password.markAsTouched();
    if (this.password.invalid) {
      focusFirstInvalid(this.host.nativeElement);
      return;
    }
    this.confirming.set(true);
    this.problem.set(null);
    try {
      await this.api.confirmEmail(this.userId, this.code, this.password.value);
      this.state.set('confirmed');
    } catch (error) {
      this.problem.set(problemToMessage(asApiError(error), 'confirm-email').message);
    } finally {
      this.confirming.set(false);
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
