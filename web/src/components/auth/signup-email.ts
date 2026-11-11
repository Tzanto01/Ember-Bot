const key = 'ember.signupEmail';
const maxAgeMs = 24 * 60 * 60 * 1000;

/** Keeps the address just signed up with on this device for a day, so `/confirm-email` can prefill it and sign in right after confirming. */
export function rememberSignupEmail(email: string): void {
  try {
    localStorage.setItem(key, JSON.stringify({ email, at: Date.now() }));
  } catch {}
}

/** Returns the address `rememberSignupEmail` kept within the last day, if any, without forgetting it. */
export function peekSignupEmail(): string | null {
  try {
    const raw = localStorage.getItem(key);
    const kept = raw ? (JSON.parse(raw) as { email?: unknown; at?: unknown }) : null;
    return typeof kept?.email === 'string' && typeof kept.at === 'number' && Date.now() - kept.at < maxAgeMs
      ? kept.email
      : null;
  } catch {
    return null;
  }
}

/** Returns the address `rememberSignupEmail` kept within the last day, if any, and forgets it. */
export function takeSignupEmail(): string | null {
  const email = peekSignupEmail();
  try {
    localStorage.removeItem(key);
  } catch {}
  return email;
}
