# HeeHee

Tell it how you feel. It reads the mood and plays the Michael Jackson record from **your own
library** that fits.

Not a mood dropdown. Not a keyword table. You write a sentence, a paragraph or a rant, the text is
scored into a continuous emotional vector, and your songs are searched by distance in that same
emotional space.

```
I'm so fed up with everything at work today, I could scream.
   -> valence -0.83  arousal 0.64  themes: frustration + anger
   -> Scream (1995)  [91% match]
```

It only ever suggests songs you actually have on disk. If a track is not in `mp3/` or `audio/`, it
does not exist as far as the app is concerned.

---

## Quick start

Requires Node 18+ (only for the local static server and the test scripts; the app itself is plain
HTML, CSS and ES modules).

```bash
npm start
# open http://localhost:5173/
```

A server is required - the app uses ES modules, `fetch`, and byte-range requests for seeking, which
browsers block on `file://`.

Other scripts:

| command | what it does |
| --- | --- |
| `npm start` | serve on :5173, with a live-resolved catalog |
| `npm run audio` | report what matched your files, and what did not |
| `npm test` | offline checks: library matching, mood math, recommender, captions, synth DSP |
| `npm run verify` | drives the real UI in headless Chrome (needs the server running) |
| `npm run verify:fallback` | checks the generated-arrangement fallback for missing files |
| `npm run audit` | layout geometry at six breakpoints; flags overflow and overlaps |

---

## What it does

**Opening sequence.** `Img/MJ.png` slides in from off-screen and settles into a moonwalk - leaning
back, gliding, with a floor shadow that breathes under him, speed trails behind, and a highlight
sweeping across his silhouette (masked from the PNG's own alpha). The signature "hee hee" plays with
it. Browsers block audio before a gesture, so it tries immediately, falls back to a tap-to-hear
prompt, and if the mp3 is missing it synthesises a passable "hee hee" from formant-filtered
oscillators.

**Your library.** Every file in `mp3/` and `audio/` is matched against a knowledge base of 116
tracks. The dev server resolves this on every page load, so **dropping a new mp3 in and reloading is
all it takes**. Anything that cannot be matched is reported to the console rather than silently
dropped, with a note on how to add it.

**Mood reading.** A lexicon of ~460 words plus ~120 phrases, scored on two axes: valence (how good
or bad) and arousal (how activated). It handles negation (`"I am not happy"`), intensifiers
(`"so fed up"`), diminishers, contrast (`"awful but I feel hopeful now"` weights what follows "but"
more heavily), emphasis (`CAPS` and `!!!` raise arousal), emoji, laughter, bare negation (`"I am
not."` reads negative on its own), and phrases where a negative word intensifies rather than cancels
(`"can't stop crying"` is *more* crying).

That produces valence, arousal, warmth, danceability, intensity, a confidence score and up to five
themes from a 51-theme vocabulary. `describe()` then turns the coordinates into words - "raw,
churning anger", "warm and content", "low and worn down".

**Song selection.** `recommend()` does weighted nearest-neighbour ranking across the library's four
emotional axes, plus a theme-resonance bonus scaled by how clear the text was, minus a recency
penalty. There is no `if (sad) return SongX` anywhere in the codebase.

**Turntable.** Rotating vinyl with grooves and a shine, a tonearm that tracks progress, a label
tinted to the album's palette, and a playhead you can drag three ways: the scrub bar, the record
surface itself (spin it with your finger), or the arrow keys when the turntable is focused. Seeking
a full-length track is instant because the dev server answers HTTP range requests.

**Live captions.** A caption strip sits directly above the chat input, in the chat bar. Captions are
generated from the song's own musical data - era, key, tempo, groove, themes, mood coordinates - and
follow the playhead through seeks. Add an `.lrc` next to an mp3 for real timed lyrics with a karaoke
wipe.

**Chat commands.** `stop`, `next`, `play smooth criminal`, `help`.

---

## How the matching works

The analyzer and the library share one coordinate system:

| axis | range | meaning |
| --- | --- | --- |
| valence | -1 .. +1 | broken .. radiant |
| arousal | 0 .. 1 | still .. explosive |
| warmth | 0 .. 1 | cold .. comforting |
| danceability | 0 .. 1 | ballad .. floor-filler |

Every track is annotated with a point in that space, derived from how it actually sounds and what it
is about. Matching is then:

```
distance   = sqrt( Σ weight_i * (song_i - target_i)^2 )   over the four axes
similarity = 1 - distance / maxDistance
themeBonus = Σ (user_theme_score * theme_weight)          capped at 0.34
score      = similarity + themeBonus * clarity - recencyPenalty + jitter
```

The jitter is deterministic, seeded from your own message, so the same feeling on a different day
can surface a different record without anything being scripted. Every suggestion explains itself in
numbers - "Sits at -0.74 valence / 0.90 arousal, a 90% match" - so you can audit the decision.

**Meet vs. lift.** The toggle in the header switches between mirroring your mood exactly (`meet`) and
nudging the target brighter and more open while keeping the same character (`lift`).

---

## Adding songs

```bash
# 1. drop files in
copy "new song.mp3" mp3\

# 2. reload the page - that is it
```

The server resolves the folder on every load, so nothing needs rebuilding for the app to see a new
file. Run `npm run audio` when you want a written report:

```
Scanned 121 audio files.
Playable catalog: 105 songs (from 116 known tracks)

15 duplicate copies not used (the best one was picked):
  Bad
      used: Michael Jackson - Bad (Official Video).mp3
      kept aside: Michael Jackson - Bad (Shortened Version).mp3

2 files could not be matched to a profile, so they will NOT be suggested:
  Michael Jackson - Some Unreleased Thing.mp3
```

**Duplicate copies of the same song are folded into one entry.** If you have both `(Audio)` and
`(Official Video)` and `(Upscaled)`, the best copy is chosen and the rest are listed as kept aside.
Genuinely different recordings stay separate - the Steve Aoki Thriller remix, the Justin Timberlake
duet, the three Blood on the Dance Floor versions.

**Unmatched files.** Matching understands `Michael Jackson - `, `Michael Jackson, Janet Jackson - `,
and release tags like `(Official 4K Video)`, `(Audio)`, `(Upscaled)`, `(Shortened Version)`,
`(Demo - Official Audio)`, `(Prison Version)`, `ft. Paul McCartney`, and nested tags. If a file still
does not match, add its title as an `alias` on the right entry in `js/library.js`.

**A song with no profile.** Give it an emotional profile in `js/library.js` (one line) and it joins
the rotation. Nothing else needs changing.

**Lyrics.** Drop `audio/beat-it.lrc` or `mp3/beat-it.lrc` next to the matching audio and it replaces
the generated captions with a `[mm:ss.xx]` timed karaoke wipe.

---

## The fallback

Every song in your library plays its real file. If a file is missing, unreadable or corrupt, the
player falls back to a **generated arrangement** in that song's own key, tempo, scale and groove -
drums, bass, chords, a lead line and vinyl surface noise, synthesised from the song's musical DNA.
It is not the record, but the player, the scrub and the captions keep working instead of dead-ending.
`npm run verify:fallback` exercises exactly that path.

---

## Optional LLM

Settings (the gear icon) can enable a second opinion from any OpenAI-compatible
`/chat/completions` endpoint. The local analyzer always runs; the LLM reading is blended with it
(weight configurable, default 0.7), which helps with sarcasm and unusual phrasing.

Off by default. Nothing leaves your machine unless you enable it and add a key. The key is stored in
`localStorage` only. On any failure it falls back to the local reading silently.

---

## Layout

```
index.html              shell, SVG symbols for the glove avatar
css/styles.css          MJ-themed responsive styling, moonwalk keyframes
js/
  app.js                wiring: chat, dock, scrubbing, library load
  sentiment.js          the mood analyzer
  lexicon.js            mood vocabulary, 51 themes, negators, modifiers
  library.js            knowledge base: 116 tracks + filename matching
  catalog.js            the active (playable) catalog
  recommender.js        mood-space ranking and explanations
  synth.js              procedural arrangement engine (writes raw PCM)
  player.js             turntable: file or generated buffer, seek, captions
  captions.js           caption timelines and .lrc parsing
  intro.js              splash, moonwalk, "hee hee"
  llm.js                optional LLM mood extraction and blending
mp3/                    your audio - the app only suggests from here
audio/                  the "hee hee" sting, plus any extra drop-ins
Img/MJ.png              the moonwalk cut-out
json/library.json       written snapshot of the resolved catalog
tools/
  serve.mjs             static server, range requests, live /library.json
  library.mjs           resolve the catalog, report matches and misses
  selfcheck.mjs         offline test suite
  verify-ui.mjs         headless Chrome end-to-end suite
  verify-fallback.mjs   generated-arrangement fallback suite
  audit-layout.mjs      geometry audit across six breakpoints
  probe-image.mjs       PNG inspection (used to seat MJ.png correctly)
```

---

## Testing

```bash
npm test              # 94 offline checks, no browser needed
npm start             # in one terminal
npm run verify        # in another: 93 end-to-end checks in headless Chrome
npm run verify:fallback   # 9 checks for the synth fallback
npm run audit             # geometry at six breakpoints
```

`npm test` covers filename matching against real filenames (including nested tags, credited duets
and the `⧸` in *Little Susie*), that every suggested song has a real file, mood direction and
magnitude across twelve phrasings, negation, intensifiers, contrast, emoji, empty input, mood values,
theme coverage across analyzer / recommender / LLM schema, recommender behaviour per mood, lift mode,
recency penalties, caption timelines, `.lrc` parsing, and the synth DSP (duration, silence, NaN, DC
offset, clipping, determinism, every groove).

`npm run verify` drives the real UI: the MJ.png moonwalk entrance and its glide, the library loading
from `library.json`, the empty state, the full mood-to-playback flow, that a suggested song is a real
local file, seek accuracy against a full-length track, stop, captions following seeks, chat commands,
responsive layout at six viewports, and console cleanliness. Screenshots go to `tools/shots/`.

---

## Browser support

Needs ES modules, `fetch`, Web Audio (`AudioContext`, `AudioBuffer`), `aspect-ratio` and CSS `dvh`.
That means any current Chrome, Edge, Firefox or Safari. `OfflineAudioContext` is **not** required -
the synth writes its own samples, so rendering works even where offline audio rendering is unavailable
or slow.

Playback still requires a user gesture to start, which is why the splash asks you to step in.

## Accessibility

Keyboard reachable throughout; the turntable is an ARIA slider with arrow-key seeking, the scrub bar
is a real `input[type=range]`, captions and mood updates announce through `aria-live`, focus rings are
visible, and `prefers-reduced-motion` disables the moonwalk, streaks, sparkles and disc rotation while
still showing the figure.
