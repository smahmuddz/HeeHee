/**
 * Layout audit. Reports the geometry of the key surfaces at three breakpoints
 * so the composition can be checked without eyeballing a screenshot.
 *
 * Prerequisite: the static server is running on :5173.
 * Run: node tools/audit-layout.mjs
 */

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const exe = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const browser = await chromium.launch({ executablePath: exe, headless: true, args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox'] });

const VIEWPORTS = [
  ['desktop', 1440, 900],
  ['laptop', 1180, 720],
  ['tablet', 820, 1180],
  ['phone', 390, 844],
  ['phone-small', 360, 640],
  ['phone-landscape', 740, 400]
];

const box = (page, sel) => page.locator(sel).first().boundingBox();
let issues_total = 0;

for (const [name, width, height] of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.goto('http://localhost:5173/', { waitUntil: 'load' });
  await page.waitForSelector('#splash.is-active');

  /* ---- splash geometry: the moonwalk must be visible and not collide ---- */
  await page.waitForTimeout(2200);
  const splash = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) };
    };
    const overlaps = (a, b) => a && b && a.y < b.bottom - 2 && b.y < a.bottom - 2 && a.x < b.right - 2 && b.x < a.right - 2;
    const mj = r('.moonwalk');
    const word = r('.wordmark--xl');
    const btn = r('#enterBtn');
    const img = document.querySelector('.moonwalk__figure');
    return {
      mj, word, btn,
      imgLoaded: Boolean(img?.complete && img?.naturalWidth),
      clipped: mj ? (mj.x < -1 || mj.right > window.innerWidth + 1 || mj.y < -1 || mj.bottom > window.innerHeight + 1) : true,
      overlapWord: overlaps(mj, word),
      overlapBtn: overlaps(mj, btn),
      btnReachable: btn ? (btn.y >= 0 && btn.bottom <= window.innerHeight + 1) : false,
      scroll: document.getElementById('splash').scrollHeight - document.getElementById('splash').clientHeight
    };
  });

  const splashIssues = [];
  if (!splash.imgLoaded) splashIssues.push('MJ.png not loaded');
  if (!splash.mj || splash.mj.h < 70) splashIssues.push(`moonwalk too small (${splash.mj?.h ?? 0}px)`);
  if (splash.clipped) splashIssues.push('moonwalk is clipped by the viewport');
  if (splash.overlapWord) splashIssues.push('moonwalk overlaps the wordmark');
  if (splash.overlapBtn) splashIssues.push('moonwalk overlaps the enter button');
  if (!splash.btnReachable) splashIssues.push('enter button outside the viewport');

  console.log(`\n--- ${name} (${width}x${height}) ---`);
  console.log(`  splash: moonwalk ${splash.mj?.w}x${splash.mj?.h} at (${splash.mj?.x},${splash.mj?.y}), scroll overflow ${splash.scroll}px`);
  console.log(splashIssues.length ? `  SPLASH ISSUES: ${splashIssues.join('; ')}` : '  splash OK');
  if (splashIssues.length) issues_total += splashIssues.length;

  await page.click('#enterBtn');
  await page.waitForTimeout(500);
  await page.fill('#input', 'I am so fed up with everything, I could scream');
  await page.click('#sendBtn');
  await page.waitForSelector('.song-card', { timeout: 30000 });
  await page.waitForTimeout(900);

  const report = await page.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom), right: Math.round(b.right) };
    };
    const cs = (sel, prop) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[prop] : null;
    };
    const overlaps = (a, b) => a && b && a.y < b.bottom && b.y < a.bottom && a.x < b.right && b.x < a.right;

    const composer = r('.composer');
    const dock = document.querySelector('#dock')?.hidden === false ? r('#dock') : null;
    const log = r('.chat__log');
    const platter = r('.platter');
    const disc = r('.vinyl__disc');
    const label = r('.vinyl__label');
    const arm = r('.tonearm');
    const stage = r('.stage');
    const mood = r('.moodpanel');

    const bars = [...document.querySelectorAll('.moodmeter .bar i')].map((el) => Math.round(parseFloat(el.style.width) || 0));
    const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };

    return {
      boxes: { composer, dock, log, platter, disc, label, arm, stage, mood },
      bars,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      scrollY: document.documentElement.scrollHeight - window.innerHeight,
      colors: {
        body: cs('body', 'backgroundColor'),
        topbar: cs('.topbar', 'backgroundColor'),
        bubble: cs('.msg--bot .bubble', 'backgroundColor'),
        label: cs('.vinyl__label', 'backgroundImage')?.slice(0, 40),
        dockCaption: cs('.dock__caption', 'color')
      },
      overlaps: {
        dockComposer: overlaps(dock, composer),
        platterMood: overlaps(platter, mood)
      },
      visibility: {
        topbar: visible(document.querySelector('.topbar')),
        platter: visible(document.querySelector('.platter')),
        moodmeter: visible(document.querySelector('.moodmeter')),
        composer: visible(document.querySelector('.composer')),
        input: visible(document.querySelector('#input')),
        send: visible(document.querySelector('#sendBtn')),
        playBtn: visible(document.querySelector('#playPauseBtn')),
        scrub: visible(document.querySelector('#scrub')),
        dockCaption: visible(document.querySelector('#dockCaption'))
      },
      // The chat must keep usable vertical room for reading.
      logHeight: log?.h ?? 0,
      platterDiameter: platter?.w ?? 0
    };
  });

  const issues = [];
  if (report.overflow > 1) issues.push(`horizontal overflow ${report.overflow}px`);
  if (report.overlaps.dockComposer) issues.push('dock overlaps composer');
  if (report.overlaps.platterMood) issues.push('turntable overlaps mood panel');
  for (const [k, v] of Object.entries(report.visibility)) if (!v) issues.push(`${k} not visible`);
  if (report.logHeight < 90) issues.push(`chat log only ${report.logHeight}px tall`);
  if (report.platterDiameter < 120) issues.push(`turntable only ${report.platterDiameter}px`);

  console.log(`\n--- ${name} (${width}x${height}) ---`);
  console.log(`  overflow=${report.overflow}px  chat log=${report.logHeight}px  turntable=${report.platterDiameter}px`);
  console.log(`  mood bars: ${report.bars.join(' / ')}%`);
  console.log(`  platter ${JSON.stringify(report.boxes.platter)}`);
  console.log(`  label   ${JSON.stringify(report.boxes.label)}`);
  console.log(`  dock    ${JSON.stringify(report.boxes.dock)}`);
  console.log(`  composer${JSON.stringify(report.boxes.composer)}`);
  console.log(`  caption color: ${report.colors.dockCaption}`);
  console.log(issues.length ? `  ISSUES: ${issues.join('; ')}` : '  layout OK');
  if (issues.length) issues_total += issues.length;

  await page.close();
}

await browser.close();

console.log(`\n${'-'.repeat(58)}`);
console.log(issues_total ? `${issues_total} layout issue(s) found` : 'No layout issues at any breakpoint.');
if (issues_total) process.exitCode = 1;
