import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import {
  type BetaUpdate,
  EmberUpdater,
  findReleaseNotes,
  findUpdate,
  updaterAvailable,
} from '@/lib/native/updater';

type Phase = 'offer' | 'permission' | 'downloading' | 'failed';

const hour = 60 * 60 * 1000;
let dismissedCode = 0;

/**
 * "Update available" banner for the sideloaded beta app; renders nothing on the web and in the Play build. Checks
 * the manifest on mount and when the app returns to the foreground (at most once an hour). Update asks for the
 * "Install unknown apps" permission first when needed, then downloads and opens Android's installer. The offer lists
 * the new version's notes from the server when it has them. Dismissing hides that version for the rest of the session.
 */
export function BetaUpdateBanner() {
  const [update, setUpdate] = useState<BetaUpdate | null>(null);
  const [phase, setPhase] = useState<Phase>('offer');
  const [percent, setPercent] = useState<number | null>(null);
  const [notes, setNotes] = useState<{ versionName: string; notes: string[] } | null>(null);
  const updateRef = useRef<BetaUpdate | null>(null);
  const phaseRef = useRef<Phase>('offer');
  const busy = useRef(false);

  function show(next: Phase) {
    phaseRef.current = next;
    setPhase(next);
  }

  async function install() {
    const target = updateRef.current;
    if (!target || busy.current) return;
    busy.current = true;
    try {
      if (!(await EmberUpdater.canInstall()).value) {
        show('permission');
        await EmberUpdater.openInstallSettings();
        return;
      }
      show('downloading');
      setPercent(null);
      const progress = await EmberUpdater.addListener('downloadProgress', ({ received, total }) => {
        if (total > 0) setPercent(Math.min(100, Math.floor((received * 100) / total)));
      });
      try {
        await EmberUpdater.downloadAndInstall({
          url: target.url,
          sha256: target.sha256,
          size: target.size,
        });
        show('offer');
      } finally {
        void progress.remove();
      }
    } catch {
      show('failed');
    } finally {
      busy.current = false;
    }
  }

  useEffect(() => {
    if (!updaterAvailable()) return;
    let active = true;
    let lastCheck = -Infinity;
    let listener: { remove: () => Promise<void> } | undefined;

    async function check() {
      if (Date.now() - lastCheck < hour) return;
      lastCheck = Date.now();
      const found = await findUpdate();
      if (!active || !found || busy.current) return;
      updateRef.current = found;
      setUpdate(found);
      const foundNotes = await findReleaseNotes(found.versionName);
      if (active && foundNotes) setNotes({ versionName: found.versionName, notes: foundNotes });
    }

    async function resumed() {
      if (
        phaseRef.current === 'permission' &&
        (await EmberUpdater.canInstall().catch(() => ({ value: false }))).value
      ) {
        await install();
      }
      await check();
    }

    void check();
    void import('@capacitor/app')
      .then(({ App }) => App.addListener('resume', () => void resumed()))
      .then((handle) => {
        if (active) listener = handle;
        else void handle.remove();
      })
      .catch(() => undefined);
    return () => {
      active = false;
      void listener?.remove();
    };
  }, []);

  if (!update || update.versionCode <= dismissedCode) return null;

  function dismiss() {
    dismissedCode = update!.versionCode;
    setUpdate(null);
  }

  const text = {
    offer: `Update available: Ember Beta ${update.versionName}`,
    permission: 'Allow Ember to install updates, then come back.',
    downloading: `Downloading Ember Beta ${update.versionName}…`,
    failed: "The update couldn't be downloaded. Try again in a moment.",
  }[phase];

  return (
    <Notice tone="info" aria-label="App update">
      <div className="flex w-full flex-wrap items-center gap-2">
        <p>{text}</p>
        {phase === 'offer' && notes?.versionName === update.versionName && (
          <ul
            aria-label={`What's new in ${update.versionName}`}
            className="flex w-full list-disc flex-col gap-1 pl-5"
          >
            {notes.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        )}
        {phase === 'downloading' ? (
          <progress
            className="h-2 w-full accent-primary"
            aria-label="Download progress"
            max={100}
            {...(percent === null ? {} : { value: percent })}
          />
        ) : (
          <Button variant="secondary" onClick={() => void install()}>
            {phase === 'failed' ? 'Try again' : 'Update'}
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Dismiss"
          className="-my-2 -mr-2 ml-auto"
          onClick={dismiss}
        >
          <X aria-hidden />
        </Button>
      </div>
    </Notice>
  );
}
