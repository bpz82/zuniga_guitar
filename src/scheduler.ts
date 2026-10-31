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
import { DEFAULT_DAY_START } from './model.ts';
import type { DayStart, EventOf, Rating } from './model.ts';
import { practiceClock, practiceDay } from './day.ts';

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
const schedulers = new Map<string, FSRS>();
function schedulerFor(retention: number, steps = true): FSRS {
  if (!(retention >= 0.7 && retention <= 0.99)) throw new RangeError(`retention ${retention} outside 0.7 to 0.99`);
  const key = `${retention}|${steps}`;
  let f = schedulers.get(key);
  if (f === undefined) {
    f = fsrs({ request_retention: retention, enable_fuzz: true, enable_short_term: steps });
    schedulers.set(key, f);
  }
  return f;
}

/**
 * Modules whose cards skip learning and relearning steps: every rating
 * schedules in whole days, never a same-session repeat. Songs I Already Know
 * (Blake, 2026-10-31): a known song rated Good is not replayed 10 minutes
 * later. Keyed by the item's module, which the contract makes trustworthy.
 */
export const NO_STEP_MODULES: readonly string[] = Object.freeze(['songs']);

/** Whether a card uses learning/relearning steps. */
export function usesSteps(library: Library, cardId: string): boolean {
  const card = library.cards.get(cardId);
  const module = card ? library.items.get(card.itemId)?.module : undefined;
  return module === undefined || !NO_STEP_MODULES.includes(module);
}

/**
 * Replays one card's reviews (oldest first) into its memory state.
 * `retention` affects only `due`. `dayStart` decides which reviews count as
 * the same day (FSRS treats same-day repeats differently). `steps: false`
 * skips learning and relearning steps (see NO_STEP_MODULES).
 */
export function memoryOf(
  cardId: string,
  reviews: readonly EventOf<'review'>[],
  retention: number,
  dayStart: DayStart = DEFAULT_DAY_START,
  steps = true,
): Memory {
  const f = schedulerFor(retention, steps);
  const first = reviews[0];
  const last = reviews.at(-1);
  if (first === undefined || last === undefined) {
    return { cardId, phase: 'new', stability: 0, difficulty: 0, reps: 0, lapses: 0, lastReview: null, due: null, leech: false };
  }
  // FSRS counts days by UTC date, so it is fed "practice clock" times whose
  // UTC date is the practice day. Durations are unchanged.
  let card: FsrsCard = createEmptyCard(new Date(practiceClock(first.at, dayStart)));
  for (const r of reviews) card = f.next(card, new Date(practiceClock(r.at, dayStart)), GRADE[r.rating]).card;
  const wait = card.due.getTime() - practiceClock(last.at, dayStart);
  return {
    cardId,
    phase: PHASE[card.state],
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    lastReview: last.at,
    due: last.at + wait,
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
  /**
   * Makes a not-yet-due review card due today, e.g. so a set song is fresh
   * for a gig. Goals plug in here. Read-only: it cannot change memory.
   */
  readonly pullForward?: (memory: Memory) => boolean;
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
   * time; then reviews by priority, riskiest first. Steps are due at their
   * exact time; reviews are due for the whole practice day they fall on, so
   * a card due at 7pm is in that morning's session. A backlog after a break
   * is simply a long queue: take what fits today, the rest stays due and is
   * re-ranked tomorrow, so it spreads over the following days by itself.
   */
  readonly due: readonly DueCard[];
  /**
   * Never-reviewed active cards: higher weight first; within a weight,
   * modules take turns, the module with the fewest cards already started
   * going first, each in the order its cards were added. One big deck never
   * hides another module's new cards (2026-10-31).
   */
  readonly fresh: readonly string[];
  /** Active cards with 8+ lapses. Still scheduled; flagged for a breakdown. */
  readonly leeches: readonly string[];
}

const STEP_PHASES: readonly Phase[] = ['learning', 'relearning'];

export function buildQueue(library: Library, options: QueueOptions): Queue {
  const { now } = options;
  const retentionFor = options.retentionFor ?? (() => library.settings.desiredRetention);
  const weightFor = options.weightFor ?? (() => 1);
  const pullForward = options.pullForward ?? (() => false);
  const { dayStart } = library.settings;
  const today = practiceDay(now, dayStart);
  const due: DueCard[] = [];
  const fresh: { id: string; weight: number; module: string }[] = [];
  /** Cards already started (reviewed at least once), per module: new material is shared out evenly. */
  const started = new Map<string, number>();
  const leeches: string[] = [];

  for (const card of library.cards.values()) {
    if (card.retired) continue;
    const memory = memoryOf(card.id, library.reviews.get(card.id) ?? [], retentionFor(card.id), dayStart, usesSteps(library, card.id));
    const weight = weightFor(card.id);
    if (!(weight > 0) || !Number.isFinite(weight)) throw new RangeError(`weight for ${card.id} must be a positive number`);
    if (memory.phase !== 'new') {
      const m = library.items.get(card.itemId)?.module ?? '';
      started.set(m, (started.get(m) ?? 0) + 1);
    }
    if (memory.phase === 'new') {
      fresh.push({ id: card.id, weight, module: library.items.get(card.itemId)?.module ?? '' });
      continue;
    }
    if (memory.leech) leeches.push(card.id);
    if (!isDue(memory, now, today, dayStart, pullForward)) continue;
    const r = retrievability(memory, now) ?? 0;
    due.push({ memory, retrievability: r, priority: (1 - r) * weight });
  }

  due.sort((a, b) => {
    const aStep = STEP_PHASES.includes(a.memory.phase);
    const bStep = STEP_PHASES.includes(b.memory.phase);
    if (aStep !== bStep) return aStep ? -1 : 1;
    if (aStep) return a.memory.due! - b.memory.due! || compareIds(a, b);
    return b.priority - a.priority || a.memory.due! - b.memory.due! || compareIds(a, b);
  });

  // Stable sort: equal weights keep the order cards were added.
  fresh.sort((a, b) => b.weight - a.weight);
  return { due, fresh: takeTurns(fresh, started), leeches };
}

function isDue(memory: Memory, now: number, today: string, dayStart: DayStart, pullForward: (m: Memory) => boolean): boolean {
  if (memory.due === null) return false;
  if (STEP_PHASES.includes(memory.phase)) return memory.due <= now;
  if (practiceDay(memory.due, dayStart) <= today) return true;
  // Pulled forward at most once per practice day.
  return memory.lastReview !== null && practiceDay(memory.lastReview, dayStart) < today && pullForward(memory);
}

function compareIds(a: DueCard, b: DueCard): number {
  return a.memory.cardId < b.memory.cardId ? -1 : a.memory.cardId > b.memory.cardId ? 1 : 0;
}

/**
 * Within each weight (already sorted, highest first), interleaves modules
 * round-robin, keeping each module's own order: A1 B1 C1 A2 B2 A3... The
 * module with the fewest started cards goes first (ties: the order modules
 * first appear), so the turn moves on after every new card is started,
 * however often the queue is rebuilt.
 */
function takeTurns(sorted: readonly { id: string; weight: number; module: string }[], started: ReadonlyMap<string, number>): string[] {
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j < sorted.length && sorted[j]!.weight === sorted[i]!.weight) j++;
    const lanes = new Map<string, string[]>();
    for (const f of sorted.slice(i, j)) {
      const lane = lanes.get(f.module);
      if (lane) lane.push(f.id);
      else lanes.set(f.module, [f.id]);
    }
    const queues = [...lanes.entries()]
      .map(([m, q], order) => ({ q, order, started: started.get(m) ?? 0 }))
      .sort((a, b) => a.started - b.started || a.order - b.order)
      .map((x) => x.q);
    for (let k = 0; out.length < j; k++) for (const q of queues) if (k < q.length) out.push(q[k]!);
    i = j;
  }
  return out;
}
