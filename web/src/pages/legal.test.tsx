import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test-utils';
import LegalPage from './legal';

function serve(markdown: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(markdown, { status: 200, headers: { 'Content-Type': 'text/markdown' } })),
  );
}

describe('LegalPage', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('renders raw HTML from the markdown as text, never as elements', async () => {
    serve(
      [
        '# Datenschutzerklärung',
        '',
        '<script>window.injected = true</script>',
        '',
        'Hallo <img src="x" onerror="window.injected = true"> Welt',
      ].join('\n'),
    );
    renderPage('/legal/privacy', () => <LegalPage doc="privacy" />, '/legal/privacy');

    expect(await screen.findByRole('heading', { level: 1, name: 'Datenschutzerklärung' })).toBeInTheDocument();
    expect(document.querySelector('#main script, #main img')).toBeNull();
    expect(screen.getByText(/<img src="x" onerror=/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/legal/datenschutzerklaerung.md');
  });

  it('renders a javascript: link as plain text, and keeps https and mailto links', async () => {
    serve(
      [
        '# Impressum',
        '',
        '[Klick](javascript:alert(1)) [Discord](https://discord.com/privacy) [Mail](mailto:hallo@example.test)',
      ].join('\n'),
    );
    renderPage('/legal/imprint', () => <LegalPage doc="imprint" />, '/legal/imprint');

    expect(await screen.findByRole('link', { name: 'Discord' })).toHaveAttribute('href', 'https://discord.com/privacy');
    expect(screen.getByRole('link', { name: 'Mail' })).toHaveAttribute('href', 'mailto:hallo@example.test');
    expect(screen.getByText(/Klick/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Klick' })).toBeNull();
  });
});
