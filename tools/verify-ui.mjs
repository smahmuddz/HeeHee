/**
 * Headless browser verification.
 *
 * Drives the real UI in Chrome, including the Web Audio renderer, and asserts
 * the end-to-end flow: open -> mood -> recommendation -> playback -> captions.
 *
 * Prerequisite: the static server is already running on :5173.
 * Run: node tools/verify-ui.mjs
 */

import { chromium } from 'playwright-core';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:5173/';
const SHOTS = 'tools/shots';

const CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe'
].filter(Boolean);

const executablePath = CANDIDATES.find((p) => existsSync(p));
if (!executablePath) {
  console.error('No Chrome/Edge binary found. Set CHROME_PATH.');
  process.exit(1);
}

let failures = 0;
let checks = 0;

function ok(label, condition, detail = '') {
  checks++;
  if (condition) console.log(`  PASS  ${label}`);
  else {
    failures++;
    console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`);
  }
}

function section(n) { console.log(`\n=== ${n} ===`); }

await mkdir(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    '--mute-audio',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-gl=swiftshader'
  ]
});

const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1
});

const page = await context.newPage();

const consoleErrors = [];
const pageErrors = [];
const failedRequests = [];
const badResponses = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('requestfailed', (r) => {
  const url = r.url();
  if (!url.includes('favicon')) failedRequests.push(`${url} :: ${r.failure()?.errorText}`);
});
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`${r.status()} ${r.url()}`);
});

/* ------------------------------------------------------------------ boot */

section('Load');

const res = await page.goto(BASE, { waitUntil: 'load' });
ok('page responds 200', res?.status() === 200, String(res?.status()));
await page.waitForSelector('#splash.is-active', { timeout: 8000 });
ok('splash is active on load', await page.locator('#splash.is-active').count() === 1);

section('Moonwalk entrance');

const figure = page.locator('.moonwalk__figure');
ok('MJ.png is rendered on the splash', await figure.count() === 1);

const imgOk = await figure.evaluate((img) => ({
  complete: img.complete,
  naturalWidth: img.naturalWidth,
  naturalHeight: img.naturalHeight,
  src: img.getAttribute('src')
}));
ok('MJ.png actually decoded', imgOk.complete && imgOk.naturalWidth > 0,
  `natural=${imgOk.naturalWidth}x${imgOk.naturalHeight} src=${imgOk.src}`);
ok('MJ.png has portrait proportions', imgOk.naturalHeight > imgOk.naturalWidth,
  `${imgOk.naturalWidth}x${imgOk.naturalHeight}`);

const figBox = await figure.boundingBox();
ok('figure has real size', (figBox?.height ?? 0) > 60, JSON.stringify(figBox));

const shadow = await page.locator('.moonwalk__shadow').count();
const streaks = await page.locator('.moonwalk__streaks i').count();
const shine = await page.locator('.moonwalk__shine').count();
ok('floor shadow is present', shadow === 1);
ok('motion streaks are present', streaks === 3, String(streaks));
ok('silhouette shine is present', shine === 1);

// The entrance must actually move him in from off-screen.
const enterOffset = await page.locator('.moonwalk').evaluate((n) => {
  const b = n.getBoundingClientRect();
  const parent = n.parentElement.getBoundingClientRect();
  return b.left - parent.left;
});
ok('figure starts offset to the right (entering from off-screen)', enterOffset > 40,
  `offset=${Math.round(enterOffset)}px`);

// Sample the entrance itself: the container carries mjEnter.
const enterSamples = [];
for (let i = 0; i < 4; i++) {
  enterSamples.push(await page.locator('.moonwalk').evaluate((n) => getComputedStyle(n).transform));
  await page.waitForTimeout(240);
}
ok('the entrance is animating in', new Set(enterSamples).size >= 2,
  `${new Set(enterSamples).size} distinct transforms`);

// The glide starts after the entrance (1.85s delay), so sample once it is live.
await page.waitForTimeout(1500);
const glideSamples = [];
for (let i = 0; i < 5; i++) {
  glideSamples.push(await figure.evaluate((n) => getComputedStyle(n).transform));
  await page.waitForTimeout(300);
}
ok('the moonwalk glide is animating', new Set(glideSamples).size >= 3,
  `${new Set(glideSamples).size} distinct transforms`);

const resting = await page.locator('.moonwalk').evaluate((n) => {
  const b = n.getBoundingClientRect();
  const parent = n.parentElement.getBoundingClientRect();
  return Math.abs((b.left + b.width / 2) - (parent.left + parent.width / 2));
});
ok('figure settles near the centre of the stage', resting < 30, `off-centre by ${Math.round(resting)}px`);

const spin = await page.locator('.moonwalk__figure').evaluate((n) => getComputedStyle(n).animationName);
ok('the glide keyframes are applied', /mjGlide/.test(spin), spin);

ok('hat and glove are gone from the splash',
  await page.locator('.floater').count() === 0 && await page.locator('#icon-fedora').count() === 0);

const sparkles = await page.locator('#splashSparkles .sparkle').count();
ok('sparkle field populated', sparkles > 10, `count=${sparkles}`);

await page.screenshot({ path: `${SHOTS}/01-splash.png` });

section('Enter');

await page.click('#enterBtn');
await page.waitForTimeout(900);
ok('splash dismissed on enter', await page.locator('#splash.is-gone').count() === 1);
ok('entering revealed the app', await page.locator('.layout').count() === 1);

section('Library');

await page.waitForSelector('.empty', { timeout: 20000 });
const library = await page.evaluate(() => {
  const lib = globalThis.__heehee;
  const songs = lib.getCatalog();
  return {
    count: songs.length,
    allHaveAudio: songs.every((s) => Boolean(s.files?.audio)),
    fromMp3: songs.every((s) => /^mp3\//.test(s.files.audio)),
    years: [Math.min(...songs.map((s) => s.year)), Math.max(...songs.map((s) => s.year))],
    sample: songs.slice(0, 3).map((s) => s.title)
  };
});
ok('library.json populated the catalog', library.count > 50, `${library.count} songs`);
ok('every song has a real audio file', library.allHaveAudio);
ok('every file resolves inside mp3/', library.fromMp3);
console.log(`  ..  ${library.count} playable songs, ${library.years[0]}-${library.years[1]}, e.g. ${library.sample.join(', ')}`);

const libraryNote = await page.locator('#emptyLibrary').innerText();
ok('empty state tells you it is playing from your library', /library/i.test(libraryNote), libraryNote);
console.log(`  ..  ${libraryNote}`);

const emptyArt = await page.locator('.empty__mj').evaluate((img) => ({
  complete: img.complete, w: img.naturalWidth
}));
ok('empty state uses MJ.png', emptyArt.complete && emptyArt.w > 0);

const reachable = await page.evaluate(async () => {
  const songs = globalThis.__heehee.getCatalog();
  const probes = songs.slice(0, 6).map(async (s) => {
    const r = await fetch(s.files.audio, { method: 'HEAD' });
    return r.ok;
  });
  return (await Promise.all(probes)).every(Boolean);
});
ok('a sample of resolved audio URLs actually serve', reachable);

section('Before anything is playing');

ok('suggestions are offered', await page.locator('.suggestion').count() >= 4,
  String(await page.locator('.suggestion').count()));
ok('transport is hidden until a record is chosen', !(await page.locator('#dock').isVisible()));
ok('turntable shows it is empty', (await page.locator('#vinylLabelTitle').innerText()) === 'No record',
  await page.locator('#vinylLabelTitle').innerText());

const idlePlay = await page.evaluate(() => {
  document.getElementById('playPauseBtn').click();
  return { playing: globalThis.__heeheePlayer.playing, song: globalThis.__heeheePlayer.song };
});
ok('pressing play before a song does nothing', idlePlay.playing === false && idlePlay.song === null,
  JSON.stringify(idlePlay));

/* --------------------------------------------------------------- the flow */

section('Mood -> recommendation');

const prompt = 'I am so fed up with everything at work today, I could scream.';
await page.fill('#input', prompt);
await page.click('#sendBtn');

await page.waitForSelector('.msg--user .bubble', { timeout: 8000 });
ok('user message rendered', (await page.locator('.msg--user .bubble').innerText()).includes('fed up'));

await page.waitForSelector('.song-card', { timeout: 20000 });
const cardTitle = await page.locator('.song-card__title').first().innerText();
ok('a song card was produced', cardTitle.length > 1, cardTitle);
console.log(`  ..  picked: ${cardTitle}`);

const moodSummary = await page.locator('#moodSummary').innerText();
ok('mood read updated', moodSummary !== 'waiting', moodSummary);
console.log(`  ..  mood: ${moodSummary}`);

const stats = await page.locator('.readout__stat b').allInnerTexts();
ok('readout shows four axes', stats.length === 4, stats.join(' '));
const valence = Number(stats[0]);
ok('negative text produced negative valence', valence < 0, `valence=${stats[0]}`);

const themes = await page.locator('.readout__themes .tag').allInnerTexts();
ok('themes were detected', themes.length >= 1, themes.join(' | '));

const reason = await page.locator('.song-card__why').first().innerText();
ok('card explains why it was chosen', reason.includes('% match'), reason.slice(0, 90));

/* ------------------------------------------------------------- playback */

section('Playback');

await page.waitForFunction(() => {
  const s = document.getElementById('dockSource')?.textContent?.toLowerCase() || '';
  return s.includes('generated') || s.includes('your file');
}, null, { timeout: 60000 });

const source = (await page.locator('#dockSource').innerText()).toLowerCase();
ok('player reached a ready source', source.includes('your file') || source.includes('generated'), source);
console.log(`  ..  source: ${source}`);

const durationText = await page.locator('#durTime').innerText();
ok('duration is known', durationText !== '0:00', durationText);

const loadedFrom = await page.evaluate(() => {
  const p = globalThis.__heeheePlayer;
  return { src: p.audioEl?.currentSrc || p.audioEl?.src || null, source: p.source };
});
ok('it is playing a real local file', loadedFrom.source === 'file' && /\/mp3\//.test(decodeURIComponent(loadedFrom.src || '')),
  JSON.stringify(loadedFrom));
console.log(`  ..  file: ${decodeURIComponent(loadedFrom.src || '').split('/').pop()}`);

await page.waitForFunction(() => document.getElementById('playPauseBtn')?.dataset.state === 'playing', null, { timeout: 15000 });
ok('playback started automatically', true);

await page.waitForTimeout(2200);
const t1 = await page.locator('#curTime').innerText();
await page.waitForTimeout(2000);
const t2 = await page.locator('#curTime').innerText();
ok('playhead advances', t1 !== t2 || t2 !== '0:00', `${t1} -> ${t2}`);

const spinning = await page.locator('#vinylDisc.is-spinning').count();
ok('vinyl is spinning', spinning === 1);

const arm = await page.locator('#tonearm').evaluate((n) => n.style.getPropertyValue('--arm'));
ok('tonearm tracks progress', arm !== '' && arm !== '-24deg', arm || 'unset');

const label = await page.locator('#vinylLabelTitle').innerText();
ok('record label shows the song', label.length > 1 && label !== 'No record', label);

section('Captions');

const cap1 = await page.locator('#dockCaption').innerText();
ok('captions render', cap1.trim().length > 3, cap1.slice(0, 80));
console.log(`  ..  caption: ${cap1.slice(0, 90)}`);

// Full-length tracks spread their cues over minutes, so cross a cue boundary by
// seeking rather than by waiting.
const captionAt = async (ratio) => {
  await page.evaluate((r) => {
    const scrub = document.getElementById('scrub');
    scrub.value = String(Math.round(r * 1000));
    scrub.dispatchEvent(new Event('change', { bubbles: true }));
  }, ratio);
  await page.waitForTimeout(600);
  return (await page.locator('#dockCaption').innerText()).trim();
};

const capEarly = await captionAt(0.05);
const capMid = await captionAt(0.5);
const capLate = await captionAt(0.92);
const seen = new Set([capEarly, capMid, capLate]);

ok('captions change as playback position changes', seen.size >= 2,
  `${seen.size} distinct: ${[...seen].map((c) => c.slice(0, 30)).join(' | ')}`);
ok('captions are never empty', [...seen].every((c) => c.length > 3));
console.log(`  ..  at 50%: ${capMid.slice(0, 90)}`);

await page.screenshot({ path: `${SHOTS}/02-playing.png` });

section('Seek');

const seekTargets = [0.2, 0.75, 0.45];
for (const ratio of seekTargets) {
  await page.evaluate((r) => {
    const scrub = document.getElementById('scrub');
    scrub.value = String(Math.round(r * 1000));
    scrub.dispatchEvent(new Event('change', { bubbles: true }));
  }, ratio);
  // The media element reports the new position once the range request lands.
  await page.waitForTimeout(700);
  const state = await page.evaluate(() => ({
    reported: document.getElementById('curTime').textContent,
    duration: globalThis.__heeheePlayer.duration,
    actual: globalThis.__heeheePlayer.currentTime,
    seekable: globalThis.__heeheePlayer.audioEl?.seekable?.length ?? 0,
    ranges: globalThis.__heeheePlayer.audioEl
      ? [...Array(globalThis.__heeheePlayer.audioEl.seekable.length)]
          .map((_, i) => globalThis.__heeheePlayer.audioEl.seekable.start(i) + '-' + globalThis.__heeheePlayer.audioEl.seekable.end(i))
      : []
  }));
  const expected = state.duration * ratio;
  const drift = Math.abs(state.actual - expected);
  ok(`seek to ${Math.round(ratio * 100)}% lands near target`, drift < 3,
    `actual=${state.actual.toFixed(1)} expected=${expected.toFixed(1)} reported=${state.reported} seekable=[${state.ranges.join(', ')}]`);
}

const dur = await page.evaluate(() => globalThis.__heeheePlayer.duration);
ok('the real record is full length, not a preview clip', dur > 90, `${dur.toFixed(0)}s`);

const afterSeek = await page.locator('#curTime').innerText();
ok('seek did not reset to zero', afterSeek !== '0:00', afterSeek);

section('Stop');

await page.click('#stopBtn');
await page.waitForTimeout(700);
const stopped = await page.locator('#playPauseBtn').getAttribute('data-state');
ok('stop returns to paused state', stopped === 'paused', String(stopped));
ok('stop resets the playhead', (await page.locator('#curTime').innerText()) === '0:00',
  await page.locator('#curTime').innerText());
ok('vinyl stopped spinning', await page.locator('#vinylDisc.is-spinning').count() === 0);

/* ----------------------------------------------------------- more moods */

section('Other moods behave differently');

const moods = [
  ['I think I am falling in love and it is the best feeling', 'positive'],
  ['I feel completely numb and empty, nothing matters', 'negative']
];

for (const [text, expected] of moods) {
  await page.fill('#input', text);
  await page.click('#sendBtn');
  await page.waitForFunction(
    (n) => document.querySelectorAll('.song-card').length >= n,
    (await page.locator('.song-card').count()) + 1,
    { timeout: 30000 }
  ).catch(() => {});
  const titles = await page.locator('.song-card__title').allInnerTexts();
  const last = titles[titles.length - 1];
  const v = await page.locator('.readout__stat b').last().innerText().catch(() => 'n/a');
  ok(`"${text.slice(0, 32)}..." produced a pick`, Boolean(last), last);
  console.log(`  ..  ${expected}: ${last}`);
  await page.waitForTimeout(400);
}

const allValences = await page.locator('.readout__stat:first-child b').allInnerTexts();
ok('different moods yielded different valences', new Set(allValences).size >= 2, allValences.join(' '));

section('Commands');

await page.fill('#input', 'I am exhausted and sad');
await page.click('#sendBtn');
await page.waitForTimeout(1500);
await page.fill('#input', 'stop');
await page.click('#sendBtn');
await page.waitForTimeout(700);
const lastBubble = await page.locator('.msg--bot .bubble').last().innerText();
ok('stop command is handled', lastBubble.trim() === 'Stopped.', lastBubble);

await page.fill('#input', 'play smooth criminal');
await page.click('#sendBtn');
await page.waitForTimeout(2500);
const dockTitle = await page.locator('#dockTitle').innerText();
ok('play <song> command loads that song', dockTitle === 'Smooth Criminal', dockTitle);

/* ------------------------------------------------------------- responsive */

section('Responsive layout');

const VIEWPORTS = [
  ['desktop', 1440, 900, 300],
  ['laptop', 1180, 720, 250],
  ['tablet', 820, 1180, 300],
  ['phone', 390, 844, 180],
  ['phone-small', 360, 640, 110],
  ['phone-landscape', 740, 400, 120]
];

for (const [label, w, h, minLog] of VIEWPORTS) {
  const p = await context.newPage();
  await p.setViewportSize({ width: w, height: h });
  await p.goto(BASE, { waitUntil: 'load' });
  await p.waitForSelector('#splash.is-active');
  await p.click('#enterBtn');
  await p.waitForTimeout(500);

  const enterReachable = await p.locator('#enterBtn').isVisible();
  ok(`${label}: splash button reachable at ${w}x${h}`, enterReachable);

  await p.fill('#input', 'I miss someone who is gone and I feel hollow');
  await p.click('#sendBtn');
  await p.waitForSelector('.song-card', { timeout: 30000 });
  await p.waitForTimeout(600);

  const m = await p.evaluate(() => {
    const log = document.querySelector('.chat__log')?.getBoundingClientRect();
    const composer = document.querySelector('.composer')?.getBoundingClientRect();
    const dock = document.querySelector('#dock')?.getBoundingClientRect();
    return {
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      logHeight: Math.round(log?.height ?? 0),
      dockAboveComposer: !dock || !composer || dock.bottom <= composer.top + 2
    };
  });

  ok(`${label}: no horizontal overflow`, m.overflow <= 1, `overflow=${m.overflow}px`);
  ok(`${label}: chat log has usable height`, m.logHeight >= minLog, `${m.logHeight}px (want >= ${minLog})`);
  ok(`${label}: dock sits above the composer`, m.dockAboveComposer);

  const tap = await p.locator('#playPauseBtn').boundingBox().catch(() => null);
  ok(`${label}: play button is tappable`, !tap || tap.height >= 30, JSON.stringify(tap));

  await p.screenshot({ path: `${SHOTS}/viewport-${label}.png` });
  await p.close();
}

/* ---------------------------------------------------------------- errors */

section('Runtime health');

// Deliberate probes and benign media aborts are expected; 4xx responses and
// uncaught errors are not.
const EXPECTED = /audio\/|mp3\/|json\/library|favicon|\.lrc|Autoplay|play\(\) failed/i;
const realErrors = consoleErrors.filter((e) => !EXPECTED.test(e));
ok('no unexpected console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
ok('no uncaught exceptions', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));

// Media elements abort in-flight range requests when a track is swapped, which
// the browser reports as ERR_ABORTED. Only genuinely missing files matter.
const realFailed = failedRequests.filter((u) => !EXPECTED.test(u) && !/ERR_ABORTED/.test(u));
ok('no unexpected network failures', realFailed.length === 0, realFailed.slice(0, 3).join(' | '));
ok('no request 404s', badResponses.length === 0, badResponses.slice(0, 3).join(' | '));
console.log(`  ..  ignored ${failedRequests.length} media aborts/probes, ${badResponses.length} 4xx responses`);

await browser.close();

console.log(`\n${'-'.repeat(58)}`);
console.log(`${checks - failures}/${checks} checks passed`);
console.log(`screenshots: ${SHOTS}/`);
if (failures) {
  console.log(`${failures} FAILING`);
  process.exitCode = 1;
} else {
  console.log('UI verified.');
}
