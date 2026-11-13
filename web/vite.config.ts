/// <reference types="vitest/config" />
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

const apiHost = 'http://localhost:5081';

/**
 * Web build only: `robots.txt` (sitemap line only with an origin), and with `origin` (`VITE_PUBLIC_ORIGIN`) a one-URL
 * `sitemap.xml`, `<link rel="canonical">`, `og:url` and absolute social image URLs. Without an origin those are left
 * out, since sitemaps, canonical links and `og:url` need absolute URLs.
 */
function publicOrigin(origin: string): Plugin {
  return {
    name: 'ember-public-origin',
    transformIndexHtml: (html) =>
      origin
        ? {
            html: html.replaceAll('content="/og/', `content="${origin}/og/`),
            tags: [
              { tag: 'link', attrs: { rel: 'canonical', href: `${origin}/` }, injectTo: 'head' },
              { tag: 'meta', attrs: { property: 'og:url', content: `${origin}/` }, injectTo: 'head' },
            ],
          }
        : html,
    generateBundle() {
      const sitemap = origin ? `\nSitemap: ${origin}/sitemap.xml\n` : '';
      this.emitFile({ type: 'asset', fileName: 'robots.txt', source: `User-agent: *\nAllow: /\nDisallow: /api/\n${sitemap}` });
      if (!origin) return;
      this.emitFile({
        type: 'asset',
        fileName: 'sitemap.xml',
        source: `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n  <url><loc>${origin}/</loc></url>\n</urlset>\n`,
      });
    },
  };
}

/**
 * Web build (`vite build`): PWA with the custom service worker in `src/sw.ts`, output `dist/ember-web/browser`.
 * Mobile build (`vite build --mode mobile`, settings in `.env.mobile`): no service worker (the PWA plugin is
 * disabled, so `virtual:pwa-register` resolves to a no-op), output
 * `dist/ember-mobile/browser` for Capacitor, with a CSP meta tag mirroring the API's header (the WebView serves the
 * bundle without one).
 * Web build: `VITE_PUBLIC_ORIGIN` (for example `https://ember-glow.app`) sets the canonical and sitemap host.
 */
export default defineConfig(({ mode }) => {
  const mobile = mode === 'mobile';
  const root = fileURLToPath(new URL('.', import.meta.url));
  const vars = loadEnv(mode, root);
  const origin = vars['VITE_PUBLIC_ORIGIN'] ? new URL(vars['VITE_PUBLIC_ORIGIN']).origin : '';
  if (mobile && !(vars['VITE_API_BASE'] && vars['VITE_WEB_ORIGIN'])) {
    throw new Error('The mobile build needs VITE_API_BASE and VITE_WEB_ORIGIN (see .env.mobile).');
  }
  return {
    plugins: [
      react(),
      tailwindcss(),
      mobile && {
        name: 'ember-mobile-csp',
        transformIndexHtml: () => [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content: `default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self' ${new URL(vars['VITE_API_BASE']!).origin}`,
            },
            injectTo: 'head-prepend',
          },
        ],
      },
      !mobile && publicOrigin(origin),
      VitePWA({
        disable: mobile,
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        injectRegister: false,
        manifest: false,
        injectManifest: {
          globPatterns: [
            '**/*.{js,css,html,svg,png,webmanifest}',
            'assets/nunito-*.woff2',
            'assets/*-latin-wght-normal-*.woff2',
            'legal/*.md',
            'release-notes.json',
          ],
          globIgnores: ['og/**'],
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
