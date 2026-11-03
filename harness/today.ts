/**
 * Home's objectives (Blake, 2026-11-02 and 2026-11-03), pure parts: which
 * goal leads, how its deadline reads, how today's goal blocks group under it,
 * and the bullet points of the popup that opens Home. The DOM side is in
 * main.ts.
 */
import { daysBetween, isActive, practiceDay, sessionFor, todayBlocks } from '../src/index.ts';
import type { BlockSegment, Goal, Library, ReviewSegment } from '../src/index.ts';

/**
 * The goal on top: the live goal with the nearest deadline (then the heavier
 * one, then the oldest id, so the choice is stable). Null with no live goal.
 */
export function focusGoal(library: Library, today: string): { goal: Goal; others: number } | null {
  const live = [...library.goals.values()].filter((g) => isActive(g, today));
  live.sort((a, b) => a.deadline.localeCompare(b.deadline) || b.weight - a.weight || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const goal = live[0];
  return goal ? { goal, others: live.length - 1 } : null;
}

/** "Fri 13 Nov · 11 days to go", "Tomorrow", "Today". Dates are calendar days ("YYYY-MM-DD"). */
export function goalWhen(goal: Goal, today: string): string {
  const days = daysBetween(today, goal.deadline);
  const [y, m, d] = goal.deadline.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  const left = days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `${days} days to go`;
  const what = goal.kind === 'gig' ? 'Gig' : 'Due';
  return `${what} ${date} · ${left}`;
}

/** Today's goal blocks with the focus goal's first, then the rest, each tagged with whether it is the focus goal's. */
export function blocksForFocus(blocks: readonly BlockSegment[], focusId: string | null): { seg: BlockSegment; focus: boolean }[] {
  const mine = blocks.filter((b) => b.block.goalId === focusId).map((seg) => ({ seg, focus: true }));
  const rest = blocks.filter((b) => b.block.goalId !== focusId).map((seg) => ({ seg, focus: false }));
  return [...mine, ...rest];
}

/** One bullet in an objectives popup. */
export interface Objective {
  readonly text: string;
  /** What the bullet is about (tests and styling): a goal block, the goal's songs, the rest of the deck, the Teach lesson, or nothing to do. */
  readonly kind: 'block' | 'songs' | 'deck' | 'lesson' | 'none';
  readonly done?: boolean;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Today's objectives on Home, built from the current goal and what the plan
 * covers right now: the goal's blocks for today (done ones ticked), the
 * goal's own cards in the session open now (its songs), the rest of the deck,
 * other goals' blocks (named), and the lesson waiting on Teach.
 */
export function homeObjectives(library: Library, now: number, lesson: string | null): Objective[] {
  const today = practiceDay(now, library.settings.dayStart);
  const focus = focusGoal(library, today);
  const session = sessionFor(library, now);
  const review = session.segments.find((x): x is ReviewSegment => x.kind === 'review');
  const goalItems = new Set(focus?.goal.itemIds ?? []);
  const ofGoal = (cardId: string) => goalItems.has(library.cards.get(cardId)?.itemId ?? '');
  const due = review?.due.map((d) => d.memory.cardId) ?? [];
  const fresh = review?.fresh ?? [];
  const goalCards = [...due, ...fresh].filter(ofGoal).length;
  const restDue = due.filter((id) => !ofGoal(id)).length;
  const restFresh = fresh.filter((id) => !ofGoal(id)).length;

  const out: Objective[] = [];
  const rows = blocksForFocus(todayBlocks(library, now), focus?.goal.id ?? null);
  const label = (seg: BlockSegment) => `${seg.block.label} · ${seg.block.minutes} min${seg.done ? ' ✓' : ''}`;
  for (const { seg } of rows.filter((r) => r.focus)) out.push({ kind: 'block', text: label(seg), done: seg.done });
  if (focus && goalCards > 0) out.push({ kind: 'songs', text: `Play ${plural(goalCards, 'song', 'songs')} for ${focus.goal.what}` });
  if (restDue + restFresh > 0) out.push({ kind: 'deck', text: `Today's deck: ${restDue} due, ${restFresh} new` });
  for (const { seg } of rows.filter((r) => !r.focus)) {
    out.push({ kind: 'block', text: `${label(seg)} · for ${library.goals.get(seg.block.goalId)?.what ?? 'another goal'}`, done: seg.done });
  }
  if (lesson) out.push({ kind: 'lesson', text: `On Teach: ${lesson} (swipe left)` });
  if (out.length === 0) out.push({ kind: 'none', text: 'Nothing due right now. Play for fun, or set a goal.' });
  return out;
}
