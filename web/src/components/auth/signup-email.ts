const key = 'ember.signupEmail';
const maxAgeMs = 24 * 60 * 60 * 1000;

interface Kept {
  email: string;
  signupKey: string | null;
}

/** A new sign-up key: 32 random bytes, base64url without padding. It ties the emailed code to this device. */
export function newSignupKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Keeps the address just signed up with and its sign-up key on this device for a day, so `/confirm-email` can prefill
 * the address and the code works here without the password.
 */
export function rememberSignupEmail(email: string, signupKey: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ email, signupKey, at: Date.now() }));
  } catch {}
}

function peek(): Kept | null {
  try {
    const raw = localStorage.getItem(key);
    const kept = raw ? (JSON.parse(raw) as { email?: unknown; signupKey?: unknown; at?: unknown }) : null;
    return typeof kept?.email === 'string' && typeof kept.at === 'number' && Date.now() - kept.at < maxAgeMs
      ? { email: kept.email, signupKey: typeof kept.signupKey === 'string' ? kept.signupKey : null }
      : null;
  } catch {
    return null;
  }
}

/** Returns the address `rememberSignupEmail` kept within the last day, if any, without forgetting it. */
export function peekSignupEmail(): string | null {
  return peek()?.email ?? null;
}

/** The sign-up key kept within the last day, if any; with `email`, only when it was kept for that address. */
export function peekSignupKey(email?: string): string | null {
  const kept = peek();
  if (!kept || (email !== undefined && kept.email.toLowerCase() !== email.trim().toLowerCase())) return null;
  return kept.signupKey;
}

/** Returns the address `rememberSignupEmail` kept within the last day, if any, and forgets it with its key. */
export function takeSignupEmail(): string | null {
  const email = peekSignupEmail();
  try {
    localStorage.removeItem(key);
  } catch {}
  return email;
}
