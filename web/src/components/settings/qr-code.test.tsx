import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QrCode } from './qr-code';

describe('QrCode', () => {
  it('keeps a four-module quiet zone so scanners read it on dark themes too', () => {
    render(<QrCode value="otpauth://totp/Ember:a%40example.test?secret=JBSWY3DPEHPK3PXP&issuer=Ember" label="QR code" />);
    const svg = screen.getByRole('img', { name: 'QR code' });
    const size = Number(svg.getAttribute('viewBox')?.split(' ')[2]);
    const modules = [...(svg.querySelector('path')?.getAttribute('d') ?? '').matchAll(/M(\d+) (\d+)/g)].map(
      ([, x, y]) => [Number(x), Number(y)],
    );
    expect(modules.length).toBeGreaterThan(0);
    const xs = modules.map(([x]) => x!);
    const ys = modules.map(([, y]) => y!);
    expect(Math.min(...xs, ...ys)).toBe(4);
    expect(Math.max(...xs, ...ys)).toBe(size - 5);
  });
});
