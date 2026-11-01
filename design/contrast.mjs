#!/usr/bin/env node
/**
 * Checks every theme in web/src/themes/*.css (plus any extra CSS paths given as arguments)
 * against docs/contracts/design-tokens-v1.md: required tokens, WCAG 2.x contrast pairs in
 * light and dark, the reward keyword, and the no-red rule. Exits 1 on any miss.
 * `--readme` also rewrites the contrast section of design/README.md.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const themesDir = resolve(here, '../web/src/themes');
const SKIP = new Set(['index.css']);

export const COLOR_TOKENS = [
  'background', 'foreground', 'card', 'card-foreground', 'popover', 'popover-foreground',
  'primary', 'primary-foreground', 'secondary', 'secondary-foreground', 'muted', 'muted-foreground',
  'accent', 'accent-foreground', 'border', 'input', 'ring', 'destructive', 'destructive-foreground',
  'notice', 'notice-foreground', 'notice-border', 'success', 'success-foreground', 'done',
  'done-foreground', 'lowday', 'lowday-foreground', 'paused', 'pending', 'empty', 'beforestart',
  'flame', 'flame-core', 'chart-1', 'chart-2', 'chart-3',
];
export const OTHER_TOKENS = [
  'radius', 'cell-radius', 'border-width', 'shadow-card', 'space-unit', 'ember-font-sans',
  'ember-font-display', 'ember-heading-weight', 'ember-heading-tracking', 'ember-dur-fast',
  'ember-dur', 'ember-dur-slow', 'ember-ease', 'ember-reward',
];
const REWARDS = ['glow', 'fill', 'rise', 'none'];

/** [foreground, background, kind] with kind 'text' (4.5:1) or 'ui' (3:1), from the contract. */
export const PAIRS = [
  ['foreground', 'background', 'text'],
  ['card-foreground', 'card', 'text'],
  ['popover-foreground', 'popover', 'text'],
  ['primary-foreground', 'primary', 'text'],
  ['primary', 'background', 'text'],
  ['primary', 'card', 'text'],
  ['secondary-foreground', 'secondary', 'text'],
  ['muted-foreground', 'background', 'text'],
  ['muted-foreground', 'card', 'text'],
  ['muted-foreground', 'muted', 'text'],
  ['muted-foreground', 'accent', 'text'],
  ['muted-foreground', 'secondary', 'text'],
  ['accent-foreground', 'accent', 'text'],
  ['input', 'background', 'ui'],
  ['input', 'card', 'ui'],
  ['ring', 'background', 'ui'],
  ['ring', 'card', 'ui'],
  ['destructive', 'background', 'text'],
  ['destructive', 'card', 'text'],
  ['destructive-foreground', 'destructive', 'text'],
  ['notice-foreground', 'notice', 'text'],
  ['notice-border', 'notice', 'ui'],
  ['success-foreground', 'success', 'text'],
  ['success', 'background', 'ui'],
  ['done-foreground', 'done', 'text'],
  ['done', 'card', 'ui'],
  ['lowday-foreground', 'lowday', 'text'],
  ['paused', 'card', 'ui'],
  ['pending', 'card', 'ui'],
  ['empty', 'card', 'ui'],
  ['beforestart', 'card', 'text'],
  ['chart-1', 'card', 'ui'],
  ['chart-2', 'card', 'ui'],
  ['chart-3', 'card', 'ui'],
];
const MIN = { text: 4.5, ui: 3 };

function block(css, selector) {
  const re = new RegExp(`(^|[}\\s])${selector.replace(/[.]/g, '\\.')}\\s*\\{([^}]*)\\}`, 'm');
  const match = css.replace(/\/\*[\s\S]*?\*\//g, '').match(re);
  const vars = {};
  if (!match) return vars;
  for (const decl of match[2].matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)) vars[decl[1]] = decl[2].trim().replace(/\s+/g, ' ');
  return vars;
}

/** Parses a theme file into `{ light, dark }` token maps; dark inherits unset tokens from light. */
export function parseTheme(css) {
  const light = block(css, ':root');
  const dark = { ...light, ...block(css, ':root.dark') };
  return { light, dark };
}

const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

function oklchToRgb(l, c, h) {
  const a = c * Math.cos((h * Math.PI) / 180);
  const b = c * Math.sin((h * Math.PI) / 180);
  const l_ = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m_ = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s_ = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l_ - 3.3077115913 * m_ + 0.2309699292 * s_,
    -1.2684380046 * l_ + 2.6097574011 * m_ - 0.3413193965 * s_,
    -0.0041960863 * l_ - 0.7034186147 * m_ + 1.707614701 * s_,
  ];
  return lin.map((v) => Math.min(1, Math.max(0, linearToSrgb(Math.min(1, Math.max(0, v))))));
}

function rgbToOklch([r, g, b]) {
  const [lr, lg, lb] = [r, g, b].map(srgbToLinear);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return { l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

const num = (s, scale = 1) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));

/** Converts a hex, rgb() or oklch() colour to sRGB channels in 0..1 (alpha ignored). */
export function toRgb(value) {
  const v = value.trim().toLowerCase();
  let m = v.match(/^#([0-9a-f]{3,8})$/);
  if (m) {
    let hex = m[1];
    if (hex.length <= 4) hex = [...hex].map((ch) => ch + ch).join('');
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  }
  m = v.match(/^rgba?\(([^)]+)\)$/);
  if (m) return m[1].split(/[\s,/]+/).slice(0, 3).map((p) => num(p, 255) / 255);
  m = v.match(/^oklch\(([^)]+)\)$/);
  if (m) {
    const [l, c, h] = m[1].split(/[\s/]+/);
    return oklchToRgb(num(l), num(c, 0.4), parseFloat(h));
  }
  throw new Error(`unsupported colour "${value}"`);
}

const luminance = (rgb) => {
  const [r, g, b] = rgb.map(srgbToLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** WCAG 2.x contrast ratio between two colours. */
export function ratio(a, b) {
  const [l1, l2] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** True for a saturated red or pink hue (oklch hue below 45° or above 330°). */
export function isRedOrPink(value) {
  const { c, h } = rgbToOklch(toRgb(value));
  return c > 0.06 && (h < 45 || h > 330);
}

/** Checks one parsed theme; returns `{ rows, problems }`. */
export function checkTheme(theme) {
  const problems = [];
  for (const mode of ['light', 'dark']) {
    const vars = theme[mode];
    for (const t of [...COLOR_TOKENS, ...OTHER_TOKENS]) if (!(t in vars)) problems.push(`${mode}: missing --${t}`);
    for (const t of COLOR_TOKENS) {
      if (!(t in vars)) continue;
      try {
        if (isRedOrPink(vars[t])) problems.push(`${mode}: --${t} ${vars[t]} reads as red or pink`);
      } catch (e) {
        problems.push(`${mode}: --${t}: ${e.message}`);
      }
    }
    if (vars['ember-reward'] && !REWARDS.includes(vars['ember-reward'])) problems.push(`${mode}: --ember-reward must be one of ${REWARDS.join(', ')}`);
  }
  const rows = PAIRS.map(([fg, bg, kind]) => {
    const r = {};
    for (const mode of ['light', 'dark']) {
      const vars = theme[mode];
      try {
        r[mode] = ratio(vars[fg], vars[bg]);
      } catch {
        r[mode] = NaN;
      }
      if (!(r[mode] >= MIN[kind])) problems.push(`${mode}: ${fg} on ${bg} ${r[mode].toFixed(2)} < ${MIN[kind]}`);
    }
    return { fg, bg, kind, ...r };
  });
  return { rows, problems };
}

function themeFiles(extra) {
  const files = existsSync(themesDir)
    ? readdirSync(themesDir).filter((f) => f.endsWith('.css') && !SKIP.has(f)).map((f) => join(themesDir, f))
    : [];
  for (const path of extra) if (!files.some((f) => basename(f) === basename(path))) files.push(resolve(path));
  return files.sort((a, b) => basename(a).localeCompare(basename(b)));
}

function markdown(results) {
  const out = [];
  out.push('| Theme | Pairs | Light min | Dark min | Result |', '| --- | --- | --- | --- | --- |');
  for (const { id, rows, problems } of results) {
    const min = (mode) => Math.min(...rows.map((r) => r[mode] / MIN[r.kind])).toFixed(2);
    out.push(`| ${id} | ${rows.length} × 2 | ${min('light')}× | ${min('dark')}× | ${problems.length ? `FAIL (${problems.length})` : 'pass'} |`);
  }
  out.push('', '"min" is the smallest ratio divided by its required minimum (1.00× = exactly at the bar).');
  for (const { id, rows, problems } of results) {
    out.push('', `### ${id}`, '', '| Pair | Kind | Light | Dark |', '| --- | --- | --- | --- |');
    for (const r of rows) {
      const cell = (v) => `${v.toFixed(2)}${v >= MIN[r.kind] ? '' : ' ✗'}`;
      out.push(`| ${r.fg} on ${r.bg} | ${r.kind} ${MIN[r.kind]}:1 | ${cell(r.light)} | ${cell(r.dark)} |`);
    }
    for (const p of problems) out.push(`- ✗ ${p}`);
  }
  return out.join('\n');
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const writeReadme = args.includes('--readme');
  const files = themeFiles(args.filter((a) => !a.startsWith('--')));
  if (!files.length) {
    console.error('No theme files found.');
    process.exit(1);
  }
  const results = files.map((file) => ({ id: basename(file, '.css'), ...checkTheme(parseTheme(readFileSync(file, 'utf8'))) }));
  for (const { id, problems } of results) {
    console.log(`${problems.length ? 'FAIL' : 'pass'}  ${id}`);
    for (const p of problems) console.log(`      ${p}`);
  }
  if (writeReadme) {
    const readme = join(here, 'README.md');
    const text = readFileSync(readme, 'utf8');
    const start = '<!-- contrast:start -->';
    const end = '<!-- contrast:end -->';
    const i = text.indexOf(start);
    const j = text.indexOf(end);
    if (i < 0 || j < 0) throw new Error('README.md lacks the contrast markers');
    writeFileSync(readme, `${text.slice(0, i + start.length)}\n${markdown(results)}\n${text.slice(j)}`);
  }
  const failed = results.filter((r) => r.problems.length).length;
  console.log(`${results.length - failed}/${results.length} themes pass`);
  process.exit(failed ? 1 : 0);
}
