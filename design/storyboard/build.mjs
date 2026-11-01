#!/usr/bin/env node
/**
 * Generates design/storyboard/index.html from the theme files in web/src/themes/ (DIRECTIONS
 * below) and design/layout.md's screens. Colours, shapes, fonts and motion come only from the
 * theme tokens; fonts are base64-inlined Latin subsets from design/node_modules.
 */
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTheme, checkTheme, PAIRS } from '../contrast.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const themesDir = resolve(here, '../../web/src/themes');
const fontsDir = resolve(here, '../node_modules/@fontsource-variable');

/** Directions shown, in order, with their hand-written annotations (no colours here). */
export const DIRECTIONS = [
  {
    id: 'hearthlight',
    name: 'Hearthlight',
    tag: 'Hearth, evolved',
    mood: 'A candle-lit kitchen table: warm, soft and familiar.',
    type: 'Nunito (rounded) for headings and body; extra-bold headings.',
    motion: 'glow: a warm halo blooms behind the check button and fades.',
    optimizes: 'Continuity with today’s Hearth and the softest, friendliest first impression.',
    risks: 'Closest to the current app, so the least new. Round cells leave a little less room for the date. Borderless cards rely on a shadow that is faint in dark mode. The honey delete outline sits close to the amber primary, so the farewell card and wording carry it.',
    tokens: 'Round day cells and check buttons (--cell-radius 9999px), no card borders (--border-width 0, --shadow-card carries the edge), 16px radius, one font family.',
  },
  {
    id: 'fieldnotes',
    name: 'Fieldnotes',
    tag: 'new',
    mood: 'A pocket notebook on a desk: grounded, quiet, a little literary.',
    type: 'Fraunces (soft serif) headings; Atkinson Hyperlegible Next body, built for telling similar letters apart.',
    motion: 'fill: ink soaks the box from the bottom up while the row tint sweeps in.',
    optimizes: 'Readability and low stimulation: a legibility-first body font, flat paper, no shadows, square boxes like a paper tracker.',
    risks: 'Serif headings feel more journal than app. Two font families to ship. Moss green for done may read as a score to some people.',
    tokens: 'Square stamped cells (--cell-radius 3px), 1px ink-blue hairlines, --shadow-card none, 6px radius, blue focus ring separate from the moss primary.',
  },
  {
    id: 'tidepool',
    name: 'Tidepool',
    tag: 'new',
    mood: 'Early morning by the water: cool, airy, unhurried.',
    type: 'Lexend for everything (designed for reading fluency); medium-weight headings with tight tracking.',
    motion: 'rise: the check floats up into place and one small bubble rises and fades.',
    optimizes: 'Calm and focus: the most spacious density and a cool palette where the flame and the honey notices are the only warm colours.',
    risks: 'Moves away from the warm “ember” feel of the name. More scrolling at 360 px because of the extra space. Teal done and lavender low day rely on their icons for colour-blind users.',
    tokens: 'Spacious density (--space-unit 5px), 18px radius with soft squircle cells (--cell-radius 14px), the slowest, gentlest motion curve.',
  },
  {
    id: 'marigold',
    name: 'Marigold',
    tag: 'new',
    mood: 'A sticker sheet on the fridge: playful, confident, high contrast.',
    type: 'Bricolage Grotesque extra-bold headings with tight tracking; Figtree body.',
    motion: 'fill, fast: the box stamps full in a short, snappy beat.',
    optimizes: 'Clarity at a glance and personality: ink outlines and a hard offset shadow make every target and state obvious.',
    risks: 'The loudest direction; 2px outlines everywhere can feel busy for sensory-sensitive people. Done is dark ink in light mode, which flips the usual “colour means done”.',
    tokens: '2px ink borders (--border-width 2px), hard offset shadow (--shadow-card 3px 3px 0), butter secondary, the fastest motion.',
  },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const ICON = {
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  pencil: '<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  flame: '<path d="M12 3c1 4 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .3 2 1.2 3 2.5 3.5C12 9 11 6 12 3z"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  sliders: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
  left: '<path d="M15 6l-6 6 6 6"/>',
  right: '<path d="M9 6l6 6-6 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
};
const icon = (name, cls = '') => `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
const flameMark = (cls = '') =>
  `<svg class="flame-mark ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path class="fo" d="M12 2C13 6 18 8.5 18 14a6 6 0 0 1-12 0c0-3.2 2-5 3.2-6.2.2 2.3 1.2 3.4 2.4 3.9C11.4 8.6 10.8 5 12 2z"/><path class="fi" d="M12 12c.6 1.6 2.6 2.3 2.6 4.2a2.6 2.6 0 0 1-5.2 0c0-1.3.9-2.2 1.5-2.7.2.9.6 1.3 1.1 1.5-.2-1.1-.3-2 0-3z"/></svg>`;
const hearthArt = `<svg class="art" viewBox="0 0 120 96" aria-hidden="true"><circle class="spark-glow" cx="60" cy="40" r="22"/><path class="fo" d="M60 22c2 8 10 11 10 20a10 10 0 0 1-20 0c0-5 3-8 5-10 .5 4 2.4 6 5 7-1-6-2-11 0-17z"/><circle class="fi" cx="60" cy="47" r="4"/><rect class="log" x="34" y="62" width="52" height="8" rx="4"/><ellipse class="stone" cx="26" cy="78" rx="12" ry="7"/><ellipse class="stone" cx="50" cy="80" rx="12" ry="7"/><ellipse class="stone" cx="74" cy="80" rx="12" ry="7"/><ellipse class="stone" cx="96" cy="78" rx="11" ry="7"/></svg>`;

/** Synthetic data: today is Saturday 31 October 2026 (1 October 2026 is a Thursday). */
const TODAY_LABEL = 'Saturday, 31 October';
const HABITS = [
  { name: 'Drink water', meta: 'streak', streak: 5, done: true, moment: true },
  { name: 'Stretch for five minutes', meta: 'streak', streak: 3, done: false, demo: true },
  { name: 'Read', meta: 'week', week: [2, 3], done: false },
  { name: 'Evening walk', meta: 'paused' },
];
const OCT = (() => {
  const s = {};
  for (let d = 1; d <= 5; d++) s[d] = 'beforestart';
  const done = [6, 7, 9, 10, 12, 13, 14, 16, 17, 22, 24, 26, 27, 28, 29];
  for (const d of done) s[d] = 'done';
  for (const d of [8, 15, 23]) s[d] = 'notdone';
  for (const d of [11, 18, 25]) s[d] = 'lowday';
  for (const d of [19, 20, 21]) s[d] = 'paused';
  s[30] = 'pending';
  s[31] = 'pending';
  return s;
})();
const STATE_WORD = {
  done: 'done', notdone: 'not checked in', pending: 'still open', lowday: 'low day, resting', paused: 'paused', beforestart: 'before this habit started',
};
const WEEKDAYS = [['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Wed', 'Wednesday'], ['Thu', 'Thursday'], ['Fri', 'Friday'], ['Sat', 'Saturday'], ['Sun', 'Sunday']];

function dayCell(state, num, { button = false, extra = '', label = '' } = {}) {
  const glyph = state === 'done' ? icon('check', 'cell-ic') : state === 'lowday' ? icon('moon', 'cell-ic') : state === 'paused' ? icon('pause', 'cell-ic pz') : '';
  const tag = button ? 'button type="button"' : 'span';
  const close = button ? 'button' : 'span';
  const n = num == null ? '' : `<span class="dn">${num}</span>`;
  return `<${tag} class="day ${extra}" data-state="${state}"${label ? ` aria-label="${esc(label)}"` : ''}>${n}${glyph}</${close}>`;
}

function shell(content, { desktop, active = 'today' }) {
  const nav = [['today', 'Today', 'flame'], ['history', 'History', 'calendar'], ['settings', 'Settings', 'sliders']]
    .map(([k, label, ic]) => `<a class="nav-link${k === active ? ' on' : ''}"${k === active ? ' aria-current="page"' : ''}>${icon(ic)}<span>${label}</span></a>`)
    .join('');
  return `<div class="app">
  <header class="topbar"><a class="brand">${flameMark()}<span>Ember</span></a>${desktop ? `<nav class="topnav" aria-label="Main">${nav}</nav>` : ''}<button class="btn ghost sm">Sign out</button></header>
  <main class="main">${content}
  <footer class="foot"><a>Privacy</a><a>Terms</a><a>Imprint</a></footer></main>
  ${desktop ? '' : `<nav class="tabbar" aria-label="Main">${nav}</nav>`}
</div>`;
}

function habitRow(h) {
  let meta;
  if (h.meta === 'streak') meta = `${h.done ? '<span>Done today</span>' : ''}<span class="badge">${icon('flame')}${h.streak}-day streak</span>`;
  else if (h.meta === 'week') {
    const [done, target] = h.week;
    const pips = Array.from({ length: target }, (_, i) => `<span class="pip" data-state="${i < done ? 'done' : 'notdone'}"></span>`).join('');
    meta = `<span class="pips" aria-hidden="true">${pips}</span><span>${done} of ${target} this week</span>`;
  } else meta = `${icon('pause')}<span>Paused until 8 November. You can resume it any time under Edit.</span>`;
  const check = h.meta === 'paused'
    ? `<span class="slot">${dayCell('paused', null)}</span>`
    : `<label class="check${h.moment ? ' moment' : ''}"><input type="checkbox"${h.done ? ' checked' : ''} aria-label="Check in ${esc(h.name)} for today"><span class="fillbar"></span>${icon('check', 'check-ic')}</label>`;
  return `<li class="card habit${h.done ? ' is-done' : ''}${h.moment ? ' moment-row' : ''}">
    <div class="habit-text"><h2 class="habit-name">${esc(h.name)}</h2><p class="meta${h.meta === 'paused' ? ' plain' : ''}">${meta}</p></div>
    <button class="btn icon ghost edit" aria-label="Edit ${esc(h.name)}">${icon('pencil')}</button>
    ${check}
  </li>`;
}

const embersCard = (n, cls = '') => `<div class="embers ${cls}"><span class="ember-art" style="--n:${n}">${flameMark()}</span><p>${n} checked in today</p></div>`;
const weekCard = `<section class="card week"><h2>Your week</h2><p>A gentle week. You checked in on 9 days.</p><p class="muted">Every check-in counts. Yesterday is still open if you want to log it.</p></section>`;

function today({ desktop }) {
  const list = `<ul class="habits" role="list">${HABITS.map(habitRow).join('')}</ul>`;
  const actions = `<div class="actions"><a class="btn secondary">${icon('plus')}New habit</a><button class="btn ghost">${icon('moon')}Mark today as a low day</button></div>`;
  const head = `<div class="page-head"><div><h1>Today</h1><p class="lede">${TODAY_LABEL}</p></div>${desktop ? '' : embersCard(1, 'inline')}</div>`;
  const body = desktop
    ? `<div class="two"><div class="col">${list}${actions}</div><aside class="col side">${`<div class="card">${embersCard(1)}</div>`}${weekCard}</aside></div>`
    : `${list}${actions}${weekCard}`;
  return shell(`${head}${body}`, { desktop, active: 'today' });
}

function todayEmpty({ desktop }) {
  const empty = `<div class="card empty">${hearthArt}<h2>Ready when you are.</h2><p>Start with one small habit. You can add more any time.</p><a class="btn primary">Create your first habit</a><p class="muted small">Low days and pauses never count against you.</p></div>`;
  return shell(`<div class="page-head"><div><h1>Today</h1><p class="lede">${TODAY_LABEL}</p></div></div>${empty}`, { desktop, active: 'today' });
}

function calendar() {
  const rows = [];
  let row = new Array(3).fill(null);
  for (let d = 1; d <= 31; d++) {
    row.push(d);
    if (row.length === 7) {
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push([...row, ...new Array(7 - row.length).fill(null)]);
  const body = rows.map((r) => `<tr>${r.map((d, i) => {
    if (d == null) return '<td></td>';
    const state = OCT[d];
    const run = state === 'done' && r[i + 1] != null && OCT[r[i + 1]] === 'done';
    const wd = WEEKDAYS[(i + 7) % 7][1];
    const isToday = d === 31;
    const label = `${wd}, ${d} October, ${isToday ? 'today, ' : ''}${STATE_WORD[state]}`;
    const cls = [run ? 'run' : '', isToday ? 'is-today' : '', d === 30 ? 'open' : ''].join(' ');
    return `<td>${dayCell(state, d, { button: state !== 'beforestart', extra: cls, label })}</td>`;
  }).join('')}</tr>`).join('');
  return `<section class="card cal"><div class="cal-head"><button class="btn icon ghost" aria-label="Previous month">${icon('left')}</button><h2>October 2026</h2><button class="btn icon ghost" aria-label="Next month">${icon('right')}</button></div>
  <table class="grid"><thead><tr>${WEEKDAYS.map(([s]) => `<th scope="col">${s}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></section>`;
}

const legend = `<ul class="legend" aria-label="Legend">${[['done', 'Done'], ['notdone', 'Not checked in'], ['pending', 'Still open'], ['lowday', 'Low day'], ['paused', 'Paused'], ['beforestart', 'Before the habit started']]
  .map(([s, t]) => `<li>${dayCell(s, s === 'beforestart' ? 5 : null, { extra: 'sw' })}<span>${t}</span></li>`).join('')}</ul>`;
const dayPanel = `<section class="card panel"><h3>Friday, 30 October</h3><p class="muted">Still open</p><div class="btn-row"><button class="btn primary">Done</button><button class="btn secondary">Not done</button><button class="btn secondary">Clear</button></div><button class="btn ghost">${icon('moon')}Mark as a low day</button><p class="muted small">Low days apply to all your habits.</p><button class="btn ghost">Close</button></section>`;
const stats = `<div class="stats"><div class="stat"><span class="stat-l">Current streak</span><span class="stat-v">4 days</span></div><div class="stat"><span class="stat-l">Best</span><span class="stat-v">7 days</span></div><div class="stat"><span class="stat-l">In October</span><span class="stat-v">15 done · 3 low days</span></div></div>`;

function history({ desktop }) {
  const head = `<div class="page-head"><div><h1>History</h1><p class="lede">Any day can be filled in later. Tap a day to change it.</p></div></div>`;
  const picker = `<label class="field"><span class="label">Habit</span><span class="select">Drink water<span class="chev">${icon('right')}</span></span></label>`;
  const main = `${picker}${stats}${calendar()}${legend}`;
  const body = desktop ? `<div class="two hist"><div class="col">${main}</div><aside class="col side sticky">${dayPanel}</aside></div>` : `${main}${dayPanel}`;
  return shell(`${head}${body}`, { desktop, active: 'history' });
}

function habitEdit({ desktop }) {
  const details = `<form class="card stack"><h2>Details</h2>
    <label class="field"><span class="label">Name</span><span class="input">Drink water</span></label>
    <fieldset class="field"><legend class="label">How often</legend><div class="options"><span class="option on"><span class="radio"></span>Every day</span><span class="option"><span class="radio"></span>A few times a week</span></div></fieldset>
    <label class="field"><span class="label">Reminder time <span class="muted">(optional)</span></span><span class="hint">Ember sends a gentle nudge at this time.</span><span class="input">09:00</span></label>
    <p class="muted small">Grace days apply to all your habits. You can change them in <a class="link">Settings</a>.</p>
    <button class="btn primary block">Save changes</button></form>`;
  const channels = `<section class="card stack"><h2>Where reminders go</h2><span class="checkrow"><span class="box on">${icon('check')}</span>Discord DM</span><span class="checkrow"><span class="box">${icon('check')}</span>Web push</span><p class="muted small">Web push also needs this browser turned on for notifications in <a class="link">Settings</a>.</p></section>`;
  const pause = `<section class="card stack"><h2 class="with-sw">${dayCell('paused', null, { extra: 'sw' })}Take a break</h2><p class="muted">Pausing keeps your history and skips reminders until the day you choose.</p><label class="field"><span class="label">Pause until</span><span class="input">dd.mm.yyyy</span></label><button class="btn secondary block">Pause habit</button></section>`;
  const del = `<section class="card farewell stack"><h2>Delete habit</h2><p>If this habit no longer fits, you can let it go.</p><button class="btn destructive block">Delete habit</button></section>`;
  const head = `<div class="page-head"><div><h1>Edit habit</h1><p class="lede">Drink water</p></div></div>`;
  const col = `<div class="col narrow">${details}${channels}${pause}${del}</div>`;
  const body = desktop
    ? `<div class="two edit"><div>${col}</div><aside class="col side"><div class="card stack"><span class="badge">${icon('flame')}5-day streak</span><a class="link">See its history</a></div></aside></div>`
    : col;
  return shell(`${head}${body}`, { desktop, active: 'today' });
}

function login({ desktop }) {
  const form = `<div class="card auth stack">${desktop ? '' : `<div class="auth-mark">${flameMark()}</div>`}<h1>Welcome back</h1><p class="lede">Sign in to check in on your habits.</p>
    <label class="field"><span class="label">Email</span><span class="input">you@example.test</span></label>
    <label class="field"><span class="label">Password</span><span class="input invalid">••••••••••••</span></label>
    <div class="notice-box" role="alert">${icon('info')}<span>That email and password don't match. Try again, or reset your password.</span></div>
    <div class="row-between"><span class="checkrow"><span class="box on">${icon('check')}</span>Stay signed in</span><a class="link">Forgot password?</a></div>
    <button class="btn primary block">Sign in</button><div class="or"><span>or</span></div><a class="btn secondary block">Sign in with Discord</a>
    <p class="center small">New to Ember? <a class="link">Create an account</a></p></div>`;
  const brand = `<div class="brand-panel" aria-hidden="true">${flameMark('big')}<p class="tagline">A calm place for your habits.</p><div class="strip">${['done', 'done', 'lowday', 'done', 'pending'].map((s, i) => dayCell(s, 26 + i)).join('')}</div></div>`;
  return `<div class="app centered"><header class="topbar"><a class="brand">${flameMark()}<span>Ember</span></a></header><main class="main">${desktop ? `<div class="split">${brand}<div class="split-form">${form}</div></div>` : form}<footer class="foot"><a>Privacy</a><a>Terms</a><a>Imprint</a></footer></main></div>`;
}

const SCREENS = [
  ['today', 'Today, with the check-in moment', today, 'Drink water is frozen mid-reward to show the check-in moment (a fill reward is shown part-way). In this file you can tap the check button on Stretch to play the theme’s reward (it stays off when your system asks for reduced motion).'],
  ['history', 'History, all six day states', history, 'October with done runs (joined by the run connector), not checked in (8, 15, 23), low days (11, 18, 25), paused (19–21), still open (30, 31; 31 is today) and before the start (1–5). The day panel is open for 30 October.'],
  ['edit', 'Habit edit', habitEdit, 'Details, reminder channels, pause and the farewell card for deleting.'],
  ['login', 'Login, with a field problem', login, 'The honey notice tone (never red) for a wrong password; the desktop split adds the brand panel.'],
  ['empty', 'Empty state', todayEmpty, 'A brand-new account on Today.'],
];

function fontFaces(families) {
  const out = [];
  let bytes = 0;
  for (const fam of families) {
    const slug = fam.replace(/ Variable$/, '').toLowerCase().replace(/\s+/g, '-');
    const file = join(fontsDir, slug, 'files', `${slug}-latin-wght-normal.woff2`);
    const data = readFileSync(file);
    bytes += data.length;
    out.push(`@font-face{font-family:'${fam}';font-style:normal;font-display:swap;font-weight:100 900;src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');}`);
  }
  return { css: out.join('\n'), bytes };
}

const familiesOf = (vars) => [vars['ember-font-sans'], vars['ember-font-display']]
  .flatMap((stack) => [...stack.matchAll(/'([^']+ Variable)'/g)].map((m) => m[1]));

function scoped(id, theme) {
  const decl = (vars) => Object.entries(vars).map(([k, v]) => `--${k}:${v};`).join('');
  return `.t-${id}{${decl(theme.light)}}\n.t-${id}.dark{${decl(theme.dark)}}`;
}

const APP_CSS = readFileSync(join(here, 'app.css'), 'utf8');
const PAGE_CSS = readFileSync(join(here, 'page.css'), 'utf8');

function frame(id, reward, mode, desktop, render) {
  return `<figure class="shot ${desktop ? 'desk' : 'phone'}"><figcaption>${desktop ? 'Desktop 1280' : '360 px'} · ${mode}</figcaption><div class="frame t-${id} ${mode === 'dark' ? 'dark' : ''} reward-${reward}">${render({ desktop })}</div></figure>`;
}

function swatches(theme) {
  const keys = ['background', 'card', 'primary', 'done', 'lowday', 'paused', 'notice', 'flame'];
  return ['light', 'dark'].map((mode) => `<div class="swatches"><span class="sw-mode">${mode}</span>${keys.map((k) => `<span class="swatch" style="background:${theme[mode][k]}" title="--${k}: ${esc(theme[mode][k])}"><span>${k}</span></span>`).join('')}</div>`).join('');
}

function build() {
  const themes = DIRECTIONS.map((d) => {
    const theme = parseTheme(readFileSync(join(themesDir, `${d.id}.css`), 'utf8'));
    const check = checkTheme(theme);
    const families = [...new Set(familiesOf(theme.light))];
    const fontBytes = families.reduce((sum, fam) => {
      const slug = fam.replace(/ Variable$/, '').toLowerCase().replace(/\s+/g, '-');
      return sum + statSync(join(fontsDir, slug, 'files', `${slug}-latin-wght-normal.woff2`)).size;
    }, 0);
    const headroom = Math.min(...check.rows.flatMap((r) => [r.light / (r.kind === 'text' ? 4.5 : 3), r.dark / (r.kind === 'text' ? 4.5 : 3)]));
    return { ...d, theme, check, families, fontBytes, headroom };
  });
  const allFamilies = [...new Set(themes.flatMap((t) => t.families))];
  const fonts = fontFaces(allFamilies);

  const compare = `<table class="compare"><thead><tr><th>Direction</th><th>Feel</th><th>Edges and depth</th><th>Day cells</th><th>Density</th><th>Reward</th><th>Fonts (Latin, KB)</th><th>Contrast headroom</th></tr></thead><tbody>${themes.map((t) => {
    const v = t.theme.light;
    return `<tr><th scope="row"><a href="#${t.id}">${t.name}</a></th><td>${esc(t.mood.split(':')[0])}</td><td>${v['border-width']} border, ${v['shadow-card'] === 'none' ? 'no shadow' : 'shadow'}, ${v.radius} radius</td><td>${v['cell-radius'] === '9999px' ? 'round' : `${v['cell-radius']} corners`}</td><td>${v['space-unit']} unit</td><td>${v['ember-reward']} · ${v['ember-dur-slow']}</td><td>${(t.fontBytes / 1024).toFixed(0)} (${t.families.length} ${t.families.length === 1 ? 'family' : 'families'})</td><td>${t.headroom.toFixed(2)}× · ${t.check.problems.length ? 'fails' : `${PAIRS.length * 2}/${PAIRS.length * 2} pass`}</td></tr>`;
  }).join('')}</tbody></table>`;

  const sections = themes.map((t) => {
    const v = t.theme.light;
    const ann = `<div class="ann"><div class="ann-head"><h2>${t.name}</h2><span class="tag">${t.tag}</span><code>web/src/themes/${t.id}.css</code></div>
      <dl><dt>Mood</dt><dd>${esc(t.mood)}</dd><dt>Type</dt><dd class="t-${t.id} type-sample"><span class="ts-d">Ready when you are.</span> <span class="ts-b">${esc(t.type)}</span></dd>
      <dt>Motion and reward</dt><dd>${esc(t.motion)} (<code>--ember-reward: ${v['ember-reward']}</code>, ${v['ember-dur-slow']}, off under reduced motion)</dd>
      <dt>Optimizes for</dt><dd>${esc(t.optimizes)}</dd><dt>Risks</dt><dd>${esc(t.risks)}</dd>
      <dt>Token-driven differences</dt><dd>${esc(t.tokens)} Layout, copy, icons and sizes are identical in every direction; only tokens change.</dd>
      <dt>Palette</dt><dd>${swatches(t.theme)}</dd></dl></div>`;
    const rows = SCREENS.map(([key, title, render, note]) => `<div class="screen" data-theme="${t.id}" data-screen="${key}"><h3>${title}</h3><p class="note">${esc(note)}</p><div class="frames">${frame(t.id, v['ember-reward'], 'light', false, render)}${frame(t.id, v['ember-reward'], 'dark', false, render)}${frame(t.id, v['ember-reward'], 'light', true, render)}${frame(t.id, v['ember-reward'], 'dark', true, render)}</div></div>`).join('');
    return `<section class="direction" id="${t.id}">${ann}${rows}</section>`;
  }).join('');

  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ember design directions · storyboard</title>
<style>
${fonts.css}
${themes.map((t) => scoped(t.id, t.theme)).join('\n')}
${PAGE_CSS}
${APP_CSS}
</style></head>
<body>
<header class="sb-head"><h1>Ember design directions</h1>
<p>Four directions for the React web app, generated from <code>web/src/themes/*.css</code> by <code>design/storyboard/build.mjs</code>. Every screen uses the same layout (<code>design/layout.md</code>); only the theme tokens differ. Synthetic data; today is Saturday 31 October 2026.</p>
<nav class="sb-nav">${themes.map((t) => `<a href="#${t.id}">${t.name}</a>`).join('')}</nav>
${compare}
<p class="sb-small">No direction is recommended here. Contrast headroom is the weakest required pair divided by its minimum (1.00× = exactly at the bar), across light and dark. Real-app screenshots per theme follow after the React screens are built.</p>
</header>
${sections}
</body></html>`;
  const out = join(here, 'index.html');
  writeFileSync(out, html);
  const size = statSync(out).size;
  console.log(`index.html ${(size / 1024 / 1024).toFixed(2)} MB, fonts ${(fonts.bytes / 1024).toFixed(0)} KB raw, ${themes.length} directions`);
  if (size > 4 * 1024 * 1024) {
    console.error('storyboard exceeds 4 MB');
    process.exit(1);
  }
}

build();
