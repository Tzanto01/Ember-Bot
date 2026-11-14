import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { mockFetch } from '@/lib/test-support';
import { BetaUpdateBanner } from './beta-update';

const native = vi.hoisted(() => ({
  available: true,
  resume: null as (() => void) | null,
  updater: {
    canInstall: vi.fn(),
    openInstallSettings: vi.fn(),
    downloadAndInstall: vi.fn(),
    addListener: vi.fn(),
  },
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: (name: string) => native.available && name === 'EmberUpdater' },
  registerPlugin: () => native.updater,
}));

vi.mock('@capacitor/app', () => ({
  App: {
    getInfo: async () => ({ build: '3' }),
    addListener: async (_event: string, listener: () => void) => {
      native.resume = listener;
      return { remove: async () => undefined };
    },
  },
}));

vi.mock('@/lib/env', () => ({
  env: { native: true, apiBase: 'https://beta.example.test', webOrigin: '' },
}));

const manifestUrl = 'https://beta.example.test/download/latest.json';
const notesUrl = 'https://beta.example.test/release-notes.json';
const manifest = {
  versionCode: 4,
  versionName: '0.9.0-beta.3',
  url: 'https://beta.example.test/download/ember-beta.apk',
  sha256: 'ab'.repeat(32),
  size: 1234,
};

async function renderWith(status: number, body: unknown) {
  const f = mockFetch();
  render(<BetaUpdateBanner />);
  await act(async () => (await f.next('GET', manifestUrl)).respond(status, body));
  return f;
}

describe('BetaUpdateBanner', () => {
  beforeEach(() => {
    native.available = true;
    native.resume = null;
    env.native = true;
    native.updater.canInstall.mockResolvedValue({ value: true });
    native.updater.openInstallSettings.mockResolvedValue(undefined);
    native.updater.downloadAndInstall.mockResolvedValue(undefined);
    native.updater.addListener.mockResolvedValue({ remove: async () => undefined });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('offers a newer versionCode and downloads it with its checksum and size', async () => {
    await renderWith(200, manifest);

    expect(screen.getByRole('status', { name: 'App update' })).toHaveTextContent(
      'Update available: Ember Beta 0.9.0-beta.3',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(native.updater.downloadAndInstall).toHaveBeenCalledWith({
      url: manifest.url,
      sha256: manifest.sha256,
      size: 1234,
    });
    expect(native.updater.openInstallSettings).not.toHaveBeenCalled();
  });

  it("lists the new version's notes from the server before downloading", async () => {
    const f = await renderWith(200, manifest);
    await act(async () =>
      (await f.next('GET', notesUrl)).respond(200, [
        { version: '0.9.0-beta.4', date: '2026-11-14', notes: { en: ['Not this one.'] } },
        { version: '0.9.0-beta.3', date: '2026-11-12', notes: { en: ['A new thing.', 'Another one.'] } },
      ]),
    );

    const list = screen.getByRole('list', { name: "What's new in 0.9.0-beta.3" });
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['A new thing.', 'Another one.']);
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(native.updater.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['fails', 503, undefined],
    [
      'has no entry for the version',
      200,
      [{ version: '0.9.0-beta.2', date: '2026-11-01', notes: { en: ['Old.'] } }],
    ],
  ])('offers the update as before when the notes request %s', async (_name, status, body) => {
    const f = await renderWith(200, manifest);
    await act(async () => (await f.next('GET', notesUrl)).respond(status, body));

    expect(screen.queryByRole('list')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(native.updater.downloadAndInstall).toHaveBeenCalledTimes(1);
  });

  it('stays quiet when the installed build is the same or newer', async () => {
    await renderWith(200, { ...manifest, versionCode: 3 });

    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['a failed request', 404, manifest],
    ['a non-object body', 200, 'not a manifest'],
    ['a string versionCode', 200, { ...manifest, versionCode: '4' }],
    ['a short checksum', 200, { ...manifest, sha256: 'abc' }],
    [
      'a cross-origin url',
      200,
      { ...manifest, url: 'https://elsewhere.example.test/ember-beta.apk' },
    ],
    [
      'a plain http url',
      200,
      { ...manifest, url: 'http://beta.example.test/download/ember-beta.apk' },
    ],
  ])('ignores %s', async (_name, status, body) => {
    await renderWith(status, body);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks for the install permission first and continues when the user comes back', async () => {
    native.updater.canInstall.mockResolvedValueOnce({ value: false });
    await renderWith(200, manifest);

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));
    expect(native.updater.openInstallSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Allow Ember to install updates, then come back.',
    );
    expect(native.updater.downloadAndInstall).not.toHaveBeenCalled();

    await act(async () => native.resume?.());
    await vi.waitFor(() => expect(native.updater.downloadAndInstall).toHaveBeenCalledTimes(1));
  });

  it('says gently when the download fails', async () => {
    native.updater.downloadAndInstall.mockRejectedValueOnce(new Error('MISMATCH'));
    await renderWith(200, manifest);

    await userEvent.click(screen.getByRole('button', { name: 'Update' }));

    expect(
      await screen.findByText("The update couldn't be downloaded. Try again in a moment."),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert', { name: 'App update' })).toHaveAttribute('data-tone', 'notice');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it.each([
    ['on the web', () => (env.native = false)],
    ['without the updater plugin', () => (native.available = false)],
  ])('does nothing %s', async (_name, setUp) => {
    setUp();
    const f = mockFetch();
    render(<BetaUpdateBanner />);
    await act(async () => undefined);

    expect(f.all).toHaveLength(0);
    expect(native.resume).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
