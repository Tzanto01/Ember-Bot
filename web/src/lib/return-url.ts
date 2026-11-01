/**
 * Returns `value` when it is a local path (a single leading `/`, not `//` or `/\`), else `fallback`.
 * Use for every `returnUrl` read from the address bar.
 */
export function safeReturnUrl(value: string | null | undefined, fallback = '/today'): string {
  if (
    !value ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.startsWith('/\\') ||
    /[\s\u0000-\u001f\u007f]/.test(value)
  ) {
    return fallback;
  }
  return value;
}
