#!/usr/bin/env node
/** Exports one PNG per direction and screen (360 px and desktop, light and dark) from index.html. */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, 'shots');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 3500, height: 1200 }, reducedMotion: 'reduce' });
  await page.goto(pathToFileURL(join(here, 'index.html')).href);
  await page.evaluate(() => document.documentElement.classList.add('shots'));
  await page.evaluate(() => document.fonts.ready);
  const screens = await page.locator('.screen').all();
  for (const screen of screens) {
    const name = `${await screen.getAttribute('data-theme')}-${await screen.getAttribute('data-screen')}.png`;
    await screen.locator('.frames').screenshot({ path: join(outDir, name) });
    console.log(name);
  }
  console.log(`${screens.length} shots`);
} finally {
  await browser.close();
}
