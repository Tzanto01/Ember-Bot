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

1. **Catch**: dim campfire, "You're here. That's enough for now.", two big buttons: "Name what's happening" and "Just breathe with me" (straight to paced breathing). A persistent header has Leave and "Urgent help" (opens `CrisisLines` in place, keeping the flow's state).
2. **Name**: tiles "Rejected / not enough", "Too much / overloaded", "Racing / panicky", "Can't stop replaying", "Not sure" (leads to breathing). Then an optional intensity: 5 worded options in a radiogroup ("a little" … "a lot") with Skip.
3. **Ride it out**: the first practice whose `states` include the named state, in file order; "Try another" cycles. One step at a time, big text, Next/Back, every step skippable. At the end, optionally "How is it now?" on the same scale.
4. **Reflect** (optional, never a gate): "what set it off" (up to 300 characters), "what helped" preselected to the practice, "how it is now". Save depends on the journal state, checked before the user types:
   - private journal on and unlocked: Save offered; the block goes through `appendPrivate`;
   - private journal locked: the existing unlock form inline, then Save;
   - plain journal or turning off: no Save; explain that reflections need the private journal, link to Settings → Privacy & data;
   - consent not given: no Save; explain and link (a write would redirect and lose the draft);
   - signed out or no account: no Save; "Nothing from this moment was saved."
   - Block format: `Moment HH:MM · {tile} · {intensity before} → {after}` then `What set it off: …` and `What helped: {practice title}` (lines left out when empty).
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

- `{ region, name, numbers: string[], hours, url?, checked: "YYYY-MM-DD" }[]`. Regions: DE (TelefonSeelsorge 0800 111 0 111, 0800 111 0 222, 116 123), AT, CH, GB, US (988, call or text), EU (112) and INTL (call your local emergency number; 112 in the EU).
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
