/**
 * The active catalog.
 *
 * The knowledge base lives in `library.js`; this module holds the subset that is
 * actually playable on this machine, resolved from the audio files present.
 *
 * The app calls `setCatalog()` with what `/library.json` reports at boot, so it
 * can only ever suggest songs it can actually play. The default is deliberately
 * EMPTY: without a resolved library there is nothing to suggest, which is better
 * than offering songs that will not start.
 */

import { buildCatalog, TRACKS, THEME_NAMES as ALL_THEME_NAMES, matchFile, normalizeTitle, splitArtist } from './library.js';

let ACTIVE = [];
let BY_ID = new Map();
let LOADED = false;

export const THEME_NAMES = ALL_THEME_NAMES;
export { TRACKS, buildCatalog, matchFile, normalizeTitle, splitArtist };

/** Replace the active catalog. Accepts an array of songs or a library payload. */
export function setCatalog(input) {
  const songs = Array.isArray(input) ? input : (input?.songs || []);
  ACTIVE = songs.slice();
  BY_ID = new Map(ACTIVE.map((s) => [s.id, s]));
  LOADED = true;
  return ACTIVE;
}

export function getCatalog() {
  return ACTIVE;
}

export function isLoaded() {
  return LOADED;
}

export function byId(id) {
  return BY_ID.get(id) || null;
}

export function count() {
  return ACTIVE.length;
}

/** Look up a playable song by title, slug or partial title. */
export function findSong(query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return null;
  const slug = normalizeTitle(q).replace(/\s+/g, '-');
  return ACTIVE.find((s) => s.slug === slug)
    || ACTIVE.find((s) => s.title.toLowerCase() === q)
    || ACTIVE.find((s) => s.title.toLowerCase().includes(q))
    || ACTIVE.find((s) => s.slug.includes(slug))
    || null;
}

/** A few example queries for the empty state, picked from what is playable. */
export function catalogSummary() {
  if (!ACTIVE.length) return { count: 0, from: null, to: null };
  const years = ACTIVE.map((s) => s.year);
  return { count: ACTIVE.length, from: Math.min(...years), to: Math.max(...years) };
}

export default { getCatalog, setCatalog, findSong, byId, count, isLoaded, catalogSummary, THEME_NAMES };
