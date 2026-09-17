/**
 * Live caption track.
 *
 * Real lyrics are copyrighted, so captions are generated from the song's own
 * musical data: era, key, tempo, groove, themes and the annotated note. They
 * stay in sync with playback and scrub correctly.
 *
 * If you drop a real `audio/<slug>.lrc` next to a real audio file, that wins.
 */

const GROOVE_NOTES = {
  motown: 'Motown pocket: tambourine on the backbeat, bass walking in eighths, horns answering the voice',
  'ballad-motown': 'Slow Motown: brushes, wide vibrato, and the band leaving space for the vocal',
  disco: 'Four-on-the-floor kick, offbeat open hats, strings climbing over the top',
  funk: 'Funk grid: sixteenth-note hats, kick pushing the off-beats, bass popping the root',
  'funk-rock': 'Funk-rock collision: distorted power chords over a sixteenth-note pocket',
  pop: 'Straight pop backbeat, kick on one and three, hook landing every four bars',
  rock: 'Driving rock kit, palm-muted guitar stabs, snare cracking on two and four',
  ballad: 'Ballad tempo: sustained chords, almost no drums, everything in the vocal',
  epoch: 'Widescreen arrangement: choir-sized pads, tom fills, key change energy'
};

const AXIS_NOTES = [
  [0.7, 'Bright major-key territory - the melody resolves upward'],
  [0.3, 'Warm, settled harmony - tension and release kept gentle'],
  [-0.3, 'Modal, unresolved harmony - the chords never quite land home'],
  [-0.7, 'Minor key, dark voicings - the harmony leans into the ache'],
  [-2, 'Deep minor - the whole arrangement sits low and heavy']
];

function pickAxis(valence) {
  for (const [threshold, text] of AXIS_NOTES) if (valence >= threshold) return text;
  return AXIS_NOTES[AXIS_NOTES.length - 1][1];
}

function tempoWord(bpm) {
  if (bpm >= 145) return 'frantic';
  if (bpm >= 125) return 'furious';
  if (bpm >= 112) return 'driving';
  if (bpm >= 98) return 'steady';
  if (bpm >= 84) return 'unhurried';
  if (bpm >= 72) return 'slow';
  return 'very slow';
}

function feelOf(song) {
  const { valence, arousal, danceability, warmth } = song.mood;
  const bits = [];
  bits.push(tempoWord(song.bpm));
  if (danceability > 0.85) bits.push('built for the floor');
  else if (danceability < 0.4) bits.push('not a dancing song');
  if (warmth > 0.85) bits.push('arms-around-you warm');
  else if (warmth < 0.35) bits.push('cold at the edges');
  if (arousal > 0.85) bits.push('relentless');
  if (valence < -0.6) bits.push('genuinely bleak');
  return bits.join(', ');
}

/** Build the caption timeline for a song. */
export function buildCues(song, duration = song.duration || 66) {
  const cues = [];
  const push = (t, text, kind = 'line') => cues.push({ t: Math.max(0, t), text, kind });

  push(0, `${song.title.toUpperCase()} \u00b7 ${song.album} \u00b7 ${song.year}`, 'title');
  push(1.2, `${song.era} era \u00b7 ${song.key} ${song.scale} \u00b7 ${song.bpm} BPM \u00b7 ${feelOf(song)}`, 'meta');

  const body = [
    [0.10, GROOVE_NOTES[song.groove] || GROOVE_NOTES.pop, 'music'],
    [0.22, pickAxis(song.mood.valence), 'music'],
    [0.34, song.note, 'note'],
    [0.46, `Themes: ${song.themes.join(' \u00b7 ')}`, 'theme'],
    [0.58, song.feel, 'feel'],
    [0.70, `Mood coordinates \u2014 valence ${fmt(song.mood.valence)}, arousal ${fmt(song.mood.arousal)}, warmth ${fmt(song.mood.warmth)}, danceability ${fmt(song.mood.danceability)}`, 'data'],
    [0.82, `Still ${song.title} \u2014 ${song.album}, ${song.year}`, 'meta'],
    [0.92, 'Ride it out to the fade.', 'line']
  ];

  for (const [frac, text, kind] of body) {
    push(duration * frac, text, kind);
  }

  return cues;
}

function fmt(n) {
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}`;
}

/** Parse an .lrc file into cues. Supports [mm:ss.xx] and multiple timestamps. */
export function parseLrc(text) {
  const cues = [];
  const lines = String(text).split(/\r?\n/);
  for (const line of lines) {
    const stamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    if (!stamps.length) continue;
    const body = line.replace(/\[[^\]]*\]/g, '').trim();
    if (!body) continue;
    for (const s of stamps) {
      const min = Number(s[1]);
      const sec = Number(s[2]);
      const fracRaw = s[3] || '0';
      const frac = Number(fracRaw) / Math.pow(10, fracRaw.length);
      cues.push({ t: min * 60 + sec + frac, text: body, kind: 'lyric' });
    }
  }
  return cues.sort((a, b) => a.t - b.t);
}

/** Tracks which caption is live, with change notification. */
export class CaptionTrack {
  constructor(onChange) {
    this.cues = [];
    this.index = -1;
    this.onChange = onChange;
    this.karaoke = false;
  }

  load(cues, { karaoke = false } = {}) {
    this.cues = [...cues].sort((a, b) => a.t - b.t);
    this.karaoke = karaoke;
    this.index = -1;
    this.update(0, true);
  }

  get current() {
    return this.cues[this.index] || null;
  }

  get next() {
    return this.cues[this.index + 1] || null;
  }

  /** Progress through the current caption, 0..1, for karaoke wipes. */
  progress(time) {
    const cur = this.current;
    if (!cur) return 0;
    const end = this.next ? this.next.t : cur.t + 4;
    const span = Math.max(0.4, end - cur.t);
    return Math.min(1, Math.max(0, (time - cur.t) / span));
  }

  update(time, force = false) {
    if (!this.cues.length) return;
    let lo = 0;
    let hi = this.cues.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.cues[mid].t <= time + 0.001) { found = mid; lo = mid + 1; } else { hi = mid - 1; }
    }
    if (found !== this.index || force) {
      this.index = found;
      this.onChange?.(this.current, found, this.cues.length);
    }
  }
}

export default { buildCues, parseLrc, CaptionTrack };
