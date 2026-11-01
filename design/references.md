# Ember design references

Dossier from the gather-design-references skill, retrieved 2026-11-01. Free sources only. Everything branded is reference-only: no screens, imagery, code or copy are reused.

## 1. Research question

"3–5 strong references for calm habit/wellbeing UIs and for the check-in reward moment, free sources only, license notes."

## 2. Project truth

- Ember is a gentle, neurodivergent-friendly habit tracker: Discord bot, web app, Android (Capacitor). React 19, Tailwind v4, shadcn/ui, Motion.
- Product rules: no red, no "missed" colour or counter, never shaming, low and paused days read as rest, any past day can be backfilled, at most two taps per check-in.
- Current theme Hearth (`web/DESIGN.md`): warm paper and charcoal, amber accent, rounded system headings, 120/200/320 ms motion, one small glow on check-in, everything off under reduced motion.
- Critique (department lead, 2026-11-01): clean and accessible but generic; Today has plain white cards and no visible reward; History is a bare month grid; lots of empty space; empty states lack personality.
- Themes vary tokens only (`docs/contracts/design-tokens-v1.md`), including the reward keyword `glow|fill|rise|none`.

## 3. Reference cards

### Card 1: How We Feel (light check-in structure)

| field | value |
| --- | --- |
| source | [App Store listing](https://apps.apple.com/us/app/how-we-feel/id1562706384), [howwefeel.org](https://howwefeel.org/) |
| source_class | first-party store listing (site body did not render) |
| currentness | indeterminate |
| question_answered | How can a wellbeing check-in feel light and non-clinical while still meaning something at a glance? |
| useful_signal | Two-step choice (pick a region, then a word) that reads as low-effort; data stays on device unless shared; free, nonprofit. |
| project_translation | Tap once for done; the optional second step (low day) stays one tap away. A soft multi-hue field can summarise History without a score, as long as every state also has an icon or text cue. |
| do_not_copy | Quadrant palette (includes a red-adjacent quadrant), vocabulary, illustration and character style. |
| license | reference-only (branded product) |
| risk | Colour-only meaning; mitigated by icons and text on every Ember day state. |
| evidence_state | listing text verified; visual details inferred |

### Card 2: Loop Habit Tracker (history without a scoreboard)

| field | value |
| --- | --- |
| source | [iSoron/uhabits](https://github.com/iSoron/uhabits) |
| source_class | first-party repository |
| currentness | current (copyright 2016–2025) |
| question_answered | How can history and progress read at a glance without a scoreboard feel? |
| useful_signal | Progress that a few gaps "don't erase"; per-habit history view; flexible "three times per week" schedules; offline, no account, no ads. |
| project_translation | History leads with what is there (current streak, best streak, days done this month), never with gaps. Weekly habits show "2 of 3 this week", matching Ember's tone table. |
| do_not_copy | "Missed day" decay language and any falling score; screens and code. |
| license | GPLv3 code: behaviour reference only, nothing copied. |
| risk | GPL obligations if any code or asset were borrowed (none is). |
| evidence_state | license and features verified |

### Card 3: GOV.UK Design System, Error message (plain-language notices)

| field | value |
| --- | --- |
| source | [Error message component](https://design-system.service.gov.uk/components/error-message/) |
| source_class | first-party design system |
| currentness | current |
| question_answered | How should a gentle, plain-language notice and field error be written and structured? |
| useful_signal | Say what happened and how to fix it; no blame words; match the field label; keep the user's input; a visually hidden prefix for screen readers. |
| project_translation | Honey-tone Notice (never red) with an icon, the message next to the field, identical wording in any summary, values kept on failure. Already matches the Ember tone table. |
| do_not_copy | Red text and borders, crown branding, "valid/invalid" wording. |
| license | Open Government Licence v3.0 (© Crown copyright); pattern reused, no wording copied. |
| risk | Honey notice text must keep 4.5:1 (checked by `design/contrast.mjs`). |
| evidence_state | verified |

### Card 4: Apple HIG, Motion and reduced motion

| field | value |
| --- | --- |
| source | [HIG Motion](https://developer.apple.com/design/human-interface-guidelines/motion), [Reduced-motion evaluation criteria](https://developer.apple.com/help/app-store-connect/manage-app-accessibility/reduced-motion-evaluation-criteria) |
| source_class | first-party (HIG body did not render; criteria page via snippets) |
| currentness | indeterminate |
| question_answered | What does a reduced-motion-safe check-in reward look like? |
| useful_signal | Motion only with purpose; under Reduce Motion replace movement with a dissolve, highlight or colour shift; animation is never the only signal of state. |
| project_translation | The reward's baseline is a state change (button fills, check appears, row note becomes "Done today", polite live announcement). Glow, fill sweep and rise are enhancements that switch off under `prefers-reduced-motion`. |
| do_not_copy | Activity rings, sounds, any Apple visuals. |
| license | reference-only |
| risk | Android WebView forwarding of the OS animation setting needs a device check. |
| evidence_state | proxy (snippets) |

### Card 5: Material 3 motion (settled, non-bouncy feedback)

| field | value |
| --- | --- |
| source | [Material 3 motion specs](https://m3.material.io/styles/motion/overview/specs) |
| source_class | first-party (body did not render); numbers from third-party docs treated as proxy |
| currentness | inaccessible |
| question_answered | How can a reward feel settled and brief rather than celebratory? |
| useful_signal | Springs for spatial movement, duration/easing pairs for opacity and colour; damping 1.0 means no overshoot. |
| project_translation | `glow` = opacity/colour only; `fill` = clipped scale of the fill; `rise` = small translate with a soft settle; `none` = instant. No overshoot in any theme. Exact values are tuned on a device. |
| do_not_copy | Material shape and ripple styling, third-party numbers. |
| license | reference-only |
| risk | Overshoot springs read as bouncy; avoided. |
| evidence_state | proxy |

### Font candidates (all SIL OFL 1.1, self-hosted through Fontsource)

| Font | Mood | Package |
| --- | --- | --- |
| Fraunces | warm soft serif, storybook / notebook | `@fontsource-variable/fraunces` |
| Nunito | friendly rounded sans | `@fontsource-variable/nunito` |
| Atkinson Hyperlegible Next | legibility-first sans, strong character distinction | `@fontsource-variable/atkinson-hyperlegible-next` |
| Bricolage Grotesque | characterful grotesque | `@fontsource-variable/bricolage-grotesque` |

The packages actually used, with versions and license files, are listed in `design/README.md`.

## 4. Pattern synthesis

- **Motion is additive, never the only signal** (Cards 4, 5): every reward degrades to a colour and shape change plus text.
- **Low-effort, two-step input** (Card 1) matches the two-tap rule.
- **Progress that never collapses** (Card 2) matches "2 of 3 this week" and streaks shown only above zero.
- **Plain, specific, blame-free wording** (Card 3) matches the Ember tone table.
- Token translations: `glow` (Cards 4, 5), `fill` (Card 4 fallback shape), `rise` (Card 5), `none` (Card 4); honey Notice (Card 3); History summary leads with what's there (Card 2).

Tensions: a glanceable History versus "no score, no missed"; a visible reward versus reduced motion; a web font versus bundle size (Latin subsets, one family per theme where possible).

## 5. Rejected patterns

- Red errors and mood quadrants (GOV.UK, How We Feel): no-red rule.
- Decaying scores and "missed" language (Loop).
- Confetti, spinning rings, overshoot bounces.
- Pet or currency reward loops (Finch-style, third-party coverage only): gamified, contingent rewards.
- Copying code, screens or icons from branded or GPL products; any paid or Pro asset.

## 6. Unknowns and blockers

- HIG and Material first-party bodies did not render; their principles are proxies and no numbers are taken from them.
- Daylio and Streaks were not researched.
- Android WebView reduced-motion behaviour needs a device check.
- Reward durations are tuned on the real app, not taken from research.

No visual direction or implementation has been approved by this research.
