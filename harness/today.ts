/**
 * The goal-first Today page (Blake, 2026-11-02), pure parts: which goal leads
 * the page, how its deadline reads, and how today's goal blocks group under
 * it. The DOM side is in main.ts.
 */
import { daysBetween, isActive } from '../src/index.ts';
import type { BlockSegment, Goal, Library } from '../src/index.ts';

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
