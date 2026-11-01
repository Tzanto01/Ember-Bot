# Ember web

React 19, TypeScript, Vite, Tailwind CSS v4, TanStack Query, React Router, Capacitor 8 (Android in `../mobile/android`). Runtime and package manager: bun (`bun --bun run <script>`); the scripts also run on Node 22+.

| Task | Command (from `web/`) |
| --- | --- |
| Install | `bun install --frozen-lockfile` |
| Dev server on port 4200 (proxies `/api`, `/health`, `/test` to the API on 5081) | `bun --bun run dev` |
| Production build (PWA, output `dist/ember-web/browser`) | `bun --bun run build` |
| Mobile build (no service worker, settings in `.env.mobile`, output `dist/ember-mobile/browser`) | `bun --bun run build:mobile` |
| Sync the Android project | `bunx --bun cap sync android` |
| Unit tests (Vitest) | `bun --bun run test` |
| End-to-end tests (Playwright) | see `playwright.config.ts`: start `tests/Ember.Api.TestHost` on port 5081 with `--webroot web/dist/ember-web/browser`, then `E2E_BASE_URL=http://localhost:5081 bunx --bun playwright test` |

Design: `design/layout.md` (layout and screens), `docs/contracts/design-tokens-v1.md` (theme tokens), `src/themes/` (themes; `index.css` picks one). Parity with the former Angular app: `PARITY.md`.
