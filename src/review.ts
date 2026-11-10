/**
 * Practice without the instrument (Blake, 2026-11-08): extended flashcard
 * review. Pure functions: which card is next, in two modes.
 *
 *   Due today  Every due card (learning steps and reviews), then new cards,
 *              up to DAILY_NEW_CARDS new ones a day.
 *   Do more    Keeps going past the due cards, without a fixed daily set:
 *              due cards first, then new cards (no daily limit), then, once
 *              the new cards have run out, repeats of cards already learned,
 *              the least well remembered first, round and round with no end.
 *
 * New cards stay inside the horizon: which cards may be served new is the
 * caller's `newOk` (the theory module's chapter horizon, see
 * src/modules/theory/practice.ts); the engine only ever has cards in the log
 * that were opened. A repeat is practice before the card is due, so it is
 * logged as an EXTRA review (details { extra: true }): kept in the log for
 * good, never fed to the scheduler (see isExtraReview), so extra practice can
 * never lower a card's stability or move its due date.
 */
import { practiceDay } from './day.ts';
import { goalQueue } from './goals.ts';
import type { Library } from './project.ts';
import { memoryOf, retrievability, scheduledReviews, usesSteps } from './scheduler.ts';
import type { Memory } from './scheduler.ts';

/** New cards in "Due today", per practice day. "Do more" has no limit. */
export const DAILY_NEW_CARDS = 10;

export type ReviewMode = 'due' | 'more';
/** due: the scheduler says it is time. new: never seen. repeat: learned, not due, practised again as an extra. */
export type ReviewKind = 'due' | 'new' | 'repeat';

export interface ReviewFilter {
  /** Cards that may be shown at all (silent flashcards). */
  readonly accept: (cardId: string) => boolean;
  /** Cards that may be shown as NEW (inside the chapter horizon). */
  readonly newOk: (cardId: string) => boolean;
}

export interface ReviewPick {
  readonly cardId: string;
  readonly kind: ReviewKind;
  /** A repeat only: every repeat had been shown, so this starts the round again (the caller forgets what it has shown). */
  readonly cycle: boolean;
}

export interface ReviewCounts {
  /** Due now. */
  readonly due: number;
  /** New cards "Due today" still allows. */
  readonly newToday: number;
  /** All new cards inside the horizon. */
  readonly newTotal: number;
  /** Learned cards that can be repeated. */
  readonly repeats: number;
}

/** Cards first reviewed today (scheduled reviews only), among the accepted ones. */
function startedToday(library: Library, now: number, accept: (id: string) => boolean): number {
  const today = practiceDay(now, library.settings.dayStart);
  let n = 0;
  for (const [cardId, reviews] of library.reviews) {
    const first = scheduledReviews(reviews)[0];
    if (first && accept(cardId) && !library.cards.get(cardId)?.retired && practiceDay(first.at, library.settings.dayStart) === today) n++;
  }
  return n;
}

interface Pools {
  readonly due: string[];
  readonly fresh: string[];
  readonly repeats: string[];
}

function pools(library: Library, now: number, f: ReviewFilter): Pools {
  const queue = goalQueue(library, now);
  const due = queue.due.map((d) => d.memory.cardId).filter(f.accept);
  const dueSet = new Set(due);
  const fresh = queue.fresh.filter((id) => f.accept(id) && f.newOk(id));
  // Learned cards that are not due, least remembered first (ties by id, so the order is stable).
  const learned: { id: string; r: number }[] = [];
  const { dayStart, desiredRetention } = library.settings;
  for (const card of library.cards.values()) {
    if (card.retired || dueSet.has(card.id) || !f.accept(card.id)) continue;
    const m: Memory = memoryOf(card.id, library.reviews.get(card.id) ?? [], desiredRetention, dayStart, usesSteps(library, card.id));
    if (m.phase === 'new') continue;
    learned.push({ id: card.id, r: retrievability(m, now) ?? 1 });
  }
  learned.sort((a, b) => a.r - b.r || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { due, fresh, repeats: learned.map((l) => l.id) };
}

/** The next card to show, or null when this mode has nothing (Due today: nothing due and no new allowance left). */
export function nextReview(library: Library, now: number, mode: ReviewMode, f: ReviewFilter, shown: ReadonlySet<string> = new Set()): ReviewPick | null {
  const p = pools(library, now, f);
  if (p.due[0] !== undefined) return { cardId: p.due[0], kind: 'due', cycle: false };
  if (mode === 'due') {
    const left = Math.max(0, DAILY_NEW_CARDS - startedToday(library, now, f.accept));
    return left > 0 && p.fresh[0] !== undefined ? { cardId: p.fresh[0], kind: 'new', cycle: false } : null;
  }
  if (p.fresh[0] !== undefined) return { cardId: p.fresh[0], kind: 'new', cycle: false };
  if (p.repeats.length === 0) return null;
  const unseen = p.repeats.filter((id) => !shown.has(id));
  const cycle = unseen.length === 0;
  return { cardId: (cycle ? p.repeats : unseen)[0]!, kind: 'repeat', cycle };
}

/** What each part of the review has left right now (for the buttons). */
export function reviewCounts(library: Library, now: number, f: ReviewFilter): ReviewCounts {
  const p = pools(library, now, f);
  return {
    due: p.due.length,
    newToday: Math.min(p.fresh.length, Math.max(0, DAILY_NEW_CARDS - startedToday(library, now, f.accept))),
    newTotal: p.fresh.length,
    repeats: p.repeats.length,
  };
}

/**
 * Whether rating this card now is extra practice: it has been learned
 * (reviewed before) and the scheduler does not have it due. Decided when the
 * rating is made, so a card that came due in the meantime counts normally.
 */
export function isExtraNow(library: Library, cardId: string, now: number): boolean {
  const { dayStart, desiredRetention } = library.settings;
  const m = memoryOf(cardId, library.reviews.get(cardId) ?? [], desiredRetention, dayStart, usesSteps(library, cardId));
  if (m.phase === 'new') return false;
  return !goalQueue(library, now).due.some((d) => d.memory.cardId === cardId);
}
