/**
 * Verifies the generated-arrangement fallback.
 *
 * Every song in your library has a real file, so this path is not normally
 * reached - but it is the safety net when a file is missing, unreadable or
 * corrupt, and it must not dead-end the app.
 *
 * Prerequisite: the static server is running on :5173.
 * Run: npm run verify:fallback
 */

import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173/';

let failures = 0;
let checks = 0;
function ok(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else { failures++; console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`); }
}

const exe = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].filter(Boolean).find(existsSync);

const browser = await chromium.launch({
  executablePath: exe,
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox']
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#splash.is-active');
  await page.click('#enterBtn');
  await page.waitForSelector('.empty', { timeout: 20000 });

  console.log('\n=== A missing file falls back to a generated arrangement ===');

  // Clone a real song but strip its audio, exactly as an unreadable file would.
  const result = await page.evaluate(async () => {
    const p = globalThis.__heeheePlayer;
    const source = globalThis.__heehee.getCatalog().find((s) => /beat it/i.test(s.title))
      || globalThis.__heehee.getCatalog()[0];
    const clone = { ...source, id: 'fallback-probe', files: { audio: null, name: null, lrc: null } };

    const phases = [];
    const originalOnState = p.hooks.onState;
    p.hooks.onState = (s) => { phases.push(s.phase); originalOnState?.(s); };

    const t0 = performance.now();
    await p.load(clone);
    const loadMs = Math.round(performance.now() - t0);
    await p.play();
    await new Promise((r) => setTimeout(r, 1600));
    const advanced = p.currentTime;
    p.pause();
    p.hooks.onState = originalOnState;

    return {
      phases,
      loadMs,
      source: p.source,
      duration: p.duration,
      advanced,
      hasBuffer: Boolean(p.buffer),
      hasElement: Boolean(p.audioEl)
    };
  });

  ok('the player fell back rather than failing', result.source === 'generated', String(result.source));
  ok('it rendered through the rendering phase', result.phases.includes('rendering'), result.phases.join(' > '));
  ok('a buffer was produced', result.hasBuffer && !result.hasElement);
  ok('the arrangement has a real duration', result.duration > 30, `${result.duration?.toFixed(1)}s`);
  ok('the fallback plays', result.advanced > 0.5, `advanced ${result.advanced?.toFixed(2)}s`);
  ok('rendering was quick', result.loadMs < 8000, `${result.loadMs}ms`);

  console.log(`  ..  ${result.phases.join(' > ')} (${result.loadMs}ms, ${result.duration.toFixed(0)}s)`);

  console.log('\n=== Seeking still works on a generated arrangement ===');
  const seek = await page.evaluate(async () => {
    const p = globalThis.__heeheePlayer;
    p.seek(p.duration * 0.5);
    const mid = p.currentTime;
    await p.play();
    await new Promise((r) => setTimeout(r, 900));
    const after = p.currentTime;
    p.stop();
    return { mid, after, duration: p.duration };
  });
  ok('seek jumps to the requested position', Math.abs(seek.mid - seek.duration * 0.5) < 0.5,
    `${seek.mid.toFixed(2)} of ${seek.duration.toFixed(2)}`);
  ok('playback continues from the seek point', seek.after > seek.mid, `${seek.mid.toFixed(2)} -> ${seek.after.toFixed(2)}`);

  ok('no uncaught exceptions', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
if (failures) process.exitCode = 1;
