import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { inGerman, renderPage } from '@/test-utils';
import AboutPage from './about';

describe('AboutPage', () => {
  it('explains Ember in English, links the product site in a new tab and gives the 112 line', () => {
    renderPage('/about', AboutPage, '/about');

    expect(screen.getByRole('heading', { level: 1, name: 'About Ember' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'When a moment gets too big' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your data' })).toBeInTheDocument();
    expect(screen.getByText(/In an emergency, call 112/)).toBeInTheDocument();
    const site = screen.getByRole('link', { name: /Visit the Ember website/ });
    expect(site).toHaveAttribute('href', 'https://ember.nicowoellnitz.de');
    expect(site).toHaveAttribute('target', '_blank');
    expect(site).toHaveAccessibleName(/Visit the Ember website.*opens in a new tab/);
  });

  it('reads in German with the same site link and the 112 line', async () => {
    await inGerman();
    renderPage('/about', AboutPage, '/about');

    expect(screen.getByRole('heading', { level: 1, name: 'Über Ember' })).toBeInTheDocument();
    expect(screen.getByText(/Im Notfall ruf die 112 an/)).toBeInTheDocument();
    const site = screen.getByRole('link', { name: /Zur Ember-Website/ });
    expect(site).toHaveAttribute('href', 'https://ember.nicowoellnitz.de');
    expect(screen.queryByText(/When a moment gets too big/)).toBeNull();
  });

  it('offers the moment door and a way back', async () => {
    const router = renderPage('/about', AboutPage, '/about');

    expect(screen.getByRole('link', { name: /need a moment/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('link', { name: 'Back to Ember' }));
    expect(router.state.location.pathname).toBe('/');
  });
});
