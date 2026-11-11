import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { env } from '@/lib/env';
import { renderPage } from '@/test-utils';
import DownloadPage from './download';

vi.mock('@/lib/env', async (original) => ({ env: { ...(await original<typeof import('@/lib/env')>()).env } }));

const androidPhone = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36';
const desktop = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36';

function visit(userAgent: string) {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(userAgent);
  renderPage('/download', DownloadPage, '/download');
}

const sections = () => screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);

describe('DownloadPage', () => {
  afterEach(() => {
    env.native = false;
    vi.restoreAllMocks();
  });

  it('offers the APK as a direct download and the Discord invite in a new tab', () => {
    visit(desktop);

    const apk = screen.getByRole('link', { name: 'Download for Android' });
    expect(apk).toHaveAttribute('href', '/download/ember-beta.apk');
    expect(apk).toHaveAttribute('download');
    const discord = screen.getByRole('link', { name: 'Add Ember to Discord (opens in a new tab)' });
    expect(discord).toHaveAttribute('target', '_blank');
    expect(discord.getAttribute('rel')).toContain('noopener');
  });

  it('puts the browser route first on a desktop', () => {
    visit(desktop);
    expect(sections()).toEqual(['iPhone and any other device', 'Android', 'Discord']);
  });

  it('puts the APK first in an Android browser', () => {
    visit(androidPhone);
    expect(sections()).toEqual(['Android', 'iPhone and any other device', 'Discord']);
  });

  it('hides the APK inside the Android app and keeps the rest', () => {
    env.native = true;
    visit(androidPhone);

    expect(screen.queryByRole('link', { name: 'Download for Android' })).toBeNull();
    expect(sections()).toEqual(['iPhone and any other device', 'Discord']);
  });
});
