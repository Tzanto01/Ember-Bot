# Ember layout v1 (React rebuild)

The shared layout and information architecture for every screen. Team `react` builds it once; themes (`web/src/themes/<id>.css`, contract `docs/contracts/design-tokens-v1.md`) change only tokens. Nothing in this file depends on which theme is picked.

Sources: the Angular app (`web/src/app/**`), `web/DESIGN.md` (tone, day states), the e2e specs (`web/e2e/**`), `docs/contracts/api-v1.md` v1.3 (no API change needed: every number below comes from `Habit.stats`, `GET /api/habits/{id}/days` or `GET /api/stats/weekly`).

Rules that apply everywhere:

- Copy is the current Angular copy unless this file says "new". Gentle, second person, short. New strings are marked **new**.
- No raw colours in components: tokens only (`color-mix()` of two tokens is fine for tints).
- Body and inputs at least 16 px, every target at least 44 × 44 px with 8 px between targets.
- Every async view has loading (Skeleton in the shape of the content, plus a visually hidden `role=status` text), empty, error (Notice + "Try again") and content states.
- Notices: shadcn `Alert` restyled as `Notice` with tones `info` / `success` / `lowday` (`role=status`) and `notice` (`role=alert`). Honey tone, never red. Inline, never toast-only.
- shadcn `destructive` variant maps to the notice/honey family (`--destructive`).
- All motion off under `prefers-reduced-motion: reduce`; state changes stay (colour, icon, text).
- Icons: one set (lucide, shipped with shadcn), decorative icons `aria-hidden`.

## 1. Frozen strings, roles and ids (from `web/e2e/**`)

These must render exactly as written, with these roles. Selectors may change only by a spec selector edit, never by changing these.

| Screen | Element | Exact name / text |
| --- | --- | --- |
| /login | link | "Sign in with Discord" |
| /login, /signup | input labels | "Email", "Password" (exact; no other control may have the exact name "Password") |
| /login | button | "Sign in" (exact) |
| /login?reason=deleted | `role=status` | text containing "deleted" |
| /login after a bad password | `role=alert` | text containing "match"; and no text matching /session ended/i |
| /signup | button | "Create account" |
| /signup sent | heading | "Check your inbox" |
| /confirm-email | input label, button | "Password", "Confirm email" |
| /confirm-email done | heading | "You're confirmed" |
| /consent | heading, button | "One quick question", "I agree" (then URL `/today`) |
| /today | heading | "Today" (exact) |
| /today | each habit name | a heading whose exact name is the habit name |
| /today empty | link | "Create your first habit" |
| /today | check button | "Check in {habit} for today", `aria-pressed` `true`/`false` |
| /today | text | /\d+-day streak/ for a daily habit with a streak |
| shell | text while queued offline | /saved on this device/, gone after sync |
| /history | heading | "History" (exact) |
| /history | day buttons | `<button id="day-YYYY-MM-DD" data-state="…" aria-expanded="…">`; the **first** `button[id^="day-"]` in the DOM belongs to the month shown, so nothing else on the page uses a `day-` id |
| /history | buttons | "Previous month", "Next month" |
| /history | `#day-panel` buttons | "Done", "Not done", "Mark as a low day" (exact) |
| /habits/new | button | "Start from scratch" |
| /habits/new | input label, button | "Name" (exact), "Create habit" (then URL `/today`) |
| /settings | input labels | "Your password" (exact), "Type DELETE to confirm" |
| /settings | button | "Delete my account" (then URL `/login?reason=deleted`) |
| /settings | link, button | "Link Discord", "Unlink Discord" |
| /settings | `role=status` | text containing "Discord is linked" |
| /link/merge | heading | "Bring your Discord habits over" |
| /link/merge | list | named "Habits to move"; each `listitem`'s text is exactly one habit name |
| /link/merge | text, button | contains "Your settings stay as they are"; "Move everything here" (then URL `/settings`) |

Page titles stay as in `app.routes.ts` ("Today · Ember", …).

## 2. Grid, breakpoints, spacing, type

| Name | Width | Behaviour |
| --- | --- | --- |
| base | 360 px and up | One column. Shell inline padding 16 px (12 px below 380 px). Bottom tab bar. |
| `md` | 48rem (768 px) | Top navigation in the header, no tab bar. Inline padding 24 px. |
| `lg` | 64rem (1024 px) | Two-column screens (Today, History, Settings, auth split). Content max 72rem. |

- Spacing scale: multiples of `--space-unit` (Tailwind `--spacing`): 1, 2, 3, 4, 5, 6, 8, 10, 12, 16. Section gap 6 units, card padding 4 units (5 from `md`), stack gap inside cards 3 units.
- Radii (derived by the app from `--radius`): `sm` = radius − 4 px, `md` = radius − 2 px, `lg` = radius, `xl` = radius + 4 px. Buttons and inputs `md`, cards `xl`, pills 9999 px, day cells and check buttons `--cell-radius`.
- Card: `--card` background, `--border-width` solid `--border`, `--shadow-card`.
- Type sizes (fixed): 13 px tab labels only, 14 px hints and footers, 16 px body and inputs, 18 px h3 and habit names, 22 px h2, 28 px h1 (36 px from `md`). Body line height 1.55, headings 1.2. Headings use `--ember-font-display`, `--ember-heading-weight`, `--ember-heading-tracking`; everything else `--ember-font-sans`. Reading measure 38rem.
- Focus: `:focus-visible` 3 px `--ring` outline, 2 px offset, on every interactive element.

## 3. Shells

### AppShell (signed-in screens)

```
360 px                                    ≥ md
┌──────────────────────────────┐          ┌───────────────────────────────────────────────┐
│ [flame] Ember        Sign out│ header   │ [flame] Ember  (Today)(History)(Settings) Sign out │
├──────────────────────────────┤          ├───────────────────────────────────────────────┤
│ notices (offline queue)      │          │ notices                                        │
│ <main id="main">             │          │ <main id="main"> max 72rem                     │
│   page                       │          │   page                                         │
│ footer: Privacy Terms Imprint│          │ footer: Privacy · Terms · Imprint              │
│ (padding for tab bar)        │          └───────────────────────────────────────────────┘
├──────────────────────────────┤
│ (Today)  (History) (Settings)│ tab bar, fixed, 64 px + safe area
└──────────────────────────────┘
```

- Skip link "Skip to content" → `<main id="main" tabindex="-1">`, visible on focus. Focus moves to the page `h1` on route change.
- Header (56 px, `--background`, bottom `--border`): brand link to `/today` (flame mark + "Ember"); from `md`, `<nav aria-label="Main">` with links "Today" (flame icon), "History" (calendar icon), "Settings" (sliders icon) as pill buttons (active: `--secondary` fill, `aria-current="page"`); right: ghost Button "Sign out" / "Signing out…".
- Tab bar below `md`: same `<nav aria-label="Main">` links as three equal 64 px tabs, icon over 13 px label, active tab `--primary` icon and label plus a 3 px top indicator. `main` gets bottom padding of 64 px + safe area so nothing hides behind it.
- Notices above the page: offline queue `info` Notice "One change is saved on this device and will sync when you're back online." / "{n} changes are saved on this device and will sync when you're back online."; dropped edit `notice` Notice "A change you made offline couldn't be saved: that day can't be edited anymore, or the habit is gone. Everything else is in place." with ghost Button "Okay".
- Footer: `<nav aria-label="Legal">` "Privacy", "Terms", "Imprint", 14 px `--muted-foreground`.

### CenteredShell (auth, consent, legal, not-found)

- Header: brand link to `/`. Footer: legal nav.
- Auth screens (signup, login, forgot, confirm, reset, consent) from `lg` use a **split**: left 5/12 a decorative brand panel (`aria-hidden`, `--secondary` background, flame illustration, tagline **new** "A calm place for your habits." and a five-cell sample week strip showing done, done, low day, done, still open, all as the real day-cell component), right 7/12 the form Card (max 28rem, vertically centred). Below `lg`: no brand panel; the Card sits under the header with a 48 px flame mark above the `h1`. This fills the empty desktop space with personality and repeats the visual language of Today.
- Legal and not-found: single column, Card max 40rem (legal prose 38rem measure).

## 4. Day states (one `DayCell` component)

`<button class="day" data-state="…">` for editable days, `<span class="day" data-state="…">` otherwise. Every state has a non-colour cue. Size: square, at least 44 px (see History for the 360 px math), up to 56 px from `md`. Radius `--cell-radius`. Date number 14 px, centred; icon 14 px under it on cells of 44 px and up.

| State | Fill | Edge | Number colour | Icon | Accessible state text |
| --- | --- | --- | --- | --- | --- |
| `done` | `--done` | none | `--done-foreground` | check | "done" |
| `notdone` | none | 1.5 px `--empty` | `--foreground` | none | "not checked in" (never "missed") |
| `pending` | none | 2 px `--pending` | `--foreground`, weight 600 | none (today: 4 px dot in `--primary` under the number) | "still open" |
| `lowday` | `--lowday` | none | `--lowday-foreground` | moon | "low day, resting" |
| `paused` | 45° hatch: `color-mix(in oklch, var(--paused) 22%, transparent)` stripes | 1.5 px dashed `--paused` | `--foreground` | pause (cells ≥ 48 px) | "paused" |
| `beforestart` | none | none | `--beforestart` | none | "before this habit started" (span, not a button) |
| future (not a state) | none | none | `--beforestart` | none | "not yet" (span) |

- Accessible name: "{long date}, {state text}", prefixed "today, " on today (for example "Sunday, 1 November, today, done"). Today also gets `aria-current="date"`.
- Open day (`aria-expanded="true"`): 3 px `--ring` outline, 2 px offset (same as focus, so it stays visible after the mouse moves away).
- **Run connector (new):** when a `done` cell's right-hand neighbour in the same week row is also `done`, a 4 px tall bar in `--done` bridges the gap at mid-height (decorative, `::after`). Runs read as one band, gaps stay neutral. Low days never break the visual, they are just a different fill.
- The same component renders the legend swatches, the auth brand strip and the Today week pips (static spans, no ids).

## 5. Signed-in screens

### /today

Data: `GET /api/habits`, `GET /api/low-days?from=today&to=today`, `GET /api/stats/weekly`.

```
360 px                                   ≥ lg
┌────────────────────────────┐           ┌─────────────────────────────────────┬──────────────────┐
│ Today              (flame) │           │ Today                               │ ┌──────────────┐ │
│ Sunday, 1 November  2 today│           │ Sunday, 1 November                  │ │ (flame)      │ │
│ [low-day notice, if any]   │           │ [low-day notice, if any]            │ │ 2 checked in │ │
│ ┌────────────────────────┐ │           │ ┌─────────────────────────────────┐ │ │ today        │ │
│ │ Drink water      (✓)   │ │           │ │ Drink water  🔥4-day streak  (✓) │ │ └──────────────┘ │
│ │ 🔥 4-day streak   ✎    │ │           │ └─────────────────────────────────┘ │ ┌──────────────┐ │
│ └────────────────────────┘ │           │ ┌─────────────────────────────────┐ │ │ Your week    │ │
│ ┌────────────────────────┐ │           │ │ Read  ●●○ 2 of 3 this week   ( ) │ │ │ headline     │ │
│ │ Read             ( )   │ │           │ └─────────────────────────────────┘ │ │ footer       │ │
│ │ ●●○ 2 of 3 this week ✎ │ │           │ [+ New habit] [☾ Mark today as a low day] │ └──────────────┘ │
│ └────────────────────────┘ │           │                                     │                  │
│ [+ New habit]              │           │                                     │                  │
│ [☾ Mark today as a low day]│           │                                     │                  │
│ ┌ Your week ─────────────┐ │           │                                     │                  │
│ └────────────────────────┘ │           │                                     │                  │
└────────────────────────────┘           └─────────────────────────────────────┴──────────────────┘
```

- **Page header:** `h1` "Today", lede = long weekday, day and month (browser locale). To the right of the `h1` on mobile, and as the top Card of the right column from `lg`: the **Today's ember** summary (new). A flame illustration (inline SVG, `--flame` body, `--flame-core` centre, `aria-hidden`) that grows one step per check-in today (scale 0.85 + 0.05 per check-in, capped at 1.1; glow opacity rises with it) and never shrinks below its resting size. Text beside it **new**: "{n} checked in today" when n > 0; nothing when n = 0 (no zero, no nudge); "Resting today" with a moon when today is a low day. The text is a plain paragraph, not a live region (the per-habit announcement covers that).
- **Low-day notice** (today is a low day), above the list: `lowday` Notice, moon icon, heading "Today is a low day", text "Go gently. Checking in is still welcome if you feel like it.", ghost Button "Clear low day".
- **Habit list:** `<ul role="list">`, one `HabitRow` Card per habit, server order (never re-sorted after a check-in: nothing moves under the thumb). Gap 3 units; card padding 4 units; row height about 88 px (was about 120 px).
  - Grid: `[text 1fr] [check 56 px]`, aligned centre.
  - `h2` habit name (18 px display font, exact name).
  - Meta line (14 px `--muted-foreground`), one of:
    - daily with streak > 0: Badge (secondary) with a small flame icon and "{n}-day streak";
    - daily, no streak: "Every day";
    - weekly: `target` pips (6 px DayCell dots, `done` filled for `week.done`, the rest `notdone` outline) then "{done} of {target} this week" when done > 0, else "Once a week" / "{target} times a week";
    - done today prefixes "Done today · " to the above;
    - low day today: moon icon + "Low day, resting. Checking in is still welcome.";
    - paused: pause icon + "Paused until {d month}. You can resume it any time under Edit." / "Paused. You can resume it any time under Edit.";
    - not started: "Starts {d month}.".
  - Edit: ghost icon Button (pencil), 44 px, accessible name "Edit {habit}" (visible text "Edit" was the old pattern; the icon button saves a line on 360 px), links to `/habits/{id}/edit`.
  - **CheckButton** (only when checkable): 56 px square with `--cell-radius`, `aria-pressed`, `aria-label` "Check in {habit} for today". Unpressed: 2 px `--pending` edge, check icon in `--muted-foreground`. Pressed: `--done` fill, check icon in `--done-foreground`. Busy: spinner, `aria-disabled`. Paused or not started: no button; a static 56 px DayCell (`paused` hatch or `beforestart`) holds the slot so rows stay aligned.
  - Done row: card background `color-mix(in oklch, var(--done) 8%, var(--card))` and a 3 px `--done` inline-start edge. Not a reward by itself, just the at-a-glance "this one is done".
- **Check-in reward moment** (see section 7 for timing): tap → button fills, the theme's `--ember-reward` animation plays, the row takes its done tint, the streak or week count steps up (number rolls), the Today's ember flame grows one step, and the polite live region says "{habit}: checked in for today.". Un-check: instant reverse, no animation, "{habit}: check-in cleared.".
- **Action row:** secondary Button with plus icon "New habit" (link `/habits/new`); ghost Button with moon "Mark today as a low day" (hidden when today is a low day or the low-day lookup failed). Below `lg` they stack full width; from `lg` they sit in one row under the list.
- **Your week** Card (`section`, `h2` "Your week"): the server `headline` (pre-line) and `footer` (muted). No numbers or bars of our own (the quiet-week rule in `web/DESIGN.md` holds). Hidden if the stats call fails.
- Live region (visually hidden, `aria-live=polite`): the four announcements from the Angular app.
- Action errors: `notice` Notice with heading "Your check-in for {habit} didn't save" / "{habit} didn't change" / "Today couldn't be marked as a low day" / "The low day couldn't be cleared" and the problem message.
- **Loading:** three Skeleton rows in HabitRow shape, `aria-busy`, hidden "Loading your habits…".
- **Load error:** `notice` Notice heading "Your habits didn't load", message, secondary Button "Try again".
- **Empty state (personality):** centred Card, 96 px illustration (`aria-hidden`): a small unlit hearth with one spark (`--flame-core` spark, `--muted` stones), `h2` "Ready when you are.", "Start with one small habit. You can add more any time.", primary Button link "Create your first habit". Under it, muted **new** line "Low days and pauses never count against you." so the first impression states the product promise.

### /history and /history/:habitId

Data: `GET /api/habits`, `GET /api/habits/{id}/days?from&to` (the shown month), `GET /api/low-days`.

```
360 px                                   ≥ lg
┌────────────────────────────┐           ┌──────────────────────────────────────┬───────────────────┐
│ History                    │           │ History                              │                   │
│ Any day can be filled in   │           │ Any day can be filled in later. …    │                   │
│ later. Tap a day to …      │           │ Habit [Drink water ▾]                │ #day-panel        │
│ Habit [Drink water     ▾]  │           │ ┌─────────┐┌─────────┐┌──────────┐   │ ┌───────────────┐ │
│ ┌─────────┬────────┬──────┐│           │ │🔥 4-day ││Best 9   ││ 18 done  │   │ │ Sat, 31 Oct   │ │
│ │4-day    │ Best 9 │18 done││           │ │ streak  ││ days    ││ in Oct   │   │ │ Still open    │ │
│ │streak   │ days   │in Oct ││           │ └─────────┘└─────────┘└──────────┘   │ │[Done][Not done][Clear]│
│ └─────────┴────────┴──────┘│           │ ┌──────────────────────────────────┐ │ │ ☾ Mark as a low day │
│ ┌ ‹  October 2026  › ────┐ │           │ │  ‹      October 2026      ›      │ │ │ Low days apply… │
│ │ M  T  W  T  F  S  S    │ │           │ │  M   T   W   T   F   S   S       │ │ │ [Close]       │ │
│ │ cells ≥ 44 px          │ │           │ │  56 px cells, run connectors     │ │ └───────────────┘ │
│ └────────────────────────┘ │           │ └──────────────────────────────────┘ │                   │
│ legend (2 columns)         │           │ legend (one row)                     │                   │
│ #day-panel (when open)     │           │                                      │                   │
└────────────────────────────┘           └──────────────────────────────────────┴───────────────────┘
```

- `h1` "History", lede "Any day can be filled in later. Tap a day to change it."
- **Habit picker** (more than one habit): Label "Habit" + Select (native `<select id="habit-picker">` or shadcn Select with the same label). Changing it replaces the URL with `/history/{id}` without a navigation. One habit: its name as a muted paragraph.
- **At a glance (new):** three compact stat tiles in one row (Card, `--secondary` background, 3-column grid even on 360 px, 12 px label over an 18 px value). Content leads with what is there, never with gaps:
  - Daily habit: "Current streak" → "{n}-day streak" (when 0: "Fresh start"); "Best" → "{bestStreak} days" (hidden when null or 0, the grid becomes two tiles); "In {Month}" → "{d} done" plus "· {l} low days" when l > 0 (`d` counts `done` days of the shown month).
  - Weekly habit: "This week" → "{done} of {target}" (done > 0) or "{target} a week"; "Last 7 days" → "{last7} done" (hidden when 0); "In {Month}" as above.
  - Labels and values are **new** strings. No count of `notdone` days anywhere.
- **Calendar Card** (`section aria-labelledby="month-heading"`):
  - Header: icon Button "Previous month" (`aria-disabled` at the habit's first month), `h2#month-heading` month and year (`aria-live=polite`), icon Button "Next month" (`aria-disabled` after the current month). 44 px buttons.
  - `table` (`aria-labelledby="month-heading"`, `aria-busy` while loading), Monday first, 7 `th scope=col` with short visible weekday and visually hidden long name. Only the shown month's days get a cell; others are empty `td`.
  - **360 px math:** shell padding 12 px below 380 px, calendar Card has no inline padding below `md`, gap 4 px: (360 − 24 − 24) / 7 = 44.6 px cells. From `md` the cells grow to 56 px and the Card gets normal padding.
  - Editable day: `button#day-{date}` DayCell with `data-state`, `aria-label`, `aria-expanded`, and `aria-controls="day-panel"` when open. Non-editable: span DayCell.
- **Legend** (`ul aria-label="Legend"`): DayCell swatch (24 px) + "Done", "Not checked in", "Still open", "Low day", "Paused", "Before the habit started". 2-column grid on 360 px, one wrapping row from `md`.
- **Day panel** `section#day-panel` Card (only rendered while a day is open; tapping the same day or Escape closes it; focus moves to its heading; below `lg` it renders directly under the calendar and scrolls into view):
  - `h3#day-panel-heading` (tabindex −1) long date; muted state text ("Today, done", "Still open", …).
  - Button row: primary "Done", secondary "Not done", secondary "Clear" (all `aria-disabled` while busy).
  - Ghost Button with moon: "Mark as a low day" / "Clear low day"; muted 14 px "Low days apply to all your habits."
  - Busy "Saving…" with spinner; error Notice; ghost Button "Close".
  - From `lg` the panel lives in a sticky right column (22rem). With no day open, the column shows a quiet placeholder Card without an id: **new** "Pick a day to fill it in or change it." with a small calendar illustration.
- Live region announcements as in the Angular app ("{long date} marked done." …).
- **Notices:** "These days didn't load" / "Your habits didn't load" (+ "Try again"); "We couldn't find that habit" + "It may have been removed." + secondary link "Show my history".
- **Loading:** stat tiles and a calendar-shaped Skeleton, hidden "Loading your history…".
- **Empty state (personality):** illustration (`aria-hidden`): an open notebook whose page is a faint 7 × 3 grid of `notdone`-outline cells with one `done` cell glowing; `h2` "Nothing to look back on yet", "Once you have a habit, its days show up here.", primary Button link "Create a habit".

### /habits/new

- `h1` "New habit".
- **Step 1, suggestions:** lede "Pick a starting point, or begin from scratch. You can change everything later." Template Cards as buttons in a grid (1 column, 2 from `md`): name (server, with its emoji) in 18 px display, description muted, meta 14 px "{cadence} · reminder at {HH:MM}". Hover/focus lifts the card border to `--ring`. Below, full-width secondary Button "Start from scratch" with a plus icon. Loading: four card Skeletons, hidden "Loading suggestions…". No templates or a failed load skips to step 2.
- **Step 2, form** (Card, max 36rem): lede "Based on {template}. Adjust anything you like." / "Keep it small. Small is how habits start."; Input "Name" (maxlength 120, messages "Give your habit a short name." / "Keep it to 100 characters or fewer."); RadioGroup legend "How often": "Every day", "A few times a week" (as two large 56 px option cards); when weekly, Select "Times per week" 1–6; Input `type=time` "Reminder time" with "(optional)" and hint "Ember sends a gentle nudge at this time."; problem Notice; primary block Button "Create habit" / "Creating your habit…"; ghost "Back to suggestions" (when templates exist); ghost link "Cancel" → `/today`.
- From `lg`, a **preview** column (decorative, `aria-hidden`, **new** label "On your Today page") renders a static HabitRow with the typed name and cadence, so the form shows what it makes.

### /habits/:id/edit

- `h1` "Edit habit", lede = habit name. Single column, max 40rem; from `lg` a right column (18rem) with a small summary Card: "{n}-day streak" / "{done} of {target} this week" (when > 0) and a **new** link "See its history" → `/history/{id}`.
- Section Cards in order, each `section aria-labelledby`:
  1. `form` "Details" (`h2#details-heading`): the step-2 fields, muted "Grace days apply to all your habits. You can change them in Settings.", feedback Notice ("Nothing has changed yet." info / "Saved." success / problem), primary Button "Save changes" / "Saving…".
  2. "Where reminders go" (only when the habit has channel data): Checkboxes "Discord DM", "Web push", "Remind me on this phone" (native), conditional muted notes and feedback exactly as the Angular app (see its strings).
  3. "Take a break" (`h2#pause-heading` tabindex −1): paused → "Paused until {long date}." / "Paused for now." + " Pick it up again whenever you like." + secondary "Resume now"; not paused → muted "Pausing keeps your history and skips reminders until the day you choose.", date Input "Pause until" (min today), secondary "Pause habit". Feedback "Paused until {long date}." / "Welcome back. This habit is active again.". A small paused DayCell swatch next to the heading ties the section to the History look.
  4. "Delete habit" (farewell Card: `--notice` background, `--notice-border` edge): idle → muted "If this habit no longer fits, you can let it go." + secondary `#delete-start` "Delete habit"; confirming → `div#delete-confirm role=group` (Escape cancels), `p#delete-question` "Delete {name} and all its check-ins? This can't be undone.", destructive (honey) Button "Yes, delete it" / "Deleting…", secondary "Keep it".
- Loading Skeleton (hidden "Loading your habit…"); not found → empty state "This habit wandered off." + "It may have been removed, or the link is out of date." + primary "Back to Today" with the not-found spark illustration; load error Notice "This habit didn't load" + "Try again".

### /settings

- `h1` "Settings". Discord result Notice first (`?discord=linked` success `role=status` "Discord is linked. You can sign in with it from now on."; `conflict` and `error` notice tone with the Angular copy).
- From `lg`: a sticky left in-page nav (14rem, `aria-label` **new** "Settings sections") with anchor links to each section; content column max 40rem. Below `lg`: Cards stacked.
- Section Cards in order (ids and copy as the Angular app): `#timezone` "Timezone" (current zone paragraph, primary "Use {browser zone}" when it differs, Combobox or input+datalist "Choose a timezone" with its hint and messages, secondary "Save timezone", "Saved."); `#grace` "Grace days" (Select "Grace days per week": "None", "1 day a week", "2 days a week", "3 days a week", saves on change); `#leaderboard` "Leaderboards" (paragraph, Switch "Show me on leaderboards", saves on change); `#discord` "Discord" (linked → paragraph + secondary "Unlink Discord"; not linked → paragraph + secondary link "Link Discord"; native variant); `#dm-reminders` "Discord reminders" (conditional); `#push` "Notifications on this device" (conditional, primary "Turn on notifications" / secondary "Turn off notifications" and the iOS hint); `#phone-reminders` (native); `#export` "Your data" (secondary "Download JSON", "Download CSV"); `#account` "Account" (legal list, secondary "Sign out").
- `#delete` "Delete your account" farewell Card (`--notice` background, `--notice-border` edge): paragraph, Input "Your password" (when the account has one), Input "Type DELETE to confirm" (autocapitalize characters), destructive (honey) Button "Delete my account" / "Deleting…".
- Every "Saved." and outcome message sits inline under its control (`role=status`), never only in a toast.

### /link/merge

- `h1` "Bring your Discord habits over". Card: summary paragraph ("This will move {n habits}, {n check-ins} and {n low days} from your Discord-only Ember account into this account."), `ul aria-label="Habits to move"` rendered as wrapping pills (each `li` contains only the name text), muted "If a habit has the same name in both accounts, Ember keeps both.", paragraph "Your settings stay as they are: timezone …, …, leaderboards on/off."; problem Notice; primary "Move everything here" / "Moving…", secondary "Cancel" / "Cancelling…".
- `none` state: Notice "Nothing to bring over" + "There's nothing waiting to be merged (links expire after 15 minutes)." + secondary link "Go to Settings". Error: Notice + "Try again" + ghost link "Go to Settings". Loading: two Skeleton lines.

## 6. Guest and public screens (CenteredShell)

All forms: Label above Input, hint under the label text (`aria-describedby`), error under the field with an info icon and honey text (`--destructive`), shown after blur or submit; the first invalid field gets focus on submit; submit shows a spinner and blocks double submit.

- **/login:** `h1` "Welcome back", lede "Sign in to check in on your habits."; query Notices (`?discord=error` notice "Discord sign-in didn't finish. You can try again."; `?reason=session` info "Your session ended. Sign in again to pick up where you left off."; `?reason=offline` notice; `?reason=deleted` info `role=status` "Your account and everything in it are deleted. Thank you for spending time with Ember."); Input "Email", Input "Password"; row: Checkbox "Stay signed in" (checked) and link "Forgot password?"; problem Notice `role=alert` ("That email and password don't match. Try again, or reset your password." / unconfirmed + secondary "Send the link again"); primary block "Sign in" / "Signing in…"; Separator with "or"; secondary block link "Sign in with Discord" (text only, no Discord colours); "New to Ember? Create an account". Native build: the paragraph and secondary "Open Ember on the web" instead of the Discord link.
- **/signup:** `h1` "Create your account", lede "A calm place for your habits. It takes a minute."; Input "Email"; Input "Password" + hint "At least 10 characters. A short phrase you'll remember works well."; terms paragraph with links; primary block "Create account" / "Creating your account…"; "Already have an account? Sign in". **Sent:** `h1` "Check your inbox", lede with the email, an envelope-with-spark illustration (`aria-hidden`), "Nothing there? …", secondary "Send it again", ghost link "Back to sign in".
- **/forgot-password:** `h1` "Reset your password" + lede, Input "Email", primary "Send the link", ghost link "Back to sign in". Sent: `h1` "Check your inbox" + lede + ghost link.
- **/confirm-email:** password state (`h1` "Confirm your email", lede, Input "Password", primary "Confirm email" / "Confirming…", problem Notice + link "Reset your password", resend form on problem); confirmed (`h1` "You're confirmed", lede "Welcome to Ember. Sign in whenever you're ready.", primary link "Sign in", the Today's ember flame at its first step as illustration); incomplete (`h1` "Let's get you a fresh link", Notice, resend form, ghost link "Back to sign in"). Resend form: Input "Email for a new link", secondary "Send a new link".
- **/reset-password:** form (`h1` "Choose a new password", lede "For {email}", hidden username input, Input "New password" + hint, primary "Save new password"); done (`h1` "Your password is updated", primary link "Sign in"); incomplete (`h1` "Let's get you a fresh link", Notice, primary link "Send me a new link").
- **/consent:** `h1` "One quick question" (or "Our privacy policy changed"), small shield-and-leaf illustration (`aria-hidden`), the two paragraphs, link "Read the privacy policy", problem Notice, primary block "I agree" / "Saving…", ghost block link "Not now" → `/settings`, muted centred note "Without it you can still read your history, change settings, and export or delete your data."
- **/legal/privacy, /legal/terms, /legal/imprint:** Card with prose (38rem measure, `lang="de"` once loaded), `h1` from the document (fallback "Privacy" / "Terms" / "Imprint"); loading `role=status` "Loading…" + three Skeleton lines; error Notice "This page couldn't be loaded. Check your connection and try again." + secondary "Try again"; bottom link with arrow "Back to Ember".
- **Not found:** illustration (`aria-hidden`) of a single spark drifting off a dotted path; `h1` "This page wandered off", lede "The link may be old, or the address has a small typo. Nothing is lost."; primary link "Go to Today".

## 7. Motion and the reward keyword

Durations come from the theme: `--ember-dur-fast` (press, hover), `--ember-dur` (state change), `--ember-dur-slow` (reward; themes keep it at or below 480 ms), easing `--ember-ease`. Only `transform`, `opacity`, `clip-path` and colours animate. No overshoot, no confetti, no shaking, nothing loops.

The app reads `--ember-reward` once per check-in (`getComputedStyle(document.documentElement).getPropertyValue('--ember-reward').trim()`):

| Keyword | Check-in reward (on the CheckButton and its row) |
| --- | --- |
| `glow` | A soft radial halo (`--flame-core` to transparent) behind the button: opacity 0 → 0.7 → 0, scale 0.8 → 1.6 over `--ember-dur-slow`; the fill cross-fades over `--ember-dur`. |
| `fill` | The `--done` fill rises inside the button from bottom to top (`clip-path: inset(100% 0 0 0)` → `inset(0)`) over `--ember-dur-slow`; the row's done tint sweeps in from the inline start (`scaleX` 0 → 1, origin start) over the same time. |
| `rise` | The check icon rises 6 px into place while fading in, and one 6 px ember dot (`--flame`) floats 16 px up from the button's top edge and fades, over `--ember-dur-slow`. |
| `none` | Instant change. |

Always (except `none`): the meta number rolls (old value up and out, new value in, `--ember-dur`) and the Today's ember flame steps up (`--ember-dur-slow`). Day cells in History use the same keyword at half the distance when marked done from the day panel. Under `prefers-reduced-motion: reduce` every keyword behaves like `none`; the colour, icon, text and live announcement still change.

Other motion: buttons scale to 0.98 while pressed (`--ember-dur-fast`); the day panel fades and slides 8 px in (`--ember-dur`); route changes do not animate.

## 8. Component inventory (shadcn/ui vocabulary)

| Component | Variants and notes |
| --- | --- |
| `Button` | `default` (primary), `secondary`, `ghost` (quiet), `link`, `destructive` (honey notice family), `outline`; sizes 44 px min height, 16 px text; `block` = full width; icon buttons 44 × 44. |
| `Card` | Default, `farewell` (notice background and border), `stat` (secondary background, compact). |
| `Input`, `Label`, `Select`, `RadioGroup`, `Checkbox`, `Switch` | 44 px controls, 16 px text, `--input` edge, `--ring` focus. Errors use `--destructive` text and an info icon. |
| `Notice` (restyled `Alert`) | `info`, `success`, `lowday`, `notice`; optional heading; icon per tone. |
| `Badge` | `secondary` for streak chips. |
| `Skeleton` | Shaped like the content it replaces. |
| `Separator` | With centred text ("or"). |
| `EmptyState` | Illustration slot (inline SVG drawing only with tokens), `h2`, text, action. |
| `DayCell`, `CheckButton`, `HabitRow`, `TodaysEmber`, `StatTile` | Ember components described above. |

Illustrations are small inline SVGs drawn by team `react` with token colours only (`--flame`, `--flame-core`, `--muted`, `--muted-foreground`, `--done`, `--lowday`); the storyboard shows the intended shapes.

## 9. Token usage map (what each token drives)

| Token | Where |
| --- | --- |
| `--background` / `--foreground` | Page, header, body text |
| `--card` / `--card-foreground` | Cards, tab bar, inputs' surface |
| `--popover` | Select menus, combobox list |
| `--primary` / `--primary-foreground` | Primary buttons, links, active tab, today dot |
| `--secondary` / `--secondary-foreground` | Secondary buttons, active nav pill, stat tiles, brand panel |
| `--muted` / `--muted-foreground` | Lede, hints, meta lines, skeletons |
| `--accent` / `--accent-foreground` | Hover rows, focused menu items |
| `--border` | Card edges, separators (decorative) |
| `--input` | Input, select, checkbox edges |
| `--ring` | Focus ring, open day outline, hovered template card |
| `--destructive` | Field errors, honey destructive buttons |
| `--notice*` | Notice tone, farewell cards |
| `--success*` | Success Notice |
| `--done*` | Done cells, pressed CheckButton, run connector, done row edge and tint |
| `--lowday*` | Low-day cells, lowday Notice |
| `--paused` | Paused hatch and dashed edge |
| `--pending` | Open-day edge, unpressed CheckButton edge |
| `--empty` | `notdone` cell edge |
| `--beforestart` | Before-start and future date numbers |
| `--flame` / `--flame-core` | Logo, Today's ember, glow halo, rise dot, illustrations |
| `--chart-1..3` | Reserved (weekly mini charts later); illustrations may use them |
| `--radius`, `--cell-radius`, `--border-width`, `--shadow-card`, `--space-unit` | Shape and density, see section 2 |
| `--ember-font-*`, `--ember-heading-*` | Type, see section 2 |
| `--ember-dur*`, `--ember-ease`, `--ember-reward` | Motion, see section 7 |

## 10. What changed from the Angular layout (for the report)

1. Today: compact rows (about 88 px instead of 120 px), a 56 px check button whose shape follows the theme, streak as a badge, weekly pips, a visible done state per row, the Today's ember summary and a token-driven reward moment.
2. History: "at a glance" stat tiles, filled day states with run connectors, 44.6 px cells at 360 px, day panel in a sticky side column on desktop.
3. Desktop uses two columns on Today, History, Settings and the auth screens instead of one narrow column with empty margins.
4. Empty states get small illustrations and one line of product promise.
5. The tab bar no longer covers content (bottom padding), and Edit became a 44 px icon button with a full accessible name.
