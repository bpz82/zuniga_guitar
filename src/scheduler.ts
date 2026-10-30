/**
 * Scheduler (checkpoint 2). The only file that talks to ts-fsrs.
 *
 * Pure functions: the log's reviews go in, memory state and a due queue
 * come out. Nothing is stored.
 *
 * Memory state (difficulty, stability, lapses) depends only on what
 * happened: review times and ratings. Desired retention only decides when a
 * card is due next. So goals can change retention freely and memory state is
 * untouched by construction. A test proves it.
 */
import { createEmptyCard, forgetting_curve, fsrs, Rating as FsrsRating, State } from '../vendor/ts-fsrs/dist/ts-fsrs.mjs';
import type { Card as FsrsCard, FSRS, Grade } from '../vendor/ts-fsrs/dist/ts-fsrs.mjs';
import type { Library } from './project.ts';
import type { EventOf, Rating } from './model.ts';

/** Spec: 8 lapses flags a card and suggests a breakdown. Never suspends. */
export const LEECH_LAPSES = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export type Phase = 'new' | 'learning' | 'review' | 'relearning';

export interface Memory {
  readonly cardId: string;
  readonly phase: Phase;
  /** Days until recall probability falls to 90%. 0 for new cards. */
  readonly stability: number;
  /** 1 (easy) to 10 (hard). 0 for new cards. */
  readonly difficulty: number;
  readonly reps: number;
  readonly lapses: number;
  /** Epoch ms, null for new cards. */
  readonly lastReview: number | null;
  /** When the card is next due at the retention it was computed for. Null for new cards. */
  readonly due: number | null;
  readonly leech: boolean;
}

const GRADE: Readonly<Record<Rating, Grade>> = {
  again: FsrsRating.Again,
  hard: FsrsRating.Hard,
  good: FsrsRating.Good,
  easy: FsrsRating.Easy,
};

const PHASE: Readonly<Record<State, Phase>> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

// FSRS-6 defaults; fuzz and learning/relearning steps on (Blake, 2026-10-30).
const schedulers = new Map<number, FSRS>();
function schedulerFor(retention: number): FSRS {
  if (!(retention >= 0.7 && retention <= 0.99)) throw new RangeError(`retention ${retention} outside 0.7 to 0.99`);
  let f = schedulers.get(retention);
  if (f === undefined) {
    f = fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: true });
    schedulers.set(retention, f);
  }
  return f;
}

/**
 * Replays one card's reviews (oldest first) into its memory state.
 * `retention` affects only `due`.
 */
export function memoryOf(cardId: string, reviews: readonly EventOf<'review'>[], retention: number): Memory {
  const f = schedulerFor(retention);
  const first = reviews[0];
  if (first === undefined) {
    return { cardId, phase: 'new', stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, due: null, leech: false };
  }
  let card: FsrsCard = createEmptyCard(new Date(first.at));
  for (const r of reviews) card = f.next(card, new Date(r.at), GRADE[r.rating]).card;
  return {
    cardId,
    phase: PHASE[card.state],
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: card.last_review ? card.last_review.getTime() : null,
    due: card.due.getTime(),
    leech: card.lapses >= LEECH_LAPSES,
  };
}

/** Probability of recall right now, 0 to 1. Null for new cards. */
export function retrievability(memory: Memory, now: number): number | null {
  if (memory.lastReview === null) return null;
  const elapsedDays = Math.max(0, now - memory.lastReview) / DAY_MS;
  return forgetting_curve(schedulerFor(0.9).parameters.w, elapsedDays, memory.stability);
}

export interface QueueOptions {
  /** Epoch ms. */
  readonly now: number;
  /** Per-card desired retention. Default: settings.desiredRetention. Goals plug in here. */
  readonly retentionFor?: (cardId: string) => number;
  /** Per-card priority weight, > 0. Default 1. Goals plug in here. */
  readonly weightFor?: (cardId: string) => number;
}

export interface DueCard {
  readonly memory: Memory;
  /** Recall probability now. */
  readonly retrievability: number;
  /** (1 - retrievability) x weight. Higher goes first. */
  readonly priority: number;
}

export interface Queue {
  /**
   * Due cards in the order to practice them: (re)learning steps first, by due
   * time; then reviews by priority, riskiest first. A backlog after a break
   * is simply a long queue: take what fits today, the rest stays due and is
   * re-ranked tomorrow, so it spreads over the following days by itself.
   */
  readonly due: readonly DueCard[];
  /** Never-reviewed active cards, in the order they were added. */
  readonly fresh: readonly string[];
  /** Active cards with 8+ lapses. Still scheduled; flagged for a breakdown. */
  readonly leeches: readonly string[];
}

const STEP_PHASES: readonly Phase[] = ['learning', 'relearning'];

export function buildQueue(library: Library, options: QueueOptions): Queue {
  const { now } = options;
  const retentionFor = options.retentionFor ?? (() => library.settings.desiredRetention);
  const weightFor = options.weightFor ?? (() => 1);
  const due: DueCard[] = [];
  const fresh: string[] = [];
  const leeches: string[] = [];

  for (const card of library.cards.values()) {
    if (card.retired) continue;
    const memory = memoryOf(card.id, library.reviews.get(card.id) ?? [], retentionFor(card.id));
    if (memory.phase === 'new') {
      fresh.push(card.id);
      continue;
    }
    if (memory.leech) leeches.push(card.id);
    if (memory.due === null || memory.due > now) continue;
    const r = retrievability(memory, now) ?? 0;
    const weight = weightFor(card.id);
    if (!(weight > 0) || !Number.isFinite(weight)) throw new RangeError(`weight for ${card.id} must be a positive number`);
    due.push({ memory, retrievability: r, priority: (1 - r) * weight });
  }

  due.sort((a, b) => {
    const aStep = STEP_PHASES.includes(a.memory.phase);
    const bStep = STEP_PHASES.includes(b.memory.phase);
    if (aStep !== bStep) return aStep ? -1 : 1;
    if (aStep) return a.memory.due! - b.memory.due! || compareIds(a, b);
    return b.priority - a.priority || a.memory.due! - b.memory.due! || compareIds(a, b);
  });

  return { due, fresh, leeches };
}

function compareIds(a: DueCard, b: DueCard): number {
  return a.memory.cardId < b.memory.cardId ? -1 : a.memory.cardId > b.memory.cardId ? 1 : 0;
}
