/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const apiHost = 'http://localhost:5081';

/**
 * Web build (`vite build`): PWA with the custom service worker in `src/sw.ts`, output `dist/ember-web/browser`.
 * Mobile build (`vite build --mode mobile`, settings in `.env.mobile`): no service worker (the PWA plugin is
 * disabled, so `virtual:pwa-register` resolves to a no-op), output
 * `dist/ember-mobile/browser` for Capacitor.
 */
export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile';
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        disable: mobile,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: false,
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest,woff2}', 'legal/*.md'],
        },
        devOptions: { enabled: false },
      }),
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    build: {
      outDir: mobile ? 'dist/ember-mobile/browser' : 'dist/ember-web/browser',
      emptyOutDir: true,
      assetsInlineLimit: 0,
    },
    server: {
      port: 4200,
      strictPort: true,
      proxy: { '/api': apiHost, '/health': apiHost, '/test': apiHost },
    },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}'],
      setupFiles: ['src/test-setup.ts'],
      restoreMocks: true,
    },
  };
});
