/**
 * Metronome core: pure functions, no audio. What plays when, at what tempo,
 * on which drum: all decided here, so it can be tested exactly. The player
 * (player.ts) only turns these ticks into sound.
 */
import type { Details } from '../../model.ts';
import type { Validation } from '../../validate.ts';

export const MIN_BPM = 30;
export const MAX_BPM = 300;

export type Voice = 'kick' | 'snare' | 'rim' | 'hihat' | 'hihatOpen' | 'ride' | 'beep';
export const KIT_VOICES = ['kick', 'snare', 'rim', 'hihat', 'hihatOpen', 'ride'] as const;
export const VOICES: readonly Voice[] = [...KIT_VOICES, 'beep'];
export type Groove = 'click' | 'rock' | 'shuffle' | 'half-time';
export const GROOVES: readonly Groove[] = ['click', 'rock', 'shuffle', 'half-time'];
/** What the plain click and count-in sound like. Grooves always use the kit. */
export type Sound = 'kit' | 'beep';
export type Workout = 'steady' | 'ramp' | 'gap' | 'ladder';
export const WORKOUTS: readonly Workout[] = ['steady', 'ramp', 'gap', 'ladder'];

export interface MetronomeConfig {
  /** Beats per minute of the beat unit. For ramps, the starting tempo. */
  readonly bpm: number;
  readonly beatsPerBar: number;
  /** 4 = quarter-note beats, 8 = eighth-note beats (6/8 accents 1 and 4), 2 = half notes. */
  readonly beatUnit: 2 | 4 | 8;
  /** Clicks per beat for the plain click: 1, 2 (8ths), 3 (triplets), 4 (16ths). */
  readonly subdivision: 1 | 2 | 3 | 4;
  readonly groove: Groove;
  readonly sound: Sound;
  /** Synth beep pitch for beat 1, and for the other beats. */
  readonly accentHz: number;
  readonly beatHz: number;
  /** 0 to 1. */
  readonly master: number;
  readonly volumes: Readonly<Record<Voice, number>>;
  /** Bars of click before the workout starts. Never muted, never ramped. */
  readonly countInBars: number;
  readonly workout: Workout;
  /** Ramp: tempo goes from bpm to targetBpm by stepBpm every everyBars bars, then holds. */
  readonly targetBpm: number;
  readonly stepBpm: number;
  readonly everyBars: number;
  /** Gap click: play this many bars, then mute this many, repeating. */
  readonly playBars: number;
  readonly muteBars: number;
  /** Ladder: bars in one rep. The metronome stops after it. */
  readonly repBars: number;
  /** Off by default: no metronome sound during the user's quiet (work) hours. */
  readonly allowDuringQuietHours: boolean;
}

export const DEFAULT_CONFIG: MetronomeConfig = Object.freeze({
  bpm: 80,
  beatsPerBar: 4,
  beatUnit: 4,
  subdivision: 1,
  groove: 'click',
  sound: 'kit',
  accentHz: 1500,
  beatHz: 1000,
  master: 0.7,
  volumes: Object.freeze({ kick: 0.9, snare: 0.8, rim: 0.8, hihat: 0.6, hihatOpen: 0.5, ride: 0.6, beep: 0.6 }),
  countInBars: 1,
  workout: 'steady',
  targetBpm: 120,
  stepBpm: 4,
  everyBars: 4,
  playBars: 2,
  muteBars: 2,
  repBars: 8,
  allowDuringQuietHours: false,
});

// ---------------------------------------------------------- validation ---

type Rule = { kind: 'int'; min: number; max: number } | { kind: 'num'; min: number; max: number } | { kind: 'enum'; values: readonly (string | number)[] } | { kind: 'bool' };
const int = (min: number, max: number): Rule => ({ kind: 'int', min, max });
const num = (min: number, max: number): Rule => ({ kind: 'num', min, max });
const oneOf = (...values: (string | number)[]): Rule => ({ kind: 'enum', values });

const RULES: Record<Exclude<keyof MetronomeConfig, 'volumes'>, Rule> = {
  bpm: int(MIN_BPM, MAX_BPM),
  beatsPerBar: int(1, 12),
  beatUnit: oneOf(2, 4, 8),
  subdivision: oneOf(1, 2, 3, 4),
  groove: oneOf(...GROOVES),
  sound: oneOf('kit', 'beep'),
  accentHz: int(200, 4000),
  beatHz: int(200, 4000),
  master: num(0, 1),
  countInBars: int(0, 4),
  workout: oneOf(...WORKOUTS),
  targetBpm: int(MIN_BPM, MAX_BPM),
  stepBpm: int(1, 50),
  everyBars: int(1, 64),
  playBars: int(1, 16),
  muteBars: int(1, 16),
  repBars: int(1, 64),
  allowDuringQuietHours: { kind: 'bool' },
};

function check(rule: Rule, v: unknown): boolean {
  switch (rule.kind) {
    case 'int':
      return typeof v === 'number' && Number.isInteger(v) && v >= rule.min && v <= rule.max;
    case 'num':
      return typeof v === 'number' && Number.isFinite(v) && v >= rule.min && v <= rule.max;
    case 'enum':
      return rule.values.includes(v as string | number);
    case 'bool':
      return typeof v === 'boolean';
  }
}

function describe(rule: Rule): string {
  if (rule.kind === 'enum') return `one of ${rule.values.join(', ')}`;
  if (rule.kind === 'bool') return 'true or false';
  return `${rule.kind === 'int' ? 'a whole number' : 'a number'} from ${rule.min} to ${rule.max}`;
}

/** Strict check of a whole config (e.g. a user's edit). Unknown keys are refused. */
export function validateConfig(input: unknown): Validation<MetronomeConfig> {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return { ok: false, error: 'metronome: must be an object' };
  const o = input as Record<string, unknown>;
  for (const k of Object.keys(o)) if (!(k in RULES) && k !== 'volumes') return { ok: false, error: `metronome.${k}: unknown setting` };
  for (const [k, rule] of Object.entries(RULES)) {
    if (!check(rule, o[k])) return { ok: false, error: `metronome.${k}: must be ${describe(rule)}` };
  }
  const vol = o.volumes as Record<string, unknown> | undefined;
  if (typeof vol !== 'object' || vol === null) return { ok: false, error: 'metronome.volumes: must be an object' };
  for (const k of Object.keys(vol)) if (!VOICES.includes(k as Voice)) return { ok: false, error: `metronome.volumes.${k}: unknown voice` };
  for (const v of VOICES) if (!check(num(0, 1), vol[v])) return { ok: false, error: `metronome.volumes.${v}: must be a number from 0 to 1` };
  if (o.workout === 'ladder' && (o.targetBpm as number) <= (o.bpm as number)) {
    return { ok: false, error: 'metronome.targetBpm: a ladder must climb above its start tempo' };
  }
  return { ok: true, value: { ...(o as unknown as MetronomeConfig), volumes: { ...(vol as Record<Voice, number>) } } };
}

/** Flattens a config for storage as item fields (flat, under 32 keys). */
export function toFields(config: MetronomeConfig): Details {
  const { volumes, ...rest } = config;
  const out: Record<string, string | number | boolean> = { ...rest };
  for (const v of VOICES) out[`vol_${v}`] = volumes[v];
  return out;
}

/**
 * Reads stored fields back. Lenient on purpose: each field that is missing
 * or invalid (an older or newer app version) falls back to its default, so
 * stored preferences can never break the metronome.
 */
export function fromFields(fields: Details | undefined): MetronomeConfig {
  const f = fields ?? {};
  const out: Record<string, unknown> = {};
  for (const [k, rule] of Object.entries(RULES)) out[k] = check(rule, f[k]) ? f[k] : DEFAULT_CONFIG[k as keyof typeof RULES];
  const volumes: Record<string, number> = {};
  for (const v of VOICES) volumes[v] = check(num(0, 1), f[`vol_${v}`]) ? (f[`vol_${v}`] as number) : DEFAULT_CONFIG.volumes[v];
  out.volumes = volumes;
  if (out.workout === 'ladder' && (out.targetBpm as number) <= (out.bpm as number)) out.workout = 'steady';
  return out as unknown as MetronomeConfig;
}

// ------------------------------------------------------------- timing ----

/** Ramp tempo for a workout bar (0-based): start, stepping toward target every N bars, then holding. */
export function rampBpm(start: number, target: number, step: number, every: number, bar: number): number {
  if (bar < 0) return start;
  const n = Math.floor(bar / every);
  return start <= target ? Math.min(target, start + n * step) : Math.max(target, start - n * step);
}

/** Gap click: is this workout bar silent? */
export function isMutedBar(playBars: number, muteBars: number, bar: number): boolean {
  return bar >= 0 && bar % (playBars + muteBars) >= playBars;
}

export function stepsPerBeat(config: MetronomeConfig, countIn: boolean): number {
  if (countIn) return 1;
  switch (config.groove) {
    case 'click':
      return config.subdivision;
    case 'shuffle':
      return 3;
    default:
      return 2;
  }
}

/** Compound meters (6/8, 9/8, 12/8) are felt in groups of three. */
export function isCompound(config: Pick<MetronomeConfig, 'beatUnit' | 'beatsPerBar'>): boolean {
  return config.beatUnit === 8 && config.beatsPerBar > 3 && config.beatsPerBar % 3 === 0;
}

export interface Hit {
  readonly voice: Voice;
  /** 0 to 1, before the user's volume settings. */
  readonly gain: number;
  /** Beep pitch. */
  readonly hz?: number;
}

/** Which sounds play on one grid step. */
export function hitsFor(config: MetronomeConfig, beat: number, step: number, countIn: boolean): Hit[] {
  const bpb = config.beatsPerBar;
  if (countIn || config.groove === 'click') {
    const beep = config.sound === 'beep';
    if (step > 0) return [beep ? { voice: 'beep', gain: 0.3, hz: config.beatHz } : { voice: 'hihat', gain: 0.45 }];
    if (beat === 0) return [beep ? { voice: 'beep', gain: 1, hz: config.accentHz } : { voice: 'rim', gain: 1 }];
    if (isCompound(config) && beat % 3 === 0) return [beep ? { voice: 'beep', gain: 0.85, hz: config.beatHz } : { voice: 'rim', gain: 0.8 }];
    return [beep ? { voice: 'beep', gain: 0.65, hz: config.beatHz } : { voice: 'rim', gain: 0.55 }];
  }
  const hits: Hit[] = [];
  const onBeat = step === 0;
  switch (config.groove) {
    case 'rock': {
      const lastOffbeat = beat === bpb - 1 && step === 1 && bpb >= 4;
      hits.push(lastOffbeat ? { voice: 'hihatOpen', gain: 0.55 } : { voice: 'hihat', gain: onBeat ? (beat === 0 ? 0.9 : 0.75) : 0.5 });
      if (onBeat && beat % 2 === 0) hits.push({ voice: 'kick', gain: beat === 0 ? 1 : 0.85 });
      if (onBeat && beat % 2 === 1) hits.push({ voice: 'snare', gain: 0.9 });
      break;
    }
    case 'half-time': {
      hits.push({ voice: 'hihat', gain: onBeat ? (beat === 0 ? 0.8 : 0.65) : 0.45 });
      if (onBeat && beat === 0) hits.push({ voice: 'kick', gain: 1 });
      if (onBeat && bpb >= 2 && beat === Math.floor(bpb / 2)) hits.push({ voice: 'snare', gain: 1 });
      break;
    }
    case 'shuffle': {
      if (step === 0) hits.push({ voice: 'ride', gain: beat === 0 ? 0.85 : 0.7 });
      if (step === 2) hits.push({ voice: 'ride', gain: 0.5 });
      if (onBeat && beat % 2 === 0) hits.push({ voice: 'kick', gain: beat === 0 ? 1 : 0.85 });
      if (onBeat && beat % 2 === 1) hits.push({ voice: 'snare', gain: 0.85 });
      break;
    }
  }
  return hits;
}

export interface Tick {
  /** Running count from 0. */
  readonly index: number;
  /** Seconds from the start of playback. */
  readonly time: number;
  /** Negative during count-in (-countInBars to -1), then 0, 1, 2... */
  readonly bar: number;
  readonly beat: number;
  readonly step: number;
  readonly stepsPerBeat: number;
  readonly beatsPerBar: number;
  readonly bpm: number;
  readonly countIn: boolean;
  /** Gap click: the beat is still counted, just silent. */
  readonly muted: boolean;
  readonly hits: readonly Hit[];
}

/**
 * Produces ticks one at a time. Changing the config while playing: a plain
 * tempo change applies at the next tick (steady and gap workouts); every
 * other change waits for the next bar, so the grid never breaks mid-bar.
 */
export class TickPlanner {
  #config: MetronomeConfig;
  #pending: MetronomeConfig | null = null;
  #bar: number;
  #beat = 0;
  #step = 0;
  #time = 0;
  #index = 0;

  constructor(config: MetronomeConfig) {
    this.#config = config;
    this.#bar = 0 - config.countInBars; // not -x: that gives -0 when there is no count-in
  }

  get config(): MetronomeConfig {
    return this.#pending ?? this.#config;
  }

  setConfig(config: MetronomeConfig): void {
    this.#pending = config;
  }

  /** The next tick, or null when a ladder rep is finished. */
  next(): Tick | null {
    const barStart = this.#beat === 0 && this.#step === 0;
    if (this.#pending && barStart) {
      this.#config = this.#pending;
      this.#pending = null;
    } else if (this.#pending && this.#pending.bpm !== this.#config.bpm && (this.#config.workout === 'steady' || this.#config.workout === 'gap')) {
      this.#config = { ...this.#config, bpm: this.#pending.bpm };
    }
    const c = this.#config;
    if (c.workout === 'ladder' && this.#bar >= c.repBars) return null;
    const countIn = this.#bar < 0;
    const spb = stepsPerBeat(c, countIn);
    const bpm = !countIn && c.workout === 'ramp' ? rampBpm(c.bpm, c.targetBpm, c.stepBpm, c.everyBars, this.#bar) : c.bpm;
    const muted = !countIn && c.workout === 'gap' && isMutedBar(c.playBars, c.muteBars, this.#bar);
    const tick: Tick = {
      index: this.#index,
      time: this.#time,
      bar: this.#bar,
      beat: this.#beat,
      step: this.#step,
      stepsPerBeat: spb,
      beatsPerBar: c.beatsPerBar,
      bpm,
      countIn,
      muted,
      hits: muted ? [] : hitsFor(c, this.#beat, this.#step, countIn),
    };
    this.#index++;
    this.#time += 60 / bpm / spb;
    if (++this.#step >= spb) {
      this.#step = 0;
      if (++this.#beat >= c.beatsPerBar) {
        this.#beat = 0;
        this.#bar++;
      }
    }
    return tick;
  }
}

// --------------------------------------------------------- tap helpers ---

/** Tempo from tapped times (ms). Taps more than 2 s apart start over. Uses the median of the last 6 gaps. */
export function tapTempo(tapsMs: readonly number[]): number | null {
  let start = 0;
  for (let i = 1; i < tapsMs.length; i++) if (tapsMs[i]! - tapsMs[i - 1]! > 2000 || tapsMs[i]! <= tapsMs[i - 1]!) start = i;
  const taps = tapsMs.slice(start).slice(-7);
  if (taps.length < 2) return null;
  const gaps = taps.slice(1).map((t, i) => t - taps[i]!).sort((a, b) => a - b);
  const mid = gaps.length / 2;
  const median = gaps.length % 2 ? gaps[Math.floor(mid)]! : (gaps[mid - 1]! + gaps[mid]!) / 2;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(60000 / median)));
}

export interface TapTiming {
  readonly taps: number;
  /** Average distance from the beat, ms. Lower is tighter. */
  readonly meanAbsMs: number;
  /** Average signed offset, ms: positive = behind the beat (dragging), negative = rushing. Includes touch-screen delay. */
  readonly meanOffsetMs: number;
}

/**
 * Compares tapped times with beat times (both in seconds, same clock). Each
 * tap is matched to the nearest beat within half a beat; strays are ignored.
 * Needs at least 4 matched taps.
 */
export function tapTiming(taps: readonly number[], beats: readonly { time: number; bpm: number }[]): TapTiming | null {
  const offsets: number[] = [];
  for (const t of taps) {
    let best: { d: number; half: number } | null = null;
    for (const b of beats) {
      const d = t - b.time;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { d, half: 30 / b.bpm };
    }
    if (best && Math.abs(best.d) <= best.half) offsets.push(best.d * 1000);
  }
  if (offsets.length < 4) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  return { taps: offsets.length, meanAbsMs: Math.round(mean(offsets.map(Math.abs))), meanOffsetMs: Math.round(mean(offsets)) };
}

/**
 * First audible sample of a decoded drum hit. Some browsers leave the MP3
 * encoder's lead-in silence in; starting playback here keeps hits on time.
 * Backs off a few samples so the attack is never clipped.
 */
export function findOnset(samples: ArrayLike<number>, threshold = 0.02, backoff = 16): number {
  for (let i = 0; i < samples.length; i++) if (Math.abs(samples[i]!) > threshold) return Math.max(0, i - backoff);
  return 0;
}
