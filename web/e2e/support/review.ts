import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

/**
 * Visual review checks for one screen state, on top of the layout spec's sideways checks: text cut off vertically,
 * text and controls overlapping each other, content hidden under the fixed bottom bar, graphics clipped by a parent
 * (or by their own SVG viewport) and truncated text. An inline link that wraps over several lines is measured per line
 * (its bounding box would cover the text next to it). Not reported as overlap: an absolutely positioned button that
 * sits on a picture it shares a parent with (the remove badge on a thumbnail), and a text field with an overlaid control.
 * Not reported as sideways overflow: content inside a scroll container (it scrolls), and a box whose only overflow is
 * a pseudo-element (no child box or line of text leaves it, e.g. the History day-run connector).
 * Not reported as a clipped graphic: the shells' decorative background scene (`.ember-scene`), which bleeds past the
 * viewport by design.
 *
 * By default a state is measured at 360 and 1280 px in light mode. `REVIEW_FULL=1` measures the whole matrix (eight
 * widths, light and dark, calm mode on and off, 200 percent root text at 360 and 1280, the other three themes at
 * 320, 360 and 1280, both 21:9 sizes light and dark, one 5120x1440 light pass). `REVIEW_SHOTS=<dir>` also saves
 * screenshots for review by eye (360, 1280, 1920 and both 21:9 sizes light and dark, 5120 light, plus the extras a
 * state asks for), appends every finding to `<dir>/findings.jsonl` and stops failing the test, so the whole matrix
 * runs.
 */

export const reviewFull = process.env['REVIEW_FULL'] === '1';
export const reviewShots = process.env['REVIEW_SHOTS'] || null;

const themes = ['hearthlight', 'fieldnotes', 'tidepool', 'marigold'] as const;
type Scheme = 'light' | 'dark';

interface Variant {
  width: number;
  height: number;
  scheme: Scheme;
  calm: boolean;
  big: boolean;
  theme: (typeof themes)[number] | null;
  shot: boolean;
}

export interface CaptureExtras {
  /** Also screenshot every theme (light and dark) at 360 and 1280 px, and calm mode at 360 px. */
  themes?: boolean;
  /** Also screenshot 200 percent root text at 360 px. */
  big?: boolean;
}

const wide = [
  { width: 2560, height: 1080 },
  { width: 3440, height: 1440 },
] as const;
const superWide = { width: 5120, height: 1440 } as const;

function variants(extras: CaptureExtras): Variant[] {
  const list: Variant[] = [];
  const add = (sized: Omit<Variant, 'shot' | 'height'> & { height?: number }, shot = false) => {
    const variant = { ...sized, height: sized.height ?? (sized.width < 768 ? 800 : 900) };
    const same = list.find(
      (v) =>
        v.width === variant.width &&
        v.height === variant.height &&
        v.scheme === variant.scheme &&
        v.calm === variant.calm &&
        v.big === variant.big &&
        v.theme === variant.theme,
    );
    if (same) same.shot ||= shot;
    else list.push({ ...variant, shot });
  };
  const base = { calm: false, big: false, theme: null };
  if (!reviewFull) {
    for (const width of [360, 1280]) add({ ...base, width, scheme: 'light' });
  } else {
    for (const width of [320, 360, 390, 412, 768, 1024, 1280, 1920])
      for (const scheme of ['light', 'dark'] as const)
        for (const calm of [false, true]) add({ ...base, width, scheme, calm });
    for (const width of [360, 1280]) add({ ...base, width, scheme: 'light', big: true });
    for (const theme of themes.slice(1))
      for (const width of [320, 360, 1280]) add({ ...base, width, scheme: 'light', theme });
    for (const size of wide) for (const scheme of ['light', 'dark'] as const) add({ ...base, ...size, scheme });
    add({ ...base, ...superWide, scheme: 'light' });
  }
  if (reviewShots) {
    for (const width of [360, 1280, 1920])
      for (const scheme of ['light', 'dark'] as const) add({ ...base, width, scheme }, true);
    for (const size of wide) for (const scheme of ['light', 'dark'] as const) add({ ...base, ...size, scheme }, true);
    add({ ...base, ...superWide, scheme: 'light' }, true);
    if (extras.themes) {
      for (const scheme of ['light', 'dark'] as const) {
        for (const theme of themes)
          for (const width of [360, 1280]) add({ ...base, width, scheme, theme }, true);
        add({ ...base, width: 360, scheme, calm: true }, true);
      }
    }
    if (extras.big) add({ ...base, width: 360, scheme: 'light', big: true }, true);
  }
  return list;
}

/** Self-contained (runs in the page): the review findings for the current layout. */
function reviewMeasure(): string[] {
  const found: string[] = [];
  const path = (element: Element): string => {
    const parts: string[] = [];
    for (
      let node: Element | null = element;
      node && node !== document.body && parts.length < 3;
      node = node.parentElement
    ) {
      const id = node.id ? `#${node.id}` : '';
      const classes = Array.from(node.classList)
        .slice(0, 2)
        .map((name) => `.${name.replace(/[[\]:/]/g, '\\$&')}`)
        .join('');
      parts.unshift(`${node.tagName.toLowerCase()}${id}${classes}`);
    }
    return parts.join(' > ');
  };
  const snippet = (element: Element) =>
    `"${(element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)}"`;
  const visible = (element: Element): boolean => {
    if (element.getClientRects().length === 0) return false;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    const box = element.getBoundingClientRect();
    return box.width > 1 && box.height > 1;
  };
  const pinned = (element: Element): boolean => {
    for (
      let node: Element | null = element;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const position = getComputedStyle(node).position;
      if (position === 'fixed' || position === 'sticky') return true;
    }
    return false;
  };
  const hiddenTree = (element: Element) => !!element.closest('[hidden], .sr-only, [inert]');
  const all = Array.from(document.body.querySelectorAll('*'));

  for (const element of all) {
    if (hiddenTree(element) || element.closest('svg, [aria-hidden="true"]')) continue;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName)) continue;
    if (!element.textContent?.trim() || !visible(element)) continue;
    const style = getComputedStyle(element);
    const clipsY = style.overflowY === 'hidden' || style.overflowY === 'clip';
    const clipsX = style.overflowX === 'hidden' || style.overflowX === 'clip';
    const clamped = style.webkitLineClamp !== 'none' && style.webkitLineClamp !== '';
    if (
      style.textOverflow === 'ellipsis' &&
      clipsX &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      found.push(
        `truncated: ${path(element)} ${snippet(element)}${element.getAttribute('title') ? ' (has title)' : ''}`,
      );
    } else if (clipsY && element.scrollHeight > element.clientHeight + 1) {
      found.push(
        `${clamped ? 'truncated' : 'clipped-text'}: ${path(element)} (scrollHeight ${element.scrollHeight} > clientHeight ${element.clientHeight}) ${snippet(element)}`,
      );
    }
  }

  interface Item {
    element: Element;
    rect: DOMRect;
    kind: string;
    fixed: boolean;
  }
  const items: Item[] = [];
  const textWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = textWalker.nextNode(); node; node = textWalker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || !node.textContent?.trim()) continue;
    if (
      hiddenTree(parent) ||
      parent.closest('svg, [aria-hidden="true"], option, select, script, style')
    )
      continue;
    if (!visible(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    for (const rect of Array.from(range.getClientRects())) {
      if (rect.width > 1 && rect.height > 1)
        items.push({ element: parent, rect, kind: 'text', fixed: pinned(parent) });
    }
  }
  const controls =
    'button, a[href], input:not([type="hidden"]), select, textarea, [role="button"], [role="switch"], [role="radio"], [role="checkbox"], [role="tab"], img';
  for (const element of Array.from(document.body.querySelectorAll(controls))) {
    if (hiddenTree(element) || element.closest('[aria-hidden="true"]') || !visible(element))
      continue;
    const lines = Array.from(element.getClientRects()).filter(
      (rect) => rect.width > 1 && rect.height > 1,
    );
    const wrapped = getComputedStyle(element).display === 'inline' && lines.length > 1;
    for (const rect of wrapped ? lines : [element.getBoundingClientRect()])
      items.push({
        element,
        rect,
        kind: element.tagName.toLowerCase(),
        fixed: pinned(element),
      });
  }
  const related = (a: Element, b: Element) => a === b || a.contains(b) || b.contains(a);
  const clipRect = (element: Element): DOMRect | null => {
    let rect: DOMRect | null = null;
    for (
      let node = element.parentElement;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
        const box = node.getBoundingClientRect();
        rect = rect
          ? new DOMRect(
              Math.max(rect.left, box.left),
              Math.max(rect.top, box.top),
              Math.min(rect.right, box.right) - Math.max(rect.left, box.left),
              Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top),
            )
          : box;
      }
    }
    return rect;
  };
  const shown = (item: Item): DOMRect => {
    const clip = clipRect(item.element);
    if (!clip) return item.rect;
    const left = Math.max(item.rect.left, clip.left);
    const top = Math.max(item.rect.top, clip.top);
    return new DOMRect(
      left,
      top,
      Math.min(item.rect.right, clip.right) - left,
      Math.min(item.rect.bottom, clip.bottom) - top,
    );
  };
  const seen = new Set<string>();
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i];
      const b = items[j];
      if (a.fixed !== b.fixed) continue;
      if (related(a.element, b.element)) continue;
      if (
        a.kind !== 'text' &&
        b.kind !== 'text' &&
        (a.element.contains(b.element) || b.element.contains(a.element))
      )
        continue;
      const ra = shown(a);
      const rb = shown(b);
      if (ra.width <= 0 || ra.height <= 0 || rb.width <= 0 || rb.height <= 0) continue;
      const x = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const y = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (x <= 2 || y <= 2) continue;
      const ctrlA = a.element.closest(controls);
      const ctrlB = b.element.closest(controls);
      if (ctrlA && ctrlA === ctrlB) continue;
      const field = (item: Item) => ['input', 'select', 'textarea'].includes(item.kind);
      const overlay = (item: Item) => getComputedStyle(item.element).position === 'absolute';
      if ((field(a) && overlay(b)) || (field(b) && overlay(a))) continue;
      const badge = (image: Item, button: Item) =>
        image.kind === 'img' &&
        button.kind === 'button' &&
        overlay(button) &&
        image.element.parentElement === button.element.parentElement;
      if (badge(a, b) || badge(b, a)) continue;
      if (
        a.kind === 'text' &&
        b.kind === 'text' &&
        a.element.closest('label') &&
        a.element.closest('label') === b.element.closest('label')
      )
        continue;
      const key = `${path(a.element)}|${path(b.element)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(
        `overlap: ${a.kind} ${path(a.element)} ${snippet(a.element)} and ${b.kind} ${path(b.element)} ${snippet(b.element)} by ${Math.round(x)}x${Math.round(y)}px`,
      );
    }
  }

  const bars = all.filter((element) => {
    if (!visible(element)) return false;
    const style = getComputedStyle(element);
    if (style.position !== 'fixed' || style.pointerEvents === 'none') return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom >= innerHeight - 1 && rect.width > innerWidth / 2;
  });
  if (bars.length > 0) {
    const top = Math.min(...bars.map((bar) => bar.getBoundingClientRect().top));
    const scrollMax = document.documentElement.scrollHeight - innerHeight;
    const lowest = items
      .filter((item) => !item.fixed)
      .reduce((max, item) => Math.max(max, item.rect.bottom + scrollY), 0);
    const visibleBottomAtEnd = lowest - Math.max(scrollMax, 0);
    if (visibleBottomAtEnd > top + 1) {
      found.push(
        `under-bar: content ends ${Math.round(visibleBottomAtEnd - top)}px under the fixed bottom bar at the end of the page`,
      );
    }
  }

  const graphics = Array.from(
    document.body.querySelectorAll('img, svg, canvas, video, picture'),
  ).filter(
    (element) =>
      !(element instanceof SVGElement && element.ownerSVGElement) &&
      !element.closest('.ember-scene') &&
      !hiddenTree(element) &&
      visible(element),
  );
  for (const graphic of graphics) {
    const rect = graphic.getBoundingClientRect();
    for (
      let node = graphic.parentElement;
      node && node !== document.documentElement;
      node = node.parentElement
    ) {
      const style = getComputedStyle(node);
      const hidesX = style.overflowX === 'hidden' || style.overflowX === 'clip';
      const hidesY = style.overflowY === 'hidden' || style.overflowY === 'clip';
      if (!hidesX && !hidesY) continue;
      const box = node.getBoundingClientRect();
      const cut =
        (hidesX && (rect.left < box.left - 1 || rect.right > box.right + 1)) ||
        (hidesY && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1));
      if (cut) {
        found.push(
          `clipped-graphic: ${path(graphic)} (${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}) by ${path(node)} (${Math.round(box.left)},${Math.round(box.top)} ${Math.round(box.width)}x${Math.round(box.height)})`,
        );
        break;
      }
    }
    if (rect.left < -1 || rect.right > document.documentElement.clientWidth + 1) {
      found.push(
        `clipped-graphic: ${path(graphic)} runs past the page edge (${Math.round(rect.left)} to ${Math.round(rect.right)})`,
      );
    }
    if (graphic instanceof SVGSVGElement && getComputedStyle(graphic).overflow !== 'visible') {
      const shapes = Array.from(
        graphic.querySelectorAll(
          'path, circle, ellipse, rect, line, polyline, polygon, text, image, use',
        ),
      );
      for (const shape of shapes) {
        if (shape.closest('defs, clipPath, mask, symbol, pattern')) continue;
        const inner = shape.getBoundingClientRect();
        if (inner.width === 0 && inner.height === 0) continue;
        const over = Math.max(
          rect.left - inner.left,
          inner.right - rect.right,
          rect.top - inner.top,
          inner.bottom - rect.bottom,
        );
        if (over > 1.5) {
          found.push(
            `clipped-graphic: ${path(graphic)} cuts its own ${shape.tagName} by ${Math.round(over)}px`,
          );
          break;
        }
      }
    }
  }
  return found;
}

/** Self-contained (runs in the page): the layout spec's sideways check, kept here so review and layout specs agree. */
function sidewaysMeasure(): string[] {
  const found: string[] = [];
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth)
    found.push(
      `page-scroll: the page scrolls sideways (${root.scrollWidth} > ${root.clientWidth})`,
    );
  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    if (element.closest('svg, [aria-hidden="true"], [hidden], .sr-only')) continue;
    if (!element.textContent?.trim()) continue;
    if (['INPUT', 'TEXTAREA', 'SELECT', 'OPTION'].includes(element.tagName)) continue;
    if (element.getClientRects().length === 0) continue;
    const style = getComputedStyle(element);
    if (style.visibility === 'hidden' || style.display === 'contents') continue;
    const box = element.getBoundingClientRect();
    if (box.width <= 1 || box.height <= 1) continue;
    if (style.overflowX === 'auto' || style.overflowX === 'scroll') continue;
    if (element.scrollWidth <= element.clientWidth + 1) continue;
    if (style.textOverflow === 'ellipsis') continue;
    const spilling = Array.from(element.children).filter((child) => {
      const rect = child.getBoundingClientRect();
      return rect.right > box.right + 1 || rect.left < box.left - 1;
    });
    if (
      spilling.length > 0 &&
      spilling.every((child) => ['absolute', 'fixed'].includes(getComputedStyle(child).position))
    )
      continue;
    let scroller = false;
    for (let node = element.parentElement; node && !scroller; node = node.parentElement) {
      const x = getComputedStyle(node).overflowX;
      scroller = x === 'auto' || x === 'scroll';
    }
    if (scroller) continue;
    if (spilling.length === 0) {
      const range = document.createRange();
      range.selectNodeContents(element);
      const textSpills = Array.from(range.getClientRects()).some(
        (rect) => rect.width > 0 && (rect.right > box.right + 1 || rect.left < box.left - 1),
      );
      if (!textSpills) continue;
    }
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
    found.push(
      `text-overflow: ${element.tagName.toLowerCase()}.${Array.from(element.classList).slice(0, 2).join('.')} (scrollWidth ${element.scrollWidth} > ${element.clientWidth}) "${text}"`,
    );
  }
  return found;
}

function slug(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/^\/+/, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'landing'
  );
}

async function settle(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !document.querySelector('main[data-arrive]'), undefined, { timeout: 3000 })
    .catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = document.getAnimations().filter((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return (
        timing && Number.isFinite(timing.endTime as number) && (timing.endTime as number) < 3000
      );
    });
    await Promise.race([
      Promise.all(finite.map((animation) => animation.finished.catch(() => undefined))),
      new Promise((done) => setTimeout(done, 1500)),
    ]);
    await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  });
}

/**
 * Measures (and in review mode screenshots) the current state over the variant matrix, then restores the page's
 * viewport, colour scheme, calm mode, theme and root text size. `route` is the path, `state` a short name for what is
 * on screen; findings are pushed to `found` as `[route state] [lang width scheme(+calm/+200pct/+theme)] category: …`.
 */
export async function capture(
  page: Page,
  route: string,
  state: string,
  lang: string,
  found: string[],
  extras: CaptureExtras = {},
): Promise<void> {
  const original = await page.evaluate(() => ({
    dark: document.documentElement.classList.contains('dark'),
    calm: document.documentElement.hasAttribute('data-calm'),
    theme: document.documentElement.dataset['theme'] ?? 'hearthlight',
    fontSize: document.documentElement.style.fontSize,
  }));
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  const name = `${slug(route)}-${slug(state)}`;
  if (reviewShots) mkdirSync(reviewShots, { recursive: true });
  try {
    for (const variant of variants(extras)) {
      await page.setViewportSize({ width: variant.width, height: variant.height });
      await page.emulateMedia({ colorScheme: variant.scheme });
      await page.evaluate(
        ({ dark, calm, theme, big }) => {
          const root = document.documentElement;
          root.classList.toggle('dark', dark);
          root.toggleAttribute('data-calm', calm);
          root.dataset['theme'] = theme;
          root.style.fontSize = big ? '200%' : '';
        },
        {
          dark: variant.scheme === 'dark',
          calm: variant.calm || original.calm,
          theme: variant.theme ?? original.theme,
          big: variant.big,
        },
      );
      await settle(page);
      const label = `${variant.scheme}${variant.calm ? '+calm' : ''}${variant.big ? '+200pct' : ''}${variant.theme ? `+${variant.theme}` : ''}`;
      const results = [
        ...(await page.evaluate(sidewaysMeasure)),
        ...(await page.evaluate(reviewMeasure)),
      ];
      const blocking = results.filter((result) => !result.startsWith('truncated:') || reviewShots);
      for (const result of blocking)
        found.push(`[${route} ${state}] [${lang} ${variant.width} ${label}] ${result}`);
      if (reviewShots) {
        for (const result of results) {
          appendFileSync(
            join(reviewShots, 'findings.jsonl'),
            `${JSON.stringify({ route, state, lang, width: variant.width, scheme: variant.scheme, calm: variant.calm, big: variant.big, theme: variant.theme, finding: result })}\n`,
          );
        }
        if (variant.shot) {
          const suffix = variant.calm
            ? '-calm'
            : variant.big
              ? '-200pct'
              : variant.theme
                ? `-${variant.theme}`
                : '';
          await page.screenshot({
            path: join(
              reviewShots,
              `${name}-${lang}-${variant.width}-${variant.scheme}${suffix}.png`,
            ),
            fullPage: true,
          });
        }
      }
    }
  } finally {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: original.dark ? 'dark' : 'light' });
    await page.evaluate((value) => {
      const root = document.documentElement;
      root.classList.toggle('dark', value.dark);
      root.toggleAttribute('data-calm', value.calm);
      root.dataset['theme'] = value.theme;
      root.style.fontSize = value.fontSize;
    }, original);
    await settle(page);
  }
}

/** Fails the test on findings, except in review mode (`REVIEW_SHOTS`), where the matrix must run to the end. */
export function reviewVerdict(found: string[]): string[] {
  return reviewShots ? [] : found;
}
