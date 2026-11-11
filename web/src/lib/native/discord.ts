import { openOnWeb } from './browser';

/** A finished browser step of the native Discord sign-in: the one-time code and the PKCE verifier it needs. */
export interface DiscordCode {
  code: string;
  verifier: string;
}

const redirect = 'app.ember.habits://auth/discord?';
const codePattern = /^[A-Za-z0-9_-]{43}$/;

let pendingVerifier: string | null = null;

function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Starts the native Discord sign-in (contract "Native Discord sign-in"): a fresh PKCE verifier stays in memory, and the
 * system browser opens `/api/auth/discord/login?client=native` with its S256 challenge.
 */
export async function startDiscordSignIn(): Promise<void> {
  const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64Url(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))),
  );
  pendingVerifier = verifier;
  await openOnWeb(`/api/auth/discord/login?client=native&challenge=${challenge}`);
}

/**
 * Reads an app URL: `app.ember.habits://auth/discord?code=…` gives the code with the pending verifier, `…?error=…` gives
 * `'error'`, and both end the pending sign-in. Any other URL, extra parameters, a malformed code or no pending sign-in
 * give null and change nothing.
 */
export function takeDiscordRedirect(url: string): DiscordCode | 'error' | null {
  if (!pendingVerifier || !url.startsWith(redirect)) return null;
  const params = [...new URLSearchParams(url.slice(redirect.length))];
  if (params.length !== 1) return null;
  const [[name, value]] = params;
  const verifier = pendingVerifier;
  if (name === 'error') {
    pendingVerifier = null;
    return 'error';
  }
  if (name !== 'code' || !codePattern.test(value)) return null;
  pendingVerifier = null;
  return { code: value, verifier };
}

/**
 * Listens for the app URL that ends the browser step (`appUrlOpen`), closes the browser and passes the result on.
 * Resolves the function that stops listening.
 */
export async function listenForDiscord(
  onResult: (result: DiscordCode | 'error') => void,
): Promise<() => void> {
  const { App } = await import('@capacitor/app');
  const listener = await App.addListener('appUrlOpen', ({ url }) => {
    const result = takeDiscordRedirect(url);
    if (!result) return;
    void import('@capacitor/browser').then(({ Browser }) => Browser.close()).catch(() => undefined);
    onResult(result);
  });
  return () => void listener.remove();
}
