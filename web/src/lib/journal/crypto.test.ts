import { describe, expect, it } from 'vitest';
import {
  decryptMood,
  decryptNote,
  encryptMood,
  encryptNote,
  importJournalKey,
  newJournalKeyBytes,
  newRecoveryCode,
  recoveryCodeBytes,
  unwrapWithPassphrase,
  unwrapWithRecovery,
  wrapWithPassphrase,
  wrapWithRecovery,
} from './crypto';
import { WrongSecretError } from './types';

const iterations = 1000;

describe('journal crypto', () => {
  it('unwraps the journal key with the passphrase and with the recovery code', async () => {
    const raw = newJournalKeyBytes();
    const { code, bytes } = await newRecoveryCode();
    const passphrasePart = await wrapWithPassphrase(raw, 'quiet harbour lantern', iterations);
    const recoveryPart = await wrapWithRecovery(raw, bytes);

    expect(passphrasePart.iterations).toBe(iterations);
    expect(await unwrapWithPassphrase(passphrasePart, 'quiet harbour lantern', iterations)).toEqual(
      raw,
    );
    expect(await unwrapWithRecovery(recoveryPart, await recoveryCodeBytes(code))).toEqual(raw);
  });

  it('rejects a wrong passphrase and a mistyped recovery code with WrongSecretError', async () => {
    const raw = newJournalKeyBytes();
    const { code, bytes } = await newRecoveryCode();
    const passphrasePart = await wrapWithPassphrase(raw, 'quiet harbour lantern', iterations);
    const recoveryPart = await wrapWithRecovery(raw, bytes);
    const typo = (code[0] === 'A' ? 'B' : 'A') + code.slice(1);

    await expect(
      unwrapWithPassphrase(passphrasePart, 'quiet harbour lanterns', iterations),
    ).rejects.toBeInstanceOf(WrongSecretError);
    await expect(recoveryCodeBytes(typo)).rejects.toBeInstanceOf(WrongSecretError);
    const other = await newRecoveryCode();
    await expect(unwrapWithRecovery(recoveryPart, other.bytes)).rejects.toBeInstanceOf(
      WrongSecretError,
    );
  });

  it('refuses a passphrase part whose iteration count was lowered below the minimum', async () => {
    const part = await wrapWithPassphrase(newJournalKeyBytes(), 'quiet harbour lantern', 10);

    await expect(
      unwrapWithPassphrase(part, 'quiet harbour lantern', iterations),
    ).rejects.toBeInstanceOf(WrongSecretError);
  });

  it('unlocks with the composed and the decomposed spelling of the same passphrase (NFC)', async () => {
    const raw = newJournalKeyBytes();
    const part = await wrapWithPassphrase(raw, 'café au lait', iterations);

    expect(await unwrapWithPassphrase(part, 'café au lait', iterations)).toEqual(raw);
  });

  it('shows the recovery code as 8 groups of 4 Crockford characters and reads it back loosely typed', async () => {
    let generated = await newRecoveryCode();
    for (let i = 0; i < 200 && !/[01]/.test(generated.code); i++)
      generated = await newRecoveryCode();
    const { code, bytes } = generated;

    expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){7}$/);
    expect(bytes).toHaveLength(16);
    const loose = code
      .toLowerCase()
      .replace(/-/g, ' ')
      .replace(/1/g, (_, i: number) => (i % 2 ? 'l' : 'I'))
      .replace(/0/g, 'o');
    expect(await recoveryCodeBytes(loose)).toEqual(bytes);
    expect(await recoveryCodeBytes(code.replace(/-/g, ''))).toEqual(bytes);
  });

  it('refuses to decrypt an entry moved to another day', async () => {
    const key = await importJournalKey(newJournalKeyBytes());
    const blob = await encryptNote(key, '2026-11-01', {
      text: 'Walked by the river.',
      mood: 'good',
    });

    expect(await decryptNote(key, '2026-11-01', blob)).toEqual({
      text: 'Walked by the river.',
      mood: 'good',
    });
    await expect(decryptNote(key, '2026-11-02', blob)).rejects.toThrow();
  });

  it('keeps entry and mood ciphertexts apart', async () => {
    const key = await importJournalKey(newJournalKeyBytes());
    const note = await encryptNote(key, '2026-11-01', { text: 'Tea', mood: null });
    const mood = await encryptMood(key, { label: 'Cosy', emoji: null });

    expect(await decryptMood(key, mood)).toEqual({ label: 'Cosy', emoji: null });
    await expect(decryptMood(key, note)).rejects.toThrow();
  });

  it('refuses a ciphertext over 16 KiB of base64', async () => {
    const key = await importJournalKey(newJournalKeyBytes());

    await expect(
      encryptNote(key, '2026-11-01', { text: 'x'.repeat(12_300), mood: null }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      encryptNote(key, '2026-11-01', { text: 'x'.repeat(12_000), mood: null }),
    ).resolves.toBeTruthy();
  });
});
