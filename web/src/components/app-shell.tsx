import { CalendarDays, Flame, LayoutGrid, SlidersHorizontal } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { FlameMark } from '@/components/flame-mark';
import { LegalLinks } from '@/components/legal-links';
import { NativeConfirmation } from '@/components/native-confirmation';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { formatDate } from '@/lib/local-date';
import { auth, deviceSync, localMode, offlineQueue } from '@/lib/services';
import { useStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const nav = [
  { to: '/today', label: 'Today', icon: Flame },
  { to: '/history', label: 'History', icon: CalendarDays },
  { to: '/year', label: 'Year', icon: LayoutGrid },
  { to: '/settings', label: 'Settings', icon: SlidersHorizontal },
];

const inline = 'px-[8px] min-[360px]:px-[12px] min-[380px]:px-[16px] md:px-[24px]';

/**
 * Signed-in shell: sticky header with the brand, the main nav (top pills from `md`, a fixed bottom tab bar below)
 * and "Sign out" from `md` (Settings has it on phones); the offline-queue and dropped-edit notices above the page; legal footer.
 */
export function AppShell() {
  const pending = useStore(offlineQueue.pending);
  const dropped = useStore(deviceSync.dropped);
  const droppedNotes = useStore(offlineQueue.droppedNotes);
  const local = useStore(localMode.mode) === 'local';
  const [signingOut, setSigningOut] = useState(false);
  const [signOutFailed, setSignOutFailed] = useState(false);
  const busy = useRef(false);

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
    <div className="flex min-h-dvh flex-col pb-[calc(64px+env(safe-area-inset-bottom))] md:pb-0">
      <header className="sticky top-0 z-10 border-b border-border bg-background pt-[env(safe-area-inset-top)]">
        <div className={cn('mx-auto flex min-h-[56px] max-w-[72rem] items-center gap-4', inline)}>
          <Link
            to="/today"
            className="inline-flex min-h-[44px] items-center gap-2 font-display text-[18px] font-bold text-foreground no-underline"
          >
            <FlameMark />
            Ember
          </Link>
          <nav
            aria-label="Main"
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
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
          {!local && (
            <Button
              variant="ghost"
              className="ml-auto max-md:hidden"
              aria-disabled={signingOut || undefined}
              onClick={() => void signOut()}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </Button>
          )}
        </div>
      </header>
      <main
        id="main"
        tabIndex={-1}
        className={cn('mx-auto flex w-full max-w-[72rem] flex-1 flex-col gap-6 py-6 focus:outline-none md:py-10', inline)}
      >
        {signOutFailed && (
          <Notice tone="notice">
            <p>Ember couldn't sign you out. Check your connection and try again.</p>
          </Notice>
        )}
        {pending > 0 && (
          <Notice tone="info">
            {`${pending === 1 ? 'One change is' : `${pending} changes are`} saved on this device and will sync when you're back online.`}
          </Notice>
        )}
        {dropped > 0 && (
          <Notice tone="notice">
            A change you made offline couldn't be saved: that day can't be edited anymore, or the habit is gone.
            Everything else is in place.
            <Button variant="ghost" onClick={() => deviceSync.dropped.set(0)}>
              Okay
            </Button>
          </Notice>
        )}
        {droppedNotes.length > 0 && (
          <Notice tone="notice">
            <p>
              {droppedNotes.length === 1 ? 'A journal entry' : 'Some journal entries'} you wrote offline couldn't be
              saved. Here is what you wrote, so you can copy it into the day again.
            </p>
            <ul className="flex flex-col gap-2">
              {droppedNotes.map((note, index) => (
                <li key={`${note.date}-${index}`}>
                  <strong>{formatDate(note.date, { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
                  <p className="whitespace-pre-line select-text">
                    {note.text ?? "This entry was private and can't be shown on this device."}
                  </p>
                </li>
              ))}
            </ul>
            <Button variant="ghost" onClick={() => offlineQueue.droppedNotes.set([])}>
              Okay
            </Button>
          </Notice>
        )}
        <NativeConfirmation />
        <Outlet />
      </main>
      <footer className="border-t border-border p-4">
        <LegalLinks />
      </footer>
    </div>
  );
}
