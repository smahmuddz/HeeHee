/**
 * HeeHee - application wiring.
 *
 * Flow: you type -> analyze() reads the feeling -> recommend() finds the song
 * closest to that feeling -> Player loads it (your file, or a generated
 * arrangement) -> the vinyl spins and captions follow along in the dock.
 */

import { findSong, getCatalog, setCatalog, catalogSummary } from './catalog.js';
import { analyze, describe } from './sentiment.js';
import { recommend } from './recommender.js';
import { Player } from './player.js';
import { buildCues, parseLrc, CaptionTrack } from './captions.js';
import { runIntro, playHeeHee, spawnSparkles, setIntroSound } from './intro.js';
import { loadConfig, saveConfig, analyzeMood } from './llm.js';

/* ------------------------------------------------------------------ helpers */

const $ = (id) => document.getElementById(id);
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const total = Math.floor(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function signed(n) {
  return `${n >= 0 ? '+' : ''}${Number(n).toFixed(2)}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function toast(text, ms = 2600) {
  const node = document.createElement('div');
  node.className = 'toast';
  node.textContent = text;
  document.body.appendChild(node);
  setTimeout(() => {
    node.style.transition = 'opacity .3s ease';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 320);
  }, ms);
}

/* -------------------------------------------------------------- dom handles */

const el = {
  splash: $('splash'),
  splashSparkles: $('splashSparkles'),
  stageSparkles: $('stageSparkles'),
  log: $('log'),
  dock: $('dock'),
  dockCaption: $('dockCaption'),
  dockTitle: $('dockTitle'),
  dockSource: $('dockSource'),
  playPauseBtn: $('playPauseBtn'),
  stopBtn: $('stopBtn'),
  curTime: $('curTime'),
  durTime: $('durTime'),
  scrub: $('scrub'),
  vinylDisc: $('vinylDisc'),
  vinylLabel: $('vinylLabel'),
  vinylLabelKicker: $('vinylLabelKicker'),
  vinylLabelTitle: $('vinylLabelTitle'),
  vinylLabelMeta: $('vinylLabelMeta'),
  tonearm: $('tonearm'),
  platter: $('platter'),
  stage: document.querySelector('.stage'),
  stageGlow: $('stageGlow'),
  moodmeter: $('moodmeter'),
  moodSummary: $('moodSummary'),
  moodNote: $('moodNote'),
  composer: $('composer'),
  input: $('input'),
  sendBtn: $('sendBtn'),
  modeBtn: $('modeBtn'),
  modeText: $('modeText'),
  settingsBtn: $('settingsBtn'),
  settings: $('settings'),
  settingsForm: $('settingsForm'),
  saveSettings: $('saveSettings'),
  replayIntro: $('replayIntro'),
  llmEnabled: $('llmEnabled'),
  llmEndpoint: $('llmEndpoint'),
  llmModel: $('llmModel'),
  llmKey: $('llmKey'),
  llmWeight: $('llmWeight'),
  llmWeightOut: $('llmWeightOut'),
  llmStatus: $('llmStatus'),
  vol: $('vol'),
  volOut: $('volOut')
};

/* -------------------------------------------------------------------- state */

const state = {
  mode: 'meet',
  recent: [],
  lastAnalysis: null,
  lastRecommendation: null,
  activeSong: null,
  busy: false
};

const captions = new CaptionTrack((cue, index, total) => {
  renderCaption(cue, index, total);
});

const player = new Player({
  onState: handlePlayerState,
  onTime: handlePlayerTime,
  onEnded: handleTrackEnded
});

// Debug handle so the player and catalog can be inspected from devtools or a
// test harness.
globalThis.__heeheePlayer = player;
globalThis.__heehee = { state, analyze, recommend, player, captions, getCatalog };

/* ------------------------------------------------------------------- render */

function renderEmptyState() {
  const summary = catalogSummary();
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `
    <div class="empty__art" aria-hidden="true">
      <img class="empty__mj" src="Img/MJ.png" alt="">
    </div>
    <h2>Say it however it comes out.</h2>
    <p>A sentence, a paragraph, three tired words. I read the feeling behind it
       and put the record that matches on the turntable. No mood menus, no
       picking from a list.</p>
    <p class="empty__library" id="emptyLibrary"></p>
    <div class="suggestions" id="suggestions"></div>
  `;
  el.log.appendChild(wrap);

  const lib = wrap.querySelector('#emptyLibrary');
  lib.textContent = summary.count
    ? `Playing from your library: ${summary.count} tracks, ${summary.from}\u2013${summary.to}. Nothing outside this folder will ever be suggested.`
    : '';

  const examples = [
    'I am so fed up with everything today',
    'I think I am falling in love and it is terrifying',
    'Best day I have had in months, I feel unstoppable',
    'Haven\u2019t slept, can\u2019t stop overthinking, everything feels heavy',
    'I miss someone who isn\u2019t coming back',
    'Woke up calm for once. Nothing is wrong.'
  ];
  const host = wrap.querySelector('#suggestions');
  for (const text of examples) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'suggestion';
    b.textContent = text;
    b.addEventListener('click', () => {
      el.input.value = text;
      submit();
    });
    host.appendChild(b);
  }
}

function addUserMessage(text) {
  const node = document.createElement('div');
  node.className = 'msg msg--user';
  node.innerHTML = `<div class="msg__body"><div class="bubble">${escapeHtml(text)}</div></div>`;
  el.log.appendChild(node);
  scrollLog();
  return node;
}

function addBotShell() {
  const node = document.createElement('div');
  node.className = 'msg msg--bot';
  node.innerHTML = `
    <div class="msg__avatar" aria-hidden="true"><svg viewBox="0 0 200 230"><use href="#icon-glove"/></svg></div>
    <div class="msg__body"></div>
  `;
  el.log.appendChild(node);
  scrollLog();
  return node.querySelector('.msg__body');
}

function addTyping(body) {
  const node = document.createElement('div');
  node.className = 'bubble';
  node.innerHTML = '<span class="typing" aria-label="Thinking"><i></i><i></i><i></i></span>';
  body.appendChild(node);
  scrollLog();
  return node;
}

function scrollLog() {
  requestAnimationFrame(() => {
    el.log.scrollTop = el.log.scrollHeight;
  });
}

function renderReadout(analysis) {
  const card = document.createElement('div');
  card.className = 'readout';
  const themes = (analysis.themes || []).slice(0, 4);
  card.innerHTML = `
    <div class="readout__head">
      <span class="readout__title">Mood read</span>
      <span class="tag${analysis.confidence > 0.6 ? ' tag--hot' : ''}">${escapeHtml(analysis.source || 'local')} &middot; ${Math.round(analysis.confidence * 100)}% sure</span>
    </div>
    <div class="readout__grid">
      <div class="readout__stat"><span>Valence</span><b>${signed(analysis.valence)}</b></div>
      <div class="readout__stat"><span>Arousal</span><b>${analysis.arousal.toFixed(2)}</b></div>
      <div class="readout__stat"><span>Warmth</span><b>${analysis.warmth.toFixed(2)}</b></div>
      <div class="readout__stat"><span>Dance</span><b>${analysis.danceability.toFixed(2)}</b></div>
    </div>
    <div class="readout__themes">
      ${themes.length
        ? themes.map((t) => `<span class="tag${t.score > 0.35 ? ' tag--hot' : ''}">${escapeHtml(t.name)} ${(t.score * 100).toFixed(0)}%</span>`).join('')
        : '<span class="tag">no strong theme detected</span>'}
    </div>
  `;
  return card;
}

/** A card for a recommendation pick. */
function renderSongCard(pick, { primary = false } = {}) {
  const { song } = pick;
  const card = document.createElement('article');
  card.className = 'song-card';
  card.dataset.songId = song.id;
  card.style.setProperty('--c1', song.colors[0]);
  card.style.setProperty('--c2', song.colors[1]);
  card.innerHTML = `
    <div class="song-card__art" aria-hidden="true"><span class="song-card__disc"></span></div>
    <div class="song-card__body">
      <div class="song-card__head">
        <div>
          <h3 class="song-card__title">${escapeHtml(song.title)}</h3>
          <p class="song-card__meta">${escapeHtml(song.album)} &middot; ${song.year} &middot; ${song.era}</p>
        </div>
        ${primary ? `<span class="song-card__badge">${Math.round(pick.similarity * 100)}% fit</span>` : ''}
      </div>
      <p class="song-card__feel">${escapeHtml(song.feel)}</p>
      <p class="song-card__why">${escapeHtml(pick.reason || '')}</p>
      <div class="song-card__tags">
        ${song.themes.slice(0, 4).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}
      </div>
      <div class="song-card__actions">
        <button class="btn btn--primary" type="button" data-act="play">Play it</button>
        <button class="btn btn--ghost" type="button" data-act="alt">Something else</button>
      </div>
    </div>
  `;

  card.querySelector('[data-act="play"]').addEventListener('click', () => playSong(song, pick));
  card.querySelector('[data-act="alt"]').addEventListener('click', () => offerAlternative());
  return card;
}

/* ------------------------------------------------------------- player glue */

function setVinylLabel(song, kicker) {
  el.vinylLabel.style.setProperty('--c1', song ? song.colors[0] : '#2a2a32');
  el.vinylLabel.style.setProperty('--c2', song ? song.colors[1] : '#101015');
  el.vinylLabelKicker.textContent = kicker || (song ? song.era : 'ready');
  el.vinylLabelTitle.textContent = song ? song.title : 'No record';
  el.vinylLabelMeta.textContent = song ? `${song.album} \u00b7 ${song.year}` : '\u2014';
}

function setPlayButton(playing) {
  el.playPauseBtn.dataset.state = playing ? 'playing' : 'paused';
  el.playPauseBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function spinDisc(on) {
  el.vinylDisc.classList.toggle('is-spinning', on);
}

function updateTonearm(progress) {
  el.tonearm.style.setProperty('--arm', `${(-24 + progress * 26).toFixed(2)}deg`);
}

function handlePlayerState(payload) {
  const { phase, song, source } = payload;
  switch (phase) {
    case 'loading':
      el.dock.hidden = false;
      el.dockTitle.textContent = song ? song.title : '';
      el.dockCaption.querySelector('.dock__caption-text').textContent = 'Dropping the needle\u2026';
      el.dockSource.textContent = 'loading';
      el.playPauseBtn.disabled = true;
      break;
    case 'rendering':
      el.dockCaption.querySelector('.dock__caption-text').textContent = 'Cutting a fresh arrangement in this song\u2019s own key and tempo\u2026';
      el.dockSource.textContent = 'rendering';
      break;
    case 'ready':
      el.playPauseBtn.disabled = false;
      el.durTime.textContent = fmtTime(payload.duration);
      el.dockSource.textContent = source === 'file' ? 'your file' : 'generated';
      el.dockSource.title = source === 'file'
        ? 'Playing a real audio file from the audio folder.'
        : `Generated arrangement. Drop a real file at ${song.files.audio} to hear the original.`;
      setVinylLabel(song, source === 'file' ? `${song.era} \u00b7 vinyl` : `${song.era} \u00b7 generated`);
      loadCaptions(song, payload.duration);
      break;
    case 'playing':
      setPlayButton(true);
      spinDisc(true);
      el.stage.classList.add('is-playing');
      el.dock.classList.add('is-playing');
      break;
    case 'paused':
    case 'stopped':
      setPlayButton(false);
      spinDisc(false);
      el.stage.classList.remove('is-playing');
      el.dock.classList.remove('is-playing');
      if (phase === 'stopped') {
        el.scrub.value = 0;
        el.curTime.textContent = '0:00';
        updateTonearm(0);
      }
      break;
    case 'ended':
      setPlayButton(false);
      spinDisc(false);
      el.stage.classList.remove('is-playing');
      el.dock.classList.remove('is-playing');
      break;
    default:
      break;
  }
}

function handlePlayerTime(t) {
  const { time, duration, playing } = t;
  if (!scrubbing && duration > 0) {
    el.scrub.value = String(Math.round((time / duration) * 1000));
    el.curTime.textContent = fmtTime(time);
    updateTonearm(clamp(time / duration, 0, 1));
  }
  captions.update(time);

  // Real .lrc lyrics light up word by word as the line plays.
  if (captions.karaoke) {
    el.dockCaption.style.setProperty('--wipe', `${(captions.progress(time) * 100).toFixed(1)}%`);
  }

  // Vinyl-reactive glow.
  const levels = player.getLevels();
  if (levels) {
    let sum = 0;
    const n = Math.min(48, levels.length);
    for (let i = 0; i < n; i++) sum += levels[i];
    el.stageGlow.style.setProperty('--level', (sum / n / 255).toFixed(3));
  } else if (!playing) {
    el.stageGlow.style.setProperty('--level', '0');
  }
}

async function loadCaptions(song, duration) {
  const cues = buildCues(song, duration || song.duration);
  captions.load(cues);
  try {
    const url = await player.resolveLyrics(song);
    if (!url) return;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return;
    const parsed = parseLrc(await res.text());
    if (parsed.length) {
      captions.load(parsed, { karaoke: true });
      el.dockSource.textContent += ' + lrc';
    }
  } catch { /* no lrc, generated cues stay */ }
}

function renderCaption(cue, index, total) {
  const node = el.dockCaption;
  const textNode = node.querySelector('.dock__caption-text');
  const text = cue ? cue.text : 'Nothing playing yet.';
  if (textNode.textContent === text) return;

  node.classList.remove('is-title', 'is-lyric');
  if (cue?.kind === 'title' || cue?.kind === 'meta') node.classList.add('is-title');
  if (cue?.kind === 'lyric') node.classList.add('is-lyric');
  node.style.setProperty('--wipe', '0%');

  node.classList.add('is-swapping');
  setTimeout(() => {
    textNode.textContent = text;
    node.classList.remove('is-swapping');
  }, 130);
}

function handleTrackEnded(song) {
  if (!state.lastAnalysis || !state.lastRecommendation) return;
  const alt = state.lastRecommendation.picks.find((p) => p.song.id !== song?.id);
  if (!alt) return;

  const body = addBotShell();
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = `That was <strong>${escapeHtml(song.title)}</strong>. Still in the same headspace?`;
  body.appendChild(b);
  body.appendChild(renderSongCard({ ...alt, reason: alt.reason || buildReason(alt) }));
  scrollLog();
}

function playSong(song, pick) {
  state.activeSong = song;
  pushRecent(song.id);
  player.load(song).then(() => {
    player.play();
  }).catch((err) => {
    toast('Could not start playback: ' + err.message);
  });

  for (const card of el.log.querySelectorAll('.song-card')) {
    card.classList.toggle('song-card--active', card.dataset.songId === song.id);
  }
  el.dock.hidden = false;
  el.dockTitle.textContent = song.title;
  if (pick) el.dockCaption.querySelector('.dock__caption-text').textContent = song.feel;
}

function pushRecent(id) {
  state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 8);
  try { localStorage.setItem('heehee.recent', JSON.stringify(state.recent)); } catch { /* ignore */ }
}

/* -------------------------------------------------------------- the analyser */

function buildReason(pick) {
  const parts = [];
  if (pick.matchedThemes?.length) parts.push(`Shares ${pick.matchedThemes.slice(0, 2).join(' and ')} with what you wrote.`);
  parts.push(`Sits at ${signed(pick.song.mood.valence)} valence / ${pick.song.mood.arousal.toFixed(2)} arousal, a ${Math.round(pick.similarity * 100)}% match.`);
  return parts.join(' ');
}

/**
 * Attach a human-readable reason to every pick, generated from the numbers.
 * Also re-points `best`/`runnerUp` at the annotated copies, since those were
 * captured before the reasons existed.
 */
function annotatePicks(rec) {
  rec.picks = rec.picks.map((p) => ({ ...p, reason: buildReason(p) }));
  rec.best = rec.picks[0];
  rec.runnerUp = rec.picks[1];
  return rec;
}

function openerFor(a) {
  if (a.valence <= -0.6 && a.arousal >= 0.6) return 'That is a lot to be carrying, and it is coming out hot.';
  if (a.valence <= -0.6) return 'That sounds genuinely heavy. I am not going to pretend otherwise.';
  if (a.valence <= -0.3 && a.arousal >= 0.65) return 'Frustration with nowhere to go is its own kind of exhausting.';
  if (a.valence <= -0.3) return 'That reads low and worn down.';
  if (a.valence >= 0.7 && a.arousal >= 0.65) return 'Whatever is going on, it is working.';
  if (a.valence >= 0.7) return 'That is a warm, settled kind of good.';
  if (a.valence >= 0.3) return 'There is a lift in that.';
  if (a.arousal >= 0.7) return 'You are running fast, even if the feeling is not named.';
  if (a.arousal <= 0.25) return 'Flat and quiet. That counts as a mood too.';
  return 'Okay. Let me read that properly.';
}

async function submit() {
  const text = el.input.value.trim();
  if (!text || state.busy) return;

  state.busy = true;
  el.sendBtn.disabled = true;
  el.input.value = '';
  autosize();

  addUserMessage(text);

  // Commands keep the chat useful without pretending to be a mood.
  if (await handleCommand(text)) {
    state.busy = false;
    el.sendBtn.disabled = false;
    return;
  }

  const body = addBotShell();
  const typing = addTyping(body);

  const local = analyze(text);
  const analysis = await analyzeMood(text, local);

  state.lastAnalysis = analysis;
  renderMoodPanel(analysis);

  const rec = recommend(analysis, { mode: state.mode, recentIds: state.recent, count: 4 });
  annotatePicks(rec);
  state.lastRecommendation = rec;

  typing.remove();

  const opener = document.createElement('div');
  opener.className = 'bubble';
  opener.textContent = openerFor(analysis);
  body.appendChild(opener);

  body.appendChild(renderReadout(analysis));

  const lead = document.createElement('div');
  lead.className = 'bubble';
  const best = rec.best;
  lead.innerHTML = `Reading that as <strong>${escapeHtml(describe(analysis.valence, analysis.arousal, analysis.themes))}</strong>.
    The closest thing in the catalog is <strong>${escapeHtml(best.song.title)}</strong> &mdash; ${escapeHtml(best.song.feel.toLowerCase())}`;
  body.appendChild(lead);

  body.appendChild(renderSongCard(best, { primary: true }));

  const runnerUp = rec.picks[1];
  if (runnerUp) {
    const more = document.createElement('div');
    more.className = 'bubble';
    more.innerHTML = `<em>Also close: ${escapeHtml(runnerUp.song.title)} (${Math.round(runnerUp.similarity * 100)}%), ${escapeHtml(rec.picks[2]?.song.title || '')}${rec.picks[3] ? `, ${escapeHtml(rec.picks[3].song.title)}` : ''}</em>`;
    body.appendChild(more);
  }

  scrollLog();
  playSong(best.song, best);

  state.busy = false;
  el.sendBtn.disabled = false;
  el.input.focus();
}

async function handleCommand(text) {
  const t = text.toLowerCase().trim();

  if (/^(stop|pause|silence|quiet|shut up)\b/.test(t)) {
    player.stop();
    const body = addBotShell();
    addBubble(body, 'Stopped.');
    return true;
  }
  if (/^(next|another|something else|different|skip)\b/.test(t)) {
    if (!state.lastRecommendation) { addBubble(addBotShell(), 'Nothing is on yet. Tell me how you feel first.'); return true; }
    await offerAlternative();
    return true;
  }
  const playMatch = /^play\s+(.+)$/.exec(t);
  if (playMatch) {
    const song = findSong(playMatch[1]);
    const body = addBotShell();
    if (!song) { addBubble(body, `I could not find "${escapeHtml(playMatch[1])}" in the catalog.`); return true; }
    addBubble(body, `Playing <strong>${escapeHtml(song.title)}</strong>.`);
    playSong(song, null);
    return true;
  }
  if (/^(help|what can you do|\?)$/.test(t)) {
    const body = addBotShell();
    addBubble(body, 'Describe how you feel and I will pick the record. You can also say <strong>stop</strong>, <strong>next</strong>, or <strong>play beat it</strong>.');
    return true;
  }
  return false;
}

function addBubble(body, html) {
  const b = document.createElement('div');
  b.className = 'bubble';
  b.innerHTML = html;
  body.appendChild(b);
  scrollLog();
  return b;
}

async function offerAlternative() {
  if (!state.lastAnalysis) { toast('Tell me how you feel first.'); return; }
  const body = addBotShell();
  const rec = recommend(state.lastAnalysis, { mode: state.mode, recentIds: state.recent, count: 4 });
  annotatePicks(rec);
  state.lastRecommendation = rec;
  addBubble(body, 'Another angle on the same feeling:');
  body.appendChild(renderSongCard(rec.best, { primary: true }));
  scrollLog();
}

/* ------------------------------------------------------------ mood panel */

function renderMoodPanel(a) {
  for (const row of el.moodmeter.querySelectorAll('.moodmeter__row')) {
    const axis = row.dataset.axis;
    const raw = a[axis] ?? 0;
    const pct = axis === 'valence' ? ((raw + 1) / 2) * 100 : raw * 100;
    row.querySelector('.bar i').style.width = `${clamp(pct, 2, 100).toFixed(1)}%`;
    row.querySelector('.moodmeter__value').textContent = signed(raw);
  }
  el.moodSummary.textContent = a.summary;
  const themes = (a.themes || []).slice(0, 3).map((t) => t.name).join(', ');
  el.moodNote.textContent = themes
    ? `Leaning on ${themes}. Picked by emotional distance, not keywords.`
    : 'No strong theme came through, so this was matched on the mood coordinates alone.';
}

function renderMoodPanelEmpty() {
  for (const row of el.moodmeter.querySelectorAll('.moodmeter__row')) {
    row.querySelector('.bar i').style.width = '50%';
    row.querySelector('.moodmeter__value').textContent = signed(0);
  }
  el.moodSummary.textContent = 'waiting';
}

/* ------------------------------------------------------------------ compose */

function autosize() {
  el.input.style.height = 'auto';
  el.input.style.height = `${Math.min(148, el.input.scrollHeight)}px`;
}

/* -------------------------------------------------------------------- modes */

function setMode(mode) {
  state.mode = mode;
  const lift = mode === 'lift';
  el.modeBtn.setAttribute('aria-pressed', String(lift));
  el.modeText.textContent = lift ? 'Lift me up' : 'Meet me where I am';
  try { localStorage.setItem('heehee.mode', mode); } catch { /* ignore */ }
}

/* ---------------------------------------------------------------- scrubbing */

let scrubbing = false;
let resumeAfterScrub = false;
let scrubDuration = 0;

function beginScrub() {
  if (!player.song) return;
  if (scrubbing) return;
  scrubbing = true;
  scrubDuration = player.duration;
  resumeAfterScrub = player.playing;
  if (resumeAfterScrub) player.pause();
  el.vinylDisc.classList.add('is-held');
}

function previewScrub(ratio) {
  const t = clamp(ratio, 0, 1) * scrubDuration;
  el.curTime.textContent = fmtTime(t);
  updateTonearm(clamp(ratio, 0, 1));
  captions.update(t);
}

function endScrub(ratio, commit = true) {
  if (!scrubbing) return;
  scrubbing = false;
  el.vinylDisc.classList.remove('is-held');
  const t = clamp(ratio, 0, 1) * scrubDuration;
  if (commit) player.seek(t);
  if (resumeAfterScrub) player.play();
  resumeAfterScrub = false;
}

el.scrub.addEventListener('pointerdown', beginScrub);
el.scrub.addEventListener('input', () => {
  if (!scrubbing) beginScrub();
  previewScrub(Number(el.scrub.value) / 1000);
});
el.scrub.addEventListener('pointerup', () => endScrub(Number(el.scrub.value) / 1000));
el.scrub.addEventListener('pointercancel', () => endScrub(Number(el.scrub.value) / 1000, false));
el.scrub.addEventListener('change', () => {
  const ratio = Number(el.scrub.value) / 1000;
  if (scrubbing) { endScrub(ratio); return; }
  // A programmatic or assistive change with no drag: seek straight away.
  if (player.song) player.seek(ratio * (player.duration || 0));
});
el.scrub.addEventListener('keydown', () => {
  if (!scrubbing) beginScrub();
});
el.scrub.addEventListener('blur', () => {
  if (scrubbing) endScrub(Number(el.scrub.value) / 1000);
});

/* Dragging around the record itself: spin it with your finger. */
let dragAngle = null;
let dragAccum = 0;

function angleFromEvent(e) {
  const rect = el.platter.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  return Math.atan2(e.clientY - cy, e.clientX - cx);
}

function shortestDelta(from, to) {
  let d = to - from;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

el.platter.addEventListener('pointerdown', (e) => {
  if (!player.song) { toast('Nothing loaded yet. Tell me how you feel first.'); return; }
  el.platter.setPointerCapture(e.pointerId);
  beginScrub();
  dragAngle = angleFromEvent(e);
  dragAccum = 0;
  e.preventDefault();
});

el.platter.addEventListener('pointermove', (e) => {
  if (dragAngle == null || !scrubbing) return;
  const a = angleFromEvent(e);
  dragAccum += shortestDelta(dragAngle, a);
  dragAngle = a;
  const ratio = clamp((dragAccum / (Math.PI * 2)), -1, 1);
  const current = scrubDuration ? player.currentTime / scrubDuration : 0;
  const target = clamp(current + ratio, 0, 1);
  el.scrub.value = String(Math.round(target * 1000));
  previewScrub(target);
});

function endPlatterDrag(e) {
  if (dragAngle == null) return;
  const target = Number(el.scrub.value) / 1000;
  dragAngle = null;
  try { el.platter.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  endScrub(target);
}

el.platter.addEventListener('pointerup', endPlatterDrag);
el.platter.addEventListener('pointercancel', (e) => {
  dragAngle = null;
  try { el.platter.releasePointerCapture(e.pointerId); } catch { /* ok */ }
  endScrub(Number(el.scrub.value) / 1000, false);
});

/* Keyboard scrubbing on the platter. */
el.platter.addEventListener('keydown', (e) => {
  if (!player.song) return;
  const step = e.shiftKey ? 15 : 5;
  if (e.key === 'ArrowRight') { player.nudge(step); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { player.nudge(-step); e.preventDefault(); }
  if (e.key === ' ' || e.key === 'Enter') { player.toggle(); e.preventDefault(); }
});

/* ---------------------------------------------------------------- settings */

function openSettings() {
  const cfg = loadConfig();
  el.llmEnabled.checked = cfg.enabled;
  el.llmEndpoint.value = cfg.endpoint || '';
  el.llmModel.value = cfg.model || '';
  el.llmKey.value = cfg.apiKey || '';
  el.llmWeight.value = String(cfg.weight ?? 0.7);
  el.llmWeightOut.textContent = Number(el.llmWeight.value).toFixed(2);
  el.llmStatus.textContent = cfg.enabled && cfg.apiKey ? 'Blending with the local analyzer.' : 'Local analyzer only.';
  el.vol.value = String(player.volume);
  el.volOut.textContent = `${Math.round(player.volume * 100)}%`;
  if (typeof el.settings.showModal === 'function') el.settings.showModal();
  else el.settings.setAttribute('open', '');
}

el.settingsBtn.addEventListener('click', openSettings);

el.saveSettings.addEventListener('click', () => {
  saveConfig({
    enabled: el.llmEnabled.checked,
    endpoint: el.llmEndpoint.value.trim(),
    model: el.llmModel.value.trim() || 'gpt-4o-mini',
    apiKey: el.llmKey.value.trim(),
    weight: Number(el.llmWeight.value)
  });
  player.setVolume(Number(el.vol.value));
  el.settings.close?.();
  toast(el.llmEnabled.checked && el.llmKey.value.trim()
    ? 'Saved. LLM reading will blend with the local one.'
    : 'Saved. Using the local analyzer.');
});

el.replayIntro.addEventListener('click', () => {
  el.settings.close?.();
  playHeeHee();
  el.splash.classList.remove('is-gone', 'is-leaving');
  el.splash.removeAttribute('aria-hidden');
  el.splash.classList.add('is-active');
  setTimeout(() => {
    el.splash.classList.add('is-leaving');
    setTimeout(() => { el.splash.classList.add('is-gone'); el.splash.setAttribute('aria-hidden', 'true'); }, 620);
  }, 2600);
});

el.llmWeight.addEventListener('input', () => {
  el.llmWeightOut.textContent = Number(el.llmWeight.value).toFixed(2);
});

el.vol.addEventListener('input', () => {
  const v = Number(el.vol.value);
  el.volOut.textContent = `${Math.round(v * 100)}%`;
  player.setVolume(v);
});

/* -------------------------------------------------------------------- wire */

el.composer.addEventListener('submit', (e) => { e.preventDefault(); submit(); });

el.input.addEventListener('input', autosize);
el.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit();
  }
});

el.playPauseBtn.addEventListener('click', () => player.toggle());
el.stopBtn.addEventListener('click', () => player.stop());
el.modeBtn.addEventListener('click', () => {
  setMode(state.mode === 'meet' ? 'lift' : 'meet');
  toast(state.mode === 'lift'
    ? 'Lift mode: I will aim a little brighter than what you wrote.'
    : 'Meet mode: I will match exactly where you are.');
});

window.addEventListener('pagehide', () => player.stop({ silent: true }));

/* -------------------------------------------------------------------- boot */

async function boot() {
  try {
    const savedMode = localStorage.getItem('heehee.mode');
    if (savedMode === 'lift' || savedMode === 'meet') setMode(savedMode);
  } catch { /* fresh start */ }

  setMode(state.mode);
  setVinylLabel(null);
  renderMoodPanelEmpty();
  autosize();
  spawnSparkles(el.splashSparkles, 26);
  spawnSparkles(el.stageSparkles, 16);

  runIntro({ onEnter: () => { el.input.focus({ preventScroll: true }); } });

  await loadLibrary();
}

/** Pull the playable catalog, which is the knowledge base minus what you do not have. */
async function loadLibrary() {
  try {
    const res = await fetch('library.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`library.json responded ${res.status}`);
    const data = await res.json();
    setCatalog(data.songs || []);
    setIntroSound(data.intro);

    try {
      const savedRecent = JSON.parse(localStorage.getItem('heehee.recent') || '[]');
      const ids = new Set(getCatalog().map((s) => s.id));
      state.recent = Array.isArray(savedRecent) ? savedRecent.filter((x) => ids.has(x)) : [];
    } catch { state.recent = []; }

    renderEmptyState();
    updateLibraryBadge(data);
  } catch (err) {
    renderLibraryError(err);
  }
}

function updateLibraryBadge(data) {
  const summary = catalogSummary();
  el.moodNote.textContent = summary.count
    ? `${summary.count} of your tracks are in play (${summary.from}\u2013${summary.to}). Matched by emotional distance, never by keywords.`
    : 'No playable audio found.';

  if (data?.unmatched?.length) {
    console.warn(
      `[HeeHee] ${data.unmatched.length} audio file(s) have no emotional profile and will not be suggested:\n` +
      data.unmatched.map((f) => `  ${f}`).join('\n') +
      '\nAdd a profile for each in js/library.js.'
    );
  }
}

function renderLibraryError(err) {
  const wrap = document.createElement('div');
  wrap.className = 'empty';
  wrap.innerHTML = `
    <h2>I cannot see your music.</h2>
    <p>HeeHee reads <code>library.json</code> to find out which songs you actually
       have, and only ever suggests those. That file is generated by the local
       server, so the page needs to be opened through it rather than as a file.</p>
    <p><code>npm start</code> then open <code>http://localhost:5173/</code></p>
  `;
  el.log.appendChild(wrap);
  el.sendBtn.disabled = true;
  el.input.disabled = true;
  el.input.placeholder = 'Waiting for your library\u2026';
  console.error('[HeeHee] could not load library.json:', err);
}

boot();
