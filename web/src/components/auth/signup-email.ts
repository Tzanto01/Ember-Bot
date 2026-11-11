const key = 'ember.signupEmail';

/** Keeps the address just signed up with on this device, so `/confirm-email` can sign in right after confirming. */
export function rememberSignupEmail(email: string): void {
  try {
    localStorage.setItem(key, email);
  } catch {}
}

/** Returns the address `rememberSignupEmail` kept, if any, and forgets it. */
export function takeSignupEmail(): string | null {
  try {
    const email = localStorage.getItem(key);
    localStorage.removeItem(key);
    return email;
  } catch {
    return null;
  }
}
