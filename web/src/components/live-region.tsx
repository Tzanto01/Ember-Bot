/**
 * Visually hidden polite live region. Keep it mounted and change `message` to announce;
 * to repeat the same text, set it to '' first.
 */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p className="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </p>
  );
}
