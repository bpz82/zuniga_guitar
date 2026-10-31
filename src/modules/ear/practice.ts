/**
 * Ear training as an engine module (contract v1). Each skill on the ladder
 * ("scale degree 6", "minor third", "meter: triple") is one item and one
 * card. FSRS schedules the skills; every review is one fresh exemplar, graded
 * and logged with its details (right or wrong, latency, replays, scaffold,
 * score). The ladder level is derived from which cards exist, so it syncs
 * and replays like everything else; levels are added, never removed.
 *
 * Cards are tagged pocket-sound and guitar: they come up in the morning and
 * in sound bursts (short, distributed sessions, as the research recommends),
 * never during quiet hours.
 *
 * Every input is checked here first: a bad response comes back as an error
 * and never reaches the contract (which would switch the module off).
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { EventOf } from '../../model.ts';
import type { Validation } from '../../validate.ts';
import {
  ALL_SKILLS,
  gradeChoice,
  gradeRhythm,
  LADDER,
  levelOf,
  levelProgress,
  makeTrial,
  medianLatency,
  skillOf,
} from './core.ts';
import type { Answer, Family, Grade, LevelProgress, Skill, Trial } from './core.ts';

export const EAR: ModuleManifest = Object.freeze({
  id: 'ear',
  contract: 1,
  templates: Object.freeze([Object.freeze({ template: 'ear', tags: Object.freeze(['pocket-sound', 'guitar'] as const) })]),
});

/** The longest a single answer is logged as (a trial left open is not practice). */
export const MAX_TRIAL_MS = 10 * 60 * 1000;

export const itemIdOf = (sk: Pick<Skill, 'family' | 'category'>) => `ear-${sk.family}-${sk.category}`;
export const cardIdOf = (sk: Pick<Skill, 'family' | 'category'>) => `${itemIdOf(sk)}-c`;

export interface EarCard {
  readonly skill: Skill;
  readonly cardId: string;
  readonly level: number;
}

/** This module's skills that have cards, in ladder order. */
export function earCards(host: ModuleHost): EarCard[] {
  const have = new Set(host.cards().filter((c) => c.template === 'ear' && !c.retired).map((c) => c.id));
  return ALL_SKILLS.filter((sk) => have.has(cardIdOf(sk))).map((sk) => ({ skill: sk, cardId: cardIdOf(sk), level: levelOf(sk)! }));
}

export function cardInfo(host: ModuleHost, cardId: string): EarCard | undefined {
  return earCards(host).find((c) => c.cardId === cardId);
}

/** Highest level whose skills are all present (0 before seeding). */
export function currentLevel(host: ModuleHost): number {
  const have = new Set(earCards(host).map((c) => c.cardId));
  let level = 0;
  for (const l of LADDER) {
    if (l.skills.every((sk) => have.has(cardIdOf(sk)))) level = l.level;
    else break;
  }
  return level;
}

async function addLevel(host: ModuleHost, level: number): Promise<void> {
  const l = LADDER.find((x) => x.level === level);
  if (!l) return;
  const items = new Set(host.items().map((i) => i.id));
  const cards = new Set(host.cards().map((c) => c.id));
  for (const sk of l.skills) {
    const itemId = itemIdOf(sk);
    if (!items.has(itemId)) await host.addItem(itemId, { family: sk.family, category: sk.category, label: sk.label, level });
    if (!cards.has(cardIdOf(sk))) await host.addCard(cardIdOf(sk), itemId, 'ear');
  }
}

/**
 * Makes sure level 1 exists, and repairs a level left half-added (e.g. a
 * device that went offline mid-unlock). Safe on every launch. Returns the level.
 */
export async function seedEar(host: ModuleHost): Promise<number> {
  const present = new Set(earCards(host).map((c) => c.level));
  const top = Math.max(1, ...present);
  for (let l = 1; l <= top; l++) await addLevel(host, l);
  return currentLevel(host);
}

/** Right/wrong answers logged on one card, oldest first. Reviews without a verdict are ignored. */
export function answersOf(host: ModuleHost, cardId: string): Answer[] {
  return host.reviews(cardId).flatMap((r) => (typeof r.details?.correct === 'boolean' ? [{ at: r.at, correct: r.details.correct }] : []));
}

export interface Progress extends LevelProgress {
  readonly level: number;
  readonly label: string;
  /** The next level's label, or null at the top of the built ladder. */
  readonly next: string | null;
}

export function progress(host: ModuleHost): Progress {
  const level = currentLevel(host);
  const l = LADDER.find((x) => x.level === level);
  const perSkill = (l?.skills ?? []).map((sk) => answersOf(host, cardIdOf(sk)));
  return {
    ...levelProgress(perSkill),
    level,
    label: l?.label ?? 'Not started',
    next: LADDER.find((x) => x.level === level + 1)?.label ?? null,
  };
}

/** Adds the next level when the current one is mastered. Returns the new level, or null. */
export async function advance(host: ModuleHost): Promise<number | null> {
  const p = progress(host);
  if (!p.mastered || p.next === null) return null;
  await addLevel(host, p.level + 1);
  return currentLevel(host);
}

/** Skips ahead by hand (an experienced player need not prove pitch direction for three days). */
export async function unlockNext(host: ModuleHost): Promise<Validation<number>> {
  const level = currentLevel(host);
  if (!LADDER.some((x) => x.level === level + 1)) return { ok: false, error: 'every built level is already unlocked' };
  await addLevel(host, level + 1);
  return { ok: true, value: currentLevel(host) };
}

/** The next ear card for right now: due first, then new. Null if none (or quiet hours). */
export function nextEarCard(host: ModuleHost, now: number): string | null {
  const { due, fresh } = host.session(now);
  const ear = new Set(earCards(host).map((c) => c.cardId));
  return due.map((d) => d.memory.cardId).find((id) => ear.has(id)) ?? fresh.find((id) => ear.has(id)) ?? null;
}

/**
 * What to practise next: a due or new ear card first; when none is due,
 * extra practice on the unlocked skill answered longest ago (so the daily
 * minutes the research suggests are always available), never `last` again
 * straight away. `soundAllowed` comes from the app (false in quiet hours:
 * the contract does not expose the session mode). Null when sound is not allowed.
 */
export function pickEarCard(host: ModuleHost, now: number, soundAllowed: boolean, last?: string): string | null {
  if (!soundAllowed) return null;
  const scheduled = nextEarCard(host, now);
  if (scheduled !== null && scheduled !== last) return scheduled;
  const lastAnswer = (id: string) => host.reviews(id).at(-1)?.at ?? -Infinity;
  const pool = earCards(host).map((c) => c.cardId).filter((id) => id !== last);
  if (pool.length === 0) return scheduled;
  return pool.reduce((a, b) => (lastAnswer(b) < lastAnswer(a) ? b : a));
}

/** A fresh exemplar for one card. `seed`: any integer; the app passes a random one. */
export function trialFor(host: ModuleHost, cardId: string, seed: number): Validation<Trial> {
  const info = cardInfo(host, cardId);
  if (!info) return { ok: false, error: `no ear card ${cardId}` };
  if (!Number.isInteger(seed)) return { ok: false, error: 'seed must be an integer' };
  const unlocked = earCards(host).filter((c) => c.skill.family === info.skill.family).map((c) => c.skill.category);
  const history = answersOf(host, cardId).map((a) => a.correct);
  return { ok: true, value: makeTrial(info.skill, { unlocked, history }, seed) };
}

function familyLatency(host: ModuleHost, family: Family): number | null {
  const lat = earCards(host)
    .filter((c) => c.skill.family === family)
    .flatMap((c) => host.reviews(c.cardId))
    .filter((r) => r.details?.correct === true && typeof r.details.latencyMs === 'number')
    .sort((a, b) => a.at - b.at)
    .map((r) => r.details!.latencyMs as number);
  return medianLatency(lat);
}

export interface Outcome {
  readonly grade: Grade;
  /** Set when this answer completed a level and the next one was added. */
  readonly newLevel: number | null;
}

const clampMs = (ms: number) => Math.round(Math.min(Math.max(0, Number.isFinite(ms) ? ms : 0), MAX_TRIAL_MS));

function checkTrial(host: ModuleHost, cardId: string, trial: Trial): Validation<EarCard> {
  const info = cardInfo(host, cardId);
  if (!info) return { ok: false, error: `no ear card ${cardId}` };
  if (trial.family !== info.skill.family || trial.category !== info.skill.category) return { ok: false, error: 'trial does not belong to this card' };
  return { ok: true, value: info };
}

async function log(host: ModuleHost, cardId: string, grade: Grade, durationMs: number): Promise<Outcome> {
  await host.reportRep(cardId, grade.rating, clampMs(durationMs), grade.details);
  return { grade, newLevel: await advance(host) };
}

/** Logs a multiple-choice answer. */
export async function answerTrial(
  host: ModuleHost,
  cardId: string,
  trial: Trial,
  response: { choice: string; latencyMs: number; replays: number },
  durationMs: number,
): Promise<Validation<Outcome>> {
  const info = checkTrial(host, cardId, trial);
  if (!info.ok) return info;
  if (trial.family === 'rhythm') return { ok: false, error: 'rhythm is answered by tapping' };
  if (!trial.choices.some((c) => c.id === response.choice)) return { ok: false, error: `not one of the choices: ${String(response.choice).slice(0, 20)}` };
  const prev = answersOf(host, cardId).at(-1);
  const grade = gradeChoice(
    trial,
    { choice: response.choice, latencyMs: clampMs(response.latencyMs), replays: response.replays },
    { medianLatencyMs: familyLatency(host, trial.family), previousCorrect: prev?.correct ?? false },
  );
  return { ok: true, value: await log(host, cardId, grade, durationMs) };
}

/** Logs a tapped rhythm. `tapsSec`: seconds from the start of the learner's bar. */
export async function answerRhythm(host: ModuleHost, cardId: string, trial: Trial, tapsSec: readonly number[], replays: number, durationMs: number): Promise<Validation<Outcome>> {
  const info = checkTrial(host, cardId, trial);
  if (!info.ok) return info;
  if (!trial.rhythm) return { ok: false, error: 'not a rhythm trial' };
  if (!Array.isArray(tapsSec) || tapsSec.length > 64) return { ok: false, error: 'taps: at most 64' };
  const prev = answersOf(host, cardId).at(-1);
  const grade = gradeRhythm(trial, tapsSec, replays, { previousCorrect: prev?.correct ?? false });
  return { ok: true, value: await log(host, cardId, grade, durationMs) };
}

/** Minutes of ear training logged since `since` (epoch ms), e.g. the start of the practice day. */
export function minutesSince(host: ModuleHost, since: number): number {
  const reviews: EventOf<'review'>[] = earCards(host).flatMap((c) => host.reviews(c.cardId));
  const ms = reviews.filter((r) => r.at >= since).reduce((sum, r) => sum + r.durationMs, 0);
  return Math.round(ms / 6000) / 10;
}

export { skillOf };
