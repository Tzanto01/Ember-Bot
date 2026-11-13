import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listenForDiscord, startDiscordSignIn, takeDiscordRedirect } from './discord';

const native = vi.hoisted(() => ({
  opened: [] as string[],
  closed: 0,
  appUrlOpen: null as ((event: { url: string }) => void) | null,
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: async ({ url }: { url: string }) => void native.opened.push(url),
    close: async () => void native.closed++,
  },
}));

vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (_event: string, listener: (event: { url: string }) => void) => {
      native.appUrlOpen = listener;
      return { remove: async () => undefined };
    },
  },
}));

const code = 'A'.repeat(42) + '_';

async function sha256Url(text: string): Promise<string> {
  const hash = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)),
  );
  return btoa(String.fromCharCode(...hash))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

describe('native Discord sign-in', () => {
  beforeEach(() => {
    native.opened = [];
    native.closed = 0;
    takeDiscordRedirect('app.ember.habits://auth/discord?error=reset');
  });

  it('opens the browser with the S256 challenge of a verifier the code redirect hands back', async () => {
    await startDiscordSignIn();

    const opened = new URL(native.opened[0], 'https://origin.test');
    expect(opened.pathname).toBe('/api/auth/discord/login');
    expect(opened.searchParams.get('client')).toBe('native');
    expect(opened.searchParams.get('language')).toBe('en');
    const result = takeDiscordRedirect(`app.ember.habits://auth/discord?code=${code}`);
    if (!result || result === 'error') throw new Error('expected a code');
    expect(result.code).toBe(code);
    expect(result.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(opened.searchParams.get('challenge')).toBe(await sha256Url(result.verifier));
  });

  it('passes on the app URL with the code once, closes the browser and ignores foreign URLs', async () => {
    const results: unknown[] = [];
    await listenForDiscord((result) => results.push(result));
    await startDiscordSignIn();

    for (const url of [
      `evil.app://auth/discord?code=${code}`,
      `app.ember.habits://auth/other?code=${code}`,
      `app.ember.habits://auth/discord?code=${code}&returnUrl=/x`,
      'app.ember.habits://auth/discord?code=short',
      `app.ember.habits://auth/discordx?code=${code}`,
    ])
      native.appUrlOpen!({ url });
    expect(results).toEqual([]);

    native.appUrlOpen!({ url: `app.ember.habits://auth/discord?code=${code}` });
    native.appUrlOpen!({ url: `app.ember.habits://auth/discord?code=${code}` });

    expect(results).toEqual([{ code, verifier: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) }]);
    await vi.waitFor(() => expect(native.closed).toBe(1));
  });

  it('reports the error redirect, which ends the pending sign-in', async () => {
    expect(takeDiscordRedirect(`app.ember.habits://auth/discord?code=${code}`)).toBeNull();
    await startDiscordSignIn();

    expect(takeDiscordRedirect('app.ember.habits://auth/discord?error=discord')).toBe('error');
    expect(takeDiscordRedirect(`app.ember.habits://auth/discord?code=${code}`)).toBeNull();
  });
});
