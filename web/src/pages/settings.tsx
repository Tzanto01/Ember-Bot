import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
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
import { Trans, useTranslation } from 'react-i18next';
import { Link, useLocation, useNavigate, useParams } from 'react-router';
import { BusyButton, TapLink } from '@/components/auth/busy-button';
import { useField, type Validator, validateAll } from '@/components/auth/use-field';
import { FormField, focusFirstInvalid } from '@/components/form-field';
import { DestinationName, reminderDestinationsKey } from '@/components/habits/device-reminders';
import { MoodManager } from '@/components/journal/mood-manager';
import { CrisisLines } from '@/components/moment/crisis-lines';
import { DeleteDeviceData, DeviceDataSettings } from '@/components/local/device-data-settings';
import { PageHeader } from '@/components/page-header';
import { ColorSchemePicker } from '@/components/settings/color-scheme-picker';
import { LanguagePicker } from '@/components/settings/language-picker';
import { FeedbackForm } from '@/components/settings/feedback-form';
import { HelpsSettings } from '@/components/settings/helps-settings';
import { JournalSettings } from '@/components/settings/journal-settings';
import { ReminderNamesSetting } from '@/components/settings/reminder-names-setting';
import { settingsGroupOf, settingsGroups } from '@/components/settings/settings-groups';
import { ConfirmForm, TwoFactorSettings } from '@/components/settings/two-factor-settings';
import { ThemePicker } from '@/components/theme-picker';
import { Button } from '@/components/ui/button';
import { cardVariants } from '@/components/ui/card';
import { Input, PasswordInput } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice, type NoticeTone } from '@/components/ui/notice';
import { NativeSelect } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { saveFile } from '@/lib/api-client';
import { env } from '@/lib/env';
import { browserTimeZone, isValidTimeZone, timeZoneLabel } from '@/lib/local-date';
import {
  type ExportFormat,
  type MePatch,
  type ReminderDestination,
  secondReminderChoices,
  type SecondReminderMinutes,
} from '@/lib/models';
import { openOnWeb } from '@/lib/native/browser';
import { updaterAvailable } from '@/lib/native/updater';
import { loadPage } from '@/lib/navigation';
import { ApiError, asApiError, problemToMessage } from '@/lib/problem';
import { api, auth, deviceSync, localMode, push, reminders } from '@/lib/services';
import { useStore } from '@/lib/store';
import { applyLanguage, currentLanguage, heldLanguage, holdLanguage, type Language, rememberDeviceLanguage, storedLanguage, t } from '@/lib/i18n';
import { applyCalm, calmMode, rememberAccountTheme, type ThemeId } from '@/lib/theme';
import { cn } from '@/lib/utils';

type Section =
  | 'timezone'
  | 'grace'
  | 'streaks'
  | 'calm'
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

const discordOutcomes = {
  linked: 'success',
  conflict: 'notice',
  error: 'notice',
  password: 'notice',
} as const satisfies Record<string, NoticeTone>;

type DiscordOutcome = keyof typeof discordOutcomes;

function discordMessage(outcome: DiscordOutcome): Message {
  return { tone: discordOutcomes[outcome], text: t(`settings.discord.outcome.${outcome}`) };
}

const zones = typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [];
const graceOptions = [0, 1, 2, 3];

function secondReminderLabel(minutes: SecondReminderMinutes): string {
  if (minutes === 0) return t('settings.second.off');
  return minutes % 60 === 0
    ? t('settings.second.hours', { count: minutes / 60 })
    : t('settings.second.minutes', { count: minutes });
}

const exportFormats: ExportFormat[] = ['json', 'csv'];
const scrollMargin = 'scroll-mt-[calc(56px+env(safe-area-inset-top)+1.5rem)]';
const wideQuery = '(min-width: 48rem)';

function zoneError(value: string): string | null {
  const zone = value.trim();
  if (!zone) return t('settings.timezone.empty');
  return isValidTimeZone(zone) ? null : t('settings.timezone.unknown');
}

const passwordRequired: Validator = (value) => (value ? null : t('settings.passwordRequired'));
const noPassword: Validator = () => null;
const deleteWord: Validator = (value) => {
  const word = value.trim().normalize('NFC');
  const expected = t('delete.word');
  if (!word) return t('settings.delete.typeDelete', { word: expected });
  return word === expected ? null : t('settings.delete.typeDeleteCaps', { word: expected });
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
      <h2 id={`${id}-heading`} tabIndex={-1} className="text-[1.375rem] focus:outline-none">
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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const params = useParams();
  const wide = useWide();
  const me = useStore(auth.me);
  const local = useStore(localMode.mode) === 'local';
  const pushAvailable = useStore(push.available);
  const queryClient = useQueryClient();

  const busyRef = useRef<Section | null>(null);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const graceRef = useRef<number | null>(null);
  const streaksRef = useRef<boolean | null>(null);
  const calmRef = useRef<boolean | null>(null);
  const secondRef = useRef<SecondReminderMinutes | null>(null);
  const scrolled = useRef<string | null>(null);
  const tzForm = useRef<HTMLFormElement>(null);
  const deleteForm = useRef<HTMLFormElement>(null);
  const everywhereButton = useRef<HTMLButtonElement>(null);
  const everywhereText = useRef<HTMLParagraphElement>(null);
  const linkDiscordButton = useRef<HTMLButtonElement>(null);
  const claimed = useRef<Promise<void> | null>(null);

  const [busy, setBusy] = useState<Section | null>(null);
  const [saved, setSaved] = useState<Section | null>(null);
  const [message, setMessage] = useState<(Message & { section: Section }) | null>(null);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [grace, setGrace] = useState<number | null>(null);
  const [streaks, setStreaks] = useState<boolean | null>(null);
  const [calm, setCalm] = useState<boolean | null>(null);
  const [second, setSecond] = useState<SecondReminderMinutes | null>(null);
  const [zone, setZone] = useState<string | null>(null);
  const [zoneTouched, setZoneTouched] = useState(false);
  const [zoneServerError, setZoneServerError] = useState<string | null>(null);
  const [confirmEverywhere, setConfirmEverywhere] = useState(false);
  const [linkingDiscord, setLinkingDiscord] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<{ password?: string; confirm?: string }>({});
  const [notificationsOff, setNotificationsOff] = useState(false);
  const [remindersLate, setRemindersLate] = useState(false);
  const togglingRef = useRef(new Set<string>());
  const [toggling, setToggling] = useState<Partial<Record<string, boolean>>>({});
  const [toggled, setToggled] = useState<Partial<Record<string, { error: string | null }>>>({});
  const [browserZone] = useState(browserTimeZone);
  const [showIosHint] = useState(() => isIos() && !isStandalone());
  const [discordOutcome] = useState<DiscordOutcome | null>(() => {
    const outcome = new URLSearchParams(location.search).get('discord');
    return outcome && Object.hasOwn(discordOutcomes, outcome) ? (outcome as DiscordOutcome) : null;
  });
  const discordNotice = discordOutcome && discordMessage(discordOutcome);

  const password = useField(me?.hasPassword ? passwordRequired : noPassword);
  const confirm = useField(deleteWord);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const linked = params.get('discord') === 'linked';
    void (linked ? auth.refreshAntiforgery() : Promise.resolve()).then(() => auth.loadMe(true)).catch(() => null);
    if (!local) claimed.current = push.claim();
    if (env.native) {
      void import('@capacitor/local-notifications')
        .then(({ LocalNotifications }) => LocalNotifications.checkPermissions())
        .then((status) => setNotificationsOff(status.display === 'denied'), () => undefined);
    }
    if (updaterAvailable()) void reminders?.exactAllowed().then((exact) => setRemindersLate(!exact));
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
            {t('settings.saved')}
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

  function changeStreaks(value: boolean): void {
    streaksRef.current = value;
    setStreaks(value);
    void patch('streaks', { showStreaks: value }).then((error) => {
      if (streaksRef.current !== value) return;
      streaksRef.current = null;
      setStreaks(null);
      if (error) fail('streaks', error);
    });
  }

  function changeCalm(value: boolean): void {
    const before = calmMode.get();
    calmRef.current = value;
    setCalm(value);
    applyCalm(value);
    void patch('calm', { calmMode: value }).then((error) => {
      if (calmRef.current !== value) return;
      calmRef.current = null;
      setCalm(null);
      if (!error) return;
      applyCalm(before);
      fail('calm', error);
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
      else if (!error.handled) show('appearance', { tone: 'info', text: t('settings.appearance.notSaved') });
    });
  }

  function saveLanguage(language: Language): void {
    const before = currentLanguage();
    const stored = storedLanguage();
    holdLanguage(language);
    rememberDeviceLanguage(language);
    applyLanguage(language);
    void patch('appearance', { language }).then((error) => {
      if (heldLanguage() !== language) return;
      holdLanguage(null);
      if (!error) return;
      rememberDeviceLanguage(stored);
      applyLanguage(before);
      if (!error.handled) show('appearance', { tone: 'info', text: t('language.notSaved') });
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
      setZoneServerError(t('settings.timezone.unknown'));
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
      return { tone: 'success', text: t('settings.discord.unlinked') };
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
      return { tone: 'success', text: t('settings.dm.resumed') };
    });

  async function toggleDestination(destination: ReminderDestination, enabled: boolean): Promise<void> {
    const { id } = destination;
    if (togglingRef.current.has(id)) return;
    togglingRef.current.add(id);
    setToggling((t) => ({ ...t, [id]: enabled }));
    setToggled((t) => ({ ...t, [id]: undefined }));
    try {
      const updated = await api.setReminderDestination(id, enabled);
      queryClient.setQueryData<ReminderDestination[]>(reminderDestinationsKey, (list) =>
        list?.map((d) => (d.id === updated.id ? updated : d)),
      );
      if (env.native) deviceSync.rebuildReminders();
      setToggled((t) => ({ ...t, [id]: { error: null } }));
    } catch (error) {
      if (!asApiError(error).handled) {
        const text = destination.enabled
          ? t('settings.push.stillOn', { name: destination.label })
          : t('settings.push.stillOff', { name: destination.label });
        setToggled((t) => ({ ...t, [id]: { error: text } }));
      }
    } finally {
      togglingRef.current.delete(id);
      setToggling((t) => ({ ...t, [id]: undefined }));
    }
  }

  const enablePhone = () =>
    act('push', async () => {
      const phone = (await reminders?.enablePhone()) ?? null;
      if (!phone) return { tone: 'info', text: t('settings.phone.notificationsOff') };
      await queryClient.invalidateQueries({ queryKey: reminderDestinationsKey });
      deviceSync.rebuildReminders();
      return { tone: 'success', text: t('settings.phone.on') };
    });

  async function enablePush(): Promise<void> {
    if (busyRef.current) return;
    start('push');
    try {
      await push.subscribe();
      await queryClient.invalidateQueries({ queryKey: reminderDestinationsKey });
      show('push', { tone: 'success', text: t('settings.push.on') });
    } catch (error) {
      if (error instanceof ApiError) fail('push', error);
      else if (push.isDenied() || (error instanceof DOMException && error.name === 'NotAllowedError'))
        show('push', { tone: 'notice', text: t('settings.push.denied') });
      else
        show('push', { tone: 'notice', text: t('settings.push.failed') });
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
        text: t('settings.account.passwordSent', { email }),
      };
    });

  async function signOut(): Promise<void> {
    if (busyRef.current) return;
    start('signout');
    if (await auth.logout()) return;
    finish();
    show('signout', { tone: 'notice', text: t('settings.account.signOutFailed') });
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
      text: t('settings.account.everywhereFailed'),
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
          setDeleteErrors(
            me.hasPassword
              ? { password: t('settings.passwordMismatch') }
              : { confirm: t('settings.delete.typeDeleteCaps', { word: t('delete.word') }) },
          ),
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
  const showSecond = !local || env.native;
  const streaksShown = streaks ?? me?.showStreaks !== false;
  const sections = [
    ...(local
      ? [{ id: 'device', title: t('settings.card.device') }]
      : [{ id: 'account', title: t('settings.card.account') }]),
    { id: 'appearance', title: t('settings.card.appearance') },
    ...(local ? [] : [{ id: 'push', title: t('settings.card.push') }]),
    ...(showDm ? [{ id: 'dm-reminders', title: t('settings.card.dmReminders') }] : []),
    ...(env.native ? [{ id: 'phone-reminders', title: t('settings.card.phoneReminders') }] : []),
    ...(showSecond ? [{ id: 'second-reminder', title: t('settings.card.secondReminder') }] : []),
    { id: 'routines', title: t('settings.card.routines') },
    { id: 'streaks', title: t('settings.card.streaks') },
    ...(streaksShown ? [{ id: 'grace', title: t('settings.card.grace') }] : []),
    { id: 'timezone', title: t('settings.card.timezone') },
    { id: 'moods', title: t('settings.card.moods') },
    ...(local
      ? []
      : [
          { id: 'two-factor', title: t('settings.card.twoFactor') },
          { id: 'discord', title: 'Discord' },
          { id: 'journal', title: t('settings.card.journal') },
          { id: 'moments', title: t('settings.card.moments') },
        ]),
    { id: 'helps', title: t('settings.card.helps') },
    ...(local ? [] : [{ id: 'export', title: t('settings.card.export') }]),
    { id: 'delete', title: local ? t('settings.card.deleteDevice') : t('settings.card.deleteAccount') },
    { id: 'feedback', title: t('settings.card.feedback') },
    { id: 'help', title: t('settings.card.help') },
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
  const destinations = useQuery({
    queryKey: reminderDestinationsKey,
    queryFn: async () => {
      await claimed.current;
      return api.listReminderDestinations();
    },
    enabled: shown('push'),
  });
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
        <PageHeader title={t('title.settings')} />
        {notice}
        <nav aria-label={t('settings.groupsLabel')}>
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
                      {t(group.nameKey)}
                    </span>
                    <span id={`group-${group.slug}-summary`} className="text-[0.875rem] text-muted-foreground">
                      {group.summaryKey ? t(group.summaryKey) : group.cards.map((card) => card.title).join(', ')}
                    </span>
                  </span>
                  <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/whats-new"
                aria-labelledby="whats-new-name"
                aria-describedby="whats-new-summary"
                className="flex min-h-[64px] items-center gap-4 px-4 py-3 text-card-foreground no-underline hover:bg-accent hover:text-accent-foreground focus-visible:-outline-offset-3"
              >
                <Sparkles aria-hidden className="size-[22px] shrink-0 text-primary" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span id="whats-new-name" className="font-semibold">
                    {t('title.whatsNew')}
                  </span>
                  <span id="whats-new-summary" className="text-[0.875rem] text-muted-foreground">
                    {t('settings.whatsNewSummary')}
                  </span>
                </span>
                <ChevronRight aria-hidden className="size-[18px] shrink-0 text-muted-foreground" />
              </Link>
            </li>
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
          <p id="settings-rail-label" className="px-3 text-[0.875rem] font-semibold text-muted-foreground">
            {t('title.settings')}
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
                  {t(group.nameKey)}
                </Link>
              </li>
            ))}
            <li>
              <Link
                to="/whats-new"
                className="flex min-h-[44px] items-center gap-3 rounded-md px-3 text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground"
              >
                <Sparkles aria-hidden className="size-[18px] shrink-0" />
                {t('title.whatsNew')}
              </Link>
            </li>
          </ul>
        </nav>
      )}

      <div className="flex min-w-0 flex-col gap-6">
        {!wide && (
          <div>
            <Link
              to="/settings"
              onClick={backToList}
              aria-label={t('settings.backToList')}
              className="-ml-2 inline-flex min-h-[44px] items-center gap-1 rounded-md px-2 font-medium text-muted-foreground no-underline hover:bg-accent hover:text-accent-foreground"
            >
              <ChevronLeft aria-hidden className="size-[18px]" />
              {t('title.settings')}
            </Link>
          </div>
        )}
        <PageHeader title={t(current.nameKey)} />
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
                    <Trans
                      i18nKey="settings.account.signedInAs"
                      values={{ email: me.email }}
                      components={{ strong: <strong className="[overflow-wrap:anywhere]" /> }}
                    />
                  ) : (
                    t('settings.account.signedInDiscord')
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                  {me.email && me.hasPassword && (
                    <BusyButton
                      type="button"
                      variant="secondary"
                      busy={busy === 'password'}
                      busyLabel={t('settings.account.sending')}
                      onClick={() => void changePassword(me.email ?? '')}
                    >
                      {t('settings.account.changePassword')}
                    </BusyButton>
                  )}
                  <BusyButton
                    type="button"
                    variant="secondary"
                    busy={busy === 'signout'}
                    busyLabel={t('nav.signingOut')}
                    onClick={() => void signOut()}
                  >
                    {t('nav.signOut')}
                  </BusyButton>
                  {!confirmEverywhere && (
                    <Button
                      ref={everywhereButton}
                      type="button"
                      variant="ghost"
                      onClick={() => askEverywhere(true)}
                    >
                      {t('settings.account.everywhere')}
                    </Button>
                  )}
                </div>
                {confirmEverywhere && (
                  <div className="flex flex-col gap-3 rounded-md border-[length:var(--border-width)] border-border p-3">
                    <p ref={everywhereText} tabIndex={-1} className="focus:outline-none">
                      {t('settings.account.everywhereConfirm')}
                    </p>
                    <div className="flex flex-wrap gap-3">
                      <BusyButton
                        type="button"
                        variant="secondary"
                        busy={busy === 'everywhere'}
                        busyLabel={t('nav.signingOut')}
                        onClick={() => void signOutEverywhere()}
                      >
                        {t('settings.account.everywhereYes')}
                      </BusyButton>
                      <Button type="button" variant="ghost" onClick={() => askEverywhere(false)}>
                        {t('settings.cancel')}
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
                  {local ? t('settings.appearance.hintLocal') : t('settings.appearance.hintAccount')}
                </p>
                <LanguagePicker local={local} onChoose={saveLanguage} />
                <ColorSchemePicker />
                <ThemePicker labelledBy="appearance-heading" describedBy="appearance-hint" onChoose={saveTheme} />
                {outcome('appearance')}
                <div className="flex min-h-[44px] items-center justify-between gap-4">
                  <Label htmlFor="calm-mode" className="min-w-0 font-normal">
                    {t('settings.calm.label')}
                  </Label>
                  <Switch
                    id="calm-mode"
                    aria-describedby="calm-mode-hint"
                    checked={calm ?? me?.calmMode === true}
                    onCheckedChange={changeCalm}
                  />
                </div>
                <p id="calm-mode-hint" className="text-[0.875rem] text-muted-foreground">
                  {t('settings.calm.hint')}
                </p>
                {savedStatus('calm')}
                {outcome('calm')}
              </SettingsCard>
            )}

            {shown('push') && (
              <SettingsCard id="push" title={title('push')}>
                {destinations.data ? (
                  destinations.data.length > 0 ? (
                    <>
                      <p>{t('settings.push.intro')}</p>
                      <ul className="flex flex-col divide-y divide-border">
                        {destinations.data.map((destination) => (
                          <li key={destination.id} className="flex flex-col py-2 first:pt-0 last:pb-0">
                            <div className="flex min-h-[44px] items-center justify-between gap-4">
                              <Label
                                htmlFor={`destination-${destination.id}`}
                                className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-normal"
                              >
                                <DestinationName destination={destination} />
                              </Label>
                              <Switch
                                id={`destination-${destination.id}`}
                                checked={toggling[destination.id] ?? destination.enabled}
                                aria-disabled={toggling[destination.id] !== undefined || undefined}
                                onCheckedChange={(checked) => void toggleDestination(destination, checked)}
                              />
                            </div>
                            <p role="status" className="inline-flex items-center gap-1.5 font-medium text-foreground">
                              {toggled[destination.id]?.error === null && (
                                <>
                                  <Check aria-hidden className="size-[18px] text-primary" />
                                  {t('settings.saved')}
                                </>
                              )}
                            </p>
                            {toggled[destination.id]?.error && (
                              <Notice tone="notice" className="mt-2">
                                <p>{toggled[destination.id]?.error}</p>
                              </Notice>
                            )}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-muted-foreground">
                      {t('settings.push.none')}
                      {!(env.native || pushAvailable) && (
                        <>
                          {' '}
                          <Trans
                            i18nKey="settings.push.noneDiscord"
                            components={{
                              anchor: (
                                <Link
                                  to={{ pathname: '/settings', hash: 'discord' }}
                                  className="text-primary underline underline-offset-4"
                                />
                              ),
                            }}
                          />
                        </>
                      )}
                    </p>
                  )
                ) : destinations.isError ? (
                  !asApiError(destinations.error).handled && (
                    <Notice tone="notice">
                      <p>{problemToMessage(asApiError(destinations.error)).message}</p>
                      <Button
                        type="button"
                        variant="secondary"
                        aria-disabled={destinations.isFetching || undefined}
                        onClick={() => void destinations.refetch()}
                      >
                        {t('settings.tryAgain')}
                      </Button>
                    </Notice>
                  )
                ) : (
                  <>
                    <p role="status" className="sr-only">
                      {t('settings.push.loading')}
                    </p>
                    <Skeleton className="h-[7rem] rounded-md" />
                  </>
                )}
                {destinations.data &&
                  !destinations.data.some((d) => d.current) &&
                  (env.native ? (
                    <div>
                      <BusyButton
                        type="button"
                        busy={busy === 'push'}
                        busyLabel={t('settings.turningOn')}
                        onClick={() => void enablePhone()}
                      >
                        {t('settings.phone.turnOn')}
                      </BusyButton>
                    </div>
                  ) : (
                    pushAvailable && (
                      <>
                        <p className="text-muted-foreground">{t('settings.push.browserHint')}</p>
                        {showIosHint && (
                          <p className="text-muted-foreground">{t('settings.push.iosHint')}</p>
                        )}
                        <div>
                          <BusyButton
                            type="button"
                            busy={busy === 'push'}
                            busyLabel={t('settings.turningOn')}
                            onClick={() => void enablePush()}
                          >
                            {t('settings.push.turnOn')}
                          </BusyButton>
                        </div>
                      </>
                    )
                  ))}
                {outcome('push')}
              </SettingsCard>
            )}

            {shown('dm-reminders') && (
              <SettingsCard id="dm-reminders" title={title('dm-reminders')}>
                {me.dmReminders.paused && (
                  <>
                    <p>{t('settings.dm.paused')}</p>
                    <div>
                      <BusyButton
                        type="button"
                        variant="secondary"
                        busy={busy === 'dm'}
                        busyLabel={t('settings.dm.resuming')}
                        onClick={() => void resumeDms()}
                      >
                        {t('settings.dm.resume')}
                      </BusyButton>
                    </div>
                  </>
                )}
                {outcome('dm')}
              </SettingsCard>
            )}

            {shown('phone-reminders') && (
              <SettingsCard id="phone-reminders" title={title('phone-reminders')}>
                <p>{local ? t('settings.phone.introLocal') : t('settings.phone.intro')}</p>
                <ReminderNamesSetting />
                {remindersLate && (
                  <Notice tone="info">
                    <p>{t('settings.phone.late')}</p>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        void reminders?.allowExact().then((exact) => {
                          setRemindersLate(!exact);
                          if (exact) deviceSync.rebuildReminders();
                        })
                      }
                    >
                      {t('settings.phone.allowExact')}
                    </Button>
                  </Notice>
                )}
                {notificationsOff && (
                  <Notice tone="info">
                    <p>{t('settings.phone.notificationsOff')}</p>
                  </Notice>
                )}
              </SettingsCard>
            )}

            {shown('second-reminder') && (
              <SettingsCard id="second-reminder" title={title('second-reminder')}>
                <FormField label={t('settings.card.secondReminder')} hint={t('settings.second.hint')}>
                  {(field) => (
                    <NativeSelect
                      {...field}
                      value={String(secondShown)}
                      onChange={(event) => changeSecond(Number(event.target.value) as SecondReminderMinutes)}
                    >
                      {secondReminderChoices.map((n) => (
                        <option key={n} value={n}>
                          {secondReminderLabel(n)}
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
                <p>{t('settings.routines.intro')}</p>
                <div>
                  <Button asChild variant="secondary">
                    <Link to="/routines">{t('settings.routines.link')}</Link>
                  </Button>
                </div>
              </SettingsCard>
            )}

            {shown('streaks') && (
              <SettingsCard id="streaks" title={title('streaks')}>
                <div className="flex min-h-[44px] items-center justify-between gap-4">
                  <Label htmlFor="show-streaks" className="min-w-0 font-normal">
                    {t('settings.streaks.label')}
                  </Label>
                  <Switch
                    id="show-streaks"
                    aria-describedby="show-streaks-hint"
                    checked={streaksShown}
                    onCheckedChange={changeStreaks}
                  />
                </div>
                <p id="show-streaks-hint" className="text-[0.875rem] text-muted-foreground">
                  {t('settings.streaks.hint')}
                </p>
                {savedStatus('streaks')}
                {outcome('streaks')}
              </SettingsCard>
            )}

            {shown('grace') && (
              <SettingsCard id="grace" title={title('grace')}>
                <FormField
                  label={t('settings.grace.label')}
                  hint={t('settings.grace.hint')}
                >
                  {(field) => (
                    <NativeSelect
                      {...field}
                      value={String(graceShown)}
                      onChange={(event) => changeGrace(Number(event.target.value))}
                    >
                      {graceOptions.map((n) => (
                        <option key={n} value={n}>
                          {n === 0 ? t('settings.grace.none') : t('settings.grace.perWeek', { count: n })}
                        </option>
                      ))}
                    </NativeSelect>
                  )}
                </FormField>
                <p className="text-[0.875rem] text-muted-foreground">{t('settings.grace.note')}</p>
                {savedStatus('grace')}
                {outcome('grace')}
              </SettingsCard>
            )}

            {shown('timezone') && (
              <SettingsCard id="timezone" title={title('timezone')}>
                {me.timezoneSet ? (
                  <p>
                    <Trans
                      i18nKey="settings.timezone.follows"
                      values={{ zone: timeZoneLabel(me.timezone) }}
                      components={{ strong: <strong /> }}
                    />
                  </p>
                ) : (
                  <p>
                    <Trans
                      i18nKey="settings.timezone.notSet"
                      values={{ zone: timeZoneLabel(me.timezone) }}
                      components={{ strong: <strong /> }}
                    />
                  </p>
                )}
                {suggestZone && (
                  <div>
                    <Button
                      type="button"
                      aria-disabled={busy !== null || undefined}
                      onClick={() => void saveTimezone(browserZone)}
                    >
                      {t('settings.timezone.use', { zone: browserZone })}
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
                    label={t('settings.timezone.label')}
                    hint={t('settings.timezone.hint')}
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
                    <BusyButton
                      type="submit"
                      variant="secondary"
                      busy={busy === 'timezone'}
                      busyLabel={t('settings.saving')}
                    >
                      {t('settings.timezone.save')}
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

            {shown('two-factor') && (
              <SettingsCard id="two-factor" title={title('two-factor')}>
                <TwoFactorSettings me={me} />
              </SettingsCard>
            )}

            {shown('discord') && (
              <SettingsCard id="discord" title={title('discord')}>
                {me.discord.linked ? (
                  <>
                    <p>{t('settings.discord.linkedText')}</p>
                    <div>
                      <BusyButton
                        type="button"
                        variant="secondary"
                        busy={busy === 'discord'}
                        busyLabel={t('settings.discord.unlinking')}
                        onClick={() => void unlinkDiscord()}
                      >
                        {t('settings.discord.unlink')}
                      </BusyButton>
                    </div>
                  </>
                ) : (
                  <>
                    <p>{t('settings.discord.intro')}</p>
                    {linkingDiscord ? (
                      <ConfirmForm
                        kind="password"
                        email={me.email}
                        hint={t('settings.discord.passwordHint')}
                        submitLabel={t('settings.discord.continue')}
                        busyLabel={t('settings.checking')}
                        onSubmit={linkDiscord}
                        onCancel={cancelLinkDiscord}
                      />
                    ) : (
                      <div>
                        {env.native ? (
                          <Button type="button" variant="secondary" onClick={() => void openOnWeb('/settings/account#discord')}>
                            {t('settings.discord.linkOnWeb')}
                          </Button>
                        ) : me.hasPassword ? (
                          <Button
                            ref={linkDiscordButton}
                            type="button"
                            variant="secondary"
                            onClick={() => setLinkingDiscord(true)}
                          >
                            {t('settings.discord.link')}
                          </Button>
                        ) : (
                          <Button asChild variant="secondary">
                            <a href={api.discordLinkUrl()}>{t('settings.discord.link')}</a>
                          </Button>
                        )}
                      </div>
                    )}
                    {env.native && (
                      <p className="text-[0.875rem] text-muted-foreground">{t('settings.discord.nativeHint')}</p>
                    )}
                  </>
                )}
                {outcome('discord')}
              </SettingsCard>
            )}

            {shown('journal') && (
              <SettingsCard id="journal" title={title('journal')}>
                <JournalSettings me={me} />
              </SettingsCard>
            )}

            {shown('moments') && (
              <SettingsCard id="moments" title={title('moments')}>
                <p>{t('settings.moments.intro')}</p>
                <div>
                  <TapLink to="/moments">{t('settings.moments.open')}</TapLink>
                </div>
              </SettingsCard>
            )}

            {shown('helps') && (
              <SettingsCard id="helps" title={title('helps')}>
                <HelpsSettings />
              </SettingsCard>
            )}

            {shown('export') && (
              <SettingsCard id="export" title={title('export')}>
                <p>{t('export.intro')}</p>
                <div className="flex flex-wrap gap-2">
                  {env.native ? (
                    <Button type="button" variant="secondary" onClick={() => void openOnWeb('/settings/privacy#export')}>
                      {t('export.onWeb')}
                    </Button>
                  ) : (
                    exportFormats.map((format) => (
                      <BusyButton
                        key={format}
                        type="button"
                        variant="secondary"
                        busy={exporting === format}
                        busyLabel={t('settings.preparing')}
                        onClick={() => void exportAs(format)}
                      >
                        {t('export.download', { format: format.toUpperCase() })}
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
                    <p>{t('settings.delete.intro')}</p>
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
                          <FormField label={t('settings.yourPassword')} error={password.error ?? deleteErrors.password ?? null}>
                            {(field) => (
                              <PasswordInput {...field} {...password.input} autoComplete="current-password" />
                            )}
                          </FormField>
                        </>
                      )}
                      <FormField
                        label={t('settings.delete.confirmLabel', { word: t('delete.word') })}
                        error={confirm.error ?? deleteErrors.confirm ?? null}
                      >
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
                        <BusyButton
                          type="submit"
                          variant="destructive"
                          busy={busy === 'delete'}
                          busyLabel={t('settings.delete.deleting')}
                        >
                          {t('settings.delete.submit')}
                        </BusyButton>
                      </div>
                    </form>
                  </>
                )}
              </SettingsCard>
            )}

            {shown('feedback') && (
              <SettingsCard id="feedback" title={title('feedback')}>
                <FeedbackForm />
              </SettingsCard>
            )}

            {shown('help') && (
              <SettingsCard id="help" title={title('help')}>
                <CrisisLines />
                <p>
                  <TapLink to="/about">{t('about.link')}</TapLink>
                </p>
              </SettingsCard>
            )}
          </>
        ) : (
          <>
            <p role="status" className="sr-only">
              {t('settings.loading')}
            </p>
            <Skeleton className="h-[12rem] rounded-xl" />
            <Skeleton className="h-[8rem] rounded-xl" />
          </>
        )}
      </div>
    </div>
  );
}
