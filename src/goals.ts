/**
 * Goals layer (checkpoint 3). Pure functions over the projected library.
 *
 * Goals can only do three things (spec): set target retention, change queue
 * order, and split practice time. They reach the scheduler solely through
 * buildQueue's read-only hooks (retentionFor, weightFor, pullForward), so they
 * cannot change memory state. Nothing here writes to the log; a goal is
 * created or edited by appending the goal-set event goalFromIntake returns.
 */
import { addDays, dayBegins, daysBetween, practiceDay } from './day.ts';
import { buildQueue, retrievability } from './scheduler.ts';
import type { Memory, Queue } from './scheduler.ts';
import type { Library } from './project.ts';
import { ACTIVE_BLOCK_KINDS } from './model.ts';
import type { BlockKind, Details, EventBody, Goal, GoalBlock, GoalKind } from './model.ts';
import { validateBody } from './validate.ts';
import type { Validation } from './validate.ts';

/** Gig set material defaults to this retention unless the goal sets its own. */
export const GIG_DEFAULT_RETENTION = 0.95;
/** In a gig's last 7 days (gig day included), recall time becomes full set run-throughs. */
export const FINAL_WEEK_DAYS = 7;
/** Days before a deadline when a check-in asks Blake to confirm or adjust the plan. */
export const CHECK_IN_DAYS: readonly number[] = [14, 7, 2];
/** Material in no active goal keeps weight 1; goal material gets 1 + goal weight. */
export const BASE_WEIGHT = 1;
/** Block kinds that are never squeezed when time runs short (guitar yoga). */
export const PROTECTED_KINDS: readonly BlockKind[] = ['feel-session'];

const RUNNABLE: ReadonlySet<BlockKind> = new Set(ACTIVE_BLOCK_KINDS);

// ------------------------------------------------------------- intake ----

/** What the intake form asks. */
export interface Intake {
  readonly kind?: GoalKind;
  readonly what: string;
  readonly why: string;
  /** "YYYY-MM-DD". */
  readonly deadline: string;
  readonly itemIds: readonly string[];
  readonly dailyMinutes: number;
  readonly weight?: number;
  readonly targetRetention?: number;
  readonly blocks?: readonly GoalBlock[];
}

/**
 * Turns the intake form into a goal-set event body, ready for append().
 * Refuses a deadline that has already passed.
 */
export function goalFromIntake(intake: Intake, goalId: string, library: Library, now: number): Validation<EventBody> {
  const today = practiceDay(now, library.settings.dayStart);
  if (typeof intake.deadline === 'string' && intake.deadline < today) {
    return { ok: false, error: `event.goal.deadline: ${intake.deadline} has already passed (today is ${today})` };
  }
  return validateBody({
    type: 'goal-set',
    goal: {
      id: goalId,
      kind: intake.kind ?? 'general',
      what: intake.what,
      why: intake.why,
      deadline: intake.deadline,
      itemIds: [...intake.itemIds],
      dailyMinutes: intake.dailyMinutes,
      weight: intake.weight ?? 1,
      ...(intake.targetRetention === undefined ? {} : { targetRetention: intake.targetRetention }),
      blocks: [...(intake.blocks ?? [])],
      archived: false,
    },
  });
}

// --------------------------------------------------------------- plan ----

export interface PlannedBlock {
  readonly goalId: string;
  readonly blockId: string;
  readonly kind: BlockKind;
  readonly label: string;
  readonly minutes: number;
  /** Goal weight, used when time has to be split. */
  readonly weight: number;
  /** Protected blocks are never squeezed by splitTime. */
  readonly protected: boolean;
  /** The block's own settings, for the module that runs it (e.g. a tempo ladder's tempos). */
  readonly params?: Details;
  /** Days until the goal's deadline (0 on the day itself). Ramps use it. */
  readonly daysLeft: number;
}

export interface CheckIn {
  readonly goalId: string;
  readonly daysLeft: number;
}

export interface GoalPlan {
  /** Practice day the plan is for, "YYYY-MM-DD". */
  readonly today: string;
  /** Goals in force today: not archived, deadline not passed. */
  readonly active: readonly Goal[];
  readonly retentionFor: (cardId: string) => number;
  readonly weightFor: (cardId: string) => number;
  readonly pullForward: (memory: Memory) => boolean;
  /** Today's blocks per active goal, sized to each goal's daily minutes. */
  readonly blocks: readonly PlannedBlock[];
  /** Goals waiting for a check-in. Re-saving the goal (adjusted or not) clears it. */
  readonly checkIns: readonly CheckIn[];
}

export function isActive(goal: Goal, today: string): boolean {
  return !goal.archived && today <= goal.deadline;
}

function targetOf(goal: Goal, fallback: number): number {
  return goal.targetRetention ?? (goal.kind === 'gig' ? GIG_DEFAULT_RETENTION : fallback);
}

export function planGoals(library: Library, now: number): GoalPlan {
  const { dayStart, desiredRetention } = library.settings;
  const today = practiceDay(now, dayStart);
  const active = [...library.goals.values()].filter((g) => isActive(g, today));

  // item id -> active goals that include it
  const byItem = new Map<string, Goal[]>();
  for (const g of active) {
    for (const itemId of g.itemIds) {
      const list = byItem.get(itemId);
      if (list) list.push(g);
      else byItem.set(itemId, [g]);
    }
  }
  const goalsOfCard = (cardId: string): readonly Goal[] => {
    const itemId = library.cards.get(cardId)?.itemId;
    return (itemId && byItem.get(itemId)) || [];
  };

  const retentionFor = (cardId: string) => {
    const goals = goalsOfCard(cardId);
    return goals.length === 0 ? desiredRetention : Math.max(...goals.map((g) => targetOf(g, desiredRetention)));
  };

  const weightFor = (cardId: string) => {
    const goals = goalsOfCard(cardId);
    return goals.length === 0 ? BASE_WEIGHT : BASE_WEIGHT + Math.max(...goals.map((g) => g.weight));
  };

  // Deadline peaking: a gig card whose next review would land after the gig,
  // and whose recall would sag below target by the end of gig day, is reviewed now.
  const pullForward = (memory: Memory) => {
    if (memory.phase !== 'review' || memory.due === null) return false;
    for (const g of goalsOfCard(memory.cardId)) {
      if (g.kind !== 'gig') continue;
      if (practiceDay(memory.due, dayStart) <= g.deadline) continue;
      const endOfGigDay = dayBegins(addDays(g.deadline, 1), dayStart);
      const r = retrievability(memory, endOfGigDay);
      if (r !== null && r < targetOf(g, desiredRetention)) return true;
    }
    return false;
  };

  const blocks = active.flatMap((g) => blocksForToday(g, today));

  const checkIns: CheckIn[] = [];
  for (const g of active) {
    const daysLeft = daysBetween(today, g.deadline);
    const savedAt = library.goalSetAt.get(g.id) ?? 0;
    const pending = CHECK_IN_DAYS.some(
      (p) => daysLeft <= p && savedAt < dayBegins(addDays(g.deadline, -p), dayStart),
    );
    if (pending) checkIns.push({ goalId: g.id, daysLeft });
  }

  return { today, active, retentionFor, weightFor, pullForward, blocks, checkIns };
}

function blocksForToday(goal: Goal, today: string): PlannedBlock[] {
  if (goal.dailyMinutes === 0) return [];
  const declared: readonly GoalBlock[] = goal.blocks.length
    ? goal.blocks
    : [{ id: 'recall', kind: 'recall', label: goal.what, minutes: goal.dailyMinutes }];
  const finalWeek = goal.kind === 'gig' && daysBetween(today, goal.deadline) < FINAL_WEEK_DAYS;
  // Reserved kinds wait for their modules; their time goes to the runnable blocks.
  const runnable = declared
    .filter((b) => RUNNABLE.has(b.kind))
    .map((b) =>
      finalWeek && b.kind === 'recall'
        ? { ...b, id: `${b.id}:run-through`, kind: 'timed-task' as const, label: 'Full set run-through' }
        : b,
    );
  if (runnable.length === 0) return [];
  const minutes = apportion(runnable.map((b) => b.minutes), goal.dailyMinutes);
  const daysLeft = daysBetween(today, goal.deadline);
  return runnable.map((b, i) => ({
    goalId: goal.id,
    blockId: b.id,
    kind: b.kind,
    label: b.label,
    minutes: minutes[i]!,
    weight: goal.weight,
    protected: PROTECTED_KINDS.includes(b.kind),
    ...(b.params === undefined || b.id.endsWith(':run-through') ? {} : { params: b.params }),
    daysLeft,
  }));
}

// ---------------------------------------------------------- time split ---

/**
 * Fits blocks into the time available. Protected blocks (guitar yoga) keep
 * their full time first. The rest share what is left in proportion to goal
 * weight, never above what they asked for. Whole minutes; nothing invented.
 */
export function splitTime(blocks: readonly PlannedBlock[], budgetMinutes: number): PlannedBlock[] {
  if (!(budgetMinutes >= 0) || !Number.isFinite(budgetMinutes)) throw new RangeError('budget must be a non-negative number');
  const budget = Math.floor(budgetMinutes);
  const prot = blocks.filter((b) => b.protected);
  const rest = blocks.filter((b) => !b.protected);
  const protTotal = sum(prot.map((b) => b.minutes));

  const out = new Map<PlannedBlock, number>();
  if (protTotal >= budget) {
    apportion(prot.map((b) => b.minutes), budget).forEach((m, i) => out.set(prot[i]!, m));
    for (const b of rest) out.set(b, 0);
  } else {
    for (const b of prot) out.set(b, b.minutes);
    waterFill(rest, budget - protTotal).forEach((m, i) => out.set(rest[i]!, m));
  }
  return blocks.map((b) => ({ ...b, minutes: out.get(b)! })).filter((b) => b.minutes > 0);
}

/** Weighted fair share with caps at each block's request. */
function waterFill(blocks: readonly PlannedBlock[], budget: number): number[] {
  const want = blocks.map((b) => b.minutes);
  if (sum(want) <= budget) return want;
  const share = new Array<number>(blocks.length).fill(0);
  let open = blocks.map((_, i) => i);
  let left = budget;
  while (open.length > 0 && left > 1e-9) {
    const w = sum(open.map((i) => blocks[i]!.weight));
    const capped = open.filter((i) => share[i]! + (left * blocks[i]!.weight) / w >= want[i]!);
    if (capped.length === 0) {
      for (const i of open) share[i] = share[i]! + (left * blocks[i]!.weight) / w;
      left = 0;
      break;
    }
    for (const i of capped) {
      left -= want[i]! - share[i]!;
      share[i] = want[i]!;
    }
    open = open.filter((i) => !capped.includes(i));
  }
  return roundKeepingTotal(share, Math.min(budget, sum(want)), want);
}

/** Scales parts to a total in whole numbers (largest remainder). */
export function apportion(parts: readonly number[], total: number): number[] {
  const s = sum(parts);
  if (s === 0) return parts.map(() => 0);
  return roundKeepingTotal(parts.map((p) => (p * total) / s), total);
}

function roundKeepingTotal(values: readonly number[], total: number, caps?: readonly number[]): number[] {
  const floors = values.map(Math.floor);
  let short = Math.round(total) - sum(floors);
  const order = values.map((v, i) => i).sort((a, b) => values[b]! - floors[b]! - (values[a]! - floors[a]!) || a - b);
  for (const i of order) {
    if (short <= 0) break;
    if (caps && floors[i]! >= caps[i]!) continue;
    floors[i] = floors[i]! + 1;
    short--;
  }
  return floors;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

// -------------------------------------------------------- convenience ----

/** Today's queue with every active goal applied. */
export function goalQueue(library: Library, now: number): Queue {
  const { retentionFor, weightFor, pullForward } = planGoals(library, now);
  return buildQueue(library, { now, retentionFor, weightFor, pullForward });
}
