import { CalendarDays, Flame, SlidersHorizontal } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { AmbientScene } from '@/components/ambient-scene';
import { BusyButton } from '@/components/auth/busy-button';
import { BetaBadge } from '@/components/beta-badge';
import { BetaUpdateBanner } from '@/components/beta-update';
import { FlameMark } from '@/components/flame-mark';
import { LegalLinks } from '@/components/legal-links';
import { NativeConfirmation } from '@/components/native-confirmation';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { useArrival } from '@/lib/arrival';
import { formatDate } from '@/lib/local-date';
import { auth, deviceSync, helps, journal, localMode, offlineQueue } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/today', label: 'nav.today', icon: Flame },
  { to: '/history', label: 'nav.history', icon: CalendarDays },
  { to: '/settings', label: 'nav.settings', icon: SlidersHorizontal },
] as const;

const inline = 'px-[8px] min-[360px]:px-[12px] min-[380px]:px-[16px] md:px-[24px]';
const measure = 'max-w-[72rem] 2xl:max-w-[88rem] min-[137.5rem]:max-w-[104rem] min-[200rem]:max-w-[120rem]';

/**
 * No-account mode's way to an account: keeps the device data waiting for it (mode `upgrading`), then opens sign-in or
 * sign-up (`to`), the same move as "Create an account and keep my data" in Settings. `onFailed` runs when that
 * cannot start.
 */
export function AccountButton({
  to,
  onFailed,
  ...props
}: Omit<ButtonProps, 'asChild' | 'onClick'> & { to: '/login' | '/signup'; onFailed: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  async function start(): Promise<void> {
    if (busy) return;
    setBusy(true);
    try {
      await localMode.beginUpgrade();
      await navigate(to);
    } catch {
      setBusy(false);
      onFailed();
    }
  }

  return (
    <BusyButton
      {...props}
      type="button"
      busy={busy}
      busyLabel={t('local.upgrade.busy')}
      onClick={() => void start()}
    />
  );
}

/**
 * Signed-in shell: sticky header with the brand, the main nav (top pills from `md`, a fixed bottom tab bar below)
 * and "Sign out" from `md` (Settings has it on phones), or "Sign in" in no-account mode; the offline-queue and
 * dropped-edit notices above the page; legal footer.
 * Loads "What helps me" into memory once the account's private journal is unlocked.
 */
export function AppShell() {
  const { t } = useTranslation();
  const pending = useStore(offlineQueue.pending);
  const dropped = useStore(deviceSync.dropped);
  const droppedNotes = useStore(offlineQueue.droppedNotes);
  const local = useStore(localMode.mode) === 'local';
  const userId = useStore(auth.me)?.id;
  const journalState = useStore(journal.state);
  const turningOff = useStore(journal.turningOff);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const [upgradeFailed, setUpgradeFailed] = useState(false);
  const busy = useRef(false);
  const arriving = useArrival(useLocation().pathname);

  useEffect(() => {
    if (local || !userId || journalState !== 'unlocked' || turningOff) return;
    void helps.ensureLoaded().catch(() => undefined);
  }, [local, userId, journalState, turningOff]);

  async function signOut() {
    if (busy.current) return;
    busy.current = true;
    setSigningOut(true);
    setSignOutFailed(false);
    setSignOutFailed(!(await auth.logout()));
    busy.current = false;
    setSigningOut(false);
  }

  return (
    <div className="relative isolate flex min-h-dvh flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      <AmbientScene app />
      <header className="sticky top-0 z-10 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
        <div className={cn('mx-auto flex min-h-[56px] items-center gap-4', measure, inline)}>
          <div className="flex items-center gap-2">
            <Link
              to="/today"
              className="inline-flex min-h-[44px] items-center gap-2 font-display text-[1.125rem] font-bold text-foreground no-underline"
            >
              <FlameMark />
              Ember
            </Link>
            <BetaBadge />
          </div>
          <nav
            aria-label={t('nav.main')}
            className="fixed inset-x-0 bottom-0 z-10 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:static md:gap-1 md:border-0 md:bg-transparent md:p-0"
          >
            {nav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  cn(
                    'flex min-h-[64px] flex-1 flex-col items-center justify-center gap-0.5 text-[13px] font-medium text-muted-foreground no-underline max-md:focus-visible:-outline-offset-3',
                    'md:min-h-[44px] md:flex-none md:flex-row md:gap-2 md:rounded-full md:px-4 md:text-base md:hover:bg-accent md:hover:text-accent-foreground',
                    isActive &&
                      'font-semibold text-primary shadow-[inset_0_3px_0_var(--primary)] md:bg-secondary md:text-secondary-foreground md:shadow-none md:hover:bg-secondary md:hover:text-secondary-foreground',
                  )
                }
              >
                <Icon aria-hidden className="size-[22px] md:size-[18px]" />
                <span>{t(label)}</span>
              </NavLink>
            ))}
          </nav>
          {local ? (
            <AccountButton
              to="/login"
              variant="ghost"
              className="ml-auto"
              onFailed={() => setUpgradeFailed(true)}
            >
              {t('auth.signIn')}
            </AccountButton>
          ) : (
            <Button
              variant="ghost"
              className="ml-auto max-md:hidden"
              aria-disabled={signingOut || undefined}
              onClick={() => void signOut()}
            >
              {signingOut ? t('nav.signingOut') : t('nav.signOut')}
            </Button>
          )}
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        data-arrive={arriving ? 'blocks' : undefined}
        className={cn('mx-auto flex w-full flex-1 flex-col gap-6 py-6 focus:outline-none md:py-10', measure, inline)}
      >
        {signOutFailed && (
          <Notice tone="notice">
            <p>{t('shell.signOutFailed')}</p>
          </Notice>
        )}
        {upgradeFailed && (
          <Notice tone="notice">
            <p>{t('local.upgrade.failed')}</p>
          </Notice>
        )}
        {pending > 0 && (
          <Notice tone="info">
            {t('shell.pending', { count: pending })}
          </Notice>
        )}
        {dropped > 0 && (
          <Notice tone="notice">
            {t('shell.dropped')}
            <Button variant="ghost" onClick={() => deviceSync.dropped.set(0)}>
              {t('shell.okay')}
            </Button>
          </Notice>
        )}
        {droppedNotes.length > 0 && (
          <Notice tone="notice">
            <p>
              {t('shell.droppedNotes', { count: droppedNotes.length })}
            </p>
            <ul className="flex flex-col gap-2">
              {droppedNotes.map((note, index) => (
                <li key={`${note.date}-${index}`}>
                  <strong>{formatDate(note.date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
                  <p className="whitespace-pre-line select-text">
                    {note.text ?? t('shell.privateNote')}
                  </p>
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={() => offlineQueue.droppedNotes.set([])}>
              {t('shell.okay')}
            </Button>
          </Notice>
        )}
        <BetaUpdateBanner />
        <NativeConfirmation />
        <Outlet />
      </main>
      <footer className="border-t border-border p-4">
        <LegalLinks />
      </footer>
    </div>
  );
}
