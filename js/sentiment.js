/**
 * Mood analyzer.
 *
 * Reads free text into a continuous emotional vector. There is no word -> song
 * table anywhere in this file: it produces feelings, and the recommender decides
 * which song lives closest to those feelings.
 */

import {
  WORDS, PHRASES, EMOJI, NEGATORS, INTENSIFIERS, DIMINISHERS, AMPLIFIER_PHRASES,
  THEME_WORDS, LAUGHTER, CRYING_ASCII, CONFUSION
} from './lexicon.js';

const CONTRAST = new Set(['but', 'however', 'although', 'though', 'yet', 'still', 'anyway', 'whereas', 'except']);
// "so" is deliberately absent: it is far more useful as an intensifier
// ("so fed up") than as a clause boundary.
const CLAUSE_BREAK = new Set(['but', 'however', 'although', 'though', 'yet', 'and', 'because', 'then', 'while', 'when']);
const NEGATION_WINDOW = 3;

const clamp = (n, lo = 0, hi = 1) => (Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);
const round = (n, p = 3) => Number(n.toFixed(p));

/** Index phrases by their first word, longest first, for greedy longest-match. */
const PHRASE_INDEX = (() => {
  const idx = new Map();
  for (const phrase of Object.keys(PHRASES)) {
    const words = phrase.split(' ');
    const head = words[0];
    if (!idx.has(head)) idx.set(head, []);
    idx.get(head).push({ phrase, words, value: PHRASES[phrase] });
  }
  for (const list of idx.values()) list.sort((a, b) => b.words.length - a.words.length);
  return idx;
})();

const THEME_INDEX = (() => {
  const idx = new Map();
  for (const [theme, terms] of Object.entries(THEME_WORDS)) {
    for (const term of terms) {
      const key = term.toLowerCase();
      if (!idx.has(key)) idx.set(key, []);
      idx.get(key).push(theme);
    }
  }
  return idx;
})();

/** Split into word units while remembering where each word sat in the raw text. */
function wordUnits(text) {
  const units = [];
  const re = /[A-Za-z][A-Za-z'’-]*/g;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[0];
    const normalized = raw.toLowerCase().replace(/’/g, "'").replace(/-/g, '');
    const shrink = (w) => w.replace(/'/g, '');
    units.push({
      raw,
      index: units.length,
      start: m.index,
      end: m.index + raw.length,
      lower: normalized,
      compact: shrink(normalized),
      shouted: raw.length >= 3 && raw === raw.toUpperCase() && /[A-Z]/.test(raw)
    });
  }
  return units;
}

function findPhrase(units, i) {
  const head = units[i].lower;
  const candidates = PHRASE_INDEX.get(head) || PHRASE_INDEX.get(units[i].compact);
  if (!candidates) return null;
  for (const cand of candidates) {
    if (i + cand.words.length > units.length) continue;
    let ok = true;
    for (let k = 0; k < cand.words.length; k++) {
      const u = units[i + k];
      if (u.lower !== cand.words[k] && u.compact !== cand.words[k].replace(/'/g, '')) { ok = false; break; }
    }
    if (ok) return cand;
  }
  return null;
}

/** Punctuation / casing / rhythm signals that shape arousal without lexicons. */
function structural(text, units) {
  const bangs = (text.match(/!/g) || []).length;
  const qs = (text.match(/\?/g) || []).length;
  const ellipsis = /\.\.\.|…/.test(text);
  const shouted = units.filter((u) => u.shouted).length;
  const letters = text.replace(/[^A-Za-z]/g, '');
  const upperRatio = letters ? letters.replace(/[^A-Z]/g, '').length / letters.length : 0;
  const chars = text.trim().length;
  const laughter = LAUGHTER.test(text);
  const crying = CRYING_ASCII.test(text);
  const confusion = CONFUSION.test(text);
  const repeated = /(\b\w+\b)(?:\s+\1){2,}/i.test(text);
  const emojiCount = (Array.from(text).filter((c) => /\p{Extended_Pictographic}/u.test(c))).length;

  let arousal = 0.34;
  arousal += Math.min(0.30, bangs * 0.10);
  arousal += Math.min(0.16, shouted * 0.05);
  arousal += upperRatio > 0.4 && letters.length > 6 ? 0.14 : 0;
  arousal += repeated ? 0.14 : 0;
  arousal += laughter ? 0.20 : 0;
  arousal += crying ? 0.16 : 0;
  arousal += emojiCount ? Math.min(0.14, emojiCount * 0.05) : 0;
  arousal += confusion ? 0.06 : 0;
  arousal -= ellipsis ? 0.12 : 0;
  arousal -= qs > 0 && bangs === 0 ? 0.04 : 0;

  // Long, composed messages read calmer than three-word bursts.
  const lengthDamp = chars > 420 ? -0.16 : chars > 180 ? -0.09 : chars < 24 ? 0.08 : 0;
  arousal += lengthDamp;

  let valenceNudge = 0;
  if (laughter) valenceNudge += 0.22;
  if (crying) valenceNudge -= 0.28;
  if (upperRatio > 0.6 && letters.length > 8) valenceNudge -= 0.10;
  if (ellipsis && !laughter) valenceNudge -= 0.08;

  return {
    arousal: clamp(arousal),
    valenceNudge: clamp(valenceNudge, -1, 1),
    shouted, bangs, qs, ellipsis, laughter, crying, confusion, repeated, emojiCount, chars
  };
}

function collectEmoji(text) {
  const out = [];
  for (const ch of Array.from(text)) {
    if (/\p{Extended_Pictographic}/u.test(ch) && EMOJI[ch]) out.push(ch);
  }
  // Also catch VS16 sequences like ☹️ / ❤️
  for (const [key, value] of Object.entries(EMOJI)) {
    if (key.length > 1 && text.includes(key)) out.push(key);
  }
  return out.map((ch) => ({ emoji: ch, value: EMOJI[ch] }));
}

export function analyze(text) {
  const raw = String(text == null ? '' : text);
  const trimmed = raw.trim();

  if (!trimmed) {
    return {
      valence: 0, arousal: 0.34, energy: 0.3, warmth: 0.5, danceability: 0.45,
      intensity: 0, confidence: 0, themes: [], hits: 0, tokens: [],
      summary: 'neutral, unreadable', structural: structural('', []), input: raw
    };
  }

  const units = wordUnits(trimmed);
  const consumed = new Set();
  const consumedNegators = new Set();
  const hits = [];

  for (let i = 0; i < units.length; i++) {
    if (consumed.has(i)) continue;

    const phrase = findPhrase(units, i);
    let value = null;
    let matchedText = '';
    let matchedIndexes = [];

    if (phrase) {
      value = phrase.value;
      matchedText = phrase.phrase;
      matchedIndexes = phrase.words.map((_, k) => i + k);
    } else if (WORDS[units[i].lower]) {
      value = WORDS[units[i].lower];
      matchedText = units[i].lower;
      matchedIndexes = [i];
    }

    if (!value) continue;

    let [v, a] = value;
    let weight = 1;
    let negated = false;
    let amplifier = 1;

    // Local modifiers sitting just before the hit.
    // "cannot stop crying" must read as *more* crying, so amplifier phrases are
    // checked before the negator branch can swallow them. Matching one ends the
    // scan, otherwise the "not" inside "can't stop" would cancel it out again.
    for (let k = i - 1, scanned = 0; k >= 0 && scanned < NEGATION_WINDOW; k--, scanned++) {
      const u = units[k];
      if (CLAUSE_BREAK.has(u.lower)) break;

      const prev = k > 0 ? units[k - 1] : null;
      if (prev) {
        const bigram = `${prev.lower} ${u.lower}`;
        const bigramCompact = `${prev.compact} ${u.compact}`;
        const boost = AMPLIFIER_PHRASES[bigram] ?? AMPLIFIER_PHRASES[bigramCompact];
        if (boost != null) {
          amplifier *= boost;
          weight = Math.max(weight, 1.15);
          consumedNegators.add(k - 1);
          break;
        }
      }

      if (NEGATORS.has(u.lower) || NEGATORS.has(u.compact)) {
        negated = true;
        consumedNegators.add(k);
        weight = Math.max(weight, 1.25);
        break;
      }
      const intensifier = INTENSIFIERS[u.lower];
      if (intensifier != null) {
        amplifier *= intensifier;
        if (DIMINISHERS.has(u.lower)) weight *= 0.9;
        else weight = Math.max(weight, 1.1);
        continue;
      }
      if (!WORDS[u.lower] && !PHRASE_INDEX.has(u.lower)) continue;
      break;
    }

    // "not happy" is not the same as "sad" - dampen after flipping.
    if (negated) {
      v = -v * 0.78;
      a = a * 0.85;
    }
    v *= amplifier;
    a = a * (0.9 + 0.35 * (amplifier - 1));

    if (units[i].shouted && !negated) {
      weight *= 1.3;
      a += 0.06;
    }

    for (const k of matchedIndexes) consumed.add(k);

    hits.push({
      text: matchedText,
      at: i,
      valence: clamp(v, -1, 1),
      arousal: clamp(a),
      weight,
      negated,
      amplifier: round(amplifier, 2)
    });
  }

  // Emoji carry mood too.
  const emojiHits = collectEmoji(trimmed);
  for (const e of emojiHits) {
    hits.push({
      text: e.emoji, at: -1, valence: e.value[0], arousal: e.value[1],
      weight: 1, negated: false, amplifier: 1, emoji: true
    });
  }

  // Contrast weighting: what comes after "but" matters more.
  let seenContrast = false;
  for (const hit of hits) {
    if (hit.at < 0) continue;
    for (let k = 0; k < hit.at; k++) if (CONTRAST.has(units[k].lower)) seenContrast = true;
    hit.weight *= seenContrast ? 1.35 : 0.88;
  }

  const struct = structural(trimmed, units);
  const totalWeight = hits.reduce((s, h) => s + h.weight, 0);

  // A negation that never attached to anything still carries meaning:
  // "I am not." reads negative even though no sentiment word was found.
  const bareNegators = units.filter((u, i) => !consumedNegators.has(i)
    && (NEGATORS.has(u.lower) || NEGATORS.has(u.compact))).length;

  let valence = 0;
  let arousal = 0;
  if (hits.length) {
    let sumV = 0;
    let sumA = 0;
    for (const h of hits) { sumV += h.valence * h.weight; sumA += h.arousal * h.weight; }
    const avgV = sumV / totalWeight;
    const avgA = sumA / totalWeight;
    // A couple of words should not sound as certain as a whole paragraph.
    const coverage = Math.min(1, totalWeight / 3.2);
    const confidenceScale = 0.55 + 0.45 * coverage;
    // Arousal deserves more trust than valence at low coverage: one genuinely
    // activated word means the person really is activated.
    const arousalScale = 0.86 + 0.14 * coverage;
    // Amplified language moves the needle further from neutral.
    const push = clamp(1 + (totalWeight - hits.length) * 0.06, 1, 1.35);
    // Structural cues matter less once the words themselves are clear.
    const structWeight = 0.34 - 0.16 * coverage;
    valence = clamp(avgV * confidenceScale * push, -1, 1);
    arousal = clamp(avgA * arousalScale * push * (1 - structWeight) + struct.arousal * structWeight);
  } else {
    arousal = struct.arousal;
  }
  valence = clamp(valence - Math.min(0.24, bareNegators * 0.12), -1, 1);
  valence = clamp(valence + struct.valenceNudge * (hits.length ? 0.25 : 1), -1, 1);
  if (hits.length && struct.laughter) arousal = clamp(arousal + 0.08);
  if (hits.length && struct.crying) arousal = clamp(arousal + 0.06);

  const confidence = clamp(
    0.28 + Math.min(0.5, totalWeight * 0.13) + Math.min(0.22, struct.chars / 900)
  );

  // ---- themes ----
  // Match theme terms against the whole token stream, not just per-token, so a
  // multi-word phrase that was consumed as one sentiment hit ("fed up with")
  // still lights up its themes.
  const themeScores = new Map();
  const bump = (theme, amount) => themeScores.set(theme, (themeScores.get(theme) || 0) + amount);

  const stream = ` ${units.map((u) => u.lower).join(' ')} `;
  const hitStream = ` ${hits.map((h) => h.text).join(' ')} `;

  for (const [term, themes] of THEME_INDEX) {
    const needle = ` ${term} `;
    const inStream = stream.includes(needle);
    const inHit = hitStream.includes(needle);
    if (!inStream && !inHit) continue;
    const amount = inHit ? 1 : 0.55;
    for (const t of themes) bump(t, amount);
  }

  const themeTotal = [...themeScores.values()].reduce((a, b) => a + b, 0);
  const themes = [...themeScores.entries()]
    .map(([name, score]) => ({ name, score: round(themeTotal ? score / themeTotal : 0) }))
    .filter((t) => t.score >= 0.1)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  const themeWeight = (name) => themes.find((t) => t.name === name)?.score || 0;

  // ---- derived axes used for matching ----
  const intensity = clamp(Math.abs(valence) * 0.55 + arousal * 0.35 + struct.shouted * 0.05);
  const positiveLift = Math.max(0, valence);
  const energy = clamp(0.5 * arousal + 0.24 * intensity + 0.14 * (struct.bangs > 0 ? 1 : 0)
    + 0.12 * (struct.shouted > 0 ? 1 : 0) + 0.1 * Math.min(1, struct.chars / 300));
  const warmth = clamp(
    0.24 + 0.42 * positiveLift
    + 0.4 * (themeWeight('love') + themeWeight('compassion') + themeWeight('unity') + themeWeight('comfort'))
    - 0.22 * themeWeight('alienation')
  );
  const danceability = clamp(0.36 + 0.34 * arousal + 0.3 * positiveLift + 0.2 * themeWeight('celebration'));

  return {
    valence: round(valence),
    arousal: round(arousal),
    energy: round(energy),
    warmth: round(warmth),
    danceability: round(danceability),
    intensity: round(intensity),
    confidence: round(confidence),
    themes,
    hits: hits.length,
    tokens: hits.map((h) => ({
      text: h.text,
      valence: round(h.valence),
      arousal: round(h.arousal),
      weight: round(h.weight, 2),
      negated: h.negated
    })),
    summary: describe(valence, arousal, themes),
    structural: {
      bangs: struct.bangs, shouted: struct.shouted, laughter: struct.laughter,
      crying: struct.crying, ellipsis: struct.ellipsis, emoji: struct.emojiCount, chars: struct.chars
    },
    input: trimmed
  };
}

/** Turn a coordinate into words. Generated, not looked up. */
export function describe(valence, arousal, themes = []) {
  let core;
  if (valence <= -0.62) core = arousal >= 0.62 ? 'raw, churning anger' : arousal >= 0.36 ? 'deep grief' : 'heavy, quiet sorrow';
  else if (valence <= -0.34) core = arousal >= 0.66 ? 'hot frustration' : arousal >= 0.4 ? 'stung and unsettled' : 'low and worn down';
  else if (valence <= -0.12) core = arousal >= 0.66 ? 'wound up, on edge' : 'mildly off, uneasy';
  else if (valence < 0.16) core = arousal >= 0.72 ? 'buzzing but undefined' : arousal <= 0.24 ? 'flat and still' : 'steady, in between';
  else if (valence < 0.48) core = arousal >= 0.68 ? 'bright and restless' : 'gently lifted';
  else if (valence < 0.75) core = arousal >= 0.68 ? 'high, dancing energy' : 'warm and content';
  else core = arousal >= 0.68 ? 'pure euphoria' : 'deep, settled joy';

  const top = themes.slice(0, 2).map((t) => t.name);
  const tail = top.length ? ` (${top.join(' + ')})` : '';
  return core + tail;
}

export default { analyze, describe };
