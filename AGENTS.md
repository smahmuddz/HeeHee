# AGENTS.md

## Project

HeeHee - a static web app. Plain HTML/CSS/ES modules, no bundler, no framework, no runtime
dependencies. `playwright-core` is a dev dependency used only by the verification scripts and
resolves against a locally installed Chrome/Edge.

The app suggests Michael Jackson songs **only from the audio files on disk** (`mp3/` and `audio/`).
`js/library.js` holds the emotional knowledge base; `js/catalog.js` holds the playable subset.

## Commands

| command | purpose |
| --- | --- |
| `npm start` | static server on http://localhost:5173/ (needed: ES modules, fetch and byte ranges) |
| `npm test` | offline checks: library matching, sentiment, recommender, catalog, captions, synth DSP |
| `npm run verify` | end-to-end in headless Chrome; **requires `npm start` running first** |
| `npm run verify:fallback` | checks the generated-arrangement fallback for missing files |
| `npm run audio` | resolve the library and report matched / unmatched / duplicate files |
| `npm run audit` | layout geometry at six breakpoints; flags overflow and overlaps |

Always run `npm test` after touching anything in `js/`. Run `npm run verify` after touching `app.js`,
`player.js`, `intro.js`, `captions.js`, `synth.js`, `css/styles.css` or `index.html` - it exercises
real playback and the splash animation.

## Architecture rules

- `js/sentiment.js`, `js/library.js`, `js/catalog.js`, `js/recommender.js`, `js/captions.js`,
  `js/synth.js`, `js/llm.js` must stay **DOM-free and Web-Audio-free** so `npm test` can run them in
  plain Node. `synth.js` writes raw PCM for exactly this reason; `player.js` wraps it in an
  `AudioBuffer`.
- Song selection must never become a keyword-to-song lookup. Feelings go in, ranked coordinates come
  out. Adding a song means adding an emotional profile to `js/library.js`, nothing else.
- The catalog is **built from files that exist**, never hardcoded. Never let a song without
  `files.audio` reach the recommender; `npm test` enforces this.
- Every theme a track uses must exist in `recommender.js` (`THEME_WEIGHT`), `lexicon.js`
  (`THEME_WORDS`) and `llm.js` (`ALLOWED_THEMES`). `npm test` enforces this.
- Do not ship copyrighted audio or lyrics. Generated captions come from song metadata; real lyrics
  only via a user-supplied `.lrc`.
- The vinyl and dock are driven only by the callbacks in `player.js`. Do not read audio state from
  the DOM.
- The static server **must keep HTTP range support**. Without it the browser cannot seek inside a
  multi-megabyte mp3 and scrubbing silently does nothing.

## Verification gotchas

- `npm run verify` needs Chrome or Edge. Override with `CHROME_PATH=/path/to/chrome`.
- Media elements abort in-flight range requests when a track is swapped; the browser reports that as
  `net::ERR_ABORTED`. The suites treat those as expected and only fail on real 4xx responses.
- `tools/shots/` is generated output; never commit it.
- The mood numbers in `tools/selfcheck.mjs` are tied to the lexicon. If you change lexicon values,
  re-run and re-tune the expectations rather than deleting the assertions.
- `js/library.js` matching is exact-key, not substring. A file whose name cannot be reduced to a
  known title needs an explicit `alias` on its entry.
