# Ember design tokens v1

Shared interface between the React web app (team `react`, consumer) and the design directions (team `design`, producer). Changes go only through the department lead.

## How a theme plugs in

- A theme is one CSS file, `web/src/themes/<id>.css`, that sets every token below on `:root` (light) and on `:root.dark` (dark), and nothing else: no component selectors, no layout.
- Fonts: self-hosted only (the CSP is `default-src 'self'`), OFL or similarly permissive. A theme names its font packages in `design/README.md`; team `design` never edits `web/package.json` (its storyboard uses `design/package.json`). The department lead adds the picked theme's font package to `web/package.json` and `web/src/themes/index.ts` at pick time.
- The app loads exactly one theme through `web/src/themes/index.css` (one `@import`) and `web/src/themes/index.ts` (font imports, may be empty).
- Dark mode: `.dark` on `<html>`, set from `prefers-color-scheme` by an external script (no inline script), with a manual override later.
- Ownership: team `react` owns `web/src/themes/index.css`, `index.ts`, `hearth.css` (the current Angular palette, ported as the working default) and the Tailwind mapping (`@theme inline` that registers each token below as a `--color-*`, `--radius-*`, `--font-*`, `--ease-*` utility; it lives outside `web/src/themes/`). Team `design` owns every other file in `web/src/themes/` and everything under `design/`.
- Applying a pick also updates, outside CSS: `theme-color` metas in `index.html`, `theme_color`/`background_color` in the web manifest, Android status-bar and splash colors, and re-renders the flame icons if the flame colors change (department lead or team `react`).

## Color tokens

Any CSS color (`oklch()` preferred). "text" pairs need WCAG 2.x 4.5:1, "UI" pairs 3:1, in light and in dark. `design/contrast.mjs` (team `design`) computes every listed pair for every theme file, including `hearth.css`, and fails on any miss.

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
