/**
 * Lookahead scheduler (the standard Web Audio pattern). A timer wakes up
 * often (every ~25 ms) and hands the audio clock every tick due in the next
 * ~150 ms, each with its exact start time. Timer jitter then never reaches
 * the sound: the audio hardware plays each hit on its sample.
 *
 * Testable without audio: time comes from `now()` and sound goes to
 * `schedule()`, both injected.
 */
import { TickPlanner } from './core.ts';
import type { MetronomeConfig, Tick } from './core.ts';
import { ScheduledClock } from '../../services/metronome-clock.ts';

export interface SchedulerOptions {
  /** Seconds on the audio clock. */
  now(): number;
  /** Play this tick at `when` (audio-clock seconds). */
  schedule(tick: Tick, when: number): void;
  /** Called once when a finite workout (a ladder rep) has played its last tick. */
  onEnd?(): void;
  /** How far ahead to schedule, seconds. */
  lookahead?: number;
  /** A tick this late (timer stalled, e.g. the app was in the background) is skipped, not played out of time. */
  lateTolerance?: number;
}

export interface PlayStats {
  readonly scheduled: number;
  readonly dropped: number;
  /** Workout bars started (count-in excluded). */
  readonly bars: number;
  /** Tempo of the latest workout bar. */
  readonly tempo: number;
  readonly startTempo: number;
}

export class LookaheadScheduler {
  readonly clock: ScheduledClock;
  #planner: TickPlanner | null = null;
  #next: ReturnType<TickPlanner['next']> = null;
  #origin = 0;
  #scheduled = 0;
  #dropped = 0;
  #bars = 0;
  #tempo = 0;
  #startTempo = 0;
  readonly #opts: Required<Omit<SchedulerOptions, 'onEnd'>> & Pick<SchedulerOptions, 'onEnd'>;

  constructor(options: SchedulerOptions) {
    this.#opts = { lookahead: 0.15, lateTolerance: 0.05, ...options };
    this.clock = new ScheduledClock(options.now);
  }

  get playing(): boolean {
    return this.#planner !== null;
  }

  get stats(): PlayStats {
    return { scheduled: this.#scheduled, dropped: this.#dropped, bars: this.#bars, tempo: this.#tempo, startTempo: this.#startTempo };
  }

  /** Starts playing; the first tick sounds at `at` (default: 100 ms from now). */
  start(config: MetronomeConfig, at = this.#opts.now() + 0.1): void {
    this.stop();
    this.#planner = new TickPlanner(config);
    this.#origin = at;
    this.#scheduled = this.#dropped = this.#bars = 0;
    this.#tempo = this.#startTempo = config.bpm;
    this.#next = this.#planner.next();
    this.pump();
  }

  setConfig(config: MetronomeConfig): void {
    this.#planner?.setConfig(config);
  }

  /** Called by the timer: schedules everything due within the lookahead. */
  pump(): void {
    if (!this.#planner) return;
    const now = this.#opts.now();
    while (this.#next && this.#origin + this.#next.time < now + this.#opts.lookahead) {
      const tick = this.#next;
      const when = this.#origin + tick.time;
      if (when < now - this.#opts.lateTolerance) {
        this.#dropped++;
      } else {
        this.#opts.schedule(tick, Math.max(when, now));
        this.#scheduled++;
      }
      if (!tick.countIn && tick.beat === 0 && tick.step === 0) {
        this.#bars++;
        this.#tempo = tick.bpm;
      }
      if (tick.step === 0) {
        this.clock.push({ time: when, bar: tick.bar, beat: tick.beat, beatsPerBar: tick.beatsPerBar, bpm: tick.bpm, countIn: tick.countIn, muted: tick.muted });
      }
      this.#next = this.#planner.next();
    }
    if (!this.#next) {
      this.#planner = null;
      this.clock.stop();
      this.#opts.onEnd?.();
    }
  }

  stop(): void {
    this.#planner = null;
    this.#next = null;
    this.clock.stop();
  }
}
