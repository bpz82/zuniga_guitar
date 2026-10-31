/**
 * Ear-training sounds, synthesized in the browser with Web Audio: no
 * samples, so nothing to license or download. Plays the NoteEvents a trial
 * describes; knows nothing about trials or grading.
 *
 * iOS (same as the metronome): call unlock() inside a tap; it asks for the
 * "playback" audio session where supported so the silent switch does not
 * mute practice.
 */
import { hz } from './core.ts';
import type { NoteEvent } from './core.ts';

export class EarPlayer {
  #ctx: AudioContext | null = null;
  #out: GainNode | null = null;
  #live: AudioScheduledSourceNode[] = [];

  /** Call from a tap/click handler. */
  async unlock(): Promise<void> {
    const nav = navigator as Navigator & { audioSession?: { type: string } };
    if (nav.audioSession) nav.audioSession.type = 'playback';
    if (!this.#ctx) {
      this.#ctx = new AudioContext({ latencyHint: 'interactive' });
      this.#out = this.#ctx.createGain();
      this.#out.gain.value = 0.5;
      const limiter = this.#ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.ratio.value = 12;
      this.#out.connect(limiter).connect(this.#ctx.destination);
      const silent = this.#ctx.createBufferSource();
      silent.buffer = this.#ctx.createBuffer(1, 1, this.#ctx.sampleRate);
      silent.connect(this.#ctx.destination);
      silent.start();
    }
    if (this.#ctx.state !== 'running') await this.#ctx.resume();
  }

  /** Audio-clock time in seconds (for tap timing). */
  now(): number {
    return this.#ctx?.currentTime ?? 0;
  }

  /**
   * Plays events, stopping anything still sounding. Returns when the first
   * event starts and the last one ends, on the audio clock.
   */
  play(events: readonly NoteEvent[], lead = 0.12): { start: number; end: number } {
    const ctx = this.#ctx;
    const out = this.#out;
    if (!ctx || !out) throw new Error('call unlock() from a tap first');
    this.stop();
    const start = ctx.currentTime + lead;
    let end = start;
    for (const e of events) {
      const t = start + e.at;
      end = Math.max(end, t + e.dur);
      this.#live.push(e.voice === 'click' || e.voice === 'accent' ? this.#click(ctx, out, t, e) : this.#tone(ctx, out, t, e));
    }
    return { start, end };
  }

  stop(): void {
    for (const n of this.#live) {
      try {
        n.stop();
      } catch {
        // already stopped
      }
    }
    this.#live = [];
  }

  #click(ctx: AudioContext, out: AudioNode, t: number, e: NoteEvent): OscillatorNode {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = e.voice === 'accent' ? 2200 : 1600;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(e.gain, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
    osc.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + 0.06);
    return osc;
  }

  #tone(ctx: AudioContext, out: AudioNode, t: number, e: NoteEvent): OscillatorNode {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = hz(e.midi);
    osc.frequency.value = f;
    const peak = e.gain * 0.6;
    let node: AudioNode = osc;
    if (e.voice === 'soft') {
      osc.type = 'sine';
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.03);
      g.gain.setValueAtTime(peak, t + Math.max(0.03, e.dur - 0.08));
      g.gain.linearRampToValueAtTime(0, t + e.dur);
    } else {
      // pluck (triangle) or bright (sawtooth): a guitar-like attack and decay through a closing filter.
      osc.type = e.voice === 'bright' ? 'sawtooth' : 'triangle';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(8000, f * (e.voice === 'bright' ? 8 : 6)), t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(200, f * 1.5), t + e.dur);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + e.dur);
      osc.connect(lp);
      node = lp;
    }
    node.connect(g).connect(out);
    osc.start(t);
    osc.stop(t + e.dur + 0.02);
    return osc;
  }
}
