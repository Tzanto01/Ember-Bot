import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import i18n from '@/lib/i18n';

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage('en');
  localStorage.removeItem('ember.language');
  document.documentElement.lang = '';
});

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
