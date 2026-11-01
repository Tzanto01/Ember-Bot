import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  Injector,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { concatMap } from 'rxjs';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiClient, saveFile } from '../../core/api-client';
import { AuthService } from '../../core/auth.service';
import { browserTimeZone, isValidTimeZone, timeZoneLabel } from '../../core/local-date';
import { ExportFormat, MePatch } from '../../core/models';
import { ApiError, asApiError, problemToMessage } from '../../core/problem';
import { PushService } from '../../core/push.service';
import {
  FieldInputDirective,
  focusFirstInvalid,
  FormFieldComponent,
} from '../../shared/form-field';
import { NoticeComponent, NoticeTone } from '../../shared/notice';
import { PageComponent } from '../../shared/page';
import { SpinnerComponent } from '../../shared/spinner';

type Section =
  | 'timezone'
  | 'grace'
  | 'leaderboard'
  | 'discord'
  | 'dm'
  | 'push'
  | 'export'
  | 'signout'
  | 'delete';

interface Message {
  tone: NoticeTone;
  text: string;
}

const discordOutcomes: Record<string, Message> = {
  linked: { tone: 'success', text: 'Discord is linked. You can sign in with it from now on.' },
  conflict: {
    tone: 'notice',
    text: 'That Discord account is already connected to another Ember account with a password, or this account already has a different Discord login.',
  },
  error: { tone: 'notice', text: "Linking didn't finish. You can try again." },
};

const pushDeniedText =
  'Your browser is blocking notifications from Ember. To allow them, open the site settings (often the icon next to the address bar), set Notifications to Allow, then try again.';

const passwordMismatch = "That password doesn't match. Try again.";
const typeDeleteText = 'Type DELETE in capital letters to confirm.';
const unknownZoneText = "Ember doesn't know that timezone. Pick one from the list.";

function zoneList(): string[] {
  return typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
}

function knownZone(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || isValidTimeZone(value) ? null : { zone: true };
}

function deleteWord(control: AbstractControl<string>): ValidationErrors | null {
  const value = control.value.trim();
  return !value || value === 'DELETE' ? null : { word: true };
}

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

@Component({
  selector: 'app-settings-page',
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
    <app-page heading="Settings">
      @if (discordNotice(); as n) {
        <app-notice [tone]="n.tone">{{ n.text }}</app-notice>
      }

      @if (me(); as me) {
        <section id="timezone" class="card stack" aria-labelledby="timezone-heading">
          <h2 id="timezone-heading">Timezone</h2>
          @if (me.timezoneSet) {
            <p>
              Your days follow <strong>{{ zoneLabel(me.timezone) }}</strong
              >. Reminders and "today" use this timezone.
            </p>
          } @else {
            <p>
              You haven't picked a timezone yet, so Ember uses
              <strong>{{ zoneLabel(me.timezone) }}</strong> for now. Reminders and "today" follow
              it.
            </p>
          }
          @if (suggestZone()) {
            <div class="row">
              <button
                class="btn btn-primary"
                type="button"
                [attr.aria-disabled]="busy() ? 'true' : null"
                (click)="saveTimezone(browserZone)"
              >
                Use {{ browserZone }}
              </button>
            </div>
          }
          <form #tzFormEl class="stack" [formGroup]="tzForm" (ngSubmit)="saveTimezone()" novalidate>
            <app-form-field
              label="Choose a timezone"
              hint="Start typing a city or region, like Berlin or New York."
              [messages]="tzMessages"
              [serverError]="tzError()"
            >
              <input
                appFieldInput
                class="input"
                type="text"
                list="timezone-list"
                formControlName="timezone"
                autocomplete="off"
                spellcheck="false"
              />
            </app-form-field>
            <datalist id="timezone-list">
              @for (zone of zones; track zone) {
                <option [value]="zone"></option>
              }
            </datalist>
            <div class="row">
              <button
                class="btn btn-secondary"
                type="submit"
                [attr.aria-disabled]="busy() ? 'true' : null"
              >
                @if (busy() === 'timezone') {
                  <app-spinner />
                  Saving…
                } @else {
                  Save timezone
                }
              </button>
              <p class="muted" role="status">{{ saved() === 'timezone' ? 'Saved.' : '' }}</p>
            </div>
          </form>
          @if (messages()['timezone']; as m) {
            <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
          }
        </section>

        <section id="grace" class="card stack" aria-labelledby="grace-heading">
          <h2 id="grace-heading">Grace days</h2>
          <app-form-field
            label="Grace days per week"
            hint="Grace days are flex days: up to this many days a week can pass without a check-in and your streak keeps going. Every check-in counts, no matter the gap."
          >
            <select appFieldInput class="input" [formControl]="grace">
              @for (n of graceOptions; track n) {
                <option [ngValue]="n">
                  {{ n === 0 ? 'None' : n === 1 ? '1 day a week' : n + ' days a week' }}
                </option>
              }
            </select>
          </app-form-field>
          <p class="muted" role="status">{{ saved() === 'grace' ? 'Saved.' : '' }}</p>
          @if (messages()['grace']; as m) {
            <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
          }
        </section>

        <section id="leaderboard" class="card stack" aria-labelledby="leaderboard-heading">
          <h2 id="leaderboard-heading">Leaderboards</h2>
          <p>
            You're off leaderboards by default, so your progress stays private. Turn this on if
            you'd like your streaks to show up there. You can switch it off again any time.
          </p>
          <label class="checkbox">
            <input type="checkbox" [formControl]="leaderboard" />
            Show me on leaderboards
          </label>
          <p class="muted" role="status">{{ saved() === 'leaderboard' ? 'Saved.' : '' }}</p>
          @if (messages()['leaderboard']; as m) {
            <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
          }
        </section>

        <section id="discord" class="card stack" aria-labelledby="discord-heading">
          <h2 id="discord-heading">Discord</h2>
          @if (me.discord.linked) {
            <p>
              Your Discord account is linked. You can sign in with it, and the Ember bot knows it's
              you.
            </p>
            <div class="row">
              <button
                class="btn btn-secondary"
                type="button"
                [attr.aria-disabled]="busy() ? 'true' : null"
                (click)="unlinkDiscord()"
              >
                @if (busy() === 'discord') {
                  <app-spinner />
                  Unlinking…
                } @else {
                  Unlink Discord
                }
              </button>
            </div>
          } @else {
            <p>
              Link your Discord account to sign in with it and to use the Ember bot with the same
              habits.
            </p>
            <div class="row">
              <a class="btn btn-secondary" [href]="linkUrl">Link Discord</a>
            </div>
          }
          @if (messages()['discord']; as m) {
            <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
          }
        </section>

        @if (me.dmReminders.paused || messages()['dm']) {
          <section id="dm-reminders" class="card stack" aria-labelledby="dm-heading">
            <h2 id="dm-heading">Discord reminders</h2>
            @if (me.dmReminders.paused) {
              <p>
                Ember paused your Discord DM reminders because they couldn't be delivered. This
                often happens when DMs from server members are turned off. Once DMs can reach you
                again, you can turn them back on.
              </p>
              <div class="row">
                <button
                  class="btn btn-secondary"
                  type="button"
                  [attr.aria-disabled]="busy() ? 'true' : null"
                  (click)="resumeDms()"
                >
                  @if (busy() === 'dm') {
                    <app-spinner />
                    Resuming…
                  } @else {
                    Resume DM reminders
                  }
                </button>
              </div>
            }
            @if (messages()['dm']; as m) {
              <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
            }
          </section>
        }

        @if (push.available()) {
          <section id="push" class="card stack" aria-labelledby="push-heading">
            <h2 id="push-heading">Notifications on this device</h2>
            <p>
              Get gentle reminders here, even when Ember isn't open. By default a notification
              doesn't name your habit, since it can show on a lock screen.
            </p>
            @if (showIosHint) {
              <p class="muted">
                On iPhone and iPad, notifications work once Ember is on your Home Screen: tap Share,
                choose "Add to Home Screen", then open Ember from there.
              </p>
            }
            @if (push.subscribed()) {
              <p>Notifications are on for this device.</p>
            }
            <div class="row">
              @if (push.subscribed()) {
                <button
                  class="btn btn-secondary"
                  type="button"
                  [attr.aria-disabled]="busy() ? 'true' : null"
                  (click)="disablePush()"
                >
                  @if (busy() === 'push') {
                    <app-spinner />
                    Turning off…
                  } @else {
                    Turn off notifications
                  }
                </button>
              } @else {
                <button
                  class="btn btn-primary"
                  type="button"
                  [attr.aria-disabled]="busy() ? 'true' : null"
                  (click)="enablePush()"
                >
                  @if (busy() === 'push') {
                    <app-spinner />
                    Turning on…
                  } @else {
                    Turn on notifications
                  }
                </button>
              }
            </div>
            @if (messages()['push']; as m) {
              <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
            }
          </section>
        }

        <section id="export" class="card stack" aria-labelledby="export-heading">
          <h2 id="export-heading">Your data</h2>
          <p>
            Download everything Ember keeps about you: your settings, every habit (paused ones too),
            all check-ins and low days, your email and your Discord ID. JSON is handy for other
            apps, CSV opens in a spreadsheet.
          </p>
          <div class="row">
            @for (format of exportFormats; track format) {
              <button
                class="btn btn-secondary"
                type="button"
                [attr.aria-disabled]="busy() ? 'true' : null"
                (click)="exportAs(format)"
              >
                @if (exporting() === format) {
                  <app-spinner />
                  Preparing…
                } @else {
                  Download {{ format.toUpperCase() }}
                }
              </button>
            }
          </div>
          @if (messages()['export']; as m) {
            <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
          }
        </section>

        <section id="account" class="card stack" aria-labelledby="account-heading">
          <h2 id="account-heading">Account</h2>
          <ul class="links" aria-label="Legal">
              <li><a class="tap-link" routerLink="/legal/privacy">Privacy</a></li>
              <li><a class="tap-link" routerLink="/legal/terms">Terms</a></li>
              <li><a class="tap-link" routerLink="/legal/imprint">Imprint</a></li>
          </ul>
          <div class="row">
            <button
              class="btn btn-secondary"
              type="button"
              [attr.aria-disabled]="busy() ? 'true' : null"
              (click)="signOut()"
            >
              @if (busy() === 'signout') {
                <app-spinner />
                Signing out…
              } @else {
                Sign out
              }
            </button>
          </div>
        </section>

        <section id="delete" class="card stack farewell" aria-labelledby="delete-heading">
          <h2 id="delete-heading">Delete your account</h2>
          <p>
            This removes your account and everything in it: habits, check-ins, low days and
            settings. It can't be undone. If you'd like to keep a copy, download your data first.
          </p>
          <form
            #deleteFormEl
            class="stack"
            [formGroup]="deleteForm"
            (ngSubmit)="deleteAccount()"
            novalidate
          >
            @if (me.hasPassword) {
              <input
                class="visually-hidden"
                type="email"
                name="username"
                autocomplete="username"
                [value]="me.email ?? ''"
                readonly
                tabindex="-1"
                aria-hidden="true"
              />
              <app-form-field
                label="Your password"
                [messages]="secretMessages"
                [serverError]="deleteErrors()['password']"
              >
                <input
                  appFieldInput
                  class="input"
                  type="password"
                  formControlName="password"
                  autocomplete="current-password"
                />
              </app-form-field>
            }
            <app-form-field
              label="Type DELETE to confirm"
              [messages]="confirmMessages"
              [serverError]="deleteErrors()['confirm']"
            >
              <input
                appFieldInput
                class="input"
                type="text"
                formControlName="confirm"
                autocomplete="off"
                autocapitalize="characters"
                spellcheck="false"
              />
            </app-form-field>
            @if (messages()['delete']; as m) {
              <app-notice [tone]="m.tone">{{ m.text }}</app-notice>
            }
            <div class="row">
              <button
                class="btn btn-secondary"
                type="submit"
                [attr.aria-disabled]="busy() ? 'true' : null"
              >
                @if (busy() === 'delete') {
                  <app-spinner />
                  Deleting…
                } @else {
                  Delete my account
                }
              </button>
            </div>
          </form>
        </section>
      }
    </app-page>
  `,
  styles: `
    :host {
      display: block;
      max-width: 44rem;
    }
    section {
      scroll-margin-top: calc(var(--tap) + var(--space-10));
    }
    .links {
      display: flex;
      flex-wrap: wrap;
      gap: 0 var(--space-5);
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .farewell {
      margin-top: var(--space-6);
      background: var(--color-notice-bg);
      border-color: var(--color-notice-border);
    }
  `,
})
export class SettingsPage {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  protected readonly push = inject(PushService);

  private readonly tzFormEl = viewChild<string, ElementRef<HTMLFormElement>>('tzFormEl', { read: ElementRef });
  private readonly deleteFormEl = viewChild<string, ElementRef<HTMLFormElement>>('deleteFormEl', { read: ElementRef });

  protected readonly me = this.auth.me;
  protected readonly zones = zoneList();
  protected readonly browserZone = browserTimeZone();
  protected readonly zoneLabel = timeZoneLabel;
  protected readonly graceOptions = [0, 1, 2, 3];
  protected readonly exportFormats: ExportFormat[] = ['json', 'csv'];
  protected readonly linkUrl = this.api.discordLinkUrl();
  protected readonly showIosHint = isIos() && !isStandalone();
  protected readonly tzMessages = {
    required: 'Pick a timezone, or start typing a city.',
    zone: unknownZoneText,
  };
  protected readonly secretMessages = { required: 'Please enter your password.' };
  protected readonly confirmMessages = {
    required: 'Type DELETE to confirm.',
    word: typeDeleteText,
  };

  protected readonly busy = signal<Section | null>(null);
  protected readonly saved = signal<Section | null>(null);
  protected readonly exporting = signal<ExportFormat | null>(null);
  protected readonly messages = signal<Partial<Record<Section, Message>>>({});
  protected readonly discordNotice = signal<Message | null>(null);
  protected readonly tzError = signal<string | null>(null);
  protected readonly deleteErrors = signal<Record<string, string>>({});

  protected readonly suggestZone = computed(() => {
    const me = this.me();
    return (
      !!me &&
      isValidTimeZone(this.browserZone) &&
      (!me.timezoneSet || me.timezone !== this.browserZone)
    );
  });

  protected readonly tzForm = new FormGroup({
    timezone: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, knownZone],
    }),
  });
  protected readonly grace = new FormControl(this.me()?.graceDaysPerWeek ?? 0, {
    nonNullable: true,
  });
  protected readonly leaderboard = new FormControl(this.me()?.leaderboardOptIn ?? false, {
    nonNullable: true,
  });
  protected readonly deleteForm = new FormGroup({
    password: new FormControl('', {
      nonNullable: true,
      validators: this.me()?.hasPassword ? [Validators.required] : [],
    }),
    confirm: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required, deleteWord],
    }),
  });

  constructor() {
    void this.push.check();

    this.grace.valueChanges
      .pipe(concatMap((value) => this.saveGrace(value)), takeUntilDestroyed())
      .subscribe();
    this.leaderboard.valueChanges
      .pipe(concatMap((value) => this.saveLeaderboard(value)), takeUntilDestroyed())
      .subscribe();

    const outcome = this.route.snapshot.queryParamMap.get('discord');
    if (outcome && Object.hasOwn(discordOutcomes, outcome)) {
      this.discordNotice.set(discordOutcomes[outcome]);
      if (outcome === 'linked') void this.refreshAfterLink();
      afterNextRender(() => {
        void this.router.navigate([], {
          relativeTo: this.route,
          queryParams: { discord: null },
          queryParamsHandling: 'merge',
          replaceUrl: true,
        });
      });
    }
  }

  protected async saveTimezone(zone?: string): Promise<void> {
    if (this.busy()) return;
    if (zone === undefined) {
      this.tzForm.markAllAsTouched();
      if (this.tzForm.invalid) {
        this.focusInvalid(this.tzFormEl());
        return;
      }
      zone = this.tzForm.controls.timezone.value.trim();
    }
    this.tzError.set(null);
    const error = await this.patch('timezone', { timezone: zone });
    if (!error) {
      this.tzForm.reset();
    } else if (error.status === 400) {
      this.tzError.set(unknownZoneText);
    } else {
      this.fail('timezone', error);
    }
  }

  protected async unlinkDiscord(): Promise<void> {
    if (this.busy()) return;
    this.start('discord');
    try {
      await this.api.unlinkDiscord();
      await this.auth.refreshAntiforgery();
      await this.auth.loadMe(true);
      this.show('discord', {
        tone: 'success',
        text: 'Discord is unlinked. You can link it again any time.',
      });
    } catch (error) {
      this.fail('discord', asApiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async resumeDms(): Promise<void> {
    if (this.busy()) return;
    this.start('dm');
    try {
      await this.api.resumeDmReminders();
      await this.auth.loadMe(true);
      this.show('dm', { tone: 'success', text: 'DM reminders are back on.' });
    } catch (error) {
      this.fail('dm', asApiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async enablePush(): Promise<void> {
    if (this.busy()) return;
    this.start('push');
    try {
      await this.push.subscribe();
      this.show('push', {
        tone: 'success',
        text: 'Notifications are on. Reminders can now reach this device.',
      });
    } catch (error) {
      if (error instanceof ApiError) {
        this.fail('push', error);
      } else if (
        this.push.isDenied() ||
        (error instanceof DOMException && error.name === 'NotAllowedError')
      ) {
        this.show('push', { tone: 'notice', text: pushDeniedText });
      } else {
        this.show('push', {
          tone: 'notice',
          text: "Notifications couldn't be turned on in this browser. You can try again.",
        });
      }
    } finally {
      this.busy.set(null);
    }
  }

  protected async disablePush(): Promise<void> {
    if (this.busy()) return;
    this.start('push');
    try {
      await this.push.unsubscribe();
      this.show('push', { tone: 'info', text: 'Notifications are off for this device.' });
    } catch (error) {
      this.fail('push', asApiError(error));
    } finally {
      this.busy.set(null);
    }
  }

  protected async exportAs(format: ExportFormat): Promise<void> {
    if (this.busy()) return;
    this.start('export');
    this.exporting.set(format);
    try {
      saveFile(await this.api.exportData(format));
    } catch (error) {
      this.fail('export', asApiError(error));
    } finally {
      this.exporting.set(null);
      this.busy.set(null);
    }
  }

  protected async signOut(): Promise<void> {
    if (this.busy()) return;
    this.start('signout');
    await this.auth.logout();
  }

  protected async deleteAccount(): Promise<void> {
    const me = this.me();
    if (this.busy() || !me) return;
    this.deleteForm.markAllAsTouched();
    if (this.deleteForm.invalid) {
      this.focusInvalid(this.deleteFormEl());
      return;
    }
    this.start('delete');
    this.deleteErrors.set({});
    try {
      const secret = this.deleteForm.controls.password.value;
      await this.api.deleteAccount(
        me.hasPassword ? { password: secret, confirm: 'DELETE' } : { confirm: 'DELETE' },
      );
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 400) {
        this.deleteErrors.set(
          me.hasPassword ? { password: passwordMismatch } : { confirm: typeDeleteText },
        );
        afterNextRender(
          () =>
            this.deleteFormEl()
              ?.nativeElement.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus(),
          { injector: this.injector },
        );
      } else {
        this.fail('delete', apiError);
      }
      this.busy.set(null);
      return;
    }
    await this.push.forgetDevice();
    this.auth.clearSession();
    await this.auth.refreshAntiforgery();
    await this.router.navigateByUrl('/login?reason=deleted');
  }

  private async saveGrace(value: number): Promise<void> {
    const error = await this.patch('grace', { graceDaysPerWeek: value });
    if (!error || this.grace.value !== value) return;
    this.grace.setValue(this.me()?.graceDaysPerWeek ?? 0, { emitEvent: false });
    this.fail('grace', error);
  }

  private async saveLeaderboard(value: boolean): Promise<void> {
    const error = await this.patch('leaderboard', { leaderboardOptIn: value });
    if (!error || this.leaderboard.value !== value) return;
    this.leaderboard.setValue(this.me()?.leaderboardOptIn ?? false, { emitEvent: false });
    this.fail('leaderboard', error);
  }

  private async patch(section: Section, body: MePatch): Promise<ApiError | null> {
    this.start(section);
    try {
      this.auth.setMe(await this.api.updateMe(body));
      this.saved.set(section);
      return null;
    } catch (error) {
      return asApiError(error);
    } finally {
      this.busy.set(null);
    }
  }

  private async refreshAfterLink(): Promise<void> {
    await this.auth.refreshAntiforgery();
    await this.auth.loadMe(true).catch(() => null);
  }

  private start(section: Section): void {
    this.busy.set(section);
    this.saved.set(null);
    this.messages.set({});
  }

  private show(section: Section, message: Message): void {
    const next: Partial<Record<Section, Message>> = {};
    next[section] = message;
    this.messages.set(next);
  }

  private fail(section: Section, error: ApiError): void {
    if (!error.handled)
      this.show(section, { tone: 'notice', text: problemToMessage(error).message });
  }

  private focusInvalid(form: ElementRef<HTMLFormElement> | undefined): void {
    if (form) focusFirstInvalid(form.nativeElement);
  }
}
