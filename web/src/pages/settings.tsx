import { Check, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  type FormEvent,
  type MouseEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { flushSync } from 'react-dom';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { BusyButton } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { MoodManager } from '@/components/journal/mood-manager';
import { DeleteDeviceData, DeviceDataSettings } from '@/components/local/device-data-settings';
import { PageHeader } from '@/components/page-header';
import { ColorSchemePicker } from '@/components/settings/color-scheme-picker';
import { JournalSettings } from '@/components/settings/journal-settings';
import { ReminderNamesSetting } from '@/components/settings/reminder-names-setting';
import { settingsGroupOf, settingsGroups } from '@/components/settings/settings-groups';
import { ConfirmForm, TwoFactorSettings } from '@/components/settings/two-factor-settings';
import { ThemePicker } from '@/components/theme-picker';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Input, PasswordInput } from '@/components/ui/input';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { NativeSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';
import { browserTimeZone, isValidTimeZone, timeZoneLabel } from '@/lib/local-date';
import { type ExportFormat, type MePatch, secondReminderChoices, type SecondReminderMinutes } from '@/lib/models';
import { openOnWeb } from '@/lib/native/browser';
import { loadPage } from '@/lib/navigation';
import { ApiError, asApiError, problemToMessage } from '@/lib/problem';
import { api, auth, localMode, push } from '@/lib/services';
import { useStore } from '@/lib/store';
import { rememberAccountTheme, type ThemeId } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Section =
  | 'timezone'
  | 'grace'
  | 'second'
  | 'discord'
  | 'dm'
  | 'push'
  | 'appearance'
  | 'export'
  | 'password'
  | 'signout'
  | 'everywhere'
  | 'delete';

interface Message {
  tone: NoticeTone;
  text: string;
}

const discordOutcomes: Record<string, Message> = {
  linked: { tone: 'success', text: 'Discord is linked. You can sign in with it from now on.' },
  conflict: {
    tone: 'notice',
    text: "Ember couldn't link that Discord account. It may already belong to another Ember account that has a password. Or this account is already linked to a different Discord account.",
  },
  error: { tone: 'notice', text: "Linking didn't finish. You can try again." },
  password: { tone: 'notice', text: 'Ember needs your password before linking Discord. You can try again here.' },
};

const pushDeniedText =
  'Your browser is blocking notifications from Ember. To allow them, open the site settings (often the icon next to the address bar), set Notifications to Allow, then try again.';
const passwordMismatch = "That password doesn't match. Try again.";
const typeDeleteText = 'Type DELETE in capital letters to confirm.';
const unknownZoneText = "Ember doesn't know that timezone. Pick one from the list.";
const themeNotSavedText =
  "Your new look is set on this device. We couldn't save it to your account just now, so your other devices keep theirs for now.";

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
const graceOptions = [0, 1, 2, 3];
const secondReminderLabels: Record<SecondReminderMinutes, string> = {
  0: 'Off',
  15: '15 minutes',
  30: '30 minutes',
  60: '1 hour',
  120: '2 hours',
};
const exportFormats: ExportFormat[] = ['json', 'csv'];
const scrollMargin = 'scroll-mt-[calc(56px+env(safe-area-inset-top)+1.5rem)]';
const wideQuery = '(min-width: 48rem)';

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

function subscribeWide(change: () => void): () => void {
  const query = window.matchMedia(wideQuery);
  query.addEventListener('change', change);
  return () => query.removeEventListener('change', change);
}

/** Whether the screen is `md` or wider, where Settings docks its groups in a side rail. */
function useWide(): boolean {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(wideQuery).matches);
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
      <h2 id={`${id}-heading`} tabIndex={-1} className="text-[22px] focus:outline-none">
        {title}
      </h2>
      {children}
    </section>
  );
}

/** Scrolls to a settings card and focuses its heading. */
function focusSection(id: string): void {
  document.getElementById(id)?.scrollIntoView();
  document.getElementById(`${id}-heading`)?.focus({ preventScroll: true });
}

/**
 * `/settings` and `/settings/:group`: account (who is signed in, change password, sign out), appearance, reminders,
 * push on this device, grace days, timezone, moods, Discord, two-step sign-in, private journal, export and account
 * deletion, in the groups of `settingsGroups`. On phones `/settings` lists the groups and `/settings/:group` shows one
 * with a way back; from `md` a side rail picks the group and `/settings` opens the first. A `#card-id` in the address
 * (also the older `/settings#card-id`) opens that card's group, scrolls to the card and focuses its heading;
 * `?discord=` opens the Discord card's group. Reloads `me` on entry. Every `PATCH /api/me` runs one at a time, in order.
 */
export default function SettingsPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const wide = useWide();
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const pushAvailable = useStore(push.available);
  const pushSubscribed = useStore(push.subscribed);

  const busyRef = useRef<Section | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const graceRef = useRef<number | null>(null);
  const secondRef = useRef<SecondReminderMinutes | null>(null);
  const scrolled = useRef<string | null>(null);
  const tzForm = useRef<HTMLFormElement>(null);
  const deleteForm = useRef<HTMLFormElement>(null);
  const everywhereButton = useRef<HTMLButtonElement>(null);
  const everywhereText = useRef<HTMLParagraphElement>(null);
  const linkDiscordButton = useRef<HTMLButtonElement>(null);

  const [busy, setBusy] = useState<Section | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [message, setMessage] = useState<(Message & { section: Section }) | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [grace, setGrace] = useState<number | null>(null);
  const [second, setSecond] = useState<SecondReminderMinutes | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [zoneTouched, setZoneTouched] = useState(false);
  const [zoneServerError, setZoneServerError] = useState<string | null>(null);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<{ password?: string; confirm?: string }>({});
  const [notificationsOff, setNotificationsOff] = useState(false);
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
    if (!local) void push.claim();
    if (env.native) {
      void import('@capacitor/local-notifications')
        .then(({ LocalNotifications }) => LocalNotifications.checkPermissions())
        .then((status) => setNotificationsOff(status.display === 'denied'), () => undefined);
    }
  }, []);

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
      <p role="status" className="inline-flex items-center gap-1.5 font-medium text-foreground">
        {saved === section && (
          <>
            <Check aria-hidden className="size-[18px] text-primary" />
            Saved.
          </>
        )}
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

  function changeSecond(value: SecondReminderMinutes): void {
    secondRef.current = value;
    setSecond(value);
    void patch('second', { secondReminderMinutes: value }).then((error) => {
      if (secondRef.current !== value) return;
      secondRef.current = null;
      setSecond(null);
      if (error) fail('second', error);
    });
  }

  function saveTheme(theme: ThemeId): void {
    if (!auth.signedIn()) return;
    void patch('appearance', { theme }).then((error) => {
      if (!error) rememberAccountTheme(theme);
      else if (!error.handled) show('appearance', { tone: 'info', text: themeNotSavedText });
    });
  }

  async function saveTimezone(chosen?: string): Promise<void> {
    if (busyRef.current) return;
    let next = chosen;
    if (next === undefined) {
      flushSync(() => setZoneTouched(true));
      if (zoneError(zoneValue)) {
        focusFirstInvalid(tzForm.current);
        return;
      }
      next = zoneValue.trim();
    }
    setZoneServerError(null);
    const error = await patch('timezone', { timezone: next });
    if (!error) {
      setZone(null);
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

  async function linkDiscord(password: string): Promise<void> {
    await api.startDiscordLink(password);
    loadPage(api.discordLinkUrl());
  }

  function cancelLinkDiscord(): void {
    flushSync(() => setLinkingDiscord(false));
    linkDiscordButton.current?.focus();
  }

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

  const changePassword = (email: string) =>
    act('password', async () => {
      await api.forgotPassword(email);
      return {
        tone: 'success',
        text: `We sent a link to ${email}. Open it to choose a new password. It can take a minute or two to arrive.`,
      };
    });

  async function signOut(): Promise<void> {
    if (busyRef.current) return;
    start('signout');
    if (await auth.logout()) return;
    finish();
    show('signout', { tone: 'notice', text: "Ember couldn't sign you out. Check your connection and try again." });
  }

  function askEverywhere(open: boolean): void {
    flushSync(() => setConfirmEverywhere(open));
    (open ? everywhereText : everywhereButton).current?.focus();
  }

  async function signOutEverywhere(): Promise<void> {
    if (busyRef.current) return;
    start('everywhere');
    if (await auth.logout(true)) return;
    finish();
    show('everywhere', {
      tone: 'notice',
      text: "Ember couldn't sign you out everywhere. Check your connection and try again.",
    });
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

  const showDm = !local && !!me && (me.dmReminders.paused || message?.section === 'dm');
  const showPush = !local && !env.native && pushAvailable;
  const showSecond = !local || env.native;
  const sections = [
    ...(local ? [{ id: 'device', title: 'On this device' }] : [{ id: 'account', title: 'Account' }]),
    { id: 'appearance', title: 'Appearance' },
    ...(showPush ? [{ id: 'push', title: 'Notifications on this device' }] : []),
    ...(showDm ? [{ id: 'dm-reminders', title: 'Discord reminders' }] : []),
    ...(env.native ? [{ id: 'phone-reminders', title: 'Reminders on this phone' }] : []),
    ...(showSecond ? [{ id: 'second-reminder', title: 'Second reminder' }] : []),
    { id: 'routines', title: 'Routines' },
    { id: 'grace', title: 'Grace days' },
    { id: 'timezone', title: 'Timezone' },
    { id: 'moods', title: 'Moods' },
    ...(local
      ? []
      : [
          { id: 'discord', title: 'Discord' },
          { id: 'two-factor', title: 'Two-step sign-in' },
          { id: 'journal', title: 'Private journal' },
          { id: 'export', title: 'Your data' },
        ]),
    { id: 'delete', title: local ? 'Delete everything on this device' : 'Delete your account' },
  ];
  const title = (id: string) => sections.find((section) => section.id === id)?.title ?? '';
  const groups = settingsGroups
    .map((group) => ({ ...group, cards: sections.filter((section) => group.cards.includes(section.id)) }))
    .filter((group) => group.cards.length > 0);
  const visibleGroup = (slug?: string) => groups.find((group) => group.slug === slug);
  const query = new URLSearchParams(location.search);
  const discordPending = !!discordNotice && query.has('discord');
  const current =
    visibleGroup(settingsGroupOf(location.hash.slice(1))?.slug) ??
    visibleGroup(params['group']) ??
    (discordPending ? visibleGroup(settingsGroupOf('discord')?.slug) : undefined) ??
    (wide ? groups[0] : undefined);
  const shown = (id: string) => !!current?.cards.some((card) => card.id === id);
  query.delete('discord');
  const pathname = current ? `/settings/${current.slug}` : '/settings';
  const search = query.toString();
  const redirect =
    pathname !== location.pathname || discordPending
      ? `${pathname}${search ? `?${search}` : ''}${location.hash}`
      : null;
  const fromList = (location.state as { fromList?: boolean } | null)?.fromList === true;

  useEffect(() => {
    if (redirect) void navigate(redirect, { replace: true });
  }, [redirect]);

  useEffect(() => {
    const id = location.hash.slice(1);
    if (redirect || !me || !id || scrolled.current === id || !document.getElementById(`${id}-heading`)) return;
    const frame = requestAnimationFrame(() => {
      scrolled.current = id;
      focusSection(id);
    });
    return () => cancelAnimationFrame(frame);
  }, [me, pushAvailable, location.hash, redirect]);

  function backToList(event: MouseEvent<HTMLAnchorElement>): void {
    if (!fromList) return;
    event.preventDefault();
    void navigate(-1);
  }

  const zoneValue = zone ?? me?.timezone ?? '';
  const zoneMessage = (zoneTouched ? zoneError(zoneValue) : null) ?? zoneServerError;
  const suggestZone = !!me && isValidTimeZone(browserZone) && (!me.timezoneSet || me.timezone !== browserZone);
  const graceShown = grace ?? me?.graceDaysPerWeek ?? 0;
  const secondShown = second ?? me?.secondReminderMinutes ?? 0;

  const notice = discordNotice && (
    <Notice tone={discordNotice.tone}>
      <p>{discordNotice.text}</p>
    </Notice>
  );

  if (!current) {
    return (
      <div className="flex max-w-[40rem] flex-col gap-6">
        <PageHeader title="Settings" />
        {notice}
        <nav aria-label="Settings groups">
          <ul className="flex flex-col divide-y divide-border overflow-hidden rounded-xl border-[length:var(--border-width)] border-border bg-card text-card-foreground shadow-card">
            {groups.map((group) => (
              <li key={group.slug}>
                <Link
                  to={`/settings/${group.slug}`}
                  state={{ fromList: true }}
                  aria-labelledby={`group-${group.slug}-name`}
                  aria-describedby={`group-${group.slug}-summary`}
                  className="flex min-h-[64px] items-center gap-4 px-4 py-3 text-card-foreground no-underline hover:bg-accent hover:text-accent-foreground focus-visible:-outline-offset-3"
                >
                  <group.icon aria-hidden className="size-[22px] shrink-0 text-primary" />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span id={`group-${group.slug}-name`} className="font-semibold">
                      {group.name}
                    </span>
                    <span id={`group-${group.slug}-summary`} className="text-[14px] text-muted-foreground">
                      {group.summary ?? group.cards.map((card) => card.title).join(', ')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    );
  }

  return (
    <div className={cn('flex flex-col gap-6', wide && 'grid grid-cols-[14rem_minmax(0,40rem)] items-start gap-8')}>
      {wide && (
        <nav
          aria-labelledby="settings-rail-label"
          className="sticky top-[calc(56px+env(safe-area-inset-top)+1.5rem)] flex flex-col gap-2"
        >
          <p id="settings-rail-label" className="px-3 text-[14px] font-semibold text-muted-foreground">
            Settings
          </p>
          <ul className="flex flex-col gap-1">
            {groups.map((group) => (
              <li key={group.slug}>
                <Link
                  to={`/settings/${group.slug}`}
                  aria-current={group.slug === current.slug ? 'page' : undefined}
                  className={cn(
                    'flex min-h-[44px] items-center gap-3 rounded-md px-3 text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground',
                    group.slug === current.slug &&
                      'bg-secondary font-semibold text-secondary-foreground hover:bg-secondary hover:text-secondary-foreground',
                  )}
                >
                  <group.icon aria-hidden className="size-[18px] shrink-0" />
                  {group.name}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}

      <div className="flex min-w-0 flex-col gap-6">
        {!wide && (
          <div>
            <Link
              to="/settings"
              onClick={backToList}
              aria-label="Back to Settings"
              className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 font-medium text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft aria-hidden className="size-[18px]" />
              Settings
            </Link>
          </div>
        )}
        <PageHeader title={current.name} />
        {notice}
        {me ? (
          <>
            {shown('device') && (
              <SettingsCard id="device" title={title('device')}>
                <DeviceDataSettings />
              </SettingsCard>
            )}

            {shown('account') && (
              <SettingsCard id="account" title={title('account')}>
                <p>
                  {me.email ? (
                    <>
                      Signed in as <strong className="[overflow-wrap:anywhere]">{me.email}</strong>
                    </>
                  ) : (
                    'Signed in with Discord'
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                  {me.email && me.hasPassword && (
                    <BusyButton
                      type="button"
                      variant="secondary"
                      busy={busy === 'password'}
                      busyLabel="Sending…"
                      onClick={() => void changePassword(me.email ?? '')}
                    >
                      Change password
                    </BusyButton>
                  )}
                  <BusyButton
                    type="button"
                    variant="secondary"
                    busy={busy === 'signout'}
                    busyLabel="Signing out…"
                    onClick={() => void signOut()}
                  >
                    Sign out
                  </BusyButton>
                  {!confirmEverywhere && (
                    <Button
                      ref={everywhereButton}
                      type="button"
                      variant="ghost"
                      onClick={() => askEverywhere(true)}
                    >
                      Sign out everywhere
                    </Button>
                  )}
                </div>
                {confirmEverywhere && (
                  <div className="flex flex-col gap-3 rounded-md border-[length:var(--border-width)] border-border p-3">
                    <p ref={everywhereText} tabIndex={-1} className="focus:outline-none">
                      This signs you out on every device, including this one.
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <BusyButton
                        type="button"
                        variant="secondary"
                        busy={busy === 'everywhere'}
                        busyLabel="Signing out…"
                        onClick={() => void signOutEverywhere()}
                      >
                        Yes, sign out everywhere
                      </BusyButton>
                      <Button type="button" variant="ghost" onClick={() => askEverywhere(false)}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
                {outcome('password')}
                {outcome('signout')}
                {outcome('everywhere')}
              </SettingsCard>
            )}

            {shown('appearance') && (
              <SettingsCard id="appearance" title={title('appearance')}>
                <p id="appearance-hint">
                  {local ? 'Choose how Ember looks.' : 'Choose how Ember looks. Your theme follows you to your other devices.'}
                </p>
                <ColorSchemePicker />
                <ThemePicker labelledBy="appearance-heading" describedBy="appearance-hint" onChoose={saveTheme} />
                {outcome('appearance')}
              </SettingsCard>
            )}

            {shown('push') && (
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

            {shown('dm-reminders') && (
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

            {shown('phone-reminders') && (
              <SettingsCard id="phone-reminders" title={title('phone-reminders')}>
                <p>
                  Turn on "Remind me on this phone" for a habit when you edit it. Reminders are set on this phone, so
                  they arrive even without a connection.
                </p>
                <ReminderNamesSetting />
                {notificationsOff && (
                  <Notice tone="info">
                    <p>Notifications are off for Ember on this phone. You can turn them on in your phone's settings.</p>
                  </Notice>
                )}
              </SettingsCard>
            )}

            {shown('second-reminder') && (
              <SettingsCard id="second-reminder" title={title('second-reminder')}>
                <FormField label="Second reminder" hint="If you haven't checked in yet, Ember nudges you once more.">
                  {(field) => (
                    <NativeSelect
                      {...field}
                      value={String(secondShown)}
                      onChange={(event) => changeSecond(Number(event.target.value) as SecondReminderMinutes)}
                    >
                      {secondReminderChoices.map((n) => (
                        <option key={n} value={n}>
                          {secondReminderLabels[n]}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                {savedStatus('second')}
                {outcome('second')}
              </SettingsCard>
            )}

            {shown('routines') && (
              <SettingsCard id="routines" title={title('routines')}>
                <p>Group habits that belong together into routines, like a morning routine.</p>
                <div>
                  <Button asChild variant="secondary">
                    <Link to="/routines">Your routines</Link>
                  </Button>
                </div>
              </SettingsCard>
            )}

            {shown('grace') && (
              <SettingsCard id="grace" title={title('grace')}>
                <FormField
                  label="Grace days per week"
                  hint="Up to this many days a week can pass without a check-in and your streak keeps going. Every check-in counts, no matter the gap."
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
                <p className="text-[14px] text-muted-foreground">
                  Grace days happen on their own. A low day is one you mark yourself, and a pause is for one habit.
                </p>
                {savedStatus('grace')}
                {outcome('grace')}
              </SettingsCard>
            )}

            {shown('timezone') && (
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
                        value={zoneValue}
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
            )}

            {shown('moods') && (
              <SettingsCard id="moods" title={title('moods')}>
                <MoodManager />
              </SettingsCard>
            )}

            {shown('discord') && (
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
                    {linkingDiscord ? (
                      <ConfirmForm
                        kind="password"
                        email={me.email}
                        hint="Ember checks it before linking Discord."
                        submitLabel="Continue to Discord"
                        busyLabel="Checking…"
                        onSubmit={linkDiscord}
                        onCancel={cancelLinkDiscord}
                      />
                    ) : (
                      <div>
                        {env.native ? (
                          <Button type="button" variant="secondary" onClick={() => void openOnWeb('/settings')}>
                            Link Discord on the web
                          </Button>
                        ) : me.hasPassword ? (
                          <Button
                            ref={linkDiscordButton}
                            type="button"
                            variant="secondary"
                            onClick={() => setLinkingDiscord(true)}
                          >
                            Link Discord
                          </Button>
                        ) : (
                          <Button asChild variant="secondary">
                            <a href={api.discordLinkUrl()}>Link Discord</a>
                          </Button>
                        )}
                      </div>
                    )}
                    {env.native && (
                      <p className="text-[14px] text-muted-foreground">
                        Linking happens in your browser. Come back here afterwards and Ember picks it up.
                      </p>
                    )}
                  </>
                )}
                {outcome('discord')}
              </SettingsCard>
            )}

            {shown('two-factor') && (
              <SettingsCard id="two-factor" title={title('two-factor')}>
                <TwoFactorSettings me={me} />
              </SettingsCard>
            )}

            {shown('journal') && (
              <SettingsCard id="journal" title={title('journal')}>
                <JournalSettings me={me} />
              </SettingsCard>
            )}

            {shown('export') && (
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
            )}

            {shown('delete') && (
              <SettingsCard id="delete" title={title('delete')} farewell>
                {local ? (
                  <DeleteDeviceData />
                ) : (
                  <>
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
                              <PasswordInput {...field} {...password.input} autoComplete="current-password" />
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
                  </>
                )}
              </SettingsCard>
            )}
          </>
        ) : (
          <>
            <p role="status" className="sr-only">
              Loading your settings…
            </p>
            <Skeleton className="h-[12rem] rounded-xl" />
            <Skeleton className="h-[8rem] rounded-xl" />
          </>
        )}
      </div>
    </div>
  );
}
