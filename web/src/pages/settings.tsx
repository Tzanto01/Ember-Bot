import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { PageHeader } from '@/components/page-header';
import { ThemePicker } from '@/components/theme-picker';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { NativeSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';
import { browserTimeZone, isValidTimeZone, timeZoneLabel } from '@/lib/local-date';
import type { ExportFormat, MePatch } from '@/lib/models';
import { openOnWeb } from '@/lib/native/browser';
import { ApiError, asApiError, problemToMessage } from '@/lib/problem';
import { api, auth, push, reminders } from '@/lib/services';
import { useStore } from '@/lib/store';

type Section = 'timezone' | 'grace' | 'leaderboard' | 'discord' | 'dm' | 'push' | 'export' | 'signout' | 'delete';

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

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
const graceOptions = [0, 1, 2, 3];
const exportFormats: ExportFormat[] = ['json', 'csv'];
const scrollMargin = 'scroll-mt-[calc(56px+env(safe-area-inset-top)+1.5rem)]';

function zoneError(value: string): string | null {
  const zone = value.trim();
  if (!zone) return 'Pick a timezone, or start typing a city.';
  return isValidTimeZone(zone) ? null : unknownZoneText;
}

const passwordRequired: Validator = (value) => (value ? null : 'Please enter your password.');
const noPassword: Validator = () => null;
const deleteWord: Validator = (value) => {
  const word = value.trim();
  if (!word) return 'Type DELETE to confirm.';
  return word === 'DELETE' ? null : typeDeleteText;
};

function isIos(): boolean {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function SettingsCard({
  id,
  title,
  farewell,
  children,
}: {
  id: string;
  title: string;
  farewell?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-heading`}
      className={cardVariants({ variant: farewell ? 'farewell' : 'default', className: scrollMargin })}
    >
      <h2 id={`${id}-heading`} className="text-[22px]">
        {title}
      </h2>
      {children}
    </section>
  );
}

/**
 * `/settings`: timezone, grace days, leaderboards, Discord, reminders, push on this device, appearance, export, sign out and
 * account deletion. Reloads `me` on entry. Every `PATCH /api/me` runs one at a time, in order.
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const me = useStore(auth.me);
  const pushAvailable = useStore(push.available);
  const pushSubscribed = useStore(push.subscribed);

  const busyRef = useRef<Section | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const graceRef = useRef<number | null>(null);
  const leaderboardRef = useRef<boolean | null>(null);
  const scrolled = useRef(false);
  const tzForm = useRef<HTMLFormElement>(null);
  const deleteForm = useRef<HTMLFormElement>(null);

  const [busy, setBusy] = useState<Section | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [message, setMessage] = useState<(Message & { section: Section }) | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [grace, setGrace] = useState<number | null>(null);
  const [leaderboard, setLeaderboard] = useState<boolean | null>(null);
  const [zone, setZone] = useState('');
  const [zoneTouched, setZoneTouched] = useState(false);
  const [zoneServerError, setZoneServerError] = useState<string | null>(null);
  const [deleteErrors, setDeleteErrors] = useState<{ password?: string; confirm?: string }>({});
  const [exactAllowed, setExactAllowed] = useState<boolean | null>(null);
  const [browserZone] = useState(browserTimeZone);
  const [showIosHint] = useState(() => isIos() && !isStandalone());
  const [discordNotice] = useState<Message | null>(() => {
    const outcome = new URLSearchParams(location.search).get('discord');
    return outcome && Object.hasOwn(discordOutcomes, outcome) ? (discordOutcomes[outcome] ?? null) : null;
  });

  const password = useField(me?.hasPassword ? passwordRequired : noPassword);
  const confirm = useField(deleteWord);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linked = params.get('discord') === 'linked';
    void (linked ? auth.refreshAntiforgery() : Promise.resolve()).then(() => auth.loadMe(true)).catch(() => null);
    void push.claim();
    if (env.native) void reminders?.exactAllowed().then(setExactAllowed, () => undefined);
    if (!discordNotice) return;
    params.delete('discord');
    const search = params.toString();
    void navigate({ search: search ? `?${search}` : '', hash: location.hash }, { replace: true });
  }, []);

  useEffect(() => {
    if (scrolled.current || !me || !location.hash) return;
    const target = document.getElementById(location.hash.slice(1));
    if (!target) return;
    scrolled.current = true;
    target.scrollIntoView();
  }, [me, pushAvailable, location.hash]);

  function start(section: Section): void {
    busyRef.current = section;
    setBusy(section);
    setSaved(null);
    setMessage(null);
  }

  function finish(): void {
    busyRef.current = null;
    setBusy(null);
  }

  function show(section: Section, next: Message): void {
    setMessage({ ...next, section });
  }

  function fail(section: Section, error: ApiError): void {
    if (!error.handled) show(section, { tone: 'notice', text: problemToMessage(error).message });
  }

  function outcome(section: Section): ReactNode {
    return message?.section === section ? (
      <Notice tone={message.tone}>
        <p>{message.text}</p>
      </Notice>
    ) : null;
  }

  function savedStatus(section: Section): ReactNode {
    return (
      <p role="status" className="text-[14px] text-muted-foreground">
        {saved === section ? 'Saved.' : ''}
      </p>
    );
  }

  function patch(section: Section, body: MePatch): Promise<ApiError | null> {
    const run = chain.current.then(async () => {
      start(section);
      try {
        auth.setMe(await api.updateMe(body));
        setSaved(section);
        return null;
      } catch (error) {
        return asApiError(error);
      } finally {
        finish();
      }
    });
    chain.current = run;
    return run;
  }

  function changeGrace(value: number): void {
    graceRef.current = value;
    setGrace(value);
    void patch('grace', { graceDaysPerWeek: value }).then((error) => {
      if (graceRef.current !== value) return;
      graceRef.current = null;
      setGrace(null);
      if (error) fail('grace', error);
    });
  }

  function changeLeaderboard(value: boolean): void {
    leaderboardRef.current = value;
    setLeaderboard(value);
    void patch('leaderboard', { leaderboardOptIn: value }).then((error) => {
      if (leaderboardRef.current !== value) return;
      leaderboardRef.current = null;
      setLeaderboard(null);
      if (error) fail('leaderboard', error);
    });
  }

  async function saveTimezone(chosen?: string): Promise<void> {
    if (busyRef.current) return;
    let next = chosen;
    if (next === undefined) {
      flushSync(() => setZoneTouched(true));
      if (zoneError(zone)) {
        focusFirstInvalid(tzForm.current);
        return;
      }
      next = zone.trim();
    }
    setZoneServerError(null);
    const error = await patch('timezone', { timezone: next });
    if (!error) {
      setZone('');
      setZoneTouched(false);
    } else if (error.status === 400) {
      setZoneServerError(unknownZoneText);
    } else {
      fail('timezone', error);
    }
  }

  async function act(section: Section, action: () => Promise<Message>): Promise<void> {
    if (busyRef.current) return;
    start(section);
    try {
      show(section, await action());
    } catch (error) {
      fail(section, asApiError(error));
    } finally {
      finish();
    }
  }

  const unlinkDiscord = () =>
    act('discord', async () => {
      await api.unlinkDiscord();
      await auth.refreshAntiforgery();
      await auth.loadMe(true);
      return { tone: 'success', text: 'Discord is unlinked. You can link it again any time.' };
    });

  const resumeDms = () =>
    act('dm', async () => {
      await api.resumeDmReminders();
      await auth.loadMe(true);
      return { tone: 'success', text: 'DM reminders are back on.' };
    });

  const disablePush = () =>
    act('push', async () => {
      await push.unsubscribe();
      return { tone: 'info', text: 'Notifications are off for this device.' };
    });

  async function enablePush(): Promise<void> {
    if (busyRef.current) return;
    start('push');
    try {
      await push.subscribe();
      show('push', { tone: 'success', text: 'Notifications are on. Reminders can now reach this device.' });
    } catch (error) {
      if (error instanceof ApiError) fail('push', error);
      else if (push.isDenied() || (error instanceof DOMException && error.name === 'NotAllowedError'))
        show('push', { tone: 'notice', text: pushDeniedText });
      else
        show('push', { tone: 'notice', text: "Notifications couldn't be turned on in this browser. You can try again." });
    } finally {
      finish();
    }
  }

  async function exportAs(format: ExportFormat): Promise<void> {
    if (busyRef.current) return;
    start('export');
    setExporting(format);
    try {
      saveFile(await api.exportData(format));
    } catch (error) {
      fail('export', asApiError(error));
    } finally {
      setExporting(null);
      finish();
    }
  }

  async function allowExact(): Promise<void> {
    await reminders?.openExactSetting().catch(() => undefined);
    setExactAllowed((await reminders?.exactAllowed().catch(() => null)) ?? null);
  }

  async function signOut(): Promise<void> {
    if (busyRef.current) return;
    start('signout');
    if (await auth.logout()) return;
    finish();
    show('signout', { tone: 'notice', text: "Ember couldn't sign you out. Check your connection and try again." });
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (busyRef.current || !me) return;
    if (!validateAll(deleteForm.current, me.hasPassword ? [password, confirm] : [confirm])) return;
    start('delete');
    setDeleteErrors({});
    try {
      await api.deleteAccount(
        me.hasPassword ? { password: password.value, confirm: 'DELETE' } : { confirm: 'DELETE' },
      );
    } catch (error) {
      const apiError = asApiError(error);
      if (apiError.status === 400) {
        flushSync(() =>
          setDeleteErrors(me.hasPassword ? { password: passwordMismatch } : { confirm: typeDeleteText }),
        );
        focusFirstInvalid(deleteForm.current);
      } else {
        fail('delete', apiError);
      }
      finish();
      return;
    }
    await push.forgetDevice();
    await auth.wipeDevice();
    auth.clearSession();
    await auth.refreshAntiforgery();
    await navigate('/login?reason=deleted');
  }

  const showDm = !!me && (me.dmReminders.paused || message?.section === 'dm');
  const showPush = !env.native && pushAvailable;
  const sections = [
    { id: 'timezone', title: 'Timezone' },
    { id: 'grace', title: 'Grace days' },
    { id: 'leaderboard', title: 'Leaderboards' },
    { id: 'discord', title: 'Discord' },
    ...(showDm ? [{ id: 'dm-reminders', title: 'Discord reminders' }] : []),
    ...(showPush ? [{ id: 'push', title: 'Notifications on this device' }] : []),
    ...(env.native ? [{ id: 'phone-reminders', title: 'Reminders on this phone' }] : []),
    { id: 'appearance', title: 'Appearance' },
    { id: 'export', title: 'Your data' },
    { id: 'account', title: 'Account' },
    { id: 'delete', title: 'Delete your account' },
  ];
  const title = (id: string) => sections.find((section) => section.id === id)?.title ?? '';

  const zoneMessage = (zoneTouched ? zoneError(zone) : null) ?? zoneServerError;
  const suggestZone = !!me && isValidTimeZone(browserZone) && (!me.timezoneSet || me.timezone !== browserZone);
  const graceShown = grace ?? me?.graceDaysPerWeek ?? 0;
  const leaderboardShown = leaderboard ?? me?.leaderboardOptIn ?? false;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />
      {discordNotice && (
        <Notice tone={discordNotice.tone}>
          <p>{discordNotice.text}</p>
        </Notice>
      )}
      {me ? (
        <div className="grid gap-6 lg:grid-cols-[14rem_minmax(0,40rem)] lg:items-start">
          <nav
            aria-label="Settings sections"
            className="hidden lg:sticky lg:top-[calc(56px+env(safe-area-inset-top)+1.5rem)] lg:block"
          >
            <ul className="flex flex-col gap-1">
              {sections.map((section) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="flex min-h-[44px] items-center rounded-md px-3 text-[14px] text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground"
                  >
                    {section.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <div className="flex min-w-0 flex-col gap-6">
            <SettingsCard id="timezone" title={title('timezone')}>
              {me.timezoneSet ? (
                <p>
                  Your days follow <strong>{timeZoneLabel(me.timezone)}</strong>. Reminders and "today" use this
                  timezone.
                </p>
              ) : (
                <p>
                  You haven't picked a timezone yet, so Ember uses <strong>{timeZoneLabel(me.timezone)}</strong> for
                  now. Reminders and "today" follow it.
                </p>
              )}
              {suggestZone && (
                <div>
                  <Button
                    type="button"
                    aria-disabled={busy !== null || undefined}
                    onClick={() => void saveTimezone(browserZone)}
                  >
                    Use {browserZone}
                  </Button>
                </div>
              )}
              <form
                ref={tzForm}
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveTimezone();
                }}
                className="flex flex-col gap-3"
              >
                <FormField
                  label="Choose a timezone"
                  hint="Start typing a city or region, like Berlin or New York."
                  error={zoneMessage}
                >
                  {(field) => (
                    <Input
                      {...field}
                      type="text"
                      list="timezone-list"
                      autoComplete="off"
                      spellCheck={false}
                      value={zone}
                      onChange={(event) => setZone(event.target.value)}
                      onBlur={() => setZoneTouched(true)}
                    />
                  )}
                </FormField>
                <datalist id="timezone-list">
                  {zones.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
                <div className="flex flex-wrap items-center gap-3">
                  <BusyButton type="submit" variant="secondary" busy={busy === 'timezone'} busyLabel="Saving…">
                    Save timezone
                  </BusyButton>
                  {savedStatus('timezone')}
                </div>
              </form>
              {outcome('timezone')}
            </SettingsCard>

            <SettingsCard id="grace" title={title('grace')}>
              <FormField
                label="Grace days per week"
                hint="Grace days are flex days: up to this many days a week can pass without a check-in and your streak keeps going. Every check-in counts, no matter the gap."
              >
                {(field) => (
                  <NativeSelect
                    {...field}
                    value={String(graceShown)}
                    onChange={(event) => changeGrace(Number(event.target.value))}
                  >
                    {graceOptions.map((n) => (
                      <option key={n} value={n}>
                        {n === 0 ? 'None' : n === 1 ? '1 day a week' : `${n} days a week`}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              {savedStatus('grace')}
              {outcome('grace')}
            </SettingsCard>

            <SettingsCard id="leaderboard" title={title('leaderboard')}>
              <p>
                You're off leaderboards by default, so your progress stays private. Turn this on if you'd like your
                streaks to show up there. You can switch it off again any time.
              </p>
              <div className="flex min-h-[44px] items-center gap-3">
                <Switch id="leaderboard-opt-in" checked={leaderboardShown} onCheckedChange={changeLeaderboard} />
                <Label htmlFor="leaderboard-opt-in" className="cursor-pointer font-normal">
                  Show me on leaderboards
                </Label>
              </div>
              {savedStatus('leaderboard')}
              {outcome('leaderboard')}
            </SettingsCard>

            <SettingsCard id="discord" title={title('discord')}>
              {me.discord.linked ? (
                <>
                  <p>Your Discord account is linked. You can sign in with it, and the Ember bot knows it's you.</p>
                  <div>
                    <BusyButton
                      type="button"
                      variant="secondary"
                      busy={busy === 'discord'}
                      busyLabel="Unlinking…"
                      onClick={() => void unlinkDiscord()}
                    >
                      Unlink Discord
                    </BusyButton>
                  </div>
                </>
              ) : (
                <>
                  <p>Link your Discord account to sign in with it and to use the Ember bot with the same habits.</p>
                  <div>
                    {env.native ? (
                      <Button type="button" variant="secondary" onClick={() => void openOnWeb('/settings')}>
                        Link Discord on the web
                      </Button>
                    ) : (
                      <Button asChild variant="secondary">
                        <a href={api.discordLinkUrl()}>Link Discord</a>
                      </Button>
                    )}
                  </div>
                  {env.native && (
                    <p className="text-[14px] text-muted-foreground">
                      Linking happens in your browser. Come back here afterwards and Ember picks it up.
                    </p>
                  )}
                </>
              )}
              {outcome('discord')}
            </SettingsCard>

            {showDm && (
              <SettingsCard id="dm-reminders" title={title('dm-reminders')}>
                {me.dmReminders.paused && (
                  <>
                    <p>
                      Ember paused your Discord DM reminders because they couldn't be delivered. This often happens
                      when DMs from server members are turned off. Once DMs can reach you again, you can turn them back
                      on.
                    </p>
                    <div>
                      <BusyButton
                        type="button"
                        variant="secondary"
                        busy={busy === 'dm'}
                        busyLabel="Resuming…"
                        onClick={() => void resumeDms()}
                      >
                        Resume DM reminders
                      </BusyButton>
                    </div>
                  </>
                )}
                {outcome('dm')}
              </SettingsCard>
            )}

            {showPush && (
              <SettingsCard id="push" title={title('push')}>
                <p>
                  Get gentle reminders here, even when Ember isn't open. By default a notification doesn't name your
                  habit, since it can show on a lock screen.
                </p>
                {showIosHint && (
                  <p className="text-muted-foreground">
                    On iPhone and iPad, notifications work once Ember is on your Home Screen: tap Share, choose "Add to
                    Home Screen", then open Ember from there.
                  </p>
                )}
                {pushSubscribed && <p>Notifications are on for this device.</p>}
                <div>
                  {pushSubscribed ? (
                    <BusyButton
                      type="button"
                      variant="secondary"
                      busy={busy === 'push'}
                      busyLabel="Turning off…"
                      onClick={() => void disablePush()}
                    >
                      Turn off notifications
                    </BusyButton>
                  ) : (
                    <BusyButton
                      type="button"
                      busy={busy === 'push'}
                      busyLabel="Turning on…"
                      onClick={() => void enablePush()}
                    >
                      Turn on notifications
                    </BusyButton>
                  )}
                </div>
                {outcome('push')}
              </SettingsCard>
            )}

            {env.native && (
              <SettingsCard id="phone-reminders" title={title('phone-reminders')}>
                <p>
                  Turn on "Remind me on this phone" for a habit when you edit it. Reminders are set on this phone, so
                  they arrive even without a connection.
                </p>
                {exactAllowed === false && (
                  <>
                    <p className="text-[14px] text-muted-foreground">
                      Your phone may deliver them a few minutes late. Allow exact alarms for Ember to get them right on
                      time.
                    </p>
                    <div>
                      <Button type="button" variant="secondary" onClick={() => void allowExact()}>
                        Allow exact reminder times
                      </Button>
                    </div>
                  </>
                )}
              </SettingsCard>
            )}

            <SettingsCard id="appearance" title={title('appearance')}>
              <p>Choose how Ember looks on this device.</p>
              <ThemePicker labelledBy="appearance-heading" />
            </SettingsCard>

            <SettingsCard id="export" title={title('export')}>
              <p>
                Download everything Ember keeps about you: your settings, every habit (paused ones too), all check-ins
                and low days, your email and your Discord ID. JSON is handy for other apps, CSV opens in a spreadsheet.
              </p>
              <div className="flex flex-wrap gap-2">
                {env.native ? (
                  <Button type="button" variant="secondary" onClick={() => void openOnWeb('/settings')}>
                    Download on the web
                  </Button>
                ) : (
                  exportFormats.map((format) => (
                    <BusyButton
                      key={format}
                      type="button"
                      variant="secondary"
                      busy={exporting === format}
                      busyLabel="Preparing…"
                      onClick={() => void exportAs(format)}
                    >
                      Download {format.toUpperCase()}
                    </BusyButton>
                  ))
                )}
              </div>
              {outcome('export')}
            </SettingsCard>

            <SettingsCard id="account" title={title('account')}>
              <ul aria-label="Legal" className="flex flex-wrap gap-x-5">
                <li>
                  <Link to="/legal/privacy" className="inline-flex min-h-[44px] items-center">
                    Privacy
                  </Link>
                </li>
                <li>
                  <Link to="/legal/terms" className="inline-flex min-h-[44px] items-center">
                    Terms
                  </Link>
                </li>
                <li>
                  <Link to="/legal/imprint" className="inline-flex min-h-[44px] items-center">
                    Imprint
                  </Link>
                </li>
              </ul>
              <div>
                <BusyButton
                  type="button"
                  variant="secondary"
                  busy={busy === 'signout'}
                  busyLabel="Signing out…"
                  onClick={() => void signOut()}
                >
                  Sign out
                </BusyButton>
              </div>
              {outcome('signout')}
            </SettingsCard>

            <SettingsCard id="delete" title={title('delete')} farewell>
              <p>
                This removes your account and everything in it: habits, check-ins, low days and settings. It can't be
                undone. If you'd like to keep a copy, download your data first.
              </p>
              <form
                ref={deleteForm}
                noValidate
                onSubmit={(event) => void deleteAccount(event)}
                className="flex flex-col gap-3"
              >
                {me.hasPassword && (
                  <>
                    <input
                      className="sr-only"
                      type="email"
                      name="username"
                      autoComplete="username"
                      value={me.email ?? ''}
                      readOnly
                      tabIndex={-1}
                      aria-hidden="true"
                    />
                    <FormField label="Your password" error={password.error ?? deleteErrors.password ?? null}>
                      {(field) => (
                        <Input {...field} {...password.input} type="password" autoComplete="current-password" />
                      )}
                    </FormField>
                  </>
                )}
                <FormField label="Type DELETE to confirm" error={confirm.error ?? deleteErrors.confirm ?? null}>
                  {(field) => (
                    <Input
                      {...field}
                      {...confirm.input}
                      type="text"
                      autoComplete="off"
                      autoCapitalize="characters"
                      spellCheck={false}
                    />
                  )}
                </FormField>
                {outcome('delete')}
                <div>
                  <BusyButton type="submit" variant="destructive" busy={busy === 'delete'} busyLabel="Deleting…">
                    Delete my account
                  </BusyButton>
                </div>
              </form>
            </SettingsCard>
          </div>
        </div>
      ) : (
        <div className="flex max-w-[40rem] flex-col gap-6">
          <p role="status" className="sr-only">
            Loading your settings…
          </p>
          <Skeleton className="h-[12rem] rounded-xl" />
          <Skeleton className="h-[8rem] rounded-xl" />
        </div>
      )}
    </div>
  );
}
