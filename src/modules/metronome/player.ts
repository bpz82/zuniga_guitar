/**
 * Web Audio player: turns scheduled ticks into sound. Browser only. All
 * timing decisions live in core.ts and scheduler.ts (tested); this file just
 * starts each sound at the exact audio-clock time it is given.
 *
 * iOS notes:
 * - Audio must be unlocked inside a tap: call unlock() from the Start button.
 * - The ring/silent switch mutes Web Audio unless the audio session is
 *   "playback". unlock() asks for that where supported (Safari 17+), because
 *   a metronome is useless if it is silently muted. It may pause other audio
 *   apps while the metronome plays.
 * - The screen is kept awake while playing (Wake Lock), since iOS suspends
 *   web audio when the screen locks.
 * - 2026-11-02: older iOS has no audio-session setting, so the ring/silent
 *   switch would mute the clicks. There, a silent <audio> element plays
 *   inside the tap, which moves iOS to its "playback" audio session.
 * - 2026-11-02: an audio context iOS has "interrupted" (a call, Siri, another
 *   app's audio) is resumed on the next Start; if it still will not run, Start
 *   reports it instead of playing silently.
 */
import { findOnset } from './core.ts';
import type { MetronomeConfig, Tick, Voice } from './core.ts';
import { KIT_VOICES } from './core.ts';
import { LookaheadScheduler } from './scheduler.ts';
import type { PlayStats } from './scheduler.ts';
import type { MetronomeClock } from '../../services/metronome-clock.ts';

type KitVoice = (typeof KIT_VOICES)[number];

export class MetronomePlayer {
  #ctx: AudioContext | null = null;
  #out: GainNode | null = null;
  #samples = new Map<KitVoice, { buffer: AudioBuffer; offset: number }>();
  #scheduler: LookaheadScheduler | null = null;
  #timer: ReturnType<typeof setInterval> | null = null;
  #config: MetronomeConfig | null = null;
  #openHat: { gain: GainNode; src: AudioBufferSourceNode } | null = null;
  #wakeLock: { release(): Promise<void> } | null = null;
  #htmlAudio: HTMLAudioElement | null = null;
  readonly #soundsUrl: string;

  constructor(soundsUrl = './sounds/') {
    this.#soundsUrl = soundsUrl;
  }

  get ready(): boolean {
    return this.#ctx !== null && this.#samples.size === KIT_VOICES.length;
  }

  get playing(): boolean {
    return this.#scheduler?.playing ?? false;
  }

  get stats(): PlayStats | null {
    return this.#scheduler?.stats ?? null;
  }

  /** The shared clock other modules sync to. Null until unlocked. */
  get clock(): MetronomeClock | null {
    return this.#scheduler?.clock ?? null;
  }

  /** Audio-clock time now, and how late sound reaches the ears (seconds). */
  get audioTime(): { now: number; latency: number } | null {
    const c = this.#ctx;
    return c ? { now: c.currentTime, latency: (c.outputLatency || 0) + (c.baseLatency || 0) } : null;
  }

  /** Audio-clock time of a UI event, for tap-along timing. */
  eventTime(timeStampMs: number): number | null {
    const c = this.#ctx;
    if (!c) return null;
    const ts = c.getOutputTimestamp?.();
    if (ts?.contextTime !== undefined && ts.performanceTime !== undefined) return ts.contextTime + (timeStampMs - ts.performanceTime) / 1000;
    return c.currentTime;
  }

  /** Call from a tap/click handler. Creates and resumes audio, loads the kit once. */
  async unlock(): Promise<void> {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    else this.#playbackSession();
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ latencyHint: 'interactive' });
      this.#out = this.#ctx.createGain();
      // A gentle limiter so stacked hits never clip.
      const limiter = this.#ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.ratio.value = 12;
      this.#out.connect(limiter).connect(this.#ctx.destination);
      // iOS unlock: play one silent sample inside the gesture.
      const silent = this.#ctx.createBufferSource();
      silent.buffer = this.#ctx.createBuffer(1, 1, this.#ctx.sampleRate);
      silent.connect(this.#ctx.destination);
      silent.start();
    }
    if (this.#ctx.state !== 'running') await this.#ctx.resume();
    if (this.#ctx.state !== 'running') throw new Error('the browser kept audio switched off; tap Start again');
    if (this.#samples.size < KIT_VOICES.length) await this.#load();
  }

  /** Without the audio-session API (older iOS): a looping silent <audio> started inside the tap. */
  #playbackSession(): void {
    if (typeof Audio === 'undefined') return;
    if (!this.#htmlAudio) {
      this.#htmlAudio = new Audio(SILENT_WAV);
      this.#htmlAudio.loop = true;
      this.#htmlAudio.setAttribute('playsinline', '');
    }
    void this.#htmlAudio.play().catch(() => undefined);
  }

  async #load(): Promise<void> {
    const ctx = this.#ctx!;
    await Promise.all(
      KIT_VOICES.map(async (voice) => {
        const res = await fetch(`${this.#soundsUrl}${voice}.mp3`);
        if (!res.ok) throw new Error(`could not load ${voice} sound (${res.status})`);
        const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
        this.#samples.set(voice, { buffer, offset: findOnset(buffer.getChannelData(0)) / buffer.sampleRate });
      }),
    );
  }

  start(config: MetronomeConfig, onEnd?: () => void): void {
    const ctx = this.#ctx;
    if (!ctx) throw new Error('call unlock() from a tap first');
    this.stop();
    this.#config = config;
    this.#out!.gain.value = config.master;
    this.#scheduler = new LookaheadScheduler({
      now: () => ctx.currentTime,
      schedule: (tick, when) => this.#play(tick, when),
      onEnd: () => {
        this.#halt();
        onEnd?.();
      },
    });
    this.#scheduler.start(config);
    this.#timer = setInterval(() => this.#scheduler?.pump(), 25);
    void this.#keepAwake();
  }

  /** Live changes (tempo, volume, groove...). */
  update(config: MetronomeConfig): void {
    this.#config = config;
    if (this.#out && this.#ctx) this.#out.gain.setTargetAtTime(config.master, this.#ctx.currentTime, 0.02);
    this.#scheduler?.setConfig(config);
  }

  stop(): void {
    this.#scheduler?.stop();
    this.#halt();
  }

  #halt(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    this.#htmlAudio?.pause();
    void this.#wakeLock?.release().catch(() => undefined);
    this.#wakeLock = null;
  }

  async #keepAwake(): Promise<void> {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<{ release(): Promise<void> }> } };
    try {
      this.#wakeLock = (await nav.wakeLock?.request('screen')) ?? null;
    } catch {
      this.#wakeLock = null;
    }
  }

  #play(tick: Tick, when: number): void {
    const ctx = this.#ctx!;
    const config = this.#config!;
    for (const hit of tick.hits) {
      const level = hit.gain * config.volumes[hit.voice as Voice];
      if (level <= 0) continue;
      if (hit.voice === 'beep') {
        this.#beep(when, hit.hz ?? config.beatHz, level);
        continue;
      }
      const sample = this.#samples.get(hit.voice as KitVoice);
      if (!sample) continue;
      // A closed hi-hat chokes a ringing open one, like a real hi-hat.
      if ((hit.voice === 'hihat' || hit.voice === 'hihatOpen') && this.#openHat) {
        this.#openHat.gain.gain.setTargetAtTime(0, when, 0.015);
        this.#openHat.src.stop(when + 0.1);
        this.#openHat = null;
      }
      const src = ctx.createBufferSource();
      src.buffer = sample.buffer;
      const gain = ctx.createGain();
      gain.gain.value = level;
      src.connect(gain).connect(this.#out!);
      src.start(when, sample.offset);
      if (hit.voice === 'hihatOpen') this.#openHat = { gain, src };
      src.onended = () => gain.disconnect();
    }
  }

  /** Classic synth click: a short sine blip with a fast decay. */
  #beep(when: number, hz: number, level: number): void {
    const ctx = this.#ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = hz;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, when);
    env.gain.linearRampToValueAtTime(level, when + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, when + 0.06);
    osc.connect(env).connect(this.#out!);
    osc.start(when);
    osc.stop(when + 0.07);
    osc.onended = () => env.disconnect();
  }
}

/** A short silent WAV (8 kHz, 8-bit, 0.1 s), built once: the <audio> that switches older iOS to playback. */
const SILENT_WAV = (() => {
  const samples = 800;
  const bytes = new Uint8Array(44 + samples);
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string) => [...s].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  view.setUint32(4, 36 + samples, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, 8000, true); // sample rate
  view.setUint32(28, 8000, true); // byte rate
  view.setUint16(32, 1, true); // block align
  view.setUint16(34, 8, true); // bits per sample
  text(36, 'data');
  view.setUint32(40, samples, true);
  bytes.fill(128, 44); // 8-bit silence is the midpoint
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:audio/wav;base64,${btoa(bin)}`;
})();
