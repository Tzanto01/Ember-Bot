# Ember web design

Status: proposal for Nico's sign-off. Tokens live in `src/styles/tokens.css` (imported by `src/styles.css`); this file explains them.

## Direction

**Hearth.** Ember is a small, steady flame on a warm evening table, not a dashboard. Warm paper in light mode, warm charcoal in dark mode, one ember-amber accent, rounded display type for headings, and a lot of quiet space. The app should feel like a notebook you are glad to open, never like a scoreboard.

Directions considered:

1. **Hearth** (chosen): paper and charcoal neutrals, amber accent, rounded headings. Calm and personal; the risk is looking too soft, so hierarchy comes from type size and spacing, not colour.
2. **Night sky**: deep blue background with a glowing flame. Striking, but dark-first fights daytime use and drifts toward a chat app look.
3. **Studio**: crisp white, black type, a single orange dot. Clean, but cold, and close to every productivity tool.

Deliberately avoided: Discord blurple, cool dark-gray chat layouts, red of any kind, streak "fire" walls, missed-day counters.

## Palette

Every colour is a `light-dark()` pair, so the theme follows `prefers-color-scheme`. A manual toggle later only sets `<html data-theme="light|dark">` (already wired in the tokens). Ratios are WCAG 2.x contrast against the background named.

| Token | Light | Dark | Role | Contrast (light / dark) |
| --- | --- | --- | --- | --- |
| `--color-bg` | `#FBF7F1` | `#1A1512` | Page background | |
| `--color-surface` | `#FFFFFF` | `#241D19` | Cards, inputs, tab bar | |
| `--color-surface-sunken` | `#F4EDE3` | `#2E2621` | Hover, info notices, active nav | |
| `--color-text` | `#2A211C` | `#F3EBE2` | Body text | 14.6 on bg, 15.8 on surface / 15.3 on bg, 14.1 on surface |
| `--color-text-muted` | `#66574C` | `#BBAA9B` | Secondary text, inactive tabs | 6.4 on bg, 6.9 on surface / 8.1 on bg, 7.4 on surface |
| `--color-border` | `#E6DBCD` | `#3A302A` | Decorative separators only | n/a (never the only cue) |
| `--color-border-strong` | `#8A7868` | `#8C7A6B` | Input borders, empty day cells | 3.9 on bg, 4.2 on surface / 4.4 on bg, 4.0 on surface |
| `--color-primary` | `#8F5200` | `#F2A65A` | Primary buttons, links, active tab | 5.8 on bg, 6.2 on surface / 8.9 on bg, 8.2 on surface |
| `--color-on-primary` | `#FFFFFF` | `#1A1512` | Text on primary | 6.2 / 8.9 |
| `--color-primary-hover` | `#7A4500` | `#F7BC80` | Hover | 7.8 with on-primary / 10.7 with on-primary |
| `--color-focus` | `#8F5200` | `#F2A65A` | 3 px focus ring | 5.8 / 8.9 on bg |
| `--color-flame` | `#F0962B` | `#F2A65A` | Logo only (decorative) | n/a |
| `--color-flame-core` | `#FFD58A` | `#FFE2A8` | Logo only (decorative) | n/a |
| `--color-done` | `#A85800` | `#E08A3C` | Done day fill (white date text on it: 5.2) | 4.8 on bg / 6.2 on surface |
| `--color-on-done` | `#FFFFFF` | `#1A1512` | Check mark on a done day | 4.0 / 6.8 |
| `--color-lowday` | `#5E5A8E` | `#A9A4DB` | Low-day moon icon and date text | 5.3 on lowday-bg / 6.0 on lowday-bg, 7.1 on surface |
| `--color-lowday-bg` | `#ECEAF5` | `#2C2A3D` | Low-day cell and notice | |
| `--color-success` | `#3D6B4F` | `#8FC2A0` | Success icon | 5.4 on success-bg / 7.3 on success-bg |
| `--color-success-bg` | `#EAF1EB` | `#1F2B23` | Success notice | |
| `--color-notice-bg` | `#F8EEDC` | `#33291C` | "Needs a look" notice (our error tone) | text 13.7 / 12.1 |
| `--color-notice-border` | `#D9BF8F` | `#6B5634` | Notice border (decorative) | n/a |
| `--color-notice-icon` | `#8F5200` | `#F2A65A` | Notice icon, invalid input border | 5.4 / 7.0 on notice-bg |
| `--color-notice-text` | `#7A4500` | `#F2C38F` | Field error text | 7.8 on surface / 10.3 on surface |

There is no red, pink or "danger" token. Problems use the honey-coloured notice tone plus an info icon and plain words.

## Type

- Body: system UI stack (`system-ui`, Segoe UI, Roboto, Noto Sans). No web font download, no CDN (CSP is `default-src 'self'`).
- Display (h1 to h3): rounded system stack (`ui-rounded`, SF Pro Rounded, Quicksand, Comfortaa, Manjari, Arial Rounded, then `system-ui`). Rounded where the platform has it, plain sans elsewhere.
- Weights: 400 body, 500 labels and buttons, 650 headings.
- Line height: 1.55 body, 1.2 headings. Text measure for reading pages: `--measure` (38rem).

| Token | Size | Use |
| --- | --- | --- |
| `--text-xs` | 13 px | Tab bar labels |
| `--text-sm` | 14 px | Hints, field errors, footer |
| `--text-base` | 16 px | Body, inputs (no iOS zoom) |
| `--text-md` | 18 px | h3, brand in header |
| `--text-lg` | 22 px | h2 |
| `--text-xl` | 28 px | h1 on phones |
| `--text-2xl` | 36 px | h1 from 48rem |

## Spacing, radii, sizes

- Spacing on a 4 px base: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32, `-10` 40, `-12` 48, `-16` 64 px.
- Radii: `--radius-sm` 6 px (focus ring), `--radius-md` 10 px (buttons, inputs, day cells), `--radius-lg` 16 px (cards), `--radius-full` pills (use sparingly).
- `--tap` 44 px: minimum height of every button, link target and day cell. `--tabbar-height` 64 px.
- Layout: content max `--shell-max` (64rem); auth panel 30rem. Bottom tab bar below 48rem, top nav from 48rem. Safe-area insets respected on the header, tab bar and centred layout.

## Motion

- `--dur-fast` 120 ms (press, hover), `--dur` 200 ms (state change), `--dur-slow` 320 ms (rare, larger reveals). Easing `--ease-out` `cubic-bezier(0.2, 0.8, 0.2, 1)`.
- Only `transform`, `opacity` and colours animate. Buttons scale to 0.98 when pressed.
- A check-in may get one small warm "glow" (opacity and scale on the day cell, at most 320 ms). No confetti, no shaking.
- `prefers-reduced-motion: reduce` turns all animation and transitions off globally.

## Tone

Gentle, second person, short sentences, no guilt. Matches the bot's voice ("No pressure", "just showing up counts") without its emoji-heavy style; emoji only where the server sends them (template names, weekly headline).

| Do | Don't |
| --- | --- |
| "That email and password don't match. Try again, or reset your password." | "Invalid credentials." |
| "Your session ended. Sign in again to pick up where you left off." | "Session expired! You have been logged out." |
| "That was a lot of tries in a short time. Please try again in about 2 minutes." | "Too many requests (429)." |
| "That day hasn't happened yet." | "Error: date in future." |
| "You have 25 habits, the most Ember keeps. Remove one you no longer need to make room." | "Habit limit exceeded." |
| "2 of 3 this week" | "1 missed" |
| "Ready when you are." (empty today) | "You haven't checked in yet!" |
| "This page wandered off." | "404 Not Found" |

Quiet week (zero check-ins in the last 7 days, from `GET /api/stats/weekly` with `totalDone === 0`): drop numbers and progress bars from the summary and show the server's softer headline, for example "It's been a quiet week, and that's okay. Whenever you're ready, your habits are here waiting." plus the footer "No pressure. Progress happens at its own pace." Never show "0/14" or a percentage that week.

Do / don't for a quiet week:

| Do | Don't |
| --- | --- |
| "It's been a quiet week, and that's okay." | "0 of 14 check-ins (0%)" |
| "Whenever you're ready, your habits are here waiting." | "Your streak is gone." |

`notdone` days are simply empty cells: same as any empty day, no icon, no colour, no count. Nothing on screen ever calls a day "missed" or "failed". Streak numbers appear only when they are above zero.

## Day states

Use the global `.day` class: `<span class="day" data-state="…">`. Each state has a non-colour cue (icon, outline style or text) and an accessible name such as "Tuesday 3 November, done".

| State | Visual | Icon | Accessible text |
| --- | --- | --- | --- |
| `done` | Filled `--color-done`, check in `--color-on-done` | check | "done" |
| `notdone` | Empty cell, `--color-border-strong` outline | none | "not checked in" (never "missed") |
| `pending` | Empty cell, 2 px `--color-primary` outline (an open day: today or yesterday, not yet checked in) | none | "still open" ("today, still open" for today) |
| `lowday` | `--color-lowday-bg` fill, moon in `--color-lowday` | moon | "low day, resting" |
| `paused` | Dashed outline with soft diagonal hatch | pause (optional on larger cells) | "paused" |
| `beforestart` | No outline, no fill (just the date number, muted), not interactive | none | "before this habit started" |

Today's check-in is one tap on the habit row (two at most when a choice is needed). Past days open the same toggle from History, so any day can be completed or corrected later.

## Screenshots for the QA pass

Each at 360 px wide and at 1280 px, in light and in dark (4 shots per screen):

1. `/signup` (form, plus the "Check your inbox" state)
2. `/login` (form, plus `?discord=error`, plus a login error notice)
3. `/confirm-email` (confirmed, plus expired with the resend form)
4. `/forgot-password` (form, plus sent state)
5. `/reset-password` (form, plus a field error)
6. `/consent`
7. `/today` (with habits, empty, quiet week)
8. `/history` and `/history/:habitId` (all six day states visible)
9. `/habits/new` and `/habits/:id/edit`
10. `/settings`
11. `/link/merge`
12. `/legal/privacy`, `/legal/terms`, `/legal/imprint`
13. Not-found page
14. Keyboard focus: skip link visible, focus ring on a primary button and on a tab bar item

## Tech notes

- Angular 21 pending Nico; upgrade to 22 once Node 22.22.3+/24.15+ is installed.
- Tokens use CSS `light-dark()` (Chrome 123, Safari 17.5, Firefox 120 and later).
- App icons: the flame mark is `public/icons/icon.svg` (any) and `public/icons/icon-maskable.svg`, plus `public/favicon.svg`. The PNG sizes in `public/icons/` are rendered from `icon-maskable.svg`.
