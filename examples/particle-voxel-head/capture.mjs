#!/usr/bin/env node
// Capture review screenshots from the running page through the img2threejs capture
// contract (window.__IMG2THREEJS_READY__ / __IMG2THREEJS_CAPTURE__), the same contract
// scripts/capture_threejs_playwright.py drives. Node + playwright-core, so it can use a
// preinstalled Chromium without a Python Playwright install.
//
//   node capture.mjs --url <page> --out-dir evidence [--chromium <path>] [--size 1200x900]
//
// Views: the fixed reference view plus orbit views, each frozen at the same clock.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const require = createRequire(resolve(arg('--modules', process.cwd()), 'noop.js'));
const { chromium } = require('playwright-core');

const url = arg('--url');
const outDir = resolve(arg('--out-dir', 'evidence'));
const [width, height] = arg('--size', '1200x900').split('x').map(Number);
const executablePath = arg('--chromium', process.env.CHROMIUM_PATH);
const only = arg('--only', '');

const VIEWS = [
  { id: 'hero', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 6, dissolve: 0.40 } },
  { id: 'hero-t9', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 9, dissolve: 0.40 } },
  { id: 'orbit-plus35', azimuthDegrees: 35, elevationDegrees: 0, state: { time: 6, dissolve: 0.40 } },
  { id: 'orbit-minus35', azimuthDegrees: -35, elevationDegrees: 5, state: { time: 6, dissolve: 0.40 } },
  { id: 'profile-intact', azimuthDegrees: 80, elevationDegrees: 0, state: { time: 6, dissolve: 0.0 } },
  { id: 'hero-intact', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 6, dissolve: 0.0 } },
  { id: 'hero-scattered', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 6, dissolve: 0.72 } },
  { id: 'preset-broad', azimuthDegrees: 20, elevationDegrees: 0, state: { time: 6, dissolve: 0.4, preset: 'broad' } },
  { id: 'preset-slender', azimuthDegrees: -20, elevationDegrees: 0, state: { time: 6, dissolve: 0.4, preset: 'slender' } },
  { id: 'preset-elder', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 6, dissolve: 0.4, preset: 'elder' } },
  { id: 'preset-child', azimuthDegrees: 0, elevationDegrees: 0, state: { time: 6, dissolve: 0.4, preset: 'child' } },
].filter((v) => !only || only.split(',').includes(v.id));

mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch({
  executablePath,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__IMG2THREEJS_READY__ === true, null, { timeout: 120000 });

const records = [];
for (const v of VIEWS) {
  const state = await page.evaluate((s) => window.__IMG2THREEJS_CAPTURE__.setState(s), v.state);
  await page.evaluate((c) => window.__IMG2THREEJS_CAPTURE__.setCamera(c), v);
  const path = join(outDir, `${v.id}.png`);
  await page.locator('canvas').screenshot({ path });
  records.push({ ...v, path, state });
  console.log('captured', v.id, JSON.stringify(state));
}
const gl = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const ctx = c.getContext('webgl2');
  const dbg = ctx.getExtension('WEBGL_debug_renderer_info');
  return { canvas: [c.width, c.height], renderer: dbg ? ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : ctx.getParameter(ctx.RENDERER) };
});
writeFileSync(join(outDir, 'captures.json'), JSON.stringify({ url, viewport: [width, height], gl, errors, records }, null, 2));
await browser.close();
if (errors.length) { console.error('page errors:\n' + errors.join('\n')); process.exitCode = 1; }
