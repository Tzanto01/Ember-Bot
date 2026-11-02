# Ember design tokens v1.2

v1.2 (2026-11-02, Nico): the theme follows the account across devices (`Me.theme`, api-v1.md v1.4); `localStorage` keeps a per-device copy for first paint.

v1.1 (2026-11-01, Nico): all four directions ship as user-selectable themes; Hearthlight is the default. `hearth.css` is retired.

Shared interface between the React web app (team `react`) and the design directions (team `design`). Changes go only through the department lead.

## How a theme plugs in

- A theme is one CSS file, `web/src/themes/<id>.css`, that sets every token below on `:root[data-theme="<id>"]` (light) and `:root[data-theme="<id>"].dark` (dark), and nothing else: no component selectors, no layout. The same rules also match `[data-theme="<id>"]` and `.dark [data-theme="<id>"]` so a scoped element (the Appearance previews) can show another theme, and Hearthlight also matches `:root:not([data-theme])` as the fallback if `/theme-init.js` fails. Ids: `hearthlight` (default), `fieldnotes`, `tidepool`, `marigold`.
- The app imports all theme files and all their font packages (self-hosted, OFL; the CSP is `default-src 'self'`). Browsers download a font file only when a page uses that family; the service worker precaches only the default theme's font files, the others are cached on first use.
- The selected theme is an account setting (`Me.theme`, api-v1.md v1.4) with a per-device copy in `localStorage` under `ember.theme` (the Capacitor WebView keeps it) for first paint and signed-out pages. When `/api/me` loads, a non-null `theme` that differs from the copy is applied and stored; null leaves the device as it is. Choosing a theme in Settings applies it instantly, stores the copy and, when signed in, sends `PATCH /api/me { theme }` (a failure keeps the local choice and shows a gentle notice). The external `/theme-init.js` sets `data-theme` (an unknown or missing value falls back to `hearthlight`) and `.dark` on `<html>` before first paint; no inline script.
- Settings has an Appearance section: a radio group of the four themes, each with a small live preview (the theme's own tokens) and its name, applied instantly. It also updates `<meta name="theme-color">` at runtime.
- Dark mode: `.dark` from `prefers-color-scheme`, with a manual override later.
- Static colors that can't follow the theme use Hearthlight: the web manifest `theme_color`/`background_color`, the Android status bar and splash, and the app icons (flame from Hearthlight's `--flame`/`--flame-core`).
- Ownership: team `react` owns `web/src/themes/**` (including the four theme files, for the selector change) and the Tailwind mapping. Team `design` owns `design/**`; `design/contrast.mjs` checks every theme file in `web/src/themes/`.

## Color tokens

Any CSS color (`oklch()` preferred). "text" pairs need WCAG 2.x 4.5:1, "UI" pairs 3:1, in light and in dark. `design/contrast.mjs` (team `design`) computes every listed pair for every theme file and fails on any miss.

| Token | Pairs that must pass |
| --- | --- |
| `--background` / `--foreground` | text: foreground on background |
| `--card` / `--card-foreground` | text: card-foreground on card |
| `--popover` / `--popover-foreground` | text |
| `--primary` / `--primary-foreground` | text: primary-foreground on primary; text: primary on background and on card (links) |
| `--secondary` / `--secondary-foreground` | text |
| `--muted` / `--muted-foreground` | text: muted-foreground on background, card, muted, accent, secondary |
| `--accent` / `--accent-foreground` | text |
| `--border` | decorative only, no pair |
| `--input` | UI: on background and on card |
| `--ring` | UI: on background and on card |
| `--destructive` / `--destructive-foreground` | Never red or pink: the honey/notice family. text: destructive on background and card (shadcn uses it for text and borders); text: destructive-foreground on destructive |
| `--notice` / `--notice-foreground` / `--notice-border` | text: notice-foreground on notice; UI: notice-border on notice |
| `--success` / `--success-foreground` | text: success-foreground on success; UI: success on background |
| `--done` / `--done-foreground` | text: done-foreground on done; UI: done on card |
| `--lowday` / `--lowday-foreground` | text: lowday-foreground on lowday |
| `--paused` | UI: on card |
| `--pending` | UI: on card |
| `--empty` | UI: on card. Never a "missed" color |
| `--beforestart` | text: on card (a muted date number) |
| `--flame` / `--flame-core` | decorative |
| `--chart-1` … `--chart-3` | UI: on card |

## Shape, type and motion tokens

| Token | Meaning |
| --- | --- |
| `--radius` | Base radius; components derive sm/md/lg |
| `--cell-radius` | Day cells and check buttons (0 = square, 9999px = round) |
| `--border-width` | Card and input border width (0 allowed when `--shadow-card` carries the edge) |
| `--shadow-card` | Card elevation (may be `none`) |
| `--space-unit` | Density base (the app's spacing scale multiplies it; 4px is the Hearth value) |
| `--ember-font-sans` / `--ember-font-display` | Body and heading stacks, system fallbacks last |
| `--ember-heading-weight` / `--ember-heading-tracking` | Heading character |
| `--ember-dur-fast` / `--ember-dur` / `--ember-dur-slow` / `--ember-ease` | Motion; all motion is off under `prefers-reduced-motion: reduce` |
| `--ember-reward` | Check-in reward style, one keyword the app reads: `glow`, `fill`, `rise` or `none` |

## Fixed by the app, not by themes

Layout and information architecture (designed once by team `design` in `design/layout.md` and the storyboard, built by team `react`), copy, icon set, sizes (body and inputs at least 16 px, targets at least 44 px).

## Product rules every theme keeps

From `docs/v2-plan.md` "Product principles": no red anywhere, no "missed" color or counter, never shaming. Low days and paused days read as rest, not failure.
