# Ember companion contract v1

The "I need a moment" flow and the shared names between teams. Server side: "Companion v1.16" in api-v1.md. Source of the concept: Nico's Anchor concept (core loop Catch, Name, Ride it out, optional Reflect).

## Ground rules

- The moment flow works signed out, offline and without an account. It makes no API call, writes nothing to localStorage, IndexedDB or the query cache, and shows no streaks.
- One exception, only after the user opens Reflect: when the account isn't loaded yet and the device is in account mode (a cold start straight into `/moment`), the app may load `GET /api/me` once (a signed-out device then gets a 401) and restore a remembered journal key, so Save can be offered. Nothing about the moment is sent; Save itself writes only through `appendPrivate`.
- Wellness wording only, in-app and outside. Never: treat, cure, therapy/therapist, heal, clinical(ly), diagnose, prevent, relieve, reduce (a condition), proven. Safe: notice, name, ground, breathe, ride it out, settle, steady, reflect.
- No automated reading of what the user writes. Crisis lines are always one tap away inside the flow.

## Routes and components (web)

- `/moment`: the flow. Public route without a loader (like `/feedback`), inside the centered shell.
- `/help`: the crisis lines page. Public, linked from the legal links and the login footer.
- `export function CrisisLines()` in `web/src/components/moment/crisis-lines.tsx`: the lines for the picked region, a country select (session only, never stored), and the fixed line "Ember isn't a crisis service and doesn't read what you write."
- `export function MomentDoor({ variant }: { variant: 'today' | 'hero' | 'quiet' })` in `web/src/components/moment/moment-door.tsx`: the "I need a moment" entry. `today` is a calm full-width button at the top of Today (also in its empty state), `hero` for the landing page, `quiet` a link-sized door for login and `/local`.
- `JournalService.appendPrivate(date: LocalDateString, block: string): Promise<void>` in `web/src/lib/journal/journal.ts`: reads that day's note, appends `block` after a blank line, encrypts and saves. Throws unless the private journal is on, not turning off, and unlocked; throws while offline; throws when the result would pass 2000 characters. Never sends plaintext.

## The flow

1. **Catch**: dim campfire in the landscape behind the card, "You're here. That's enough for now.", two big buttons: "Name what's happening" and "Just breathe with me" (straight to paced breathing). A persistent header has Leave and "Urgent help" (opens `CrisisLines` in place, keeping the flow's state).
2. **Name**: tiles "Rejected / not enough", "Too much / overloaded", "Racing / on edge", "Can't stop replaying", "Not sure" (leads to breathing). Then an optional intensity: 5 worded options in a radiogroup ("a little" … "a lot") with Skip.
3. **Ride it out**: the first practice whose `states` include the named state, in file order; "Try another" cycles. One step at a time, big text, Next/Back, every step skippable. At the end, optionally "How is it now?" on the same scale.
4. **Reflect** (optional, never a gate): "what set it off" (up to 300 characters), "what helped" preselected to the practice, "how it is now". Save depends on the journal state, checked before the user types:
   - private journal on and unlocked: Save offered; the block goes through `appendPrivate`;
   - private journal locked: the existing unlock form inline, then Save;
   - plain journal or turning off: no Save; explain that reflections need the private journal, link to Settings → Privacy & data;
   - consent not given: no Save; explain and link (a write would redirect and lose the draft);
   - signed out or no account: no Save; "Nothing from this moment was saved."
   - Block format: `Moment HH:MM · {tile} · {intensity before} → {after}` then `What set it off: …` and `What helped: {practice title}` (lines left out when empty).
- The flow sits in a still night/dawn landscape with a campfire whose glow and halo swell and settle at the paced-breathing tempo (in 4 s, out 6 s, no hold) from Catch on. When the breathing player runs, this ambient rhythm fades out so the circle alone carries the rhythm, and it returns on pause or when done. Reduced motion shows it static; calm mode keeps the landscape static and softer, without the campfire.
- Turning the private journal off re-uploads every entry, moment notes included, as plaintext after the user confirms; the turn-off confirmation says so.

## Practice content (`web/src/content/practices.json`, bundled by import)

```ts
type MomentState = 'rejected' | 'overloaded' | 'racing' | 'replaying' | 'unsure';
interface Practice {
  id: string; version: number; title: string; states: MomentState[];
  type: 'breathing' | 'grounding' | 'orientation' | 'reframe' | 'urge-surfing';
  minutes: number; steps: PracticeStep[];
  a11y: { motion: 'none' | 'gentle'; languageLevel: 'plain' };
  basis: string; // the public technique, for content review; never shown
}
type PracticeStep =
  | { kind: 'text'; text: string }
  | { kind: 'breath'; inhale: number; hold: number; exhale: number; rounds: number }
  | { kind: 'timer'; seconds: number; text: string };
```

- A test validates the real file: unique kebab-case ids, version ≥ 1, non-empty states, 1 to 12 steps, text ≤ 160 characters, inhale/exhale 2 to 8 s, hold 0 to 7 s, 3 to 10 rounds, timer 30 to 180 s, every state covered, and the claims wordlist (word boundaries) over every string in the content files and the moment UI copy.
- Initial set, in order: `paced-breathing` (in 4, out 6, 6 rounds; racing, overloaded, unsure), `kind-voice` (self-compassion and a perceived-rejection check; rejected), `grounding-54321` (overloaded, racing, replaying), `cool-and-here` (cool water or a cool object, then name place, day and three things you see; racing, overloaded), `ride-the-wave` (urge surfing, 90 s timer; rejected, replaying), `set-it-down` (label it, postpone it, one slow breath; replaying). Breathing practices end with "If you feel dizzy, breathe normally."
- Breathing player: the circle is `aria-hidden`; phases as text ("Breathe in, 4"); one polite announcement per phase change, never per second; explicit Start and Pause (nothing auto-starts); no scaling under reduced motion; focus moves to the step heading on each step.

## Crisis lines (`web/src/content/crisis-lines.json`, bundled by import)

- `{ region, name, numbers: string[], hours, url?, checked: "YYYY-MM-DD" }[]`. Regions: DE (TelefonSeelsorge 0800 111 0 111, 0800 111 0 222, 116 123), AT, CH, GB (emergency 999), IE (Samaritans 116 123; emergency 999; plus the EU 112 row), US (988, call or text; emergency 911), EU (112, named "Emergency number (EU)") and INTL (call your local emergency number; 112 in the EU).
- Region: `Intl.Locale(navigator.languages[i]).region`, else a timezone map, else INTL. EU regions always show 112 too. Numbers are `tel:` links.
- Shown in the moment header panel (every step), on `/help`, and in Settings under "Help right now".

## Native doors (Android)

- Intent action `app.ember.habits.OPEN_MOMENT`, from a static launcher shortcut ("I need a moment"), a 1x1 data-free `MomentWidget`, and a button in the Today widget.
- `EmberWidget.takeLaunchAction(): Promise<{ action: 'moment' | null }>` returns and clears the pending launch action. The web app calls it before creating the router and replaces the URL with `/moment`, so the sign-in page never flashes on a cold start.
- Event `openMoment` on `EmberWidget` for a warm start (`onNewIntent`); the web app navigates to `/moment`.
- The PWA manifest lists `/moment` as its first shortcut.

## Copy deck

- Door label: "I need a moment".
- Pitch (Nico picked "Campfire + companion", 2026-11-13): hero "A small campfire for big moments."; meta, store and descriptions "A calm companion for hard moments and gentle days." Habits come second: "And on the other days: gentle habits."
- Streak setting: "Show streaks" in Settings → Habits & days, off for new accounts.

## Companion extras (0.10.0-beta.1)

### Your moments (`/moments`)

- Signed in with the private journal on and unlocked: lists every saved moment reflection of the last 12 months, newest first, grouped by month, decrypted on the device from the day notes (`GET /api/day-notes` over the range). Each shows the date and time, the tile, the intensity change, what set it off and what helped, and "Add to What helps me". Nothing new is stored. Locked: the unlock form; no private journal or no account: a calm explanation and a link to Settings → Privacy & data.
- Parsing reads reflection blocks in both languages: a block starts with a line `Moment HH:MM · …` (the word "Moment" is the same in English and German) and its label lines are matched in English and German.
- Linked from the moment end screen after a save, from Settings → Privacy & data, and from History's day panel when the day holds a moment note.

### What helps me

- An end-to-end encrypted list (plaintext `{ "v": 1, "items": [{ "id", "text", "practiceId"?, "addedAt" }] }`, at most 20 items, text at most 80 characters) stored through `/api/me/helps`. Items come from "Add to What helps me" (from a reflection: the practice, or the user's own "what helped" words) or are added by hand in Settings → "What helps me" (add, edit, remove, reorder).
- In the moment flow, Catch shows up to 3 items as quiet chips under the two buttons ("What helped before"); one with a `practiceId` opens that practice, one without shows its text as a gentle reminder step. **Loading rule:** the list is loaded and decrypted only when the app starts signed in with the journal unlocked (with the rest of the account data), kept in memory, never written to device storage in plaintext. The moment flow only reads memory and makes no request for it; after a cold start into `/moment` it simply shows no chips.
- No account or no private journal: Settings explains that the list needs the private journal.
- Envelope: the API's `encrypted` string is the day-note envelope `{ "v": 1, "iv", "ct" }` as JSON text, AES-GCM with the journal key and its own AAD `ember:helps:v1`, so a helps blob can't pass for a day note or a mood. Web: `encryptHelps`/`decryptHelps` in `web/src/lib/journal/crypto.ts`, `HelpsService` in `web/src/lib/helps/helps.ts` (memory only).

### Calm mode

- One switch in Settings → Appearance ("Calm mode"), on the account (`Me.calmMode`) or on the device without an account. When on: no motion anywhere (as with reduced motion, including the breathing circle, which shows text only), softer contrast-safe colours from a calm token set (still WCAG AA), decorative illustrations and embers hidden, no What's new card on Today (the check-in summary and the weekly card stay, without the flame), the moment flow without the campfire. The system's reduced-motion setting still applies on its own.
- Calm mode shows the background landscape static and a little softer, an exception to hiding decorations because a blank background unsettles; the background glows and sparks stay hidden.

## Tips (0.10.0-beta.1, api v1.18)

Nico (2026-11-14): "point users in the direction of something that app can do when the time is right. We don't want to overload them, but we do want them to have the chance to experience everything."

### Rules

- A tip is a small card that offers one feature once. It shows only when its condition holds and its id is not in `tipsSeen`. Answering it, following its link or dismissing it (×, labelled "Dismiss tip" / "Tipp ausblenden") marks it seen for the account (`PUT /api/me/tips/{id}`; no-account: on the device). Offline: hide it at once and send the mark with the next sync; a failed mark is retried, never shown again on this device meanwhile.
- At most one tip on screen at a time, in the order below. After a tip is dismissed or answered, the next one waits until the next local day (remembered per device; losing it only means an earlier tip).
- Never inside the moment flow (`/moment`), never on the first local day of the account except `streaks`, and never on top of the What's new card (that card goes first, the tip waits until the next day).
- Calm mode shows only `streaks` (it is a question about the user's own setting).
- Copy is wellness-safe, EN and DE, no exclamation marks, no pressure ("You can change this any time"). A tip is a `section` with a heading, its action as a link or button, and the dismiss button; it does not steal focus and announces nothing.

### Catalogue (in priority order)

| id | Condition | Where | Action |
| --- | --- | --- | --- |
| `streaks` | The account has at least one habit and `showStreaks` is false. In practice right after the first habit is saved, on any client. | Top of Today, above the habit list (below the "I need a moment" door). | A question, not a dismissible tip: "Do you want to see streaks?" with one line on what a streak is and that some find it motivating and some find it stressful, plus "You can change this any time in Settings." Buttons "Show streaks" (sets `showStreaks: true`) and "Not for me" (keeps it off). Both mark it seen. No ×. |
| `private-journal` | Signed in with an account, the journal is plain (private journal off), and the user has saved at least one day note. | Under the day-note form on Today after a save, and on History's day panel. | "Want your notes locked so only you can read them?" Link to Settings → Privacy & data. |
| `routines` | At least 3 active habits and no routine. | Below the habit list on Today. | "Habits you do together can share one routine." Link to the new routine page. |
| `android` | Web only (never inside the Android app): check-ins on at least 3 different days. | Below the habit list on Today. | "Ember is also on Android, with a home screen widget and an "I need a moment" shortcut." Link to `/download`. |
| `discord` | Signed in, no Discord linked, check-ins on at least 7 different days. | Below the habit list on Today. | "Ember can also remind you and take check-ins in Discord." Link to Settings → Account (link Discord). Phrased as an add-on. |

- The release note's streak line changes to: "Streaks are optional now. When you add your first habit, Ember asks whether you want them. You can change it any time in Settings under “Habits & days”. Existing accounts keep their streaks on." (DE to match.) Add one line about tips: "Now and then Ember points out something it can do, once, when it fits."

