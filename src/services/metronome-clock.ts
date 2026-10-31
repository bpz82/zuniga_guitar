/**
 * Shared service: the metronome clock. Other modules (recorder, improv
 * takes, future drum features) sync to the beat through this interface only;
 * they never touch the metronome's internals or its audio graph.
 *
 * All times are seconds on the audio clock (AudioContext.currentTime), the
 * only clock precise enough for music. A listener that throws is cut off and
 * never stops the metronome or other listeners (failure isolation).
 */

export interface ClockBeat {
  /** Audio-clock time of the beat, seconds. */
  readonly time: number;
  /** Negative during count-in. */
  readonly bar: number;
  readonly beat: number;
  readonly beatsPerBar: number;
  readonly bpm: number;
  readonly countIn: boolean;
  /** Gap click: the beat happens but is silent. */
  readonly muted: boolean;
}

export interface MetronomeClock {
  readonly running: boolean;
  /** Now on the audio clock. */
  now(): number;
  /** The most recent beat at or before t, or null. */
  beatAt(t: number): ClockBeat | null;
  /** The next beat after t, if it is already scheduled (up to ~150 ms ahead). */
  nextBeat(t: number): ClockBeat | null;
  /** Called for each beat as it is scheduled, slightly ahead of time. Returns an unsubscribe function. */
  onBeat(listener: (beat: ClockBeat) => void): () => void;
  /** Called when playback stops. */
  onStop(listener: () => void): () => void;
}

/** The metronome's implementation: fed with beats as the scheduler plans them. */
export class ScheduledClock implements MetronomeClock {
  #beats: ClockBeat[] = [];
  #running = false;
  readonly #now: () => number;
  readonly #beatListeners = new Set<(b: ClockBeat) => void>();
  readonly #stopListeners = new Set<() => void>();
  /** Listeners cut off because they threw. */
  readonly failures: unknown[] = [];

  constructor(now: () => number) {
    this.#now = now;
  }

  get running(): boolean {
    return this.#running;
  }

  now(): number {
    return this.#now();
  }

  beatAt(t: number): ClockBeat | null {
    for (let i = this.#beats.length - 1; i >= 0; i--) if (this.#beats[i]!.time <= t) return this.#beats[i]!;
    return null;
  }

  nextBeat(t: number): ClockBeat | null {
    return this.#beats.find((b) => b.time > t) ?? null;
  }

  onBeat(listener: (beat: ClockBeat) => void): () => void {
    this.#beatListeners.add(listener);
    return () => this.#beatListeners.delete(listener);
  }

  onStop(listener: () => void): () => void {
    this.#stopListeners.add(listener);
    return () => this.#stopListeners.delete(listener);
  }

  /** Scheduler side: a beat has been scheduled. */
  push(beat: ClockBeat): void {
    this.#running = true;
    this.#beats.push(beat);
    if (this.#beats.length > 64) this.#beats.splice(0, this.#beats.length - 64);
    for (const l of [...this.#beatListeners]) this.#call(this.#beatListeners, l, beat);
  }

  /** Scheduler side: playback stopped. */
  stop(): void {
    if (!this.#running) return;
    this.#running = false;
    this.#beats = [];
    for (const l of [...this.#stopListeners]) this.#call(this.#stopListeners, l);
  }

  #call<A extends unknown[]>(set: Set<(...a: A) => void>, l: (...a: A) => void, ...args: A) {
    try {
      l(...args);
    } catch (e) {
      set.delete(l);
      this.failures.push(e);
    }
  }
}
