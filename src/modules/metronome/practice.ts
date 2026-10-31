/**
 * The metronome as an engine module. Speed exercises are this module's own
 * cards ("tempo-exercise", guitar). Each session on one is a review with the
 * tempo in its details, written through the module contract, so the engine
 * tracks speed progress from the log. Preferences are one module item, so
 * they sync and replay like everything else.
 *
 * Every write is checked here first: a bad value comes back as an error to
 * show the user, and never reaches the contract (which would switch the
 * module off).
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { EventOf, GoalBlock, Rating } from '../../model.ts';
import type { Validation } from '../../validate.ts';
import { DEFAULT_CONFIG, fromFields, MAX_BPM, MIN_BPM, toFields, validateConfig } from './core.ts';
import type { MetronomeConfig, Workout } from './core.ts';

export const METRONOME: ModuleManifest = Object.freeze({
  id: 'metronome',
  contract: 0,
  templates: Object.freeze([Object.freeze({ template: 'tempo-exercise', tags: Object.freeze(['guitar'] as const) })]),
});

export const PREFS_ITEM = 'mx-prefs';
export const FREE_PRACTICE = { itemId: 'mx-free', cardId: 'mx-free-c', name: 'Free practice' } as const;
/** Shorter sessions are not logged (a stray start/stop). */
export const MIN_SESSION_MS = 5000;

export interface Exercise {
  readonly cardId: string;
  readonly itemId: string;
  readonly name: string;
}

export function exercises(host: ModuleHost): Exercise[] {
  const names = new Map(host.items().map((i) => [i.id, String(i.fields.name ?? i.id)]));
  return host
    .cards()
    .filter((c) => c.template === 'tempo-exercise' && !c.retired)
    .map((c) => ({ cardId: c.id, itemId: c.itemId, name: names.get(c.itemId) ?? c.itemId }));
}

/** Adds an exercise (or returns it if it exists). `id` must be stable, e.g. a UUID from the app. */
export async function addExercise(host: ModuleHost, id: string, name: string): Promise<Validation<Exercise>> {
  const clean = name.trim();
  if (clean.length < 1 || clean.length > 80) return { ok: false, error: 'exercise name: 1 to 80 characters' };
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(id)) return { ok: false, error: 'exercise id: letters, digits, - and _ only' };
  const itemId = id.startsWith('mx-') ? id : `mx-${id}`;
  const cardId = `${itemId}-c`;
  const existing = exercises(host).find((e) => e.cardId === cardId);
  if (existing) return { ok: true, value: existing };
  await host.addItem(itemId, { name: clean });
  await host.addCard(cardId, itemId, 'tempo-exercise');
  return { ok: true, value: { cardId, itemId, name: clean } };
}

export async function ensureFreePractice(host: ModuleHost): Promise<Exercise> {
  const r = await addExercise(host, FREE_PRACTICE.itemId, FREE_PRACTICE.name);
  if (!r.ok) throw new Error(r.error);
  return r.value;
}

// ------------------------------------------------------------ sessions ---

export interface SessionResult {
  readonly cardId: string;
  readonly workout: Workout;
  /** Tempo at the start, and the tempo reached (the last bar played). */
  readonly startTempo: number;
  readonly tempo: number;
  /** Workout bars played (count-in not included). */
  readonly bars: number;
  readonly durationMs: number;
  /** The player's own verdict: played it cleanly, or sloppy. */
  readonly clean: boolean;
  /** From tapping along (see tapTiming): average distance from the beat, and signed offset. */
  readonly timingErrorMs?: number;
  readonly tapOffsetMs?: number;
  /** Set when the session was a goal's tempo-ladder block. */
  readonly goalId?: string;
  readonly blockId?: string;
}

const isInt = (v: unknown, min: number, max: number) => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function sessionReview(r: SessionResult): Validation<{ rating: Rating; durationMs: number; details: Record<string, string | number | boolean> }> {
  if (!['steady', 'ramp', 'gap', 'ladder'].includes(r.workout)) return { ok: false, error: 'session.workout: unknown' };
  if (!isInt(r.startTempo, MIN_BPM, MAX_BPM) || !isInt(r.tempo, MIN_BPM, MAX_BPM)) return { ok: false, error: `session.tempo: whole numbers from ${MIN_BPM} to ${MAX_BPM}` };
  if (!isInt(r.bars, 1, 100_000)) return { ok: false, error: 'session.bars: at least one workout bar' };
  if (!isInt(r.durationMs, MIN_SESSION_MS, 4 * 60 * 60 * 1000)) return { ok: false, error: 'session.durationMs: too short to log, or over 4 hours' };
  if (typeof r.clean !== 'boolean') return { ok: false, error: 'session.clean: true or false' };
  if (r.timingErrorMs !== undefined && !isInt(r.timingErrorMs, 0, 1000)) return { ok: false, error: 'session.timingErrorMs: 0 to 1000' };
  if (r.tapOffsetMs !== undefined && !isInt(r.tapOffsetMs, -1000, 1000)) return { ok: false, error: 'session.tapOffsetMs: -1000 to 1000' };
  if ((r.goalId === undefined) !== (r.blockId === undefined)) return { ok: false, error: 'session: goalId and blockId go together' };
  const details: Record<string, string | number | boolean> = {
    workout: r.workout,
    tempo: r.tempo,
    startTempo: r.startTempo,
    bars: r.bars,
    clean: r.clean,
  };
  if (r.timingErrorMs !== undefined) details.timingErrorMs = r.timingErrorMs;
  if (r.tapOffsetMs !== undefined) details.tapOffsetMs = r.tapOffsetMs;
  if (r.goalId !== undefined) details.goalId = r.goalId;
  if (r.blockId !== undefined) details.blockId = r.blockId;
  return { ok: true, value: { rating: r.clean ? 'good' : 'again', durationMs: r.durationMs, details } };
}

/** Logs a session on one of this module's exercise cards. */
export async function logSession(host: ModuleHost, result: SessionResult): Promise<Validation<null>> {
  const review = sessionReview(result);
  if (!review.ok) return review;
  if (!exercises(host).some((e) => e.cardId === result.cardId)) return { ok: false, error: `session.cardId: ${result.cardId} is not a metronome exercise` };
  await host.reportRep(result.cardId, review.value.rating, review.value.durationMs, review.value.details);
  return { ok: true, value: null };
}

export interface TempoPoint {
  readonly at: number;
  readonly tempo: number;
  readonly clean: boolean;
  readonly workout: string;
}

/** Speed history of one exercise, oldest first. */
export function tempoHistory(reviews: readonly EventOf<'review'>[]): TempoPoint[] {
  return reviews
    .filter((r) => typeof r.details?.tempo === 'number')
    .map((r) => ({
      at: r.at,
      tempo: r.details!.tempo as number,
      clean: typeof r.details!.clean === 'boolean' ? (r.details!.clean as boolean) : r.rating === 'good' || r.rating === 'easy',
      workout: String(r.details!.workout ?? 'steady'),
    }));
}

/** Fastest tempo played cleanly, or null. */
export function bestCleanTempo(reviews: readonly EventOf<'review'>[]): number | null {
  const clean = tempoHistory(reviews).filter((p) => p.clean);
  return clean.length ? Math.max(...clean.map((p) => p.tempo)) : null;
}

// --------------------------------------------------------- tempo ladder ---

export interface LadderParams {
  readonly cardId: string;
  readonly startBpm: number;
  readonly targetBpm: number;
  readonly stepBpm: number;
  /** Clean reps in a row needed before the tempo goes up. */
  readonly cleanReps: number;
  readonly repBars: number;
}

export interface LadderState {
  /** Tempo for the next rep. */
  readonly tempo: number;
  /** Clean reps in a row at this tempo so far. */
  readonly cleanStreak: number;
  readonly atTarget: boolean;
  readonly reps: number;
}

/**
 * Where a tempo ladder stands, replayed from its reps (spec: raise tempo only
 * after N clean reps, drop back on a sloppy one). Only ladder reps count. A
 * rep at a different tempo than expected (settings changed) re-anchors the
 * ladder at that tempo, within the ladder's range.
 */
export function ladderState(params: LadderParams, reps: readonly { tempo: number; clean: boolean }[]): LadderState {
  const clamp = (t: number) => Math.min(params.targetBpm, Math.max(params.startBpm, t));
  let tempo = params.startBpm;
  let streak = 0;
  for (const rep of reps) {
    if (rep.tempo !== tempo) {
      tempo = clamp(rep.tempo);
      streak = 0;
    }
    if (rep.clean) {
      if (++streak >= params.cleanReps && tempo < params.targetBpm) {
        tempo = clamp(tempo + params.stepBpm);
        streak = 0;
      }
    } else {
      tempo = clamp(tempo - params.stepBpm);
      streak = 0;
    }
  }
  return { tempo, cleanStreak: streak, atTarget: tempo >= params.targetBpm, reps: reps.length };
}

/** A goal block's tempo-ladder parameters (validated when the goal was saved). */
export function ladderParams(block: Pick<GoalBlock, 'kind' | 'params'>): LadderParams | null {
  if (block.kind !== 'tempo-ladder' || !block.params) return null;
  const p = block.params;
  return {
    cardId: String(p.cardId),
    startBpm: p.startBpm as number,
    targetBpm: p.targetBpm as number,
    stepBpm: p.stepBpm as number,
    cleanReps: p.cleanReps as number,
    repBars: p.repBars as number,
  };
}

/** The ladder's state from this module's log. */
export function ladderFor(host: ModuleHost, params: LadderParams): LadderState {
  const reps = tempoHistory(host.reviews(params.cardId)).filter((p) => p.workout === 'ladder');
  return ladderState(params, reps);
}

/** A config that plays the next ladder rep. */
export function ladderConfig(base: MetronomeConfig, params: LadderParams, state: LadderState): MetronomeConfig {
  return { ...base, workout: 'ladder', bpm: state.tempo, targetBpm: params.targetBpm, stepBpm: params.stepBpm, repBars: params.repBars };
}

// --------------------------------------------------------- preferences ---

export function loadPrefs(host: ModuleHost): MetronomeConfig {
  const item = host.items().find((i) => i.id === PREFS_ITEM);
  return item ? fromFields(item.fields) : DEFAULT_CONFIG;
}

/** Saves preferences if they changed. Refuses invalid ones without writing. */
export async function savePrefs(host: ModuleHost, config: unknown): Promise<Validation<MetronomeConfig>> {
  const checked = validateConfig(config);
  if (!checked.ok) return checked;
  const fields = toFields(checked.value);
  const current = host.items().find((i) => i.id === PREFS_ITEM)?.fields;
  const same = current !== undefined && Object.keys(fields).length === Object.keys(current).length && Object.entries(fields).every(([k, v]) => current[k] === v);
  if (!same) await host.addItem(PREFS_ITEM, fields);
  return checked;
}
