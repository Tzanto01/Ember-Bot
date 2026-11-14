import { act, cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';
import { fakeJournal } from '@/components/journal/fake-journal';
import { JournalContext } from '@/components/journal/journal-context';
import type { JournalState } from '@/lib/journal/types';
import { deviceToday } from '@/lib/guards';
import type { HelpItem } from '@/lib/helps/types';
import { api, auth, deviceSync, helps, localMode, offlineQueue } from '@/lib/services';
import { me } from '@/lib/test-support';
import { renderPage } from '@/test-utils';
import MomentPage from './moment';

vi.mock('@/lib/services', async (original) => {
  const { Store } = await import('@/lib/store');
  return {
    ...(await original<typeof import('@/lib/services')>()),
    localMode: { mode: new Store('account') },
    offlineQueue: { pending: new Store(0) },
    deviceSync: { sync: vi.fn(async () => undefined) },
  };
});

function open(state: JournalState) {
  const journal = fakeJournal({ state });
  const router = renderPage(
    '/moment',
    () => (
      <JournalContext value={journal}>
        <MomentPage />
      </JournalContext>
    ),
    '/moment',
  );
  return { journal, router };
}

async function heading(name: string | RegExp) {
  const h1 = await screen.findByRole('heading', { level: 1, name });
  expect(h1).toHaveFocus();
  return h1;
}

function announced(): string[] {
  return [...document.querySelectorAll('[aria-live="polite"]')].map((el) => el.textContent ?? '');
}

async function quickToReflect() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Just breathe with me' }));
  await heading(/Slow breathing, step 1 of 5/);
  await user.click(screen.getByRole('button', { name: 'Skip to the end' }));
  await heading('How is it now?');
  await user.click(screen.getByRole('button', { name: 'Skip' }));
  await heading("That's it for now.");
  await user.click(screen.getByRole('button', { name: 'Reflect on it' }));
  await heading('Reflect, if you like');
  return user;
}

describe('MomentPage', () => {
  afterEach(() => {
    auth.me.set(null);
    helps.items.set(null);
    localMode.mode.set('account');
    offlineQueue.pending.set(0);
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('walks Catch, Name, intensity and every practice step, saves the reflection and leaves', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal, router } = open('unlocked');
    const user = userEvent.setup();

    expect(
      screen.getByRole('heading', { level: 1, name: "You're here. That's enough for now." }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: "Name what's happening" }));
    await heading("What's happening?");
    await user.click(screen.getByRole('button', { name: 'Too much, overloaded' }));
    await heading('How strong is it?');
    await user.click(screen.getByRole('radio', { name: 'Strong' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    for (let step = 1; step <= 5; step++) {
      await heading(new RegExp(`^Slow breathing, step ${step} of 5`));
      if (step === 3) expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: step === 5 ? 'Finish' : 'Next' }));
    }

    await heading('How is it now?');
    await user.click(screen.getByRole('radio', { name: 'Noticeable' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading("That's it for now.");
    await user.click(screen.getByRole('button', { name: 'Reflect on it' }));
    await heading('Reflect, if you like');

    expect(screen.getByRole('radio', { name: 'Slow breathing' })).toBeChecked();
    expect(screen.getByRole('radiogroup', { name: 'How it is now' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Noticeable', checked: true })).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: /What set it off/ }), 'A long day');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText("Saved to today's private note.")).toBeInTheDocument();
    expect(journal.appendPrivate).toHaveBeenCalledTimes(1);
    const [date, block] = journal.appendPrivate.mock.calls[0]!;
    expect(date).toBe(deviceToday(me.timezone));
    expect(block).toMatch(
      /^Moment \d\d:\d\d · Too much \/ overloaded · Strong → Noticeable\nWhat set it off: A long day\nWhat helped: Slow breathing$/,
    );

    await user.click(screen.getByRole('button', { name: 'Done for now' }));
    expect(router.state.location.pathname).toBe('/');
  }, 15_000);

  it('keeps the draft and explains when saving fails offline', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal } = open('unlocked');
    journal.appendPrivate.mockRejectedValueOnce(new Error('Offline.'));
    const user = await quickToReflect();
    const box = screen.getByRole('textbox', { name: /What set it off/ });
    await user.type(box, 'The bus');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText("You're offline, so nothing was saved. Your words are still here."),
    ).toBeInTheDocument();
    expect(box).toHaveValue('The bus');
  });

  it('offers no Save with the plain journal and links to Privacy & data', async () => {
    auth.me.set(me);
    const { journal } = open('off');
    await quickToReflect();
    expect(
      screen.getByText(
        'Saving a reflection needs the private journal. Nothing from this moment was saved.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open Privacy & data' })).toHaveAttribute(
      'href',
      '/settings/privacy',
    );
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
  });

  it('offers no Save when signed out', async () => {
    open('off');
    await quickToReflect();
    expect(screen.getByText('Nothing from this moment was saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
  });

  it('shows the unlock form for a locked private journal and offers Save after unlocking', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal } = open('locked');
    (journal.unlock as Mock).mockImplementation(async () => {
      journal.state.set('unlocked');
      return { needsNewPassphrase: false };
    });
    const user = await quickToReflect();

    expect(screen.getByLabelText('Journal passphrase')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Journal passphrase'), 'correct horse battery');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    const box = await screen.findByRole('textbox', { name: /What set it off/ });
    expect(box).toHaveFocus();
    await user.type(box, 'Noise');
    await user.click(await screen.findByRole('button', { name: 'Save' }));

    expect(journal.unlock).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Saved to today's private note.")).toBeInTheDocument();
    expect(journal.appendPrivate).toHaveBeenCalledTimes(1);
    expect(journal.appendPrivate.mock.calls[0]![1]).toContain('What set it off: Noise');
  }, 15_000);

  it.each([
    ['consent not given', { given: false, policyVersion: null, currentPolicyVersion: '1' }],
    ['an outdated policy version', { given: true, policyVersion: '0', currentPolicyVersion: '1' }],
  ])('offers no Save and explains consent when %s', async (_name, consent) => {
    auth.me.set({
      ...me,
      journal: { ...me.journal, encrypted: true },
      consent: consent as typeof me.consent,
    });
    const { journal } = open('unlocked');
    await quickToReflect();
    expect(screen.getByText(/needs your consent to the privacy policy/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Review consent' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
  });

  it('offers no Save while the private journal is turning off', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal } = open('unlocked');
    journal.turningOff.set(true);
    await quickToReflect();
    expect(screen.getByRole('link', { name: 'Open Privacy & data' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
  });

  it('offers no Save without an account', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    localMode.mode.set('local');
    const { journal } = open('unlocked');
    await quickToReflect();
    expect(screen.getByText('Nothing from this moment was saved.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
  });

  it('makes no network call and writes no storage across a full run until Save', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const idb = globalThis.indexedDB ? vi.spyOn(globalThis.indexedDB, 'open') : undefined;
    const { journal } = open('unlocked');
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: "Name what's happening" }));
    await heading("What's happening?");
    await user.click(screen.getByRole('button', { name: 'Too much, overloaded' }));
    await heading('How strong is it?');
    await user.click(screen.getByRole('radio', { name: 'Strong' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    for (let step = 1; step <= 5; step++) {
      await heading(new RegExp(`^Slow breathing, step ${step} of 5`));
      await user.click(screen.getByRole('button', { name: step === 5 ? 'Finish' : 'Next' }));
    }
    await heading('How is it now?');
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    await heading("That's it for now.");
    await user.click(screen.getByRole('button', { name: 'Reflect on it' }));
    await heading('Reflect, if you like');
    await user.type(screen.getByRole('textbox', { name: /What set it off/ }), 'Unsent words');

    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    if (idb) expect(idb).not.toHaveBeenCalled();
  }, 15_000);

  it('opens the crisis lines in place and keeps the flow where it was', async () => {
    open('off');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: "Name what's happening" }));
    await heading("What's happening?");
    const toggle = screen.getByRole('button', { name: 'Urgent help' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Ember isn.t a crisis service/)).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { level: 1, name: "What's happening?" }),
    ).toBeInTheDocument();
  });

  it('writes to the device day past midnight and leaves out "What helped" for Nothing really', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-01T23:30:00Z'));
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal } = open('unlocked');
    const user = await quickToReflect();
    await user.click(screen.getByRole('radio', { name: 'Nothing really' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Saved to today's private note.")).toBeInTheDocument();
    expect(journal.appendPrivate).toHaveBeenCalledWith('2026-11-02', 'Moment 00:30');
  });

  it('syncs queued edits before saving and keeps the draft when they stay queued', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    offlineQueue.pending.set(2);
    const { journal } = open('unlocked');
    const user = await quickToReflect();
    const box = screen.getByRole('textbox', { name: /What set it off/ });
    await user.type(box, 'Late train');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText("You're offline, so nothing was saved. Your words are still here."),
    ).toBeInTheDocument();
    expect(deviceSync.sync).toHaveBeenCalled();
    expect(journal.appendPrivate).not.toHaveBeenCalled();
    expect(box).toHaveValue('Late train');

    vi.mocked(deviceSync.sync).mockImplementationOnce(async () => offlineQueue.pending.set(0));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Saved to today's private note.")).toBeInTheDocument();
    expect(journal.appendPrivate).toHaveBeenCalledTimes(1);
  });

  it('announces the character limit only at its thresholds', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    open('unlocked');
    const user = await quickToReflect();
    const box = screen.getByRole('textbox', { name: /What set it off/ });
    await user.click(box);
    await user.paste('x'.repeat(279));
    expect(screen.getByText('21 characters left')).toBeInTheDocument();
    expect(announced()).not.toContain('21 characters left');
    await user.type(box, 'xx');
    expect(announced()).toContain('20 characters left');
    expect(announced()).not.toContain('19 characters left');
    await user.paste('x'.repeat(19));
    expect(announced()).toContain('Limit reached');
  });

  it('clears the earlier "How is it now?" answer when trying another practice', async () => {
    auth.me.set({ ...me, journal: { ...me.journal, encrypted: true } });
    const { journal } = open('unlocked');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Just breathe with me' }));
    await heading(/Slow breathing, step 1 of 5/);
    await user.click(screen.getByRole('button', { name: 'Skip to the end' }));
    await heading('How is it now?');
    await user.click(screen.getByRole('radio', { name: 'Strong' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading("That's it for now.");
    await user.click(screen.getByRole('button', { name: 'Try another' }));
    await heading(/^A kind voice, step 1 of 5/);
    await user.click(screen.getByRole('button', { name: 'Skip to the end' }));
    await heading('How is it now?');
    expect(screen.queryByRole('radio', { checked: true })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await heading("That's it for now.");
    await user.click(screen.getByRole('button', { name: 'Reflect on it' }));
    await heading('Reflect, if you like');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText("Saved to today's private note.")).toBeInTheDocument();
    expect(journal.appendPrivate.mock.calls[0]![1]).not.toContain('→');
  }, 15_000);

  it('pauses the breathing player silently while urgent help is open', async () => {
    open('off');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Just breathe with me' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await heading(/^Slow breathing, step 3 of 5/);
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('bg-secondary');
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(announced()).toContain('Round 1 of 6. Breathe in, 4');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/Just breathe along\.$/);
    expect(screen.getByRole('button', { name: 'Next' })).not.toHaveClass('bg-secondary');
    await user.click(screen.getByRole('button', { name: 'Urgent help' }));
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 1200)));
    expect(
      screen.getByText('Breathe in, 4', { selector: 'p:not([aria-live])' }),
    ).toBeInTheDocument();
    expect(announced()).toContain('Round 1 of 6. Breathe in, 4');
    expect(announced()).not.toContain('Paused');
  });

  describe('what helped before', () => {
    const help = (id: string, text: string, practiceId?: string): HelpItem => ({
      id,
      text,
      ...(practiceId ? { practiceId } : {}),
      addedAt: '2026-11-01T10:00:00.000Z',
    });

    it('offers at most three chips from the list in memory, and reads nothing from the server', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const getHelps = vi.spyOn(api, 'getHelps');
      helps.items.set([help('1', 'Cold water'), help('2', 'Call Sam'), help('3', 'Stretch'), help('4', 'Fourth one')]);
      open('off');

      const section = screen.getByRole('region', { name: 'What helped before' });
      expect(within(section).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Cold water',
        'Call Sam',
        'Stretch',
      ]);
      expect(getHelps).not.toHaveBeenCalled();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('shows no chips and no heading while the list is not in memory or is empty', () => {
      open('off');
      expect(screen.queryByText('What has helped before')).toBeNull();
      cleanup();

      helps.items.set([]);
      open('off');
      expect(screen.queryByText('What has helped before')).toBeNull();
    });

    it('opens the practice for a chip that has one', async () => {
      helps.items.set([help('1', 'My breathing', 'paced-breathing')]);
      open('off');

      await userEvent.setup().click(screen.getByRole('button', { name: 'My breathing' }));

      await heading(/Slow breathing, step 1 of 5/);
    });

    it('shows the reminder text for a chip without a practice, and goes on to naming or back', async () => {
      helps.items.set([help('1', 'Cold water on my wrists')]);
      open('off');
      const user = userEvent.setup();

      await user.click(screen.getByRole('button', { name: 'Cold water on my wrists' }));
      await heading(/Something that helped before.*Cold water on my wrists/);
      await user.click(screen.getByRole('button', { name: 'Back' }));
      await heading(/./);
      expect(screen.getByRole('button', { name: 'Cold water on my wrists' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Cold water on my wrists' }));
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await heading("What's happening?");
    });
  });
});
