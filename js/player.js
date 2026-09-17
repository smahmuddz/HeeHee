/**
 * The turntable.
 *
 * Two possible sources per song, chosen at load time:
 *   1. a real file at audio/<slug>.mp3 if you have one
 *   2. otherwise a freshly rendered arrangement from synth.js
 *
 * Both expose the same play / pause / stop / seek interface, so the vinyl UI,
 * scrubbing and captions do not care which one is loaded.
 */

import { renderPcm } from './synth.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Wrap raw PCM in an AudioBuffer so it can be scrubbed like a real file. */
function toAudioBuffer(ctx, pcm) {
  const buffer = ctx.createBuffer(pcm.channels.length, pcm.length, pcm.sampleRate);
  for (let ch = 0; ch < pcm.channels.length; ch++) {
    buffer.copyToChannel(pcm.channels[ch], ch);
  }
  return buffer;
}

export class Player {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.ctx = null;
    this.gain = null;
    this.analyser = null;
    this.levels = null;

    this.song = null;
    this.source = null;        // 'file' | 'generated'
    this.audioEl = null;
    this.mediaNode = null;
    this.buffer = null;
    this.bufferSource = null;
    this.audioBase = '';       // '' = serve audio from alongside the app
    this._directElement = false;

    this.playing = false;
    this._offset = 0;
    this._startedAt = 0;
    this._manualStop = false;
    this._raf = 0;
    this._renderToken = 0;

    this.bufferCache = new Map();
    this.volume = 0.9;
  }

  /** Lazily create the AudioContext - browsers require a gesture first. */
  ensureContext() {
    if (!this.ctx) {
      const Ctx = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!Ctx) throw new Error('Web Audio is not supported in this browser.');
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.gain = this.ctx.createGain();
      this.gain.gain.value = this.volume;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.analyser.smoothingTimeConstant = 0.78;
      this.levels = new Uint8Array(this.analyser.frequencyBinCount);
      this.gain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  /**
   * Where the audio actually lives. Empty means "alongside the app", which is
   * the local case. Set this to a CDN or object-store URL to keep the app small
   * while the songs live somewhere else.
   */
  setAudioBase(base) {
    this.audioBase = String(base || '').trim();
    return this.audioBase;
  }

  /** Resolve a catalog-relative path against the configured audio base. */
  resolveUrl(url) {
    if (!url) return url;
    if (/^(https?:|blob:|data:)/i.test(url)) return url;
    if (!this.audioBase) return url;
    return `${this.audioBase.replace(/\/+$/, '')}/${String(url).replace(/^\/+/, '')}`;
  }

  isCrossOrigin(url) {
    if (!/^https?:/i.test(url)) return false;
    try {
      return new URL(url, location.href).origin !== location.origin;
    } catch {
      return false;
    }
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.gain) this.gain.gain.value = this.volume;
    if (this.audioEl) this.audioEl.volume = this._directElement ? this.volume : 1;
  }

  /** Frequency data for the visualiser. Returns null when idle or unroutable. */
  getLevels() {
    if (!this.analyser || !this.playing || this._directElement) return null;
    this.analyser.getByteFrequencyData(this.levels);
    return this.levels;
  }

  /** The lyrics file for a song, if one was found next to the audio. */
  resolveLyrics(song) {
    return this.resolveUrl(song?.files?.lrc || null);
  }

  async load(song) {
    this.stop({ silent: true });
    this.song = song;
    const token = ++this._renderToken;
    this.hooks.onState?.({ phase: 'loading', song });

    // The catalog only ever contains songs with a resolved file, so this is
    // normally a direct hit. The synth is kept as a safety net.
    const url = this.resolveUrl(song.files?.audio || null);
    if (url && await this._loadFile(song, url)) return;
    if (token !== this._renderToken) return;
    await this._loadGenerated(song, token);
  }

  /** @returns {Promise<boolean>} whether the file actually loaded */
  async _loadFile(song, url) {
    this.ensureContext();
    const crossOrigin = this.isCrossOrigin(url);
    const el = new Audio();
    el.src = url;
    el.preload = 'auto';
    el.volume = this.volume;

    const ok = await new Promise((resolve) => {
      const done = (good) => resolve(good);
      el.addEventListener('loadedmetadata', () => done(true), { once: true });
      el.addEventListener('error', () => done(false), { once: true });
      setTimeout(() => done(el.readyState >= 1), 12000);
    });

    if (!ok) {
      try { el.removeAttribute('src'); el.load(); } catch { /* ok */ }
      return false;
    }

    this.disposeSources();
    this.audioEl = el;
    this.source = 'file';
    this._offset = 0;
    this._directElement = false;

    // Routing through Web Audio would need CORS headers from a remote host and
    // taints the graph when they are missing, so cross-origin media is played
    // directly by the element instead. It just loses the reactive glow.
    if (!crossOrigin) {
      try {
        this.mediaNode = this.ctx.createMediaElementSource(el);
        this.mediaNode.connect(this.gain);
        el.volume = 1;
      } catch {
        this.mediaNode = null;
        this._directElement = true;
      }
    } else {
      this.mediaNode = null;
      this._directElement = true;
      el.crossOrigin = null;
    }

    el.addEventListener('ended', () => this._handleEnded());
    this.hooks.onState?.({
      phase: 'ready', song, source: 'file', duration: this.duration,
      url, crossOrigin, direct: this._directElement
    });
    return true;
  }

  async _loadGenerated(song, token) {
    this.ensureContext();
    let buffer = this.bufferCache.get(song.id);
    if (!buffer) {
      this.hooks.onState?.({ phase: 'rendering', song });
      const pcm = await renderPcm(song, {
        duration: song.duration || 66,
        sampleRate: this.ctx.sampleRate,
        onProgress: (p) => this.hooks.onState?.({ phase: 'rendering', song, progress: p })
      });
      if (token !== this._renderToken) return;
      buffer = toAudioBuffer(this.ctx, pcm);
      this.bufferCache.set(song.id, buffer);
    }
    if (token !== this._renderToken) return;
    this.disposeSources();
    this.buffer = buffer;
    this.source = 'generated';
    this._offset = 0;
    this.hooks.onState?.({ phase: 'ready', song, source: 'generated', duration: this.duration });
  }

  get duration() {
    if (this.source === 'file' && this.audioEl) {
      const d = this.audioEl.duration;
      return Number.isFinite(d) && d > 0 ? d : (this.song?.duration || 0);
    }
    return this.buffer ? this.buffer.duration : 0;
  }

  get currentTime() {
    if (this.source === 'file' && this.audioEl) return this.audioEl.currentTime || 0;
    if (!this.buffer) return 0;
    if (!this.playing) return this._offset;
    return clamp(this._offset + (this.ctx.currentTime - this._startedAt), 0, this.buffer.duration);
  }

  async play() {
    if (!this.song) return;
    this.ensureContext();
    if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch { /* ignore */ } }

    if (this.source === 'file' && this.audioEl) {
      try { await this.audioEl.play(); } catch { /* autoplay guard */ }
      this.playing = true;
    } else if (this.buffer) {
      if (this._offset >= this.buffer.duration - 0.05) this._offset = 0;
      this._startBuffer();
    }
    this.hooks.onState?.({ phase: 'playing', song: this.song, source: this.source });
    this._loop();
  }

  _startBuffer() {
    this.disposeBufferSource();
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(this.gain);
    this._manualStop = false;
    src.onended = () => { if (!this._manualStop) this._handleEnded(); };
    this._startedAt = this.ctx.currentTime;
    src.start(0, clamp(this._offset, 0, Math.max(0, this.buffer.duration - 0.01)));
    this.bufferSource = src;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    if (this.source === 'file' && this.audioEl) {
      this._offset = this.audioEl.currentTime || 0;
      this.audioEl.pause();
    } else if (this.bufferSource) {
      this._offset = this.currentTime;
      this._manualStop = true;
      try { this.bufferSource.stop(); } catch { /* already stopped */ }
      this.bufferSource = null;
    }
    this.playing = false;
    this.hooks.onState?.({ phase: 'paused', song: this.song, source: this.source });
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  stop({ silent = false } = {}) {
    const wasPlaying = this.playing;
    if (this.source === 'file' && this.audioEl) this.audioEl.pause();
    this._manualStop = true;
    this.disposeBufferSource();
    this.playing = false;
    this._offset = 0;
    if (this.source === 'file' && this.audioEl) this.audioEl.currentTime = 0;
    if (!silent) this.hooks.onState?.({ phase: 'stopped', song: this.song, source: this.source });
    else if (wasPlaying) this.hooks.onState?.({ phase: 'stopped', song: this.song, source: this.source });
  }

  unload() {
    this.stop({ silent: true });
    this.disposeSources();
    this.song = null;
    this.hooks.onState?.({ phase: 'idle' });
  }

  seek(time) {
    const dur = this.duration;
    if (!dur) return;
    const t = clamp(time, 0, Math.max(0, dur - 0.05));
    if (this.source === 'file' && this.audioEl) {
      this.audioEl.currentTime = t;
      this._offset = t;
    } else if (this.buffer) {
      const wasPlaying = this.playing;
      this._offset = t;
      if (wasPlaying) this._startBuffer();
    }
    this._emitTime(true);
  }

  nudge(delta) {
    this.seek(this.currentTime + delta);
  }

  _handleEnded() {
    this.playing = false;
    this._offset = this.duration;
    this.hooks.onState?.({ phase: 'ended', song: this.song, source: this.source });
    this.hooks.onEnded?.(this.song);
  }

  _loop() {
    cancelAnimationFrame(this._raf);
    const tick = () => {
      this._emitTime(false);
      if (this.playing) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _emitTime(force) {
    if (!this.song) return;
    this.hooks.onTime?.({
      time: this.currentTime,
      duration: this.duration,
      playing: this.playing,
      source: this.source,
      force
    });
  }

  disposeBufferSource() {
    if (this.bufferSource) {
      this._manualStop = true;
      try { this.bufferSource.onended = null; this.bufferSource.stop(); } catch { /* ok */ }
      try { this.bufferSource.disconnect(); } catch { /* ok */ }
      this.bufferSource = null;
    }
  }

  disposeSources() {
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    this.disposeBufferSource();
    if (this.audioEl) {
      try { this.audioEl.pause(); this.audioEl.removeAttribute('src'); this.audioEl.load(); } catch { /* ok */ }
      this.audioEl = null;
    }
    if (this.mediaNode) {
      try { this.mediaNode.disconnect(); } catch { /* ok */ }
      this.mediaNode = null;
    }
    this.buffer = null;
    this.source = null;
    this.playing = false;
    this._offset = 0;
  }
}

export default { Player };
