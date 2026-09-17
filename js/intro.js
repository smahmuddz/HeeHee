/**
 * Opening sequence: the fedora and the sequined glove drift in with the
 * signature "hee hee".
 *
 * Browsers refuse to autoplay audio before a gesture, so we try immediately and
 * silently fall back to a tap-to-hear affordance. If the mp3 itself is missing
 * we synthesise a passable "hee hee" from formant-filtered oscillators.
 */

let heeHeeUrl = 'audio/hee hee.mp3';
let introAudio = null;

/** Point the sting at the file the library actually resolved. */
export function setIntroSound(url) {
  if (!url || url === heeHeeUrl) return;
  heeHeeUrl = url;
  introAudio = null;
}

function getIntroAudio(url = heeHeeUrl) {
  if (!introAudio) {
    introAudio = new Audio(url);
    introAudio.preload = 'auto';
    introAudio.volume = 0.85;
    introAudio.addEventListener('error', () => { introAudio = null; }, { once: true });
  }
  return introAudio;
}

/** Synthesised fallback "hee hee" - a vowel-ish double chirp. */
export function synthHeeHee() {
  const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: 'interactive' });
  const master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);

  const syllable = (t, f0, dur, gain) => {
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(f0 * 0.82, t);
    osc.frequency.linearRampToValueAtTime(f0 * 1.08, t + dur * 0.22);
    osc.frequency.linearRampToValueAtTime(f0 * 0.94, t + dur);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.018);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env);

    // "ee" vowel formants
    const formants = [[320, 5, 0.9], [2200, 8, 0.55], [2950, 10, 0.28]];
    for (const [f, q, g] of formants) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const fg = ctx.createGain();
      fg.gain.value = g;
      env.connect(bp).connect(fg).connect(master);
    }
    const direct = ctx.createGain();
    direct.gain.value = 0.18;
    env.connect(direct).connect(master);

    // breath
    const n = ctx.createBufferSource();
    const nb = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * 0.3), ctx.sampleRate);
    const nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    n.buffer = nb;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.8);
    n.connect(hp).connect(ng).connect(master);
    n.start(t); n.stop(t + dur + 0.02);

    osc.start(t); osc.stop(t + dur + 0.05);
  };

  const t0 = ctx.currentTime + 0.02;
  syllable(t0, 300, 0.17, 0.42);
  syllable(t0 + 0.21, 352, 0.21, 0.38);

  setTimeout(() => { try { ctx.close(); } catch { /* ok */ } }, 1400);
  return ctx;
}

/**
 * Play the "hee hee". Returns true when it actually played.
 * If blocked, the promise resolves false and the caller should re-arm on gesture.
 */
export async function playHeeHee() {
  const el = getIntroAudio();
  if (el) {
    try {
      el.currentTime = 0;
      await el.play();
      return true;
    } catch {
      return false;
    }
  }
  try {
    synthHeeHee();
    return true;
  } catch {
    return false;
  }
}

/**
 * Run the splash.
 * @param {object} opts
 * @param {() => void} opts.onEnter  called once the user commits to entering
 */
export function runIntro(opts = {}) {
  const splash = document.getElementById('splash');
  const hint = document.getElementById('soundHint');
  const enterBtn = document.getElementById('enterBtn');
  if (!splash) { opts.onEnter?.(); return; }

  let entered = false;
  let soundPlayed = false;

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  splash.classList.toggle('splash--reduced', reduced);
  splash.classList.add('is-active');

  const setHint = (text) => { if (hint) hint.textContent = text; };

  const armSound = () => {
    if (soundPlayed) return;
    playHeeHee().then((ok) => {
      if (ok) {
        soundPlayed = true;
        setHint('Hee hee.');
        splash.classList.add('has-sounded');
      } else {
        setHint('Tap anywhere for the sound');
      }
    });
  };

  // Try straight away; almost always blocked on a cold load.
  armSound();

  const onFirstGesture = () => {
    if (!soundPlayed) armSound();
    window.removeEventListener('pointerdown', onFirstGesture);
    window.removeEventListener('keydown', onFirstGesture);
    window.removeEventListener('touchstart', onFirstGesture);
  };
  window.addEventListener('pointerdown', onFirstGesture, { passive: true });
  window.addEventListener('keydown', onFirstGesture);
  window.addEventListener('touchstart', onFirstGesture, { passive: true });

  const enter = () => {
    if (entered) return;
    entered = true;
    if (!soundPlayed) armSound();
    splash.classList.add('is-leaving');
    document.body.classList.add('has-entered');
    setTimeout(() => {
      splash.classList.add('is-gone');
      splash.setAttribute('aria-hidden', 'true');
      opts.onEnter?.();
    }, reduced ? 60 : 620);
  };

  enterBtn?.addEventListener('click', (e) => { e.stopPropagation(); enter(); });
  splash.addEventListener('click', enter);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') {
      if (document.activeElement === enterBtn) return;
      enter();
    }
  });

  // Encouraging nudge if nothing happens.
  setTimeout(() => {
    if (!entered) splash.classList.add('is-waiting');
  }, 5200);

  return { enter };
}

/** Sparkle field used behind the splash and the stage. */
export function spawnSparkles(host, count = 22) {
  if (!host) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) return;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const s = document.createElement('span');
    s.className = 'sparkle';
    s.style.setProperty('--x', `${Math.random() * 100}%`);
    s.style.setProperty('--y', `${Math.random() * 100}%`);
    s.style.setProperty('--d', `${2.4 + Math.random() * 3.4}s`);
    s.style.setProperty('--delay', `${Math.random() * 4}s`);
    s.style.setProperty('--size', `${2 + Math.random() * 4}px`);
    frag.appendChild(s);
  }
  host.appendChild(frag);
}

export default { runIntro, playHeeHee, synthHeeHee, spawnSparkles, setIntroSound };
