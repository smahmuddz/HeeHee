/**
 * Optional LLM mood extraction.
 *
 * Off by default and never required. When configured it runs alongside the local
 * analyzer and the two readings are blended, which smooths out odd phrasing and
 * sarcasm. Any failure falls straight back to the local result.
 *
 * Works with any OpenAI-compatible /chat/completions endpoint.
 */

const STORE_KEY = 'heehee.llm';

export const ALLOWED_THEMES = [
  'love', 'desire', 'loss', 'grief', 'anger', 'defiance', 'anxiety', 'sadness',
  'loneliness', 'joy', 'celebration', 'hope', 'nostalgia', 'guilt', 'unity',
  'compassion', 'reflection', 'escapism', 'alienation', 'awe', 'weariness',
  'tension', 'obsession', 'paranoia', 'betrayal', 'heartbreak', 'tragedy',
  'melancholy', 'sensuality', 'intrigue', 'confidence', 'resilience', 'faith',
  'comfort', 'vulnerability', 'friendship', 'playfulness', 'injustice',
  'urgency', 'restlessness', 'cynicism', 'devotion', 'fear', 'frustration',
  'longing', 'peace', 'sorrow', 'renewal', 'anguish', 'intensity', 'tenderness', 'energy'
];

const SYSTEM_PROMPT = `You are an emotional-signal extractor. You do not recommend songs.
Read the user's message and return ONLY a JSON object with these fields:

{
  "valence": number,        // -1 (despair) .. 0 (neutral) .. +1 (radiant)
  "arousal": number,        //  0 (still/calm) .. 1 (activated/intense)
  "energy": number,         //  0 .. 1
  "warmth": number,         //  0 (cold) .. 1 (comforting/affectionate)
  "danceability": number,   //  0 .. 1
  "intensity": number,      //  0 .. 1, how strongly felt
  "confidence": number,     //  0 .. 1, how sure you are
  "summary": string,        // short phrase, max 6 words, describing the feeling
  "themes": [ { "name": string, "score": number } ]  // up to 5, scores 0..1, must sum near 1
}

Rules:
- Judge the whole message including sarcasm, negation and mixed feelings.
- allowed theme names: ${ALLOWED_THEMES.join(', ')}
- Never output prose, markdown or code fences. JSON only.`;

export function loadConfig() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return defaultConfig();
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

export function defaultConfig() {
  return {
    enabled: false,
    endpoint: 'https://api.openai.com/v1/chat/completions',
    model: 'gpt-4o-mini',
    apiKey: '',
    weight: 0.7,
    timeoutMs: 9000
  };
}

export function saveConfig(next) {
  const cfg = { ...loadConfig(), ...next };
  try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch { /* storage may be blocked */ }
  return cfg;
}

export function isConfigured() {
  const cfg = loadConfig();
  return Boolean(cfg.enabled && cfg.endpoint && cfg.apiKey);
}

const clamp = (n, lo = 0, hi = 1) => {
  const v = Number(n);
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : null;
};

function normalizeThemes(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const name = String(item?.name || '').trim().toLowerCase();
    const score = clamp(item?.score, 0, 1);
    if (!name || score == null) continue;
    if (!ALLOWED_THEMES.includes(name)) continue;
    out.push({ name, score });
  }
  const total = out.reduce((s, t) => s + t.score, 0);
  if (total > 0) for (const t of out) t.score = Number((t.score / total).toFixed(3));
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}

export function normalizeLLM(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const valence = clamp(raw.valence, -1, 1);
  const arousal = clamp(raw.arousal, 0, 1);
  if (valence == null || arousal == null) return null;
  const themes = normalizeThemes(raw.themes);
  return {
    valence,
    arousal,
    energy: clamp(raw.energy, 0, 1) ?? arousal,
    warmth: clamp(raw.warmth, 0, 1) ?? 0.5,
    danceability: clamp(raw.danceability, 0, 1) ?? arousal,
    intensity: clamp(raw.intensity, 0, 1) ?? Math.abs(valence),
    confidence: clamp(raw.confidence, 0, 1) ?? 0.7,
    themes,
    summary: String(raw.summary || '').trim().slice(0, 80) || 'reading your mood',
    source: 'llm'
  };
}

function extractJson(text) {
  if (!text) return null;
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Call the endpoint. Throws on failure so the caller can fall back. */
export async function analyzeWithLLM(text, cfg = loadConfig()) {
  if (!cfg.enabled || !cfg.endpoint || !cfg.apiKey) throw new Error('LLM not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.timeoutMs || 9000);
  try {
    const res = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${cfg.apiKey}`
      },
      body: JSON.stringify({
        model: cfg.model,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text }
        ]
      }),
      signal: controller.signal
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}`);
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    const parsed = normalizeLLM(extractJson(content));
    if (!parsed) throw new Error('LLM returned unusable JSON');
    return parsed;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Blend the local reading with the LLM reading.
 * The LLM gets `weight`; the local analyzer keeps the rest. Themes are merged.
 */
export function blend(local, remote, weight = 0.7) {
  if (!remote) return { ...local, source: 'local' };
  const w = clamp(weight, 0, 1);
  const mix = (a, b) => Number((a * (1 - w) + b * w).toFixed(3));

  const themeMap = new Map();
  for (const t of local.themes || []) themeMap.set(t.name, (themeMap.get(t.name) || 0) + t.score * (1 - w));
  for (const t of remote.themes || []) themeMap.set(t.name, (themeMap.get(t.name) || 0) + t.score * w);
  const total = [...themeMap.values()].reduce((a, b) => a + b, 0);
  const themes = [...themeMap.entries()]
    .map(([name, score]) => ({ name, score: Number((total ? score / total : 0).toFixed(3)) }))
    .filter((t) => t.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);

  return {
    ...local,
    valence: mix(local.valence, remote.valence),
    arousal: mix(local.arousal, remote.arousal),
    energy: mix(local.energy, remote.energy),
    warmth: mix(local.warmth, remote.warmth),
    danceability: mix(local.danceability, remote.danceability),
    intensity: mix(local.intensity, remote.intensity),
    confidence: Number(Math.max(local.confidence, remote.confidence * w).toFixed(3)),
    themes,
    summary: remote.summary || local.summary,
    source: 'blended'
  };
}

/**
 * Analyse text, preferring a blended reading when the LLM is configured.
 * Always resolves - never blocks the app.
 */
export async function analyzeMood(text, localResult) {
  const cfg = loadConfig();
  if (!cfg.enabled || !cfg.apiKey) return { ...localResult, source: 'local' };
  try {
    const remote = await analyzeWithLLM(text, cfg);
    return blend(localResult, remote, cfg.weight);
  } catch (err) {
    return { ...localResult, source: 'local', llmError: String(err?.message || err) };
  }
}

export default { loadConfig, saveConfig, isConfigured, analyzeWithLLM, blend, analyzeMood, ALLOWED_THEMES };
