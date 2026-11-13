import type { EncryptedBlob, JournalKey, LocalDateString, MoodKey } from '../models';
import { WrongSecretError } from './types';
import { t } from '../i18n';

/** Contract "Crypto details": PBKDF2-SHA256 iterations for new passphrase wraps. */
export const passphraseIterations = 600_000;
/** Largest `ct` the API takes: 16 KiB of base64. */
export const maxCiphertextLength = 16 * 1024;

const recoveryInfo = 'ember-journal-recovery-v1';
const moodAad = 'ember-mood:v1';
const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const maxIterations = 10_000_000;

type Bytes = Uint8Array<ArrayBuffer>;

const utf8 = (text: string): Bytes => new TextEncoder().encode(text);
const noteAad = (date: LocalDateString): Bytes => utf8(`ember-day-note:v1:${date}`);

function random(length: number): Bytes {
  return crypto.getRandomValues(new Uint8Array(length));
}

/** Standard base64 of `bytes`. */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Bytes of standard base64 `text`; throws on anything that isn't base64. */
export function fromBase64(text: string): Bytes {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function fromBase64Sized(text: unknown, length: number): Bytes {
  if (typeof text !== 'string') throw new WrongSecretError();
  let bytes: Bytes;
  try {
    bytes = fromBase64(text);
  } catch {
    throw new WrongSecretError();
  }
  if (bytes.length !== length) throw new WrongSecretError();
  return bytes;
}

/** A fresh random 32-byte journal key. The caller wipes it (`fill(0)`) once wrapped and imported. */
export function newJournalKeyBytes(): Bytes {
  return random(32);
}

/** Imports raw journal key bytes as a non-extractable AES-GCM key. */
export function importJournalKey(raw: Bytes): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function passphraseKey(passphrase: string, salt: Bytes, iterations: number): Promise<CryptoKey> {
  return crypto.subtle
    .importKey('raw', utf8(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      ),
    );
}

function recoveryKey(code: Bytes, salt: Bytes): Promise<CryptoKey> {
  return crypto.subtle
    .importKey('raw', code, 'HKDF', false, ['deriveKey'])
    .then((base) =>
      crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt, info: utf8(recoveryInfo) },
        base,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      ),
    );
}

async function wrap(raw: Bytes, wrapping: CryptoKey): Promise<{ iv: string; wrapped: string }> {
  const iv = random(12);
  const wrapped = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrapping, raw),
  );
  return { iv: toBase64(iv), wrapped: toBase64(wrapped) };
}

async function unwrap(
  part: { iv: unknown; wrapped: unknown },
  wrapping: CryptoKey,
): Promise<Bytes> {
  const iv = fromBase64Sized(part.iv, 12);
  const wrapped = fromBase64Sized(part.wrapped, 48);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, wrapping, wrapped));
  } catch {
    throw new WrongSecretError();
  }
}

/** The passphrase part of a journal key: PBKDF2-SHA256 over the NFC-normalized passphrase, fresh salt and IV. */
export async function wrapWithPassphrase(
  raw: Bytes,
  passphrase: string,
  iterations = passphraseIterations,
): Promise<JournalKey['passphrase']> {
  const salt = random(16);
  return {
    salt: toBase64(salt),
    iterations,
    ...(await wrap(raw, await passphraseKey(passphrase, salt, iterations))),
  };
}

/**
 * The raw journal key from its passphrase part. Rejects with `WrongSecretError` for a wrong passphrase, malformed
 * fields, or an iteration count below `minIterations` (so a server can't weaken new unlocks) or absurdly high.
 */
export async function unwrapWithPassphrase(
  part: JournalKey['passphrase'],
  passphrase: string,
  minIterations = passphraseIterations,
): Promise<Bytes> {
  const { iterations } = part;
  if (
    !Number.isSafeInteger(iterations) ||
    iterations < minIterations ||
    iterations > maxIterations
  ) {
    throw new WrongSecretError();
  }
  const salt = fromBase64Sized(part.salt, 16);
  return unwrap(part, await passphraseKey(passphrase, salt, iterations));
}

/** The recovery part of a journal key: HKDF-SHA256 over the 16 recovery code bytes, fresh salt and IV. */
export async function wrapWithRecovery(raw: Bytes, code: Bytes): Promise<JournalKey['recovery']> {
  const salt = random(16);
  return { salt: toBase64(salt), ...(await wrap(raw, await recoveryKey(code, salt))) };
}

/** The raw journal key from its recovery part. Rejects with `WrongSecretError`. */
export async function unwrapWithRecovery(
  part: JournalKey['recovery'],
  code: Bytes,
): Promise<Bytes> {
  const salt = fromBase64Sized(part.salt, 16);
  return unwrap(part, await recoveryKey(code, salt));
}

async function checksum(bytes: Bytes): Promise<Bytes> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)).slice(0, 4);
}

/**
 * A new recovery code: 16 random bytes, shown as 8 groups of 4 Crockford base32 characters joined by dashes.
 *
 * Layout: the 32 characters are the big-endian base32 of 20 bytes (160 bits): the 16 secret bytes followed by the
 * first 4 bytes of their SHA-256, a checksum that catches typos. Only the 16 secret bytes go into HKDF.
 */
export async function newRecoveryCode(): Promise<{ code: string; bytes: Bytes }> {
  const bytes = random(16);
  const all = new Uint8Array(20);
  all.set(bytes);
  all.set(await checksum(bytes), 16);
  let bits = 0n;
  for (const byte of all) bits = (bits << 8n) | BigInt(byte);
  let chars = '';
  for (let i = 31; i >= 0; i--) chars += crockford[Number((bits >> BigInt(i * 5)) & 31n)];
  return { code: chars.match(/.{4}/g)!.join('-'), bytes };
}

/**
 * The 16 secret bytes of a typed recovery code (see {@link newRecoveryCode}). Normalizes it first: uppercase, spaces
 * and dashes removed, `I`/`L` read as `1`, `O` as `0`. Rejects with `WrongSecretError` when it isn't 32 base32
 * characters or the checksum doesn't match.
 */
export async function recoveryCodeBytes(code: string): Promise<Bytes> {
  const chars = code.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
  if (chars.length !== 32) throw new WrongSecretError();
  let bits = 0n;
  for (const char of chars) {
    const value = crockford.indexOf(char);
    if (value < 0) throw new WrongSecretError();
    bits = (bits << 5n) | BigInt(value);
  }
  const all = new Uint8Array(20);
  for (let i = 19; i >= 0; i--) {
    all[i] = Number(bits & 255n);
    bits >>= 8n;
  }
  const bytes = all.slice(0, 16);
  const expected = await checksum(bytes);
  if (expected.some((byte, i) => byte !== all[16 + i])) throw new WrongSecretError();
  return bytes;
}

async function seal(key: CryptoKey, payload: unknown, aad: Bytes): Promise<EncryptedBlob> {
  const iv = random(12);
  const ct = toBase64(
    new Uint8Array(
      await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: aad },
        key,
        utf8(JSON.stringify(payload)),
      ),
    ),
  );
  if (ct.length > maxCiphertextLength) throw new RangeError(t('journal.error.cipherTooLong'));
  return { v: 1, iv: toBase64(iv), ct };
}

async function open(
  key: CryptoKey,
  blob: EncryptedBlob,
  aad: Bytes,
): Promise<Record<string, unknown>> {
  if (blob.v !== 1) throw new Error('Unknown ciphertext version.');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(blob.iv), additionalData: aad },
    key,
    fromBase64(blob.ct),
  );
  const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain));
  if (!value || typeof value !== 'object') throw new Error('Unexpected payload.');
  return value as Record<string, unknown>;
}

const stringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

/** Encrypts a day's entry; the AAD binds it to `date`. Throws `RangeError` when `ct` would exceed 16 KiB. */
export function encryptNote(
  key: CryptoKey,
  date: LocalDateString,
  note: { text: string | null; mood: MoodKey | null },
): Promise<EncryptedBlob> {
  return seal(key, { text: note.text, mood: note.mood }, noteAad(date));
}

/** Decrypts a day's entry stored for `date`. Rejects when it was sealed for another day, key or kind. */
export async function decryptNote(
  key: CryptoKey,
  date: LocalDateString,
  blob: EncryptedBlob,
): Promise<{ text: string | null; mood: MoodKey | null }> {
  const { text, mood } = await open(key, blob, noteAad(date));
  if (!stringOrNull(text) || !stringOrNull(mood)) throw new Error('Unexpected payload.');
  return { text, mood: mood as MoodKey | null };
}

/** Encrypts an own mood's label and emoji. Throws `RangeError` when `ct` would exceed 16 KiB. */
export function encryptMood(
  key: CryptoKey,
  mood: { label: string; emoji: string | null },
): Promise<EncryptedBlob> {
  return seal(key, { label: mood.label, emoji: mood.emoji }, utf8(moodAad));
}

/** Decrypts an own mood. Rejects for another key or an entry blob. */
export async function decryptMood(
  key: CryptoKey,
  blob: EncryptedBlob,
): Promise<{ label: string; emoji: string | null }> {
  const { label, emoji } = await open(key, blob, utf8(moodAad));
  if (typeof label !== 'string' || !stringOrNull(emoji)) throw new Error('Unexpected payload.');
  return { label, emoji };
}
