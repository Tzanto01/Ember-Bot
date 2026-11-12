import type { ReminderDestination } from '../models';

const installIdKey = 'ember.installId';
const phoneKey = 'ember.reminderPhone';
const validInstallId = /^[A-Za-z0-9_-]{16,64}$/;

/** This phone as a reminder destination (contract v1.14): its destination id and whether it is turned on. */
export interface ReminderPhone {
  id: string;
  enabled: boolean;
}

/** The random id of this app install (`ember.installId`), made once and kept; the server binds the phone to it. */
export function installId(): string {
  try {
    const stored = localStorage.getItem(installIdKey);
    if (stored && validInstallId.test(stored)) return stored;
  } catch {}
  const id = crypto.randomUUID();
  try {
    localStorage.setItem(installIdKey, id);
  } catch {}
  return id;
}

/**
 * The phone's name for Settings: the model from the WebView user agent (`Android 14; Pixel 8 Build/…`), at most
 * 60 characters; "Android phone" when there is none, it is shorter than 2 characters (a reduced user agent says
 * "K") or it holds control, format, line or paragraph separator characters or a lone surrogate.
 */
export function phoneLabel(userAgent: string = navigator.userAgent): string {
  const model = /Android [^;)]*;\s*([^;)]*?)(?:\s+Build\/|[;)])/.exec(userAgent)?.[1]?.trim() ?? '';
  const label = model.slice(0, 60).trim();
  if (label.length < 2 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u.test(label)) return 'Android phone';
  return label;
}

/** The phone's destination from the last registration (for offline rebuilds), or null. */
export function cachedPhone(): ReminderPhone | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(phoneKey) ?? 'null');
    if (typeof value !== 'object' || value === null) return null;
    const { id, enabled } = value as Record<string, unknown>;
    return typeof id === 'string' && typeof enabled === 'boolean' ? { id, enabled } : null;
  } catch {
    return null;
  }
}

/** Caches `destination` as this phone's ({@link cachedPhone}) and answers it as a {@link ReminderPhone}. */
export function rememberPhone(destination: ReminderDestination): ReminderPhone {
  const phone = { id: destination.id, enabled: destination.enabled };
  try {
    localStorage.setItem(phoneKey, JSON.stringify(phone));
  } catch {}
  return phone;
}

/** Forgets the cached destination (sign-out, session end, account deletion). */
export function forgetPhone(): void {
  localStorage.removeItem(phoneKey);
}
