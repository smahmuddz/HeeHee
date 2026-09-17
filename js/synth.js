/**
 * Procedural arrangement engine.
 *
 * Each song carries key / bpm / scale / groove. This turns those into a real
 * backing track: drums, bass, chords, a lead line and vinyl surface noise.
 * Nothing is sampled from the records - it is generated from the song's own
 * musical DNA, so previews are distinct and royalty-free.
 *
 * Synthesis writes straight into Float32Arrays rather than building a Web Audio
 * node graph. That keeps a full 70-second arrangement at a few hundred
 * milliseconds and removes any dependency on OfflineAudioContext, so the same
 * code runs in Node for testing.
 *
 * Returns raw PCM; the player wraps it in an AudioBuffer for true scrubbing.
 */

/* ------------------------------------------------------------------ theory */

const NOTE = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10]
};

const PROGRESSIONS = {
  motown: [0, 3, 4, 3],
  'ballad-motown': [0, 5, 3, 4],
  disco: [0, 5, 3, 4],
  funk: [0, 6, 5, 4],
  'funk-rock': [0, 6, 4, 5],
  pop: [0, 4, 5, 3],
  rock: [0, 6, 3, 4],
  ballad: [0, 5, 3, 4],
  epoch: [0, 3, 4, 0]
};

/** Per-groove performance data. Steps are sixteenth notes in a 16-step bar. */
const D = {
  motown: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [2, 6, 10, 14], clap: [], tamb: [2, 6, 10, 14], swing: 0.10, bass: [[0, 1.4], [6, 0.6], [8, 1.4], [14, 0.6]], pad: 0.30, lead: 0.55, hatGain: 0.5, ghost: 0.5 },
  'ballad-motown': { kick: [0, 8], snare: [4, 12], hat: [4, 12], open: [], clap: [], tamb: [], swing: 0.06, bass: [[0, 3.4], [8, 3.4]], pad: 0.40, lead: 0.30, hatGain: 0.34, ghost: 0.3 },
  disco: { kick: [0, 4, 8, 12], snare: [4, 12], hat: [2, 6, 10, 14], open: [2, 6, 10, 14], clap: [4, 12], tamb: [2, 6, 10, 14], swing: 0, bass: [[0, 0.9], [2, 0.9], [4, 0.9], [6, 0.9], [8, 0.9], [10, 0.9], [12, 0.9], [14, 0.9]], pad: 0.34, lead: 0.62, hatGain: 0.46, ghost: 0.62 },
  funk: { kick: [0, 3, 6, 10, 11], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], open: [2, 6, 10, 14], clap: [4, 12], tamb: [], swing: 0.08, bass: [[0, 0.6], [3, 0.4], [6, 0.9], [10, 0.6], [11, 0.4], [14, 0.9]], pad: 0.22, lead: 0.72, hatGain: 0.4, ghost: 0.72 },
  'funk-rock': { kick: [0, 3, 6, 9, 11], snare: [4, 12], hat: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], open: [6, 14], clap: [4, 12], tamb: [], swing: 0, bass: [[0, 0.5], [2, 0.4], [4, 0.5], [6, 0.5], [8, 0.5], [10, 0.4], [12, 0.5], [14, 0.5]], pad: 0.18, lead: 0.75, hatGain: 0.42, ghost: 0.75 },
  pop: { kick: [0, 8], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [2, 6, 10, 14], clap: [12], tamb: [2, 6, 10, 14], swing: 0, bass: [[0, 1.4], [4, 0.6], [8, 1.4], [12, 0.6]], pad: 0.30, lead: 0.60, hatGain: 0.5, ghost: 0.55 },
  rock: { kick: [0, 3, 6, 8, 11, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [6, 14], clap: [12], tamb: [], swing: 0, bass: [[0, 0.9], [3, 0.5], [6, 0.9], [8, 0.9], [11, 0.5], [14, 0.9]], pad: 0.16, lead: 0.72, hatGain: 0.5, ghost: 0.68 },
  ballad: { kick: [0], snare: [8], hat: [8], open: [], clap: [], tamb: [], swing: 0.05, bass: [[0, 7.6]], pad: 0.46, lead: 0.34, hatGain: 0.24, ghost: 0.25 },
  epoch: { kick: [0, 8, 14], snare: [4, 12], hat: [0, 2, 4, 6, 8, 10, 12, 14], open: [6, 14], clap: [4, 12], tamb: [2, 6, 10, 14], swing: 0, bass: [[0, 1.6], [4, 1.4], [8, 1.6], [12, 1.4]], pad: 0.42, lead: 0.50, hatGain: 0.46, ghost: 0.5 }
};

export function grooveFor(name) {
  return D[name] || D.pop;
}

/* -------------------------------------------------------------- utilities */

function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

function rootMidi(key) {
  const match = /^([A-Ga-g][#b]?)(\d?)$/.exec(String(key).trim());
  if (!match) return 45;
  const letter = match[1][0].toUpperCase() + match[1].slice(1);
  const offset = NOTE[letter] ?? NOTE[match[1].toUpperCase()] ?? 0;
  const octave = match[2] ? Number(match[2]) : 3;
  return 12 * (octave + 1) + offset;
}

function scaleDegree(scale, root, degree, octaveShift = 0) {
  const n = scale.length;
  const octave = Math.floor(degree / n) + octaveShift;
  const step = ((degree % n) + n) % n;
  return root + scale[step] + octave * 12;
}

/* --------------------------------------------------------------- wavetables */

const TABLE_SIZE = 2048;
const TABLES = (() => {
  const build = (harmonics, phaseFn) => {
    const t = new Float32Array(TABLE_SIZE + 1);
    for (let i = 0; i < TABLE_SIZE; i++) {
      const p = i / TABLE_SIZE;
      let v = 0;
      for (const h of harmonics) v += phaseFn(h, p);
      t[i] = v;
    }
    let peak = 0;
    for (let i = 0; i < TABLE_SIZE; i++) peak = Math.max(peak, Math.abs(t[i]));
    if (peak > 0) for (let i = 0; i < TABLE_SIZE; i++) t[i] /= peak;
    t[TABLE_SIZE] = t[0];
    return t;
  };

  const range = (n) => Array.from({ length: n }, (_, i) => i + 1);
  const odd = (n) => range(n).filter((k) => k % 2 === 1);

  return {
    sine: build([1], (h, p) => Math.sin(2 * Math.PI * p)),
    // Band-limited to 20 harmonics: clean enough for a preview, no harsh aliasing.
    saw: build(range(20), (h, p) => Math.sin(2 * Math.PI * h * p) / h),
    square: build(odd(20), (h, p) => Math.sin(2 * Math.PI * h * p) / h),
    tri: build(odd(11), (h, p) => (h % 4 === 1 ? 1 : -1) * Math.sin(2 * Math.PI * h * p) / (h * h))
  };
})();

/** Linear-interpolated table read. Phase is in turns (0..1). */
function wave(table, phase) {
  const x = (phase - Math.floor(phase)) * TABLE_SIZE;
  const i = x | 0;
  const frac = x - i;
  const a = table[i];
  return a + (table[i + 1] - a) * frac;
}

/** Chamberlin state-variable filter, lowpass output. */
function svfFreq(hz, sr) {
  return Math.min(0.98, Math.max(0.001, 2 * Math.sin(Math.PI * Math.min(hz, sr * 0.24) / sr)));
}

/* ------------------------------------------------------------ instruments */

function kick(L, R, sr, start, gain) {
  const len = Math.min(L.length - start, Math.floor(0.42 * sr));
  if (len <= 0) return;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const x = i / sr;
    const freq = 44 + 106 * Math.exp(-x * 30);
    phase += freq / sr;
    const amp = Math.exp(-x * 8.4) * (1 - Math.exp(-x * 700));
    const s = wave(TABLES.sine, phase) * amp * 0.95 * gain;
    L[start + i] += s;
    R[start + i] += s;
  }
}

const NOISE_LEN = 1 << 15;
function noiseBuffer(rand) {
  const b = new Float32Array(NOISE_LEN);
  for (let i = 0; i < NOISE_LEN; i++) b[i] = rand() * 2 - 1;
  return b;
}

/** Reads a looping noise buffer with a per-voice random offset. */
function snare(L, R, sr, start, gain, noise, offset) {
  const len = Math.min(L.length - start, Math.floor(0.24 * sr));
  if (len <= 0) return;
  const f = svfFreq(1850, sr);
  const q1 = 1 / 0.7;
  let low = 0;
  let band = 0;
  let n = offset % NOISE_LEN;
  let tphase = 0;
  for (let i = 0; i < len; i++) {
    const x = i / sr;
    const input = noise[n];
    n = (n + 1) & (NOISE_LEN - 1);
    low += f * band;
    const high = input - low - q1 * band;
    band += f * high;
    // Two-stage decay: a loud crack then a short tail.
    const noiseEnv = Math.exp(-x * 26) + 0.35 * Math.exp(-x * 9);
    const tone = wave(TABLES.sine, tphase) * 0.22 * Math.exp(-x * 30);
    tphase += 190 / sr;
    const s = (band * 0.5 * noiseEnv + tone) * gain;
    L[start + i] += s * 0.94;
    R[start + i] += s;
  }
}

function hat(L, R, sr, start, noise, offset, open, gain) {
  const decay = open ? 11 : 62;
  const len = Math.min(L.length - start, Math.floor((open ? 0.28 : 0.075) * sr));
  if (len <= 0) return;
  let n = offset % NOISE_LEN;
  let lp1 = 0;
  let lp2 = 0;
  const a = 1 - Math.exp(-2 * Math.PI * 7200 / sr);
  for (let i = 0; i < len; i++) {
    const x = i / sr;
    const input = noise[n];
    n = (n + 1) & (NOISE_LEN - 1);
    lp1 += (input - lp1) * a;
    lp2 += (lp1 - lp2) * a;
    const hp = input - lp2;
    const s = hp * Math.exp(-x * decay) * 0.34 * gain;
    L[start + i] += s * 0.9;
    R[start + i] += s;
  }
}

function clap(L, R, sr, start, gain, noise, offset) {
  const f = svfFreq(1500, sr);
  const bursts = [0, 0.011, 0.022, 0.033];
  bursts.forEach((delay, bi) => {
    const t0 = start + Math.floor(delay * sr);
    const last = bi === bursts.length - 1;
    const len = Math.min(L.length - t0, Math.floor((last ? 0.2 : 0.05) * sr));
    if (len <= 0) return;
    let low = 0;
    let band = 0;
    let n = (offset + bi * 977) % NOISE_LEN;
    for (let i = 0; i < len; i++) {
      const x = i / sr;
      const input = noise[n];
      n = (n + 1) & (NOISE_LEN - 1);
      low += f * band;
      const high = input - low - (1 / 1.3) * band;
      band += f * high;
      const s = band * Math.exp(-x * (last ? 18 : 60)) * (last ? 0.4 : 0.24) * gain;
      L[t0 + i] += s * 0.92;
      R[t0 + i] += s;
    }
  });
}

function tambourine(L, R, sr, start, noise, offset, gain) {
  const len = Math.min(L.length - start, Math.floor(0.16 * sr));
  if (len <= 0) return;
  const f = svfFreq(5200, sr);
  let low = 0;
  let band = 0;
  let n = offset % NOISE_LEN;
  for (let i = 0; i < len; i++) {
    const x = i / sr;
    const input = noise[n];
    n = (n + 1) & (NOISE_LEN - 1);
    low += f * band;
    const high = input - low - (1 / 0.9) * band;
    band += f * high;
    const s = band * Math.exp(-x * 26) * 0.28 * gain;
    L[start + i] += s * 0.85;
    R[start + i] += s * 1.05;
  }
}

/** Saw bass with a resonant filter sweep and a sine sub. */
function bassNote(L, R, sr, start, dur, freq, gain) {
  const len = Math.min(L.length - start, Math.floor((dur + 0.05) * sr));
  if (len <= 0) return;
  const attack = 0.012;
  const release = Math.min(0.14, dur * 0.3);
  const fA = svfFreq(freq * 6.5, sr);
  const fB = svfFreq(Math.max(120, freq * 2.1), sr);
  let low = 0;
  let band = 0;
  let phase = 0;
  let subPhase = 0;
  const q1 = 1 / 6;
  for (let i = 0; i < len; i++) {
    const x = i / sr;
    let amp;
    if (x < attack) amp = x / attack;
    else if (x < dur - release) amp = 1;
    else amp = Math.max(0, (dur - x) / release);
    if (amp <= 0) break;

    const sweep = Math.min(1, x / Math.max(0.05, dur));
    const f = fA + (fB - fA) * sweep;

    phase += freq / sr;
    subPhase += freq * 0.5 / sr;
    const input = wave(TABLES.saw, phase);
    low += f * band;
    const high = input - low - q1 * band;
    band += f * high;

    const s = (low * 0.9 + wave(TABLES.sine, subPhase) * 0.5) * amp * 0.42 * gain;
    L[start + i] += s;
    R[start + i] += s;
  }
}

/** Detuned triangle stack through a slowly opening lowpass. */
function padChord(L, R, sr, start, dur, freqs, gain) {
  const len = Math.min(L.length - start, Math.floor((dur + 0.1) * sr));
  if (len <= 0) return;
  const voices = [];
  for (const f of freqs) {
    voices.push({ f: f * 0.997, phase: 0 });
    voices.push({ f: f * 1.003, phase: 0.25 });
  }
  const attack = Math.min(0.75, dur * 0.35);
  const release = Math.min(1.1, dur * 0.45);
  let low = 0;
  let band = 0;
  const q1 = 1 / 0.6;
  const per = (0.5 * gain) / voices.length;

  for (let i = 0; i < len; i++) {
    const x = i / sr;
    let amp;
    if (x < attack) amp = x / attack;
    else if (x < dur) amp = 1;
    else amp = Math.max(0, 1 - (x - dur) / release);
    if (amp <= 0) break;

    const cutoff = svfFreq(700 + 900 * Math.min(1, x / Math.max(0.5, dur)), sr);
    let sum = 0;
    for (const v of voices) {
      v.phase += v.f / sr;
      sum += wave(TABLES.tri, v.phase);
    }
    low += cutoff * band;
    const high = sum - low - q1 * band;
    band += cutoff * high;

    const s = low * amp * per;
    L[start + i] += s * 0.92;
    R[start + i] += s * 1.08;
  }
}

/** Square + saw lead. Writes dry into the mix and wet into the send buses. */
function leadNote(L, R, sendL, sendR, sr, start, dur, freq, gain) {
  const len = Math.min(L.length - start, Math.floor((dur + 0.04) * sr));
  if (len <= 0) return;
  const attack = 0.012;
  const release = Math.min(0.12, dur * 0.4);
  const fA = svfFreq(Math.min(5200, freq * 9), sr);
  const fB = svfFreq(Math.max(700, freq * 2.4), sr);
  let low = 0;
  let band = 0;
  let p1 = 0;
  let p2 = 0.37;
  const q1 = 1 / 3.5;

  for (let i = 0; i < len; i++) {
    const x = i / sr;
    let amp;
    if (x < attack) amp = x / attack;
    else if (x < dur - release) amp = 0.78;
    else amp = Math.max(0, (dur - x) / release * 0.78);
    if (amp <= 0) break;

    const sweep = Math.min(1, x / Math.max(0.04, dur));
    const f = fA + (fB - fA) * sweep;
    p1 += freq / sr;
    p2 += (freq * 1.004) / sr;
    const input = wave(TABLES.square, p1) * 0.6 + wave(TABLES.saw, p2) * 0.5;

    low += f * band;
    const high = input - low - q1 * band;
    band += f * high;

    const s = low * amp * gain;
    L[start + i] += s * 0.9;
    R[start + i] += s * 1.1;
    sendL[start + i] += s * 0.8;
    sendR[start + i] += s * 0.6;
  }
}

/* -------------------------------------------------------------- structure */

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/**
 * Render a complete arrangement to PCM.
 *
 * @returns {Promise<{sampleRate:number,length:number,duration:number,channels:Float32Array[]}>}
 */
export async function renderPcm(song, options = {}) {
  const {
    duration = song.duration || 66,
    sampleRate = 44100,
    drums = true,
    lead = true,
    vinyl = true,
    onProgress
  } = options;

  const length = Math.max(1, Math.ceil(duration * sampleRate));
  const L = new Float32Array(length);
  const R = new Float32Array(length);
  const sendL = new Float32Array(length);
  const sendR = new Float32Array(length);

  const rand = mulberry32(seedFrom(`${song.id}|${song.title}|${song.key}|${song.bpm}`));
  const noise = noiseBuffer(rand);
  const pat = grooveFor(song.groove);
  const scale = SCALES[song.scale] || SCALES.major;
  const root = rootMidi(song.key);
  const progression = PROGRESSIONS[song.groove] || PROGRESSIONS.pop;

  const step = (60 / song.bpm) / 4;
  const barLen = step * 16;
  const totalBars = Math.max(4, Math.floor(duration / barLen));

  const introEnd = Math.min(2, Math.floor(totalBars * 0.1));
  const buildEnd = introEnd + Math.min(2, Math.floor(totalBars * 0.12));
  const breakStart = Math.max(buildEnd + 2, totalBars - Math.max(3, Math.floor(totalBars * 0.16)));
  const breakEnd = Math.min(totalBars, breakStart + 2);

  const sampleAt = (t) => Math.floor(t * sampleRate);

  for (let bar = 0; bar < totalBars; bar++) {
    const barTime = bar * barLen;
    const inIntro = bar < introEnd;
    const inBuild = bar >= introEnd && bar < buildEnd;
    const inBreak = bar >= breakStart && bar < breakEnd;
    const isFull = !inIntro && !inBuild && !inBreak;

    const degree = progression[bar % progression.length];
    const chord = [
      scaleDegree(scale, root, degree),
      scaleDegree(scale, root, degree + 2),
      scaleDegree(scale, root, degree + 4)
    ];
    if (song.scale === 'minor' && bar % 4 === 3) chord.push(scaleDegree(scale, root, degree + 6));

    // ---- chords ----
    const padGain = pat.pad * (inIntro ? 1.25 : inBreak ? 1.1 : 1) * (inBuild ? 0.8 : 1);
    padChord(L, R, sampleRate, sampleAt(barTime), barLen * (inBreak ? 1.5 : 1.02),
      chord.map(midiToFreq), padGain);

    // ---- bass ----
    if (!inIntro) {
      const bassGain = isFull ? 1 : inBreak ? 0.6 : 0.72;
      for (const [s, len] of pat.bass) {
        const t = barTime + s * step;
        if (t >= duration) break;
        const bassDegree = s === 0 ? degree : (s % 8 === 0 ? degree + 4 : degree);
        bassNote(L, R, sampleRate, sampleAt(t), Math.min(len * step, duration - t),
          midiToFreq(scaleDegree(scale, root, bassDegree, -1)), bassGain);
      }
    }

    // ---- drums ----
    if (drums && !inIntro && !inBreak) {
      const swing = pat.swing || 0;
      const off = (s) => (s % 2 === 1 ? swing * step : 0);
      const level = isFull ? 1 : 0.78;
      for (const s of pat.kick) {
        const t = barTime + s * step + off(s);
        if (t < duration) kick(L, R, sampleRate, sampleAt(t), level);
      }
      for (const s of pat.snare) {
        const t = barTime + s * step + off(s);
        if (t < duration) snare(L, R, sampleRate, sampleAt(t), level * (isFull ? 1 : 0.7), noise, (rand() * NOISE_LEN) | 0);
      }
      for (const s of pat.hat) {
        const t = barTime + s * step + off(s);
        if (t >= duration) continue;
        const accented = s % 4 === 0;
        hat(L, R, sampleRate, sampleAt(t), noise, (rand() * NOISE_LEN) | 0, false,
          pat.hatGain * level * (accented ? 1.25 : 0.7));
      }
      if (isFull) {
        for (const s of pat.open) {
          const t = barTime + s * step;
          if (t < duration) hat(L, R, sampleRate, sampleAt(t), noise, (rand() * NOISE_LEN) | 0, true, pat.hatGain * 0.7);
        }
        for (const s of pat.clap) {
          const t = barTime + s * step;
          if (t < duration) clap(L, R, sampleRate, sampleAt(t), 0.55, noise, (rand() * NOISE_LEN) | 0);
        }
        for (const s of pat.tamb) {
          const t = barTime + s * step;
          if (t < duration) tambourine(L, R, sampleRate, sampleAt(t), noise, (rand() * NOISE_LEN) | 0, 0.85);
        }
      }
    }

    // ---- lead ----
    if (lead && !inIntro && (isFull || inBreak)) {
      const density = inBreak ? pat.lead * 0.5 : pat.lead;
      const contour = [];
      for (let i = 0; i < 8; i++) contour.push(rand() < 0.5 ? 1 : -1);
      let idx = 0;
      for (let s = 0; s < 16; s++) {
        if (rand() > density) continue;
        if (s % 2 === 1 && rand() < 0.4) continue;
        const t = barTime + s * step + (s % 2 === 1 ? (pat.swing || 0) * step : 0);
        if (t >= duration - 0.25) break;
        const len = rand() < 0.25 ? step * 1.5 : step * 0.9;
        const dir = contour[idx % contour.length];
        idx++;
        const shape = Math.round(Math.sin(idx / 3.1) * 2);
        const degreeOffset = degree + 2 + shape + dir;
        const octave = rand() < 0.25 ? 1 : 0;
        const gain = (inBreak ? 0.1 : 0.15) * (s % 4 === 0 ? 1.15 : 0.85);
        leadNote(L, R, sendL, sendR, sampleRate, sampleAt(t), Math.min(len, duration - t),
          midiToFreq(scaleDegree(scale, root, degreeOffset, octave)), gain);
      }
    }

    if (onProgress && bar % 4 === 0) onProgress(bar / totalBars);
    // Yield so the UI keeps breathing during longer arrangements.
    if (bar % 8 === 7) await new Promise((r) => setTimeout(r, 0));
  }

  // ---- stereo delay from the lead bus ----
  const delaySamples = Math.max(1, Math.floor(step * 3 * sampleRate));
  const taps = [[delaySamples, 0.30], [delaySamples * 2, 0.16]];
  for (const [d, g] of taps) {
    for (let i = d; i < length; i++) {
      L[i] += sendR[i - d] * g * 0.7;
      R[i] += sendL[i - d] * g * 0.7;
    }
  }

  // ---- vinyl surface noise ----
  if (vinyl) {
    let n = (rand() * NOISE_LEN) | 0;
    let lp = 0;
    const a = 1 - Math.exp(-2 * Math.PI * 3800 / sampleRate);
    for (let i = 0; i < length; i++) {
      const input = noise[n];
      n = (n + 1) & (NOISE_LEN - 1);
      lp += (input - lp) * a;
      let s = (input - lp) * 0.055;
      if (rand() < 0.00022) s += (rand() * 2 - 1) * 0.30;      // crackle
      L[i] += s * 0.9;
      R[i] += s * 1.1;
    }
  }

  // ---- master: soft clip and fades ----
  const fadeIn = Math.floor(0.35 * sampleRate);
  const fadeOutStart = Math.max(fadeIn + 1, Math.floor((duration - 1.8) * sampleRate));

  for (let i = 0; i < length; i++) {
    let l = Math.tanh(L[i] * 1.15) * 0.92;
    let r = Math.tanh(R[i] * 1.15) * 0.92;

    let g = 1;
    if (i < fadeIn) g = i / fadeIn;
    else if (i > fadeOutStart) g = clamp((length - i) / (length - fadeOutStart), 0, 1);
    if (g !== 1) { l *= g; r *= g; }

    L[i] = l;
    R[i] = r;
  }

  normalize([L, R], 0.86);
  onProgress?.(1);

  return { sampleRate, length, duration: length / sampleRate, channels: [L, R] };
}

/** Peak-normalise so every song feels equally loud. */
function normalize(channels, target) {
  let peak = 0;
  for (const data of channels) {
    for (let i = 0; i < data.length; i++) {
      const abs = data[i] < 0 ? -data[i] : data[i];
      if (abs > peak) peak = abs;
    }
  }
  if (!peak || peak < 0.0001) return channels;
  const scale = Math.min(4, target / peak);
  if (Math.abs(scale - 1) < 0.01) return channels;
  for (const data of channels) for (let i = 0; i < data.length; i++) data[i] *= scale;
  return channels;
}

export default { renderPcm, grooveFor };
