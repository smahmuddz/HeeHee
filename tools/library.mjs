/**
 * Resolve the playable catalog: the knowledge base in js/library.js intersected
 * with the audio files actually on disk.
 *
 * The dev server calls resolveLibrary() on every /library.json request, so
 * dropping a new mp3 into mp3/ and reloading is enough.
 *
 * Run directly to write the static library.json snapshot - the file a static
 * host such as Vercel has to serve - and print a report:
 *   npm run audio
 *   npm run build
 */

import { readdir, stat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCatalog, TRACKS, normalizeTitle } from '../js/library.js';

export const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Where the resolved snapshot is written. Must match what the app fetches. */
export const SNAPSHOT = 'library.json';

const AUDIO_EXT = /\.(mp3|m4a|ogg|opus|wav|flac|webm)$/i;

/** Directories scanned for playable audio, in priority order. */
export const AUDIO_DIRS = ['mp3', 'audio'];

/** URL-encode a relative path while keeping the separators. */
function toUrl(relPath) {
  return relPath.split(sep).map(encodeURIComponent).join('/');
}

async function listDir(dir) {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (!e.isFile() || !AUDIO_EXT.test(e.name)) continue;
      const info = await stat(join(dir, e.name)).catch(() => null);
      out.push({ name: e.name, bytes: info?.size ?? 0 });
    }
    return out;
  } catch {
    return [];
  }
}

/** Everything playable, newest-directory-wins on duplicate filenames. */
export async function listAudioFiles(root = ROOT) {
  const seen = new Set();
  const files = [];
  for (const dir of AUDIO_DIRS) {
    const full = join(root, dir);
    for (const { name, bytes } of await listDir(full)) {
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      files.push({ name, bytes, url: toUrl(relative(root, join(full, name))) });
    }
  }
  return files;
}

/** The intro sting is separate from the song catalog. */
async function findIntro(root) {
  const files = await listAudioFiles(root);
  const hit = files.find((f) => /hee\s*hee/i.test(f.name));
  return hit ? hit.url : null;
}

/** Any .lrc sitting next to the audio, keyed by normalised basename. */
export async function listLyrics(root = ROOT) {
  const map = new Map();
  for (const dir of AUDIO_DIRS) {
    let entries = [];
    try {
      entries = await readdir(join(root, dir), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !/\.lrc$/i.test(e.name)) continue;
      const key = normalizeTitle(e.name);
      if (!key || map.has(key)) continue;
      map.set(key, toUrl(relative(root, join(dir, e.name))));
    }
  }
  return map;
}

/**
 * @returns {Promise<{songs, intro, unmatched, variants, totalFiles, catalogSize, generatedAt}>}
 */
export async function resolveLibrary(root = ROOT) {
  const files = await listAudioFiles(root);
  const intro = await findIntro(root);
  const { songs, unmatched, variants } = buildCatalog(files);

  // Attach any matching .lrc so real lyrics replace the generated captions.
  const lyrics = await listLyrics(root);
  if (lyrics.size) {
    for (const song of songs) {
      const key = normalizeTitle(song.files.name);
      const hit = lyrics.get(key);
      if (hit) song.files.lrc = hit;
    }
  }

  // The intro sting is not a song; never report it as an unmatched track.
  const introName = intro ? decodeURIComponent(intro.split('/').pop()) : null;
  const realUnmatched = unmatched.filter((f) => f !== introName);

  const playable = new Set(songs.map((s) => s.files.name));
  const playableFiles = files.filter((f) => playable.has(f.name));

  return {
    songs,
    intro,
    unmatched: realUnmatched,
    variants,
    totalFiles: files.length,
    lyricFiles: [...lyrics.keys()].length,
    catalogSize: songs.length,
    knownTracks: TRACKS.length,
    playableBytes: playableFiles.reduce((sum, f) => sum + f.bytes, 0),
    totalBytes: files.reduce((sum, f) => sum + f.bytes, 0),
    largestBytes: files.reduce((max, f) => Math.max(max, f.bytes), 0),
    generatedAt: new Date().toISOString()
  };
}

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

/* ------------------------------------------------------------------ report */

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const lib = await resolveLibrary();
  // Written to the site root: this is exactly the URL the app fetches, and the
  // file a static host such as Vercel has to serve.
  await writeFile(join(ROOT, SNAPSHOT), `${JSON.stringify(lib, null, 2)}\n`, 'utf8');

  console.log(`Scanned ${lib.totalFiles} audio files.`);
  console.log(`Playable catalog: ${lib.catalogSize} songs (from ${lib.knownTracks} known tracks)`);
  console.log(`Lyric files: ${lib.lyricFiles}`);
  console.log(`Intro sting: ${lib.intro || 'not found (a synthesised hee hee will be used)'}`);
  console.log(`Wrote ${SNAPSHOT}\n`);

  if (lib.variants.length) {
    console.log(`${lib.variants.length} duplicate copies not used (the best one was picked):`);
    for (const v of lib.variants) console.log(`  ${v.title}\n      used: ${v.chosen}\n      kept aside: ${v.file}`);
    console.log('');
  }

  if (lib.unmatched.length) {
    console.log(`${lib.unmatched.length} files could not be matched to a profile, so they will NOT be suggested:`);
    for (const f of lib.unmatched) console.log(`  ${f}`);
    console.log('\nAdd their titles as aliases in js/library.js to include them.');
  } else {
    console.log('Every audio file matched a profile.');
  }

  // Deployment sanity: shipping the songs with the app only works while the
  // payload stays reasonable.
  console.log(`\nDeployment payload: ${mb(lib.playableBytes)} across ${lib.catalogSize} songs` +
    `${lib.largestBytes ? `, largest single file ${mb(lib.largestBytes)}` : ''}.`);
  if (lib.playableBytes > 800 * 1048576) {
    console.log('  Note: that is a heavy static payload. Vercel will deploy it but serve it');
    console.log('  slowly, and some plans reject it outright. The video-sourced rips are the');
    console.log('  big ones; album audio files are several times smaller.');
  }
  console.log('  After deploying, run:  npm run deploy:check -- https://your-deployment');
  console.log('  to confirm library.json and the audio files are actually reachable.');
}

export default { resolveLibrary, listAudioFiles, AUDIO_DIRS, ROOT };
