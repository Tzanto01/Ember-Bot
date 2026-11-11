import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { BetaBadge } from './beta-badge';

describe('BetaBadge', () => {
  afterEach(() => {
    env.apiBase = '';
    vi.unstubAllGlobals();
  });

  it('shows on the web beta host and stays hidden in dev and on other hosts', () => {
    vi.stubGlobal('location', { hostname: 'beta.ember-glow.app' });
    const { unmount } = render(<BetaBadge />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    unmount();

    vi.stubGlobal('location', { hostname: 'ember-glow.app' });
    const other = render(<BetaBadge />);
    expect(screen.queryByText('Beta')).toBeNull();
    other.unmount();

    vi.unstubAllGlobals();
    render(<BetaBadge />);
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('follows the API host in the app build, not the page host', () => {
    env.apiBase = 'https://beta.ember-glow.app';
    const { unmount } = render(<BetaBadge />);
    expect(screen.getByText('Beta')).toBeInTheDocument();
    unmount();

    env.apiBase = 'https://ember-glow.app';
    vi.stubGlobal('location', { hostname: 'beta.ember-glow.app' });
    render(<BetaBadge />);
    expect(screen.queryByText('Beta')).toBeNull();
  });
});
