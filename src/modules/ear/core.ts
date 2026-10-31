/**
 * Ear training, pure core (Blake, 2026-10-31; from the ear-training research
 * review). No audio, no engine access: given a skill and a seed, make one
 * exemplar (what to play, what to ask, the right answer); given a response,
 * grade it into an FSRS rating plus details for the log.
 *
 * Shape of the curriculum (research, "Progression and timeline"):
 * tonic-relative hearing is the spine (scale degree after a cadence);
 * intervals are a secondary, interleaved drill heard in key context once
 * established; chord quality, then chord function in a progression; rhythm
 * and meter run in parallel from day one. A card is a skill ("scale degree 6",
 * "minor third"), never one sound: every trial is a fresh exemplar with a new
 * key, register, timbre and direction.
 */

import type { Rating } from '../../model.ts';

// ------------------------------------------------------------ randomness ---

export type Rng = () => number;

/** Small seeded generator (mulberry32): same seed, same exemplar. */
export function rngFrom(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
function shuffle<T>(rng: Rng, xs: readonly T[]): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

// ---------------------------------------------------------------- sound ---

/** Synth voices. Varying timbre is part of exemplar variation. */
export type Voice = 'pluck' | 'soft' | 'bright' | 'click' | 'accent';
export const PITCHED_VOICES: readonly Voice[] = ['pluck', 'soft', 'bright'];

/** One sound to play. Times in seconds from the start of the trial. */
export interface NoteEvent {
  readonly at: number;
  readonly dur: number;
  /** MIDI note number (60 = middle C). Ignored by clicks. */
  readonly midi: number;
  readonly voice: Voice;
  /** 0 to 1. */
  readonly gain: number;
}

export const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Major scale, semitones above the tonic for degrees 1 to 7. */
export const MAJOR = [0, 2, 4, 5, 7, 9, 11] as const;
/** Semitones above the tonic of degree d (0-based, may run past 6 into the next octave). */
const degreeSemis = (d: number) => MAJOR[((d % 7) + 7) % 7]! + 12 * Math.floor(d / 7);

/** I-IV-V-I in close voicing over a bass: establishes the key (research: tonic first). */
export function cadence(tonic: number, voice: Voice, start = 0, beat = 0.6): NoteEvent[] {
  const chords = [
    [0, 4, 7],
    [0, 5, 9],
    [-1, 2, 7],
    [0, 4, 7],
  ];
  const bass = [-12, -7, -5, -12];
  return chords.flatMap((c, i) => [
    ...c.map((s) => ({ at: start + i * beat, dur: beat * 0.95, midi: tonic + s, voice, gain: 0.45 })),
    { at: start + i * beat, dur: beat * 0.95, midi: tonic + bass[i]!, voice, gain: 0.5 },
  ]);
}

const note = (at: number, midi: number, voice: Voice, dur = 0.9, gain = 0.8): NoteEvent => ({ at, dur, midi, voice, gain });
const block = (at: number, midis: readonly number[], voice: Voice, dur = 1.2): NoteEvent[] => midis.map((m) => note(at, m, voice, dur, 0.55));
export const endOf = (events: readonly NoteEvent[]) => events.reduce((t, e) => Math.max(t, e.at + e.dur), 0);

// --------------------------------------------------------------- skills ---

export type Family = 'direction' | 'degree' | 'interval' | 'quality' | 'function' | 'meter' | 'rhythm';
export const FAMILIES: readonly Family[] = ['direction', 'degree', 'interval', 'quality', 'function', 'meter', 'rhythm'];

export interface Skill {
  readonly family: Family;
  /** Category id within the family: ASCII, stable. */
  readonly category: string;
  /** What the learner sees on the answer button. */
  readonly label: string;
}

const s = (family: Family, category: string, label = category): Skill => ({ family, category, label });

const DEGREE_LABEL = ['1 · do', '2 · re', '3 · mi', '4 · fa', '5 · sol', '6 · la', '7 · ti'];
const degree = (n: number) => s('degree', String(n), DEGREE_LABEL[n - 1]);

/** Interval categories: semitones. */
export const INTERVAL_SEMIS: Readonly<Record<string, number>> = {
  m2: 1, M2: 2, m3: 3, M3: 4, P4: 5, TT: 6, P5: 7, m6: 8, M6: 9, m7: 10, M7: 11, P8: 12,
};
/** Triad qualities: semitones above the root. */
export const QUALITY_SEMIS: Readonly<Record<string, readonly number[]>> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
};
/** Diatonic functions in major: scale degree index of the root. */
export const FUNCTION_DEGREE: Readonly<Record<string, number>> = { I: 0, ii: 1, iii: 2, IV: 3, V: 4, vi: 5, viio: 6 };
const FUNCTION_LABEL: Readonly<Record<string, string>> = { viio: 'vii°' };

/**
 * The mastery ladder (research levels 1 to 6; 7 to 9 deferred). A level's
 * skills are added when the previous level is mastered (or unlocked by hand).
 * Strands run side by side, as in the Eastman and Berklee curricula.
 */
export const LADDER: readonly { readonly level: number; readonly label: string; readonly skills: readonly Skill[] }[] = [
  {
    level: 1,
    label: 'Pitch direction; steady eighths',
    skills: [s('direction', 'up', 'Up'), s('direction', 'down', 'Down'), s('direction', 'same', 'Same'), s('rhythm', 'r1', 'Rhythm: quarters and eighths')],
  },
  {
    level: 2,
    label: 'Tonic and degrees 1, 3, 5; simple meter',
    skills: [degree(1), degree(3), degree(5), s('meter', 'duple', '2 (duple)'), s('meter', 'triple', '3 (triple)')],
  },
  {
    level: 3,
    label: 'All diatonic degrees; seconds, thirds, fourths, fifths; major and minor',
    skills: [
      degree(2), degree(4), degree(6), degree(7),
      ...['m2', 'M2', 'm3', 'M3', 'P4', 'P5'].map((c) => s('interval', c)),
      s('quality', 'major', 'Major'), s('quality', 'minor', 'Minor'),
    ],
  },
  {
    level: 4,
    label: 'Sixths, sevenths, tritone, octave; rests and sixteenths',
    skills: [...['m6', 'M6', 'm7', 'M7', 'TT', 'P8'].map((c) => s('interval', c)), s('rhythm', 'r2', 'Rhythm: rests and sixteenths')],
  },
  {
    level: 5,
    label: 'Diminished and augmented; compound meter',
    skills: [s('quality', 'dim', 'Diminished'), s('quality', 'aug', 'Augmented'), s('meter', 'compound', '6/8 (compound)')],
  },
  {
    level: 6,
    label: 'Chord function in a progression',
    skills: Object.keys(FUNCTION_DEGREE).map((c) => s('function', c, FUNCTION_LABEL[c] ?? c)),
  },
];

export const ALL_SKILLS: readonly Skill[] = LADDER.flatMap((l) => l.skills);
export const levelOf = (sk: Pick<Skill, 'family' | 'category'>) =>
  LADDER.find((l) => l.skills.some((x) => x.family === sk.family && x.category === sk.category))?.level;
export const skillOf = (family: string, category: string) => ALL_SKILLS.find((x) => x.family === family && x.category === category);

/** The most confusable partner, used to narrow choices in scaffold mode (research: interleave confusables). */
export const CONFUSABLE: Readonly<Record<Family, Readonly<Record<string, string>>>> = {
  direction: { up: 'down', down: 'up', same: 'up' },
  degree: { '1': '3', '2': '1', '3': '5', '4': '3', '5': '3', '6': '5', '7': '1' },
  interval: { m2: 'M2', M2: 'm2', m3: 'M3', M3: 'm3', P4: 'P5', P5: 'P4', TT: 'P5', m6: 'M6', M6: 'm6', m7: 'M7', M7: 'm7', P8: 'M7' },
  quality: { major: 'minor', minor: 'major', dim: 'minor', aug: 'major' },
  function: { I: 'vi', ii: 'IV', iii: 'V', IV: 'ii', V: 'viio', vi: 'IV', viio: 'V' },
  meter: { duple: 'compound', triple: 'duple', compound: 'duple' },
  rhythm: {},
};

// --------------------------------------------------------------- trials ---

/** How each degree (0-based) resolves to the tonic: index 7 is the tonic an octave up. */
export const RESOLUTION: readonly (readonly number[])[] = [[0], [1, 0], [2, 1, 0], [3, 2, 1, 0], [4, 0], [5, 4, 0], [6, 7]];

export interface Choice {
  readonly id: string;
  readonly label: string;
}

export interface RhythmTask {
  readonly bpm: number;
  /** Expected onsets in beats within the answer bar (4 beats). */
  readonly onsets: readonly number[];
  /** When the learner's bar starts, in seconds from the start of the trial. */
  readonly answerAt: number;
  readonly beats: number;
}

export interface Trial {
  readonly family: Family;
  readonly category: string;
  readonly prompt: string;
  /** Empty for rhythm (the answer is tapped). */
  readonly choices: readonly Choice[];
  /** The right choice id (for rhythm, the category). */
  readonly answer: string;
  /** The exemplar. */
  readonly events: readonly NoteEvent[];
  /** Played after a wrong answer: the right answer, resolved or slowed down. */
  readonly feedback: readonly NoteEvent[];
  /** Spoken-style explanation shown after answering. */
  readonly explain: string;
  readonly rhythm?: RhythmTask;
  /** Second wrong in a row: two choices only and an explicit cadence. */
  readonly scaffold: boolean;
}

export interface TrialContext {
  /** Unlocked categories in this family (the answer choices). */
  readonly unlocked: readonly string[];
  /** Answers given on this card so far (oldest first): drives scaffold and key context. */
  readonly history: readonly boolean[];
}

/** Scaffold mode after two wrong answers in a row (research: "second consecutive error"). */
export const scaffolding = (history: readonly boolean[]) => history.length >= 2 && !history.at(-1) && !history.at(-2);
/** Intervals are heard in key context once a card has this many answers (research: context should outnumber naked trials). */
export const CONTEXT_AFTER = 3;

function choicesFor(rng: Rng, family: Family, answer: string, unlocked: readonly string[], scaffold: boolean): Choice[] {
  const ordered = ALL_SKILLS.filter((x) => x.family === family && (unlocked.includes(x.category) || x.category === answer));
  if (!scaffold || ordered.length <= 2) return ordered.map((x) => ({ id: x.category, label: x.label }));
  const partner = CONFUSABLE[family][answer];
  const other = ordered.find((x) => x.category === partner) ?? shuffle(rng, ordered.filter((x) => x.category !== answer))[0]!;
  const two = ordered.filter((x) => x.category === answer || x.category === other.category);
  return two.map((x) => ({ id: x.category, label: x.label }));
}

/** One fresh exemplar of a skill. */
export function makeTrial(skill: Pick<Skill, 'family' | 'category'>, ctx: TrialContext, seed: number): Trial {
  const known = skillOf(skill.family, skill.category);
  if (!known) throw new RangeError(`unknown ear skill ${skill.family}/${skill.category}`);
  const rng = rngFrom(seed);
  const scaffold = scaffolding(ctx.history);
  const voice = pick(rng, PITCHED_VOICES);
  const choices = known.family === 'rhythm' ? [] : choicesFor(rng, known.family, known.category, ctx.unlocked, scaffold);
  const base = { family: known.family, category: known.category, answer: known.category, choices, scaffold };
  switch (known.family) {
    case 'direction': {
      const a = int(rng, 52, 70);
      const step = int(rng, scaffold ? 5 : 1, 12);
      const b = known.category === 'same' ? a : known.category === 'up' ? a + step : a - step;
      const events = [note(0, a, voice), note(1, b, voice)];
      return { ...base, prompt: 'Second note: up, down or the same?', events, feedback: [note(0, a, voice, 0.6), note(0.7, b, voice, 0.6)], explain: `${known.label}.` };
    }
    case 'degree': {
      const tonic = int(rng, 55, 66);
      const d = Number(known.category) - 1;
      const pre = cadence(tonic, voice);
      // A different octave or timbre from the cadence (research: Benbassat-style card).
      const target = tonic + degreeSemis(d) + pick(rng, scaffold ? [0] : [-12, 0, 12]);
      const tVoice = scaffold ? voice : pick(rng, PITCHED_VOICES);
      const at = endOf(pre) + 0.4;
      const events = [...pre, note(at, target, tVoice, 1.2)];
      // Resolution to the tonic (research example: 6 -> 5 -> 1; ti goes up to do).
      const feedback = RESOLUTION[d]!.map((x, i) => note(i * 0.45, target - degreeSemis(d) + degreeSemis(x), tVoice, 0.42));
      return { ...base, prompt: 'Key set by the cadence. Which scale degree is the last note?', events, feedback, explain: `${known.label}: hear it resolve to 1.` };
    }
    case 'interval': {
      const semis = INTERVAL_SEMIS[known.category]!;
      const up = scaffold || rng() < 0.5;
      const inContext = !scaffold && ctx.history.length >= CONTEXT_AFTER && rng() < 0.6;
      let pre: NoteEvent[] = [];
      let low = int(rng, 50, 64);
      if (inContext) {
        // Put the interval on scale degrees where it is diatonic, after a cadence.
        const tonic = int(rng, 55, 64);
        const starts = [...Array(7).keys()].filter((d) => [...Array(8).keys()].some((k) => degreeSemis(d + k) - degreeSemis(d) === semis));
        low = tonic + degreeSemis(pick(rng, starts)) - 12 * (rng() < 0.5 ? 1 : 0);
        pre = cadence(tonic, voice);
      }
      const at = pre.length ? endOf(pre) + 0.4 : 0;
      const [first, second] = up ? [low, low + semis] : [low + semis, low];
      const events = [...pre, note(at, first, voice), note(at + 1, second, voice)];
      const feedback = [note(0, first, voice, 0.7), note(0.8, second, voice, 0.7), ...block(1.7, [first, second], voice)];
      return { ...base, prompt: `Which interval${inContext ? ' (in this key)' : ''}?`, events, feedback, explain: `${known.category}, ${up ? 'up' : 'down'} (${semis} semitones).` };
    }
    case 'quality': {
      const root = int(rng, 48, 60);
      const notes = QUALITY_SEMIS[known.category]!.map((x) => root + x);
      const events = block(0, notes, voice, 1.6);
      const feedback = [...notes.map((m, i) => note(i * 0.4, m, voice, 0.5)), ...block(1.4, notes, voice)];
      return { ...base, prompt: 'Which chord quality?', events, feedback, explain: `${known.label}: arpeggiated, then together.` };
    }
    case 'function': {
      const tonic = int(rng, 52, 60);
      const triad = (deg: number) => [0, 2, 4].map((k) => tonic + degreeSemis(deg + k));
      const bass = (deg: number) => tonic - 12 + degreeSemis(deg);
      const d = FUNCTION_DEGREE[known.category]!;
      const prog = [0, d, 4, 0];
      const beat = 0.9;
      const events = prog.flatMap((deg, i) => [...block(i * beat, triad(deg), voice, beat * 0.95), note(i * beat, bass(deg), voice, beat * 0.95, 0.6)]);
      const feedback = [...block(0, triad(d), voice), note(0, bass(d), voice, 1.2, 0.6), note(1.4, bass(d), voice, 1, 0.7)];
      return { ...base, prompt: 'I – ? – V – I. Which chord is second?', events, feedback, explain: `${FUNCTION_LABEL[known.category] ?? known.category} (bass on degree ${d + 1}).` };
    }
    case 'meter': {
      const bpm = int(rng, 84, 104);
      const beat = 60 / bpm;
      const [beats, sub] = known.category === 'duple' ? [2, 2] : known.category === 'triple' ? [3, 2] : [2, 3];
      const bass = int(rng, 40, 47);
      const events: NoteEvent[] = [];
      for (let bar = 0; bar < 4; bar++) {
        for (let b = 0; b < beats; b++) {
          for (let k = 0; k < sub; k++) {
            const at = (bar * beats + b + k / sub) * beat;
            const v: Voice = b === 0 && k === 0 ? 'accent' : 'click';
            events.push({ at, dur: 0.05, midi: 0, voice: v, gain: k === 0 ? (b === 0 ? 1 : 0.7) : 0.3 });
          }
          if (b === 0) events.push(note(bar * beats * beat, bass, voice, beat * 0.9, 0.6));
        }
      }
      return { ...base, prompt: 'Count along. Which meter?', events, feedback: events, explain: `${known.label}: ${beats} beats a bar, each split in ${sub}.` };
    }
    case 'rhythm': {
      const bpm = 80;
      const beat = 60 / bpm;
      const onsets = rhythmPattern(rng, known.category === 'r2' ? 2 : 1);
      const click = (at: number, accent: boolean, gain = 0.8): NoteEvent => ({ at, dur: 0.05, midi: 0, voice: accent ? 'accent' : 'click', gain });
      const countIn = (bar: number, gain: number) => [0, 1, 2, 3].map((b) => click((bar * 4 + b) * beat, b === 0, gain));
      const pitch = int(rng, 60, 72);
      const pattern = onsets.map((o) => note((4 + o) * beat, pitch, voice, 0.18, 0.8));
      // Count-in, the rhythm, count-in again, then the learner's bar (soft clicks keep time).
      const events = [...countIn(0, 0.8), ...pattern, ...countIn(1, 0.25), ...countIn(2, 0.8), ...countIn(3, 0.25)];
      return {
        ...base,
        prompt: 'Listen, then tap the rhythm back in the bar after the second count-in.',
        events,
        feedback: [...countIn(0, 0.8), ...onsets.map((o) => note((4 + o) * beat, pitch, voice, 0.18, 0.8))],
        explain: `Onsets on beats ${onsets.map((o) => +(o + 1).toFixed(2)).join(', ')}.`,
        rhythm: { bpm, onsets, answerAt: 12 * beat, beats: 4 },
      };
    }
  }
}

/**
 * One bar of 4/4 as onsets in beats. Level 1: quarters and eighths (never all
 * quarters). Level 2 adds quarter rests and sixteenth figures.
 */
export function rhythmPattern(rng: Rng, level: 1 | 2): number[] {
  const cells1: number[][] = [[0], [0, 0.5]];
  const cells2: number[][] = [...cells1, [], [0, 0.25, 0.5, 0.75], [0, 0.5, 0.75], [0, 0.25, 0.5]];
  const cells = level === 1 ? cells1 : cells2;
  for (;;) {
    const bar = [0, 1, 2, 3].map((b) => (b === 0 ? pick(rng, cells.filter((c) => c.length > 0)) : pick(rng, cells)).map((o) => o + b));
    const onsets = bar.flat();
    const plain = onsets.length === 4 && onsets.every((o) => Number.isInteger(o));
    const hasLevel2 = level === 1 || bar.some((c) => c.length === 0 || c.some((o) => o % 0.5 !== 0));
    if (!plain && hasLevel2) return onsets;
  }
}

// -------------------------------------------------------------- grading ---

export interface ChoiceResponse {
  readonly choice: string;
  /** From the end of the first playback to the answer. */
  readonly latencyMs: number;
  /** Plays after the first one. */
  readonly replays: number;
}

export interface GradeContext {
  /** The learner's rolling median latency for this family on correct answers, if known. */
  readonly medianLatencyMs: number | null;
  /** Whether the previous answer on this card was right. */
  readonly previousCorrect: boolean;
}

export type Details = Record<string, string | number | boolean>;

export interface Grade {
  readonly correct: boolean;
  readonly rating: Rating;
  /** For the review event: flat, small, validated. */
  readonly details: Details;
}

/**
 * The research's per-response score, P = 0.60A + 0.15L + 0.10C + 0.10R + 0.05H,
 * without confidence (C; no confidence prompt yet), renormalized to 0..1.
 * Stored for later fitting; FSRS gets the rating below.
 */
export function responseScore(correct: boolean, latencyMs: number, median: number | null, replays: number, scaffold: boolean): number {
  const A = correct ? 1 : 0;
  const L = median === null || latencyMs <= 0 ? 1 : Math.min(1, median / latencyMs);
  const R = replays === 0 ? 1 : 0;
  const H = scaffold ? 0 : 1;
  return Math.round(((0.6 * A + 0.15 * L + 0.1 * R + 0.05 * H) / 0.9) * 1000) / 1000;
}

/**
 * Answer to FSRS rating, mirroring the research's cold-start multipliers:
 * wrong -> again; right after a replay or with scaffolding -> hard;
 * right first time -> good; right first time, at or under the usual speed,
 * and right last time too -> easy (two in a row guards against lucky guesses).
 */
export function rate(correct: boolean, firstTry: boolean, fast: boolean, previousCorrect: boolean): Rating {
  if (!correct) return 'again';
  if (!firstTry) return 'hard';
  return fast && previousCorrect ? 'easy' : 'good';
}

export function gradeChoice(trial: Trial, r: ChoiceResponse, g: GradeContext): Grade {
  const correct = r.choice === trial.answer;
  const latencyMs = Math.max(0, Math.round(r.latencyMs));
  const replays = Math.max(0, Math.floor(r.replays));
  const fast = g.medianLatencyMs !== null && latencyMs <= g.medianLatencyMs;
  return {
    correct,
    rating: rate(correct, replays === 0 && !trial.scaffold, fast, g.previousCorrect),
    details: {
      family: trial.family,
      category: trial.category,
      answered: r.choice.slice(0, 16),
      correct,
      latencyMs,
      replays,
      scaffold: trial.scaffold,
      score: responseScore(correct, latencyMs, g.medianLatencyMs, replays, trial.scaffold),
    },
  };
}

export interface RhythmCheck {
  readonly correct: boolean;
  /** Expected onsets with a tap close enough, after removing the learner's steady lag. */
  readonly matched: number;
  readonly missed: number;
  readonly extra: number;
  /** Average distance of matched taps from the beat after lag removal, ms. */
  readonly timingMs: number;
  /** The steady lag removed (median signed offset), ms. Touch screens add some. */
  readonly lagMs: number;
}

/** A tap counts if within this fraction of a beat of an expected onset (after lag removal). */
export const RHYTHM_TOLERANCE_BEATS = 0.125;
/** A steady lag bigger than this is a wrong rhythm, not touch delay. */
export const MAX_LAG_BEATS = 0.25;

/**
 * Taps (seconds from the start of the learner's bar) against the expected
 * onsets. Removes a steady lag first (touch screens add delay), then pairs
 * each expected onset with the nearest unused tap.
 */
export function checkRhythm(task: RhythmTask, tapsSec: readonly number[]): RhythmCheck {
  const beat = 60 / task.bpm;
  const taps = [...tapsSec].filter((x) => Number.isFinite(x) && x > -MAX_LAG_BEATS * beat && x < (task.beats + MAX_LAG_BEATS) * beat).sort((a, b) => a - b).map((x) => x / beat);
  const expected = [...task.onsets];
  // Lag: median of each expected onset's nearest tap offset.
  const offsets = expected.map((o) => taps.reduce((best, t) => (Math.abs(t - o) < Math.abs(best) ? t - o : best), Infinity)).filter(Number.isFinite);
  const sorted = [...offsets].sort((a, b) => a - b);
  const lag = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
  const used = new Set<number>();
  const errors: number[] = [];
  for (const o of expected) {
    let best = -1;
    for (const [i, t] of taps.entries()) {
      if (used.has(i)) continue;
      const err = Math.abs(t - lag - o);
      if (err <= RHYTHM_TOLERANCE_BEATS && (best < 0 || err < Math.abs(taps[best]! - lag - o))) best = i;
    }
    if (best >= 0) {
      used.add(best);
      errors.push(Math.abs(taps[best]! - lag - o));
    }
  }
  const matched = errors.length;
  const missed = expected.length - matched;
  const extra = taps.length - matched;
  const timingMs = matched ? Math.round((errors.reduce((a, b) => a + b, 0) / matched) * beat * 1000) : 0;
  const lagMs = Math.round(lag * beat * 1000);
  return { correct: missed === 0 && extra === 0 && Math.abs(lag) <= MAX_LAG_BEATS, matched, missed, extra, timingMs, lagMs };
}

/** Tight enough to count as "fast" (easy) for rhythm: average error under this. */
export const RHYTHM_EASY_MS = 40;

export function gradeRhythm(trial: Trial, tapsSec: readonly number[], replays: number, g: Pick<GradeContext, 'previousCorrect'>): Grade {
  if (!trial.rhythm) throw new RangeError('not a rhythm trial');
  const c = checkRhythm(trial.rhythm, tapsSec);
  const reps = Math.max(0, Math.floor(replays));
  return {
    correct: c.correct,
    rating: rate(c.correct, reps === 0 && !trial.scaffold, c.timingMs <= RHYTHM_EASY_MS, g.previousCorrect),
    details: {
      family: trial.family,
      category: trial.category,
      correct: c.correct,
      replays: reps,
      scaffold: trial.scaffold,
      taps: tapsSec.length,
      missed: c.missed,
      extra: c.extra,
      timingMs: c.timingMs,
      lagMs: c.lagMs,
      score: responseScore(c.correct, 0, null, reps, trial.scaffold),
    },
  };
}

// ------------------------------------------------------------ mastery ---

export interface Answer {
  readonly at: number;
  readonly correct: boolean;
}

/** Research: advance on retained performance, at least three sessions apart, >= 85% on mixed exemplars, no category much weaker. */
export const MASTERY = Object.freeze({
  /** Accuracy over the level's most recent answers. */
  accuracy: 0.85,
  recent: 20,
  /** Every skill in the level: at least this many answers, and this accuracy over its last five. */
  perSkillAnswers: 3,
  perSkillAccuracy: 0.7,
  /** Separate sessions: answers more than this far apart start a new session. */
  sessions: 3,
  sessionGapMs: 12 * 60 * 60 * 1000,
});

export interface LevelProgress {
  readonly answers: number;
  readonly sessions: number;
  /** Over the most recent answers (all skills in the level). Null until there are any. */
  readonly accuracy: number | null;
  /** The weakest skill's accuracy over its last five, null if a skill has too few answers. */
  readonly weakest: number | null;
  readonly mastered: boolean;
}

export function levelProgress(perSkill: readonly (readonly Answer[])[]): LevelProgress {
  const all = perSkill.flat().sort((a, b) => a.at - b.at);
  let sessions = all.length ? 1 : 0;
  for (let i = 1; i < all.length; i++) if (all[i]!.at - all[i - 1]!.at > MASTERY.sessionGapMs) sessions++;
  const recent = all.slice(-MASTERY.recent);
  const accuracy = recent.length ? recent.filter((a) => a.correct).length / recent.length : null;
  const enough = perSkill.every((xs) => xs.length >= MASTERY.perSkillAnswers);
  const weakest = enough
    ? Math.min(...perSkill.map((xs) => {
        const last = [...xs].sort((a, b) => a.at - b.at).slice(-5);
        return last.filter((a) => a.correct).length / last.length;
      }))
    : null;
  const mastered =
    enough && sessions >= MASTERY.sessions && recent.length >= MASTERY.recent && accuracy !== null && accuracy >= MASTERY.accuracy && weakest !== null && weakest >= MASTERY.perSkillAccuracy;
  return { answers: all.length, sessions, accuracy, weakest, mastered };
}

/** Rolling median latency of correct answers (most recent 20). */
export function medianLatency(latencies: readonly number[]): number | null {
  const xs = latencies.slice(-20).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
  if (xs.length < 3) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/** Research default: about 18 minutes a day in short blocks. A suggestion shown to the learner, never enforced. */
export const DAILY_MINUTES = 18;
