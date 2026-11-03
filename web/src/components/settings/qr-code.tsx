import { useMemo } from 'react';
import { encode } from 'uqr';

/**
 * `value` as a QR code drawn with inline SVG elements (no data URI, no injected markup), always dark modules on a
 * light field so every scanner reads it. `label` is its accessible name.
 */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const qr = encode(value, { ecc: 'M', border: 2 });
    let d = '';
    qr.data.forEach((row, y) =>
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      }),
    );
    return { size: qr.size, path: d };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className="size-[200px] rounded-md bg-card fill-card-foreground dark:bg-card-foreground dark:fill-card"
    >
      <title>{label}</title>
      <path d={path} />
    </svg>
  );
}
