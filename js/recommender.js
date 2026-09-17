/**
 * Song selection.
 *
 * The analyzer outputs a point in emotional space; every song owns a point in
 * the same space. Recommendation is nearest-neighbour ranking with theme
 * resonance and a recency penalty. There is no "if sad then song X" anywhere.
 *
 * A small deterministic jitter (seeded by the message itself) means the same
 * feeling on a different day can surface a different song without anything
 * being scripted.
 */

import { getCatalog } from './catalog.js';

const AXES = [
  { key: 'valence', weight: 1.55 },
  { key: 'arousal', weight: 1.15 },
  { key: 'danceability', weight: 0.60 },
  { key: 'warmth', weight: 0.85 }
];

/** Themes are not equally strong signals. */
export const THEME_WEIGHT = {
  love: 1.00, desire: 0.85, loss: 1.00, grief: 0.70, anger: 1.00, defiance: 0.90,
  anxiety: 1.00, sadness: 1.00, loneliness: 1.00, joy: 0.95, celebration: 0.80,
  hope: 0.85, nostalgia: 0.75, guilt: 0.80, unity: 0.85, compassion: 0.85,
  reflection: 0.80, escapism: 0.85, alienation: 0.95, awe: 0.75, weariness: 0.95,
  tension: 0.90, obsession: 0.85, paranoia: 0.95, betrayal: 1.00, heartbreak: 1.00,
  tragedy: 0.90, melancholy: 0.85, sensuality: 0.80, intrigue: 0.70, confidence: 0.80,
  resilience: 0.85, faith: 0.85, comfort: 0.95, vulnerability: 0.85, friendship: 0.85,
  playfulness: 0.70, injustice: 0.90, urgency: 0.85, restlessness: 0.85,
  cynicism: 0.80, mystery: 0.40, social: 0.50, 'social-justice': 0.90, danger: 0.60,
  devotion: 0.90, fear: 1.00, frustration: 1.00, longing: 0.95, peace: 0.80, sorrow: 0.90,
  renewal: 0.80, anguish: 1.00, intensity: 0.85, tenderness: 0.90, energy: 0.75
};

/** Deterministic PRNG so a given message always scores the same way. */
function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(a) {
  return function next() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_DIST = Math.sqrt(AXES.reduce((s, ax) => s + ax.weight, 0) * 4);

/**
 * @param {object} analysis  output of analyze()
 * @param {object} [opts]
 * @param {'meet'|'lift'} [opts.mode]  'meet' mirrors the mood, 'lift' nudges brighter
 * @param {string[]} [opts.recentIds]  songs played recently, lightly penalised
 * @param {number} [opts.count]  how many suggestions to rank
 * @param {object[]} [opts.songs]  override the active catalog
 */
export function recommend(analysis, opts = {}) {
  const { mode = 'meet', recentIds = [], count = 5 } = opts;
  const catalog = opts.songs || getCatalog();

  if (!catalog.length) {
    return { target: null, mode, picks: [], best: null, runnerUp: null, empty: true, explanation: 'No playable songs found.' };
  }

  // 'lift' targets a slightly brighter, more open version of the same feeling.
  const lift = mode === 'lift' ? 0.28 : 0;
  const target = {
    valence: clamp(analysis.valence * (1 - lift * 0.35) + lift, -1, 1),
    arousal: clamp(analysis.arousal * (1 - lift * 0.15) + lift * 0.10),
    danceability: clamp(analysis.danceability * (1 - lift * 0.1) + lift * 0.25),
    warmth: clamp(analysis.warmth * (1 - lift * 0.2) + lift * 0.35)
  };

  const themeMap = new Map((analysis.themes || []).map((t) => [t.name, t.score]));
  const rand = mulberry32(hashSeed(analysis.input || analysis.summary || 'x'));

  const scored = catalog.map((song) => {
    let sum = 0;
    const breakdown = [];
    for (const axis of AXES) {
      const delta = song.mood[axis.key] - target[axis.key];
      const term = axis.weight * delta * delta;
      sum += term;
      breakdown.push({ axis: axis.key, delta: round(delta, 2), term: round(term, 3) });
    }
    const distance = Math.sqrt(sum);
    const similarity = clamp(1 - distance / MAX_DIST);

    let themeScore = 0;
    const matchedThemes = [];
    for (const theme of song.themes) {
      const userHas = themeMap.get(theme);
      if (userHas == null) continue;
      const w = THEME_WEIGHT[theme] ?? 0.5;
      themeScore += userHas * w;
      matchedThemes.push(theme);
    }
    const themeBonus = Math.min(0.34, themeScore * 0.42);

    // Theme overlap matters most when the text was clearly emotional.
    const clarity = clamp(0.45 + analysis.confidence * 0.55);
    const weightedThemeBonus = themeBonus * clarity;

    const recentIndex = recentIds.indexOf(song.id);
    const recencyPenalty = recentIndex === -1 ? 0
      : recentIndex === 0 ? 0.40
        : recentIndex === 1 ? 0.28
          : 0.16;

    // Tiny deterministic texture so identical moods can vary day to day.
    const jitter = (rand() - 0.5) * 0.05;

    const score = similarity * 1.0 + weightedThemeBonus - recencyPenalty + jitter;

    return {
      song,
      score: round(score),
      similarity: round(similarity),
      themeBonus: round(weightedThemeBonus),
      recencyPenalty: round(recencyPenalty),
      distance: round(distance),
      matchedThemes: matchedThemes.sort((a, b) => (themeMap.get(b) || 0) - (themeMap.get(a) || 0)),
      breakdown
    };
  });

  scored.sort((a, b) => b.score - a.score);

  const top = scored.slice(0, count);
  return {
    target,
    mode,
    picks: top,
    best: top[0],
    runnerUp: top[1],
    explanation: explain(analysis, top[0], mode)
  };
}

function round(n, p = 3) { return Number(n.toFixed(p)); }
function clamp(n, lo = 0, hi = 1) { return Math.min(hi, Math.max(lo, n)); }

/** Plain-language justification, derived from the numbers rather than stored. */
export function explain(analysis, pick, mode) {
  if (!pick) return 'No songs in the catalog matched.';
  const { song } = pick;
  const v = analysis.valence;
  const a = analysis.arousal;
  const dir = v < -0.3 ? 'negative' : v > 0.3 ? 'positive' : 'ambivalent';
  const act = a > 0.66 ? 'highly activated' : a > 0.4 ? 'moderately activated' : 'low and still';

  const lines = [];
  lines.push(`You read ${v >= 0 ? '+' : ''}${v.toFixed(2)} valence and ${a.toFixed(2)} arousal - ${dir}, ${act}${analysis.themes.length ? `, carrying ${analysis.themes.slice(0, 3).map((t) => t.name).join(', ')}` : ''}.`);
  lines.push(`${song.title} sits at ${song.mood.valence >= 0 ? '+' : ''}${song.mood.valence.toFixed(2)} / ${song.mood.arousal.toFixed(2)} with ${song.mood.warmth.toFixed(2)} warmth - a ${pick.similarity >= 0.85 ? 'very close' : pick.similarity >= 0.7 ? 'close' : 'loose'} fit.`);
  if (pick.matchedThemes.length) lines.push(`Shared ground: ${pick.matchedThemes.slice(0, 3).join(', ')}.`);
  if (mode === 'lift') lines.push('Lift mode nudged the target brighter than what you wrote.');
  return lines.join(' ');
}

export default { recommend, explain, THEME_WEIGHT };
