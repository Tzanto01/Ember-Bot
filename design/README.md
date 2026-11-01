# Ember design directions

Four drop-in themes for the React web app, plus the shared layout they all use. Nothing here is picked yet.

| File | What it is |
| --- | --- |
| `layout.md` | Layout and information architecture for every screen (team `react` builds this once) |
| `references.md` | Reference dossier (free sources, license notes) |
| `../web/src/themes/{hearthlight,fieldnotes,tidepool,marigold}.css` | One theme per direction, every token from `docs/contracts/design-tokens-v1.md` |
| `contrast.mjs` | Checks every theme in `web/src/themes/` (Hearth too): required tokens, every contrast pair in light and dark, reward keyword, no red or pink |
| `storyboard/index.html` | Self-contained storyboard, generated from the theme files by `storyboard/build.mjs` |
| `storyboard/shots/*.png` | Headless exports, one per direction and screen (360 px and desktop, light and dark) |

## Directions

| Direction | Feel | Edges and depth | Day cells | Density | Reward | Fonts |
| --- | --- | --- | --- | --- | --- | --- |
| Hearthlight (Hearth evolved) | Candle-lit kitchen table: warm, soft, familiar | no border, soft shadow, 16px radius | round | 4px | `glow`, 420 ms | Nunito |
| Fieldnotes | Pocket notebook: grounded, quiet, literary | 1px hairline, no shadow, 6px radius | square (3px) | 4px | `fill`, 440 ms | Fraunces + Atkinson Hyperlegible Next |
| Tidepool | Morning by the water: cool, airy, unhurried | 1px, faint shadow, 18px radius | squircle (14px) | 5px | `rise`, 480 ms | Lexend |
| Marigold | Sticker sheet: playful, confident, high contrast | 2px ink border, hard offset shadow, 12px radius | 6px corners | 4px | `fill`, 300 ms | Bricolage Grotesque + Figtree |

Neutral comparison (no recommendation):

| | Hearthlight | Fieldnotes | Tidepool | Marigold |
| --- | --- | --- | --- | --- |
| Closest to today's app | yes | no | no | no |
| Stimulation level | low-medium | lowest | low | highest |
| Brand warmth ("ember") | strongest | medium | weakest (flame is the only warm spot) | medium |
| States readable at a glance | good | good | good | strongest (ink outlines) |
| Font weight to ship (Latin) | 38 KB | 69 KB | 39 KB | 60 KB |
| Main risk | least new | journal more than app | cool, more scrolling | busy for sensory-sensitive users |

The full annotations (mood, palette, type, motion, what it optimizes for, risks, token-driven differences) are in the storyboard.

## Fonts

All SIL OFL 1.1, self-hosted from Fontsource (CSP `default-src 'self'` holds), Latin subset in the storyboard. At pick time the department lead adds the package(s) to `web/package.json` and the import line(s) to `web/src/themes/index.ts`.

| Theme | Package (version used here) | Import for `web/src/themes/index.ts` |
| --- | --- | --- |
| hearthlight | `@fontsource-variable/nunito` 5.3.0 | `import '@fontsource-variable/nunito/wght.css';` |
| fieldnotes | `@fontsource-variable/fraunces` 5.3.0, `@fontsource-variable/atkinson-hyperlegible-next` 5.3.0 | `import '@fontsource-variable/fraunces/wght.css';` and `import '@fontsource-variable/atkinson-hyperlegible-next/wght.css';` |
| tidepool | `@fontsource-variable/lexend` 5.3.0 | `import '@fontsource-variable/lexend/wght.css';` |
| marigold | `@fontsource-variable/bricolage-grotesque` 5.3.0, `@fontsource-variable/figtree` 5.3.0 | `import '@fontsource-variable/bricolage-grotesque/wght.css';` and `import '@fontsource-variable/figtree/wght.css';` |

The theme files name the families as Fontsource registers them (`'Nunito Variable'`, …) with system fallbacks last, so a theme still renders before its font package is added.

## Applying a pick (department lead)

1. `web/src/themes/index.css`: `@import './<id>.css';`. `web/src/themes/index.ts`: the font import(s) above.
2. Outside CSS (contract "How a theme plugs in"): `theme-color` metas, manifest `theme_color` / `background_color`, Android status bar and splash. Use the theme's `--background` (light and dark). Flame colours change in every direction, so re-render the flame icons from `--flame` / `--flame-core`.

## Run

```sh
cd design
bun install
node contrast.mjs            # add --readme to refresh the table below; extra CSS paths may be passed
bun storyboard/build.mjs     # writes storyboard/index.html (fails above 4 MB)
bun storyboard/shots.mjs     # needs Node 20+ or bun, and a cached Playwright Chromium (no download)
```

## Contrast

Every pair from the contract, light and dark. Hearth (`hearth.css`, team `react`) was checked from its branch with `node contrast.mjs <path>/hearth.css`; once merged it is picked up automatically.

<!-- contrast:start -->
| Theme | Pairs | Light min | Dark min | Result |
| --- | --- | --- | --- | --- |
| fieldnotes | 34 × 2 | 1.14× | 1.19× | pass |
| hearth | 34 × 2 | 1.11× | 1.32× | pass |
| hearthlight | 34 × 2 | 1.07× | 1.18× | pass |
| marigold | 34 × 2 | 1.27× | 1.31× | pass |
| tidepool | 34 × 2 | 1.16× | 1.18× | pass |

"min" is the smallest ratio divided by its required minimum (1.00× = exactly at the bar).

### fieldnotes

| Pair | Kind | Light | Dark |
| --- | --- | --- | --- |
| foreground on background | text 4.5:1 | 14.37 | 14.53 |
| card-foreground on card | text 4.5:1 | 15.32 | 12.96 |
| popover-foreground on popover | text 4.5:1 | 15.32 | 12.20 |
| primary-foreground on primary | text 4.5:1 | 7.51 | 10.62 |
| primary on background | text 4.5:1 | 7.05 | 10.51 |
| primary on card | text 4.5:1 | 7.51 | 9.37 |
| secondary-foreground on secondary | text 4.5:1 | 11.98 | 10.98 |
| muted-foreground on background | text 4.5:1 | 6.67 | 8.33 |
| muted-foreground on card | text 4.5:1 | 7.11 | 7.43 |
| muted-foreground on muted | text 4.5:1 | 6.13 | 6.66 |
| muted-foreground on accent | text 4.5:1 | 5.98 | 6.29 |
| muted-foreground on secondary | text 4.5:1 | 5.98 | 6.29 |
| accent-foreground on accent | text 4.5:1 | 12.88 | 10.98 |
| input on background | ui 3:1 | 4.17 | 4.55 |
| input on card | ui 3:1 | 4.45 | 4.06 |
| ring on background | ui 3:1 | 6.72 | 8.97 |
| ring on card | ui 3:1 | 7.16 | 8.00 |
| destructive on background | text 4.5:1 | 6.55 | 10.49 |
| destructive on card | text 4.5:1 | 6.99 | 9.35 |
| destructive-foreground on destructive | text 4.5:1 | 6.99 | 10.60 |
| notice-foreground on notice | text 4.5:1 | 7.69 | 9.20 |
| notice-border on notice | ui 3:1 | 3.41 | 3.56 |
| success-foreground on success | text 4.5:1 | 6.88 | 9.30 |
| success on background | ui 3:1 | 6.45 | 9.20 |
| done-foreground on done | text 4.5:1 | 5.61 | 8.10 |
| done on card | ui 3:1 | 5.53 | 7.15 |
| lowday-foreground on lowday | text 4.5:1 | 6.78 | 7.84 |
| paused on card | ui 3:1 | 4.10 | 4.04 |
| pending on card | ui 3:1 | 7.16 | 8.00 |
| empty on card | ui 3:1 | 3.77 | 4.06 |
| beforestart on card | text 4.5:1 | 5.74 | 5.55 |
| chart-1 on card | ui 3:1 | 5.53 | 7.15 |
| chart-2 on card | ui 3:1 | 5.71 | 7.21 |
| chart-3 on card | ui 3:1 | 4.20 | 8.44 |

### hearth

| Pair | Kind | Light | Dark |
| --- | --- | --- | --- |
| foreground on background | text 4.5:1 | 14.76 | 15.34 |
| card-foreground on card | text 4.5:1 | 15.76 | 14.07 |
| popover-foreground on popover | text 4.5:1 | 15.76 | 14.07 |
| primary-foreground on primary | text 4.5:1 | 6.22 | 8.95 |
| primary on background | text 4.5:1 | 5.83 | 8.95 |
| primary on card | text 4.5:1 | 6.22 | 8.20 |
| secondary-foreground on secondary | text 4.5:1 | 13.56 | 12.57 |
| muted-foreground on background | text 4.5:1 | 6.49 | 8.05 |
| muted-foreground on card | text 4.5:1 | 6.92 | 7.38 |
| muted-foreground on muted | text 4.5:1 | 5.96 | 6.60 |
| muted-foreground on accent | text 4.5:1 | 5.96 | 6.60 |
| muted-foreground on secondary | text 4.5:1 | 5.96 | 6.60 |
| accent-foreground on accent | text 4.5:1 | 13.56 | 12.57 |
| input on background | ui 3:1 | 3.96 | 4.41 |
| input on card | ui 3:1 | 4.23 | 4.04 |
| ring on background | ui 3:1 | 5.83 | 8.95 |
| ring on card | ui 3:1 | 6.22 | 8.20 |
| destructive on background | text 4.5:1 | 7.35 | 11.19 |
| destructive on card | text 4.5:1 | 7.84 | 10.26 |
| destructive-foreground on destructive | text 4.5:1 | 7.84 | 11.19 |
| notice-foreground on notice | text 4.5:1 | 6.81 | 8.80 |
| notice-border on notice | ui 3:1 | 3.33 | 4.37 |
| success-foreground on success | text 4.5:1 | 6.15 | 8.96 |
| success on background | ui 3:1 | 5.76 | 8.96 |
| done-foreground on done | text 4.5:1 | 5.17 | 6.79 |
| done on card | ui 3:1 | 5.17 | 6.22 |
| lowday-foreground on lowday | text 4.5:1 | 5.30 | 5.99 |
| paused on card | ui 3:1 | 4.23 | 4.04 |
| pending on card | ui 3:1 | 6.22 | 8.20 |
| empty on card | ui 3:1 | 4.23 | 4.04 |
| beforestart on card | text 4.5:1 | 6.03 | 5.94 |
| chart-1 on card | ui 3:1 | 6.22 | 8.20 |
| chart-2 on card | ui 3:1 | 6.31 | 7.13 |
| chart-3 on card | ui 3:1 | 6.15 | 8.22 |

### hearthlight

| Pair | Kind | Light | Dark |
| --- | --- | --- | --- |
| foreground on background | text 4.5:1 | 14.61 | 15.21 |
| card-foreground on card | text 4.5:1 | 15.53 | 13.47 |
| popover-foreground on popover | text 4.5:1 | 15.53 | 12.69 |
| primary-foreground on primary | text 4.5:1 | 6.07 | 9.51 |
| primary on background | text 4.5:1 | 5.75 | 9.51 |
| primary on card | text 4.5:1 | 6.12 | 8.42 |
| secondary-foreground on secondary | text 4.5:1 | 11.34 | 11.12 |
| muted-foreground on background | text 4.5:1 | 6.63 | 8.72 |
| muted-foreground on card | text 4.5:1 | 7.05 | 7.72 |
| muted-foreground on muted | text 4.5:1 | 6.11 | 6.82 |
| muted-foreground on accent | text 4.5:1 | 5.92 | 6.38 |
| muted-foreground on secondary | text 4.5:1 | 5.92 | 6.38 |
| accent-foreground on accent | text 4.5:1 | 13.05 | 11.12 |
| input on background | ui 3:1 | 3.67 | 4.56 |
| input on card | ui 3:1 | 3.91 | 4.04 |
| ring on background | ui 3:1 | 5.75 | 9.51 |
| ring on card | ui 3:1 | 6.12 | 8.42 |
| destructive on background | text 4.5:1 | 6.76 | 10.65 |
| destructive on card | text 4.5:1 | 7.19 | 9.43 |
| destructive-foreground on destructive | text 4.5:1 | 7.13 | 10.65 |
| notice-foreground on notice | text 4.5:1 | 7.50 | 9.22 |
| notice-border on notice | ui 3:1 | 3.47 | 3.55 |
| success-foreground on success | text 4.5:1 | 6.13 | 9.37 |
| success on background | ui 3:1 | 5.82 | 9.37 |
| done-foreground on done | text 4.5:1 | 4.80 | 7.62 |
| done on card | ui 3:1 | 4.77 | 6.75 |
| lowday-foreground on lowday | text 4.5:1 | 6.48 | 7.51 |
| paused on card | ui 3:1 | 3.90 | 4.04 |
| pending on card | ui 3:1 | 4.77 | 8.42 |
| empty on card | ui 3:1 | 3.32 | 4.04 |
| beforestart on card | text 4.5:1 | 5.92 | 5.99 |
| chart-1 on card | ui 3:1 | 4.77 | 6.75 |
| chart-2 on card | ui 3:1 | 4.91 | 7.08 |
| chart-3 on card | ui 3:1 | 4.57 | 7.47 |

### marigold

| Pair | Kind | Light | Dark |
| --- | --- | --- | --- |
| foreground on background | text 4.5:1 | 16.03 | 16.01 |
| card-foreground on card | text 4.5:1 | 17.09 | 14.28 |
| popover-foreground on popover | text 4.5:1 | 17.09 | 13.49 |
| primary-foreground on primary | text 4.5:1 | 14.32 | 11.62 |
| primary on background | text 4.5:1 | 14.82 | 11.62 |
| primary on card | text 4.5:1 | 15.80 | 10.36 |
| secondary-foreground on secondary | text 4.5:1 | 11.67 | 10.23 |
| muted-foreground on background | text 4.5:1 | 7.86 | 9.25 |
| muted-foreground on card | text 4.5:1 | 8.38 | 8.24 |
| muted-foreground on muted | text 4.5:1 | 7.25 | 7.32 |
| muted-foreground on accent | text 4.5:1 | 6.51 | 6.37 |
| muted-foreground on secondary | text 4.5:1 | 5.72 | 5.91 |
| accent-foreground on accent | text 4.5:1 | 13.29 | 11.03 |
| input on background | ui 3:1 | 14.82 | 6.92 |
| input on card | ui 3:1 | 15.80 | 6.17 |
| ring on background | ui 3:1 | 6.24 | 8.53 |
| ring on card | ui 3:1 | 6.65 | 7.61 |
| destructive on background | text 4.5:1 | 6.78 | 11.23 |
| destructive on card | text 4.5:1 | 7.23 | 10.02 |
| destructive-foreground on destructive | text 4.5:1 | 6.94 | 11.23 |
| notice-foreground on notice | text 4.5:1 | 8.33 | 9.52 |
| notice-border on notice | ui 3:1 | 8.33 | 5.09 |
| success-foreground on success | text 4.5:1 | 6.76 | 9.58 |
| success on background | ui 3:1 | 6.61 | 9.58 |
| done-foreground on done | text 4.5:1 | 10.15 | 11.23 |
| done on card | ui 3:1 | 14.89 | 10.02 |
| lowday-foreground on lowday | text 4.5:1 | 8.69 | 7.75 |
| paused on card | ui 3:1 | 7.36 | 5.09 |
| pending on card | ui 3:1 | 15.80 | 10.36 |
| empty on card | ui 3:1 | 5.93 | 4.52 |
| beforestart on card | text 4.5:1 | 6.75 | 6.65 |
| chart-1 on card | ui 3:1 | 14.89 | 10.02 |
| chart-2 on card | ui 3:1 | 7.63 | 7.28 |
| chart-3 on card | ui 3:1 | 4.00 | 8.08 |

### tidepool

| Pair | Kind | Light | Dark |
| --- | --- | --- | --- |
| foreground on background | text 4.5:1 | 13.70 | 15.34 |
| card-foreground on card | text 4.5:1 | 14.80 | 13.78 |
| popover-foreground on popover | text 4.5:1 | 14.80 | 13.01 |
| primary-foreground on primary | text 4.5:1 | 6.67 | 10.80 |
| primary on background | text 4.5:1 | 6.26 | 10.80 |
| primary on card | text 4.5:1 | 6.77 | 9.70 |
| secondary-foreground on secondary | text 4.5:1 | 11.42 | 11.32 |
| muted-foreground on background | text 4.5:1 | 6.19 | 8.86 |
| muted-foreground on card | text 4.5:1 | 6.69 | 7.96 |
| muted-foreground on muted | text 4.5:1 | 5.70 | 7.06 |
| muted-foreground on accent | text 4.5:1 | 5.56 | 6.54 |
| muted-foreground on secondary | text 4.5:1 | 5.56 | 6.54 |
| accent-foreground on accent | text 4.5:1 | 12.30 | 11.32 |
| input on background | ui 3:1 | 3.58 | 4.67 |
| input on card | ui 3:1 | 3.86 | 4.19 |
| ring on background | ui 3:1 | 6.26 | 10.80 |
| ring on card | ui 3:1 | 6.77 | 9.70 |
| destructive on background | text 4.5:1 | 6.40 | 10.72 |
| destructive on card | text 4.5:1 | 6.91 | 9.63 |
| destructive-foreground on destructive | text 4.5:1 | 6.81 | 10.72 |
| notice-foreground on notice | text 4.5:1 | 7.49 | 9.20 |
| notice-border on notice | ui 3:1 | 3.47 | 3.55 |
| success-foreground on success | text 4.5:1 | 6.39 | 9.43 |
| success on background | ui 3:1 | 6.00 | 9.43 |
| done-foreground on done | text 4.5:1 | 5.45 | 8.53 |
| done on card | ui 3:1 | 5.45 | 7.67 |
| lowday-foreground on lowday | text 4.5:1 | 6.46 | 7.52 |
| paused on card | ui 3:1 | 3.87 | 4.19 |
| pending on card | ui 3:1 | 5.45 | 9.70 |
| empty on card | ui 3:1 | 3.57 | 4.19 |
| beforestart on card | text 4.5:1 | 5.64 | 5.95 |
| chart-1 on card | ui 3:1 | 5.45 | 7.67 |
| chart-2 on card | ui 3:1 | 4.92 | 7.25 |
| chart-3 on card | ui 3:1 | 4.01 | 8.64 |
<!-- contrast:end -->
