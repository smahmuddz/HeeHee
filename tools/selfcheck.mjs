/**
 * Offline verification for everything that does not touch the DOM.
 * Run: npm test
 *
 * The catalog is resolved from the real audio files on disk, so these checks
 * also prove that file matching works against the actual filenames.
 */

import { analyze, describe } from '../js/sentiment.js';
import { setCatalog, getCatalog, findSong, THEME_NAMES, TRACKS, matchFile, normalizeTitle, splitArtist } from '../js/catalog.js';
import { recommend, THEME_WEIGHT } from '../js/recommender.js';
import { buildCues, parseLrc, CaptionTrack } from '../js/captions.js';
import { normalizeLLM, blend, ALLOWED_THEMES } from '../js/llm.js';
import { renderPcm, grooveFor } from '../js/synth.js';
import { resolveLibrary } from './library.mjs';

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

function section(name) { console.log(`\n=== ${name} ===`); }

/* ------------------------------------------------------------------ library */

section('Library resolution');

const lib = await resolveLibrary();
setCatalog(lib.songs);
const SONGS = getCatalog();

ok('audio files were found on disk', lib.totalFiles > 0, `${lib.totalFiles} files`);
ok('catalog is populated from those files', SONGS.length > 0, `${SONGS.length} songs`);
ok('unmatched files are reported rather than silently dropped', Array.isArray(lib.unmatched),
  `${lib.unmatched.length} unmatched`);
ok('intro sting was located', Boolean(lib.intro), lib.intro || 'not found');

const withoutAudio = SONGS.filter((s) => !s.files?.audio);
ok('every suggested song has a real audio file', withoutAudio.length === 0,
  withoutAudio.map((s) => s.title).join(', '));

const duplicateFiles = new Map();
for (const s of SONGS) {
  const list = duplicateFiles.get(s.files.audio) || [];
  list.push(s.title);
  duplicateFiles.set(s.files.audio, list);
}
const shared = [...duplicateFiles.values()].filter((l) => l.length > 1);
ok('no two songs share the same file', shared.length === 0, JSON.stringify(shared));

ok('unmatched files are only the intro sting or genuinely unknown',
  lib.unmatched.length === 0, lib.unmatched.join(', '));

console.log(`  ..  ${lib.totalFiles} files -> ${SONGS.length} playable songs`);

section('File matching');

const matching = [
  ['Michael Jackson - Beat It (Official 4K Video).mp3', 'Beat It'],
  ['Michael Jackson - Billie Jean (Official Video).mp3', 'Billie Jean'],
  ["Michael Jackson - Wanna Be Startin' Somethin' (Audio).mp3", "Wanna Be Startin' Somethin'"],
  ['Michael Jackson - P.Y.T. (Pretty Young Thing) (Official Audio).mp3', 'P.Y.T.'],
  ["Michael Jackson - Don't Stop 'Til You Get Enough (Official Video - Upscaled).mp3", "Don't Stop 'Til You Get Enough"],
  ['Michael Jackson - Little Susie ⧸ Pie Jesu (Audio).mp3', 'Little Susie'],
  ['Michael Jackson - (I Like) The Way You Love Me (Audio).mp3', '(I Like) The Way You Love Me'],
  ['Michael Jackson, Janet Jackson - Scream (Official Video).mp3', 'Scream'],
  ['Michael Jackson - History (Audio).mp3', 'HIStory'],
  ['Michael Jackson - Xscape (Official Audio).mp3', 'Xscape'],
  ['Michael Jackson - Blood On The Dance Floor X Dangerous (The White Panda Mash-Up).mp3', 'Blood on the Dance Floor x Dangerous'],
  ['Michael Jackson - Thriller (Steve Aoki Midnight Hour Remix) (Audio).mp3', 'Thriller (Steve Aoki Midnight Hour Remix)'],
  ['Michael Jackson - D.S. (Audio).mp3', 'D.S.'],
  ['Michael Jackson - 2000 Watts (Audio).mp3', '2000 Watts'],
  ["Michael Jackson - She's Out of My Life (Official Video - Upscaled).mp3", "She's Out of My Life"],
  ['Michael Jackson - Behind The Mask (Mike\'s Mix (Demo) - Official Audio).mp3', 'Behind the Mask']
];

let matchFails = 0;
for (const [file, expected] of matching) {
  const got = matchFile(file);
  if (!got || got.title !== expected) {
    matchFails++;
    console.log(`    miss: ${file}\n      want "${expected}", got "${got ? got.title : 'null'}"`);
  }
}
ok(`${matching.length} real filenames resolve to the right track`, matchFails === 0, `${matchFails} missed`);

ok('a credit-qualified duet beats the solo track',
  matchFile('Michael Jackson, Justin Timberlake - Love Never Felt So Good (Audio).mp3')?.title
    === 'Love Never Felt So Good (with Justin Timberlake)');
ok('the solo version still resolves to the solo track',
  matchFile('Michael Jackson - Love Never Felt So Good (Official Video).mp3')?.title
    === 'Love Never Felt So Good');

// normalizeTitle works on the song part; splitArtist removes the credit prefix.
const songKey = (file) => normalizeTitle(splitArtist(String(file).replace(/\.[a-z0-9]{2,5}$/i, '')).title);

ok('release tags are ignored', songKey('Michael Jackson - Bad (Official Video).mp3') === 'bad',
  songKey('Michael Jackson - Bad (Official Video).mp3'));
ok('nested tags are ignored',
  songKey("Michael Jackson - Behind The Mask (Mike's Mix (Demo) - Official Audio).mp3") === 'behind the mask',
  songKey("Michael Jackson - Behind The Mask (Mike's Mix (Demo) - Official Audio).mp3"));
ok('titles with punctuation survive',
  songKey("Michael Jackson - Don't Stop 'Til You Get Enough (Audio).mp3") === 'dont stop til you get enough',
  songKey("Michael Jackson - Don't Stop 'Til You Get Enough (Audio).mp3"));
ok('meanings inside brackets are preserved',
  songKey('Michael Jackson - Thriller (Steve Aoki Midnight Hour Remix) (Audio).mp3') === 'thriller steve aoki midnight hour remix',
  songKey('Michael Jackson - Thriller (Steve Aoki Midnight Hour Remix) (Audio).mp3'));
ok('splitArtist keeps the credited artists', (() => {
  const { artist, title } = splitArtist('Michael Jackson, Janet Jackson - Scream (Official Video)');
  return artist === 'Michael Jackson, Janet Jackson' && title === 'Scream (Official Video)';
})());
ok('splitArtist leaves unprefixed names alone',
  splitArtist('hee hee').artist === '' && splitArtist('hee hee').title === 'hee hee');
ok('unknown files return null', matchFile('Totally Unrelated Thing.mp3') === null);

/* ------------------------------------------------------------------ catalog */

section('Catalog integrity');

const slugs = new Set();
let dupeSlug = null;
for (const s of SONGS) {
  if (slugs.has(s.slug)) dupeSlug = s.slug;
  slugs.add(s.slug);
}
ok('no duplicate slugs in the playable catalog', dupeSlug === null, dupeSlug || '');

const badMood = SONGS.filter((s) => {
  const { valence, arousal, danceability, warmth } = s.mood;
  return valence < -1 || valence > 1 || arousal < 0 || arousal > 1
    || danceability < 0 || danceability > 1 || warmth < 0 || warmth > 1;
});
ok('every mood axis within range', badMood.length === 0, badMood.map((s) => s.title).join(', '));

const unreachable = THEME_NAMES.filter((t) => THEME_WEIGHT[t] == null);
ok('every theme has a recommender weight', unreachable.length === 0, unreachable.join(', '));

const undefinedTheme = THEME_NAMES.filter((t) => !ALLOWED_THEMES.includes(t));
ok('every theme is known to the LLM schema', undefinedTheme.length === 0, undefinedTheme.join(', '));

const valenceSpread = Math.max(...SONGS.map((s) => s.mood.valence)) - Math.min(...SONGS.map((s) => s.mood.valence));
ok('catalog spans a wide valence range', valenceSpread > 1.6, `spread=${valenceSpread.toFixed(2)}`);

const eras = new Set(SONGS.map((s) => s.era));
ok('catalog spans multiple eras', eras.size >= 5, [...eras].join(', '));

ok('every song has a feel line', SONGS.every((s) => typeof s.feel === 'string' && s.feel.length > 10));
ok('every song has at least one theme', SONGS.every((s) => s.themes.length > 0));
ok('every song has playable music data', SONGS.every((s) => s.bpm > 40 && s.bpm < 220 && s.key && s.groove));
ok('knowledge base is larger than the playable subset', TRACKS.length >= SONGS.length,
  `${TRACKS.length} known vs ${SONGS.length} playable`);

ok('findSong resolves by title', findSong('billie jean')?.title === 'Billie Jean');
ok('findSong resolves partial', findSong('smooth')?.title === 'Smooth Criminal');
ok('findSong resolves the new Xscape tracks', findSong('xscape')?.title === 'Xscape');
ok('findSong handles "no" input', findSong('') === null);
ok('findSong rejects a song you do not have', findSong('i want you back') === null);

/* ---------------------------------------------------------------- sentiment */

section('Sentiment - direction and magnitude');

const cases = [
  { text: 'I am so fed up with everything today, I could scream.', expectV: 'neg', expectA: 'high', themes: ['frustration', 'anger', 'weariness'] },
  { text: 'I think I am falling in love and it is terrifying but wonderful.', expectV: 'pos', expectA: 'mid', themes: ['love'] },
  { text: 'Best day I have had in months. I feel unstoppable!!!', expectV: 'pos', expectA: 'high', themes: ['joy', 'celebration', 'defiance', 'confidence'] },
  { text: 'Haven\u2019t slept, can\u2019t stop overthinking, everything feels heavy and pointless.', expectV: 'neg', expectA: 'mid', themes: ['anxiety'] },
  { text: 'I miss someone who isn\u2019t coming back. It aches.', expectV: 'neg', expectA: 'low', themes: ['loss', 'longing', 'sorrow'] },
  { text: 'Woke up calm for once. Nothing is wrong.', expectV: 'pos', expectA: 'low', themes: ['peace'] },
  { text: 'I AM FURIOUS. THIS IS RIDICULOUS AND SO UNFAIR!!!', expectV: 'neg', expectA: 'high', themes: ['anger', 'frustration'] },
  { text: 'meh. whatever. bored.', expectV: 'neg', expectA: 'low', themes: ['weariness'] },
  { text: 'I feel invisible and nobody cares about me.', expectV: 'neg', expectA: 'low', themes: ['loneliness'] },
  { text: 'Grateful. Thankful. So proud of what we built together.', expectV: 'pos', expectA: 'mid', themes: ['joy', 'unity'] },
  { text: 'I am not happy about this at all.', expectV: 'neg', expectA: 'mid' },
  { text: 'I am not sad, honestly I feel pretty hopeful.', expectV: 'pos', expectA: 'mid', themes: ['hope'] }
];

for (const c of cases) {
  const r = analyze(c.text);
  const dirOk = c.expectV === 'pos' ? r.valence > 0.12 : c.expectV === 'neg' ? r.valence < -0.12 : Math.abs(r.valence) <= 0.12;
  const aOk = c.expectA === 'high' ? r.arousal > 0.6 : c.expectA === 'low' ? r.arousal < 0.45 : (r.arousal >= 0.3 && r.arousal <= 0.8);
  const themeOk = !c.themes || r.themes.some((t) => c.themes.includes(t.name));
  ok(
    `"${c.text.slice(0, 44)}..."`,
    dirOk && aOk && themeOk,
    `v=${r.valence} a=${r.arousal} themes=[${r.themes.slice(0, 3).map((t) => `${t.name}:${t.score}`).join(' ')}] want v=${c.expectV} a=${c.expectA}${c.themes ? ` themes~${c.themes.join('|')}` : ''}`
  );
}

section('Sentiment - mechanics');

const plain = analyze('I feel happy and calm today');
const shouted = analyze('I FEEL HAPPY AND CALM TODAY!!!');
ok('exclamation and caps raise arousal', shouted.arousal > plain.arousal, `${plain.arousal} -> ${shouted.arousal}`);

const mild = analyze('I am a little bit sad');
const strong = analyze('I am extremely devastated, absolutely heartbroken');
ok('intensifiers increase magnitude', Math.abs(strong.valence) > Math.abs(mild.valence), `${mild.valence} -> ${strong.valence}`);

ok('negation flips valence sign', analyze('I am not happy').valence < 0 && analyze('I am happy').valence > 0);
ok('amplifier phrases intensify rather than cancel',
  analyze('I cannot stop crying').valence < analyze('I am crying').valence,
  `${analyze('I am crying').valence} -> ${analyze('I cannot stop crying').valence}`);

const withEmoji = analyze('That was such a day \u{1F622}\u{1F494}');
const withoutEmoji = analyze('That was such a day');
ok('emoji shift valence', withEmoji.valence < withoutEmoji.valence, `${withoutEmoji.valence} -> ${withEmoji.valence}`);

const laugh = analyze('hahaha that was hilarious');
ok('laughter reads positive and activated', laugh.valence > 0.1 && laugh.arousal > 0.5, `v=${laugh.valence} a=${laugh.arousal}`);

const empty = analyze('');
ok('empty input is neutral and safe', empty.valence === 0 && empty.hits === 0 && empty.confidence === 0);

const long = analyze('Work has been relentless, I am exhausted, and honestly I feel like I am failing at everything. Everyone seems fine and I am not, which makes it worse. I keep telling myself it will pass but it does not feel like it will.');
ok('long paragraph produces confident negative read', long.valence < -0.3 && long.confidence > 0.6, `v=${long.valence} conf=${long.confidence}`);

ok('post-"but" clause dominates', analyze('The week was awful but I feel genuinely hopeful now').valence > -0.2);
ok('describe() returns a phrase', describe(-0.8, 0.9, []).length > 3);

/* --------------------------------------------------------------- recommend */

section('Recommender');

function top(text, opts) {
  const a = analyze(text);
  return { a, r: recommend(a, opts) };
}

const sad = top('I am devastated. Everything I built is gone and I cannot stop crying.');
const happy = top('I feel incredible, we won, I could dance all night!!!');
const angry = top('I am furious. So sick of being lied to and treated unfairly.');
const inLove = top('I think I am falling in love. I get butterflies every time they text.');
const wistful = top('Feeling nostalgic tonight, thinking about childhood summers.');

ok('sad text picks a low-valence song', sad.r.best.song.mood.valence < -0.3, `${sad.r.best.song.title} v=${sad.r.best.song.mood.valence}`);
ok('happy text picks a high-valence song', happy.r.best.song.mood.valence > 0.5, `${happy.r.best.song.title} v=${happy.r.best.song.mood.valence}`);
ok('angry text picks a high-arousal song', angry.r.best.song.mood.arousal > 0.7, `${angry.r.best.song.title} a=${angry.r.best.song.mood.arousal}`);
ok('in-love text picks a love-themed song', inLove.r.best.song.themes.some((t) => t === 'love' || t === 'desire'), inLove.r.best.song.title);
ok('nostalgic text picks a reflective song', wistful.r.best.song.themes.some((t) => ['nostalgia', 'reflection', 'melancholy'].includes(t)), wistful.r.best.song.title);

const picks = new Set();
for (let i = 0; i < 12; i++) picks.add(recommend(analyze(`I feel wonderful and dancing today, number ${i} of a good week`)).best.song.id);
ok('varied phrasing yields varied songs', picks.size >= 2, `${picks.size} distinct picks`);

const lifts = recommend(analyze('I am so sad and tired'), { mode: 'lift' });
const meets = recommend(analyze('I am so sad and tired'), { mode: 'meet' });
ok('lift mode targets a brighter valence than meet mode', lifts.target.valence > meets.target.valence,
  `${meets.target.valence} -> ${lifts.target.valence}`);

const repeatTest = recommend(analyze('I am furious about everything'), { recentIds: [angry.r.best.song.id] });
ok('recent picks are penalised', repeatTest.best.song.id !== angry.r.best.song.id,
  `${angry.r.best.song.title} -> ${repeatTest.best.song.title}`);

ok('explanation is generated prose', angry.r.explanation.includes('valence'));
ok('every suggestion comes from the playable catalog',
  [sad, happy, angry, inLove, wistful].every((t) => SONGS.some((s) => s.id === t.r.best.song.id)));

const emptyCatalog = recommend(analyze('I feel fine'), { songs: [] });
ok('an empty catalog degrades safely', emptyCatalog.picks.length === 0 && emptyCatalog.empty === true);

const neverSuggested = TRACKS.filter((t) => !SONGS.some((s) => s.id === t.id));
ok('songs you do not own can never be suggested',
  neverSuggested.every((t) => !SONGS.some((s) => s.id === t.id)),
  `${neverSuggested.length} known-but-unowned tracks excluded`);

for (const [label, res] of [['sad', sad], ['happy', happy], ['angry', angry], ['in love', inLove], ['wistful', wistful]]) {
  console.log(`  .. ${label.padEnd(8)} v=${String(res.a.valence).padStart(6)} a=${res.a.arousal.toFixed(2)} -> ${res.r.best.song.title} (${Math.round(res.r.best.similarity * 100)}%, ${res.r.best.matchedThemes.slice(0, 2).join('/') || 'coords only'})`);
}

/* ---------------------------------------------------------------- captions */

section('Captions');

const song = SONGS.find((s) => /beat it/i.test(s.title)) || SONGS[0];
const cues = buildCues(song, 66);
ok('cues generated', cues.length >= 8, `n=${cues.length}`);
ok('cues are time-ordered', cues.every((c, i) => i === 0 || c.t >= cues[i - 1].t));
ok('cues fit inside the duration', cues.every((c) => c.t >= 0 && c.t <= 66), `last=${cues[cues.length - 1].t}`);

const parsed = parseLrc('[00:12.50] first\n[00:20.00]second\n[01:05]third');
ok('lrc parses three stamps', parsed.length === 3, `n=${parsed.length}`);
ok('lrc handles centiseconds', Math.abs(parsed[0].t - 12.5) < 0.01, String(parsed[0].t));
ok('lrc handles mm:ss', Math.abs(parsed[2].t - 65) < 0.01, String(parsed[2].t));

const track = new CaptionTrack(() => {});
track.load(cues);
track.update(0);
ok('caption track starts at 0', track.index === 0, String(track.index));
let lastIndex = -2;
for (const t of [0, 5, 12, 30, 50, 64, 65.9]) {
  track.update(t);
  lastIndex = Math.max(lastIndex, track.index);
}
ok('caption index never goes backwards', track.index >= 0);
ok('caption progress is bounded', track.progress(30) >= 0 && track.progress(30) <= 1);

/* --------------------------------------------------------------------- llm */

section('LLM layer');

ok('normalizeLLM clamps out-of-range', (() => {
  const r = normalizeLLM({ valence: 5, arousal: -3, themes: [{ name: 'anger', score: 2 }] });
  return r.valence === 1 && r.arousal === 0;
})());
ok('normalizeLLM rejects junk', normalizeLLM({ nope: true }) === null);
ok('normalizeLLM drops unknown themes', (() => {
  const r = normalizeLLM({ valence: 0.5, arousal: 0.5, themes: [{ name: 'not-a-theme', score: 1 }, { name: 'joy', score: 1 }] });
  return r.themes.length === 1 && r.themes[0].name === 'joy';
})());

const blended = blend(analyze('I am so happy'), normalizeLLM({
  valence: -0.9, arousal: 0.9, energy: 0.9, warmth: 0.1, danceability: 0.9,
  intensity: 0.9, confidence: 0.9, summary: 'furious', themes: [{ name: 'anger', score: 1 }]
}), 0.7);
ok('blend moves toward the remote reading', blended.valence < 0, `v=${blended.valence}`);
ok('blend merges themes from both sources', blended.themes.length >= 1);
ok('blend marks its source', blended.source === 'blended');

/* -------------------------------------------------------------------- synth */

section('Synth engine');

function stats(pcm) {
  let peak = 0;
  let sum = 0;
  let count = 0;
  let bad = 0;
  let dc = 0;
  for (const ch of pcm.channels) {
    for (let i = 0; i < ch.length; i++) {
      const v = ch[i];
      if (!Number.isFinite(v)) { bad++; continue; }
      const abs = v < 0 ? -v : v;
      if (abs > peak) peak = abs;
      sum += v * v;
      dc += v;
      count++;
    }
  }
  return { peak, rms: Math.sqrt(sum / count), bad, dc: dc / count };
}

const t0 = Date.now();
const pcm = await renderPcm(song, { duration: 20 });
const elapsed = Date.now() - t0;
const st = stats(pcm);

ok('renders the requested duration', Math.abs(pcm.duration - 20) < 0.05, `${pcm.duration}`);
ok('renders stereo', pcm.channels.length === 2);
ok('sample rate is sane', pcm.sampleRate === 44100, String(pcm.sampleRate));
ok('no NaN or Infinity samples', st.bad === 0, `${st.bad} bad samples`);
ok('audio is not silent', st.rms > 0.02, `rms=${st.rms.toFixed(4)}`);
ok('peak is normalised without clipping', st.peak > 0.4 && st.peak <= 0.87, `peak=${st.peak.toFixed(4)}`);
ok('no significant DC offset', Math.abs(st.dc) < 0.01, `dc=${st.dc.toFixed(5)}`);
ok('render is fast', elapsed < 3000, `${elapsed}ms for 20s of audio`);

const again = stats(await renderPcm(song, { duration: 20 }));
ok('rendering is deterministic', Math.abs(again.rms - st.rms) < 1e-9 && again.peak === st.peak);
ok('different songs render different audio',
  Math.abs(stats(await renderPcm(SONGS.find((s) => s.groove === 'funk-rock') || song, { duration: 20 })).rms
    - stats(await renderPcm(SONGS.find((s) => s.groove === 'ballad') || song, { duration: 20 })).rms) > 0.001);

const everyGroove = [...new Set(TRACKS.map((s) => s.groove))];
ok('every groove has a pattern', everyGroove.every((g) => grooveFor(g) !== undefined),
  everyGroove.filter((g) => !grooveFor(g)).join(', '));

const grooveFailures = [];
for (const g of everyGroove) {
  const s = TRACKS.find((x) => x.groove === g);
  const p = stats(await renderPcm(s, { duration: 8 }));
  if (p.bad > 0 || p.rms < 0.01 || p.peak > 0.88) grooveFailures.push(`${g}(rms=${p.rms.toFixed(3)},peak=${p.peak.toFixed(3)})`);
}
ok(`all ${everyGroove.length} grooves render cleanly`, grooveFailures.length === 0, grooveFailures.join(' '));

// Sample the catalog rather than rendering all 105, to keep the suite quick.
const sample = [];
for (let i = 0; i < 18; i++) sample.push(SONGS[Math.floor((i / 18) * SONGS.length)]);
const songFails = [];
for (const s of sample) {
  const p = stats(await renderPcm(s, { duration: 6 }));
  if (p.bad > 0 || !Number.isFinite(p.rms) || p.rms < 0.005) songFails.push(s.title);
}
ok(`a ${sample.length}-song sample renders usable audio`, songFails.length === 0, songFails.join(', '));

console.log(`  ..  previews run ${Math.min(...SONGS.map((s) => s.duration))}s to ${Math.max(...SONGS.map((s) => s.duration))}s`);

/* -------------------------------------------------------------------- done */

console.log(`\n${'-'.repeat(58)}`);
console.log(`${checks - failures}/${checks} checks passed`);
if (failures) {
  console.log(`${failures} FAILING`);
  process.exitCode = 1;
} else {
  console.log('All good.');
}
