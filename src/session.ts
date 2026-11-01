/**
 * Session builder (checkpoint 4). Pure functions: given the library and the
 * time, what should Blake practice right now, and when should he be nudged?
 * Nothing is stored and nothing is written. Missed sessions need no handling:
 * unpracticed cards simply stay due and come up in the next session.
 *
 * Windows (from settings): morning guitar session, then pocket bursts before,
 * during and after work. Quiet hours (work) override everything: inside them
 * only silent cards are served, so the phone never makes a sound at work.
 */
import { addDays, dayBegins, minuteOfDay, minutesOf, practiceDay, timeOnDay } from './day.ts';
import { gigMemos, goalQueue, planGoals, splitTime } from './goals.ts';
import type { PlannedBlock } from './goals.ts';
import type { Library } from './project.ts';
import type { DueCard } from './scheduler.ts';
import type { CardTag, WindowId } from './model.ts';

/** Spec: pocket bursts are 3 to 5 minutes. The UI time-boxes; the engine counts nothing. */
export const BURST_MINUTES = Object.freeze({ min: 3, max: 5 });

/** What a session may use: the guitar, a phone with sound, or a silent phone. */
export type Mode = 'guitar' | 'sound' | 'silent';

const WINDOW_MODE: Readonly<Record<WindowId, Mode>> = {
  morning: 'guitar',
  'before-work': 'sound',
  'during-work': 'silent',
  'after-work': 'sound',
};

/** Which card tags each mode may serve. Silent cards work anywhere a phone does. */
export const MODE_TAGS: Readonly<Record<Mode, readonly CardTag[]>> = {
  guitar: ['guitar'],
  sound: ['pocket-sound', 'pocket-silent'],
  silent: ['pocket-silent'],
};

export interface WindowSlot {
  readonly id: WindowId;
  readonly mode: Mode;
  /** Epoch ms. */
  readonly start: number;
  /** Epoch ms: the next window's start, or the end of the practice day. */
  readonly end: number;
}

/** A practice day's windows in time order. */
export function windowsFor(library: Library, date: string): WindowSlot[] {
  const { dayStart, windows } = library.settings;
  const starts = windows
    .map((w) => ({ id: w.id, mode: WINDOW_MODE[w.id], start: timeOnDay(date, w.start, dayStart) }))
    .sort((a, b) => a.start - b.start);
  const dayEnd = dayBegins(addDays(date, 1), dayStart);
  return starts.map((w, i) => ({ ...w, end: starts[i + 1]?.start ?? dayEnd }));
}

/** The window Blake is in now. Before the first window of the day, it is the first one. */
export function currentWindow(library: Library, now: number): WindowSlot | null {
  const slots = windowsFor(library, practiceDay(now, library.settings.dayStart));
  if (slots.length === 0) return null;
  return [...slots].reverse().find((w) => w.start <= now) ?? slots[0]!;
}

/** True during quiet hours (work), when nothing may make a sound. */
export function isQuiet(library: Library, t: number): boolean {
  const { quietHours, dayStart } = library.settings;
  const m = minuteOfDay(t, dayStart.timeZone);
  const start = minutesOf(quietHours.start);
  const end = minutesOf(quietHours.end);
  return start < end ? m >= start && m < end : m >= start || m < end;
}

// ------------------------------------------------------------ sessions ---

export interface ReviewSegment {
  readonly kind: 'review';
  /** Time box for this segment. */
  readonly minutes: number;
  /** Due cards in practice order: serve these first. */
  readonly due: readonly DueCard[];
  /** New cards to introduce if time is left. Time, not a count, is the limit. */
  readonly fresh: readonly string[];
}

export interface BlockSegment {
  readonly kind: 'block';
  readonly block: PlannedBlock;
  /** Already done today (a matching task-done or feel-session event). */
  readonly done: boolean;
}

export type Segment = ReviewSegment | BlockSegment;

export interface Session {
  /** Practice day, "YYYY-MM-DD". */
  readonly date: string;
  readonly windowId: WindowId | null;
  readonly mode: Mode;
  /** In quiet hours: serve silently. */
  readonly quiet: boolean;
  /** Target length and the shortest acceptable length, in minutes. */
  readonly minutes: number;
  readonly minMinutes: number;
  /** In order. The morning puts guitar yoga first so it is never squeezed out. */
  readonly segments: readonly Segment[];
  /** Nothing to do at all. */
  readonly empty: boolean;
}

/** What to practice right now. Opening the app always gets a session. */
export function sessionFor(library: Library, now: number): Session {
  const date = practiceDay(now, library.settings.dayStart);
  const window = currentWindow(library, now);
  const quiet = isQuiet(library, now);
  const mode: Mode = quiet ? 'silent' : (window?.mode ?? 'sound');
  const queue = goalQueue(library, now);
  const tags = MODE_TAGS[mode];
  const fits = (cardId: string) => library.cards.get(cardId)?.tags.some((t) => tags.includes(t)) ?? false;
  const due = queue.due.filter((d) => fits(d.memory.cardId));
  const fresh = queue.fresh.filter(fits);

  // A gig's rundown memo, on gig night, in whatever session is open.
  const done = doneToday(library, date);
  const memos: BlockSegment[] = gigMemos(library, now).map((b) => ({ kind: 'block', block: b, done: done(b) }));

  if (mode !== 'guitar') {
    const segments: Segment[] = [{ kind: 'review', minutes: BURST_MINUTES.max, due, fresh }, ...memos];
    return finish({ date, windowId: window?.id ?? null, mode, quiet, minutes: BURST_MINUTES.max, minMinutes: BURST_MINUTES.min, segments });
  }

  // Morning: goal blocks fitted into the session; recall time and anything
  // left over become the review time box for due guitar cards.
  const budget = library.settings.morningMinutes;
  const fitted = splitTime(planGoals(library, now).blocks, budget);
  const recall = fitted.filter((b) => b.kind === 'recall');
  const other = fitted.filter((b) => b.kind !== 'recall');
  const used = fitted.reduce((s, b) => s + b.minutes, 0);
  const reviewMinutes = recall.reduce((s, b) => s + b.minutes, 0) + (budget - used);
  const block = (b: PlannedBlock): BlockSegment => ({ kind: 'block', block: b, done: done(b) });
  const segments: Segment[] = [
    ...other.filter((b) => b.protected).map(block),
    ...(reviewMinutes > 0 ? [{ kind: 'review' as const, minutes: reviewMinutes, due, fresh }] : []),
    ...other.filter((b) => !b.protected).map(block),
    ...memos,
  ];
  return finish({ date, windowId: window?.id ?? null, mode, quiet, minutes: budget, minMinutes: budget, segments });
}

/**
 * Today's goal blocks for an overview (the Today screen): the morning plan's
 * blocks fitted to the morning's minutes, without recall (that time is spent
 * on due cards), plus any gig memo due now, each marked done or not.
 */
export function todayBlocks(library: Library, now: number): BlockSegment[] {
  const date = practiceDay(now, library.settings.dayStart);
  const done = doneToday(library, date);
  const fitted = splitTime(planGoals(library, now).blocks, library.settings.morningMinutes).filter((b) => b.kind !== 'recall');
  return [...fitted, ...gigMemos(library, now)].map((b) => ({ kind: 'block', block: b, done: done(b) }));
}

/**
 * Cards due today per owning module (for badges): due review cards for the
 * whole practice day plus learning steps due now, whatever the window.
 */
export function dueToday(library: Library, now: number): ReadonlyMap<string, number> {
  const out = new Map<string, number>();
  for (const d of goalQueue(library, now).due) {
    const card = library.cards.get(d.memory.cardId);
    const module = card ? (library.items.get(card.itemId)?.module ?? '') : '';
    out.set(module, (out.get(module) ?? 0) + 1);
  }
  return out;
}

function finish(s: Omit<Session, 'empty'>): Session {
  const empty = s.segments.every((seg) =>
    seg.kind === 'review' ? seg.due.length === 0 && seg.fresh.length === 0 : seg.done,
  );
  return { ...s, empty };
}

function doneToday(library: Library, date: string): (b: PlannedBlock) => boolean {
  const today = library.activity.filter((e) => practiceDay(e.at, library.settings.dayStart) === date);
  return (b) =>
    today.some((e) =>
      e.type === 'task-done'
        ? e.goalId === b.goalId && e.blockId === b.blockId
        : e.type === 'feel-session' && b.kind === 'feel-session' && e.goalId === b.goalId,
    );
}

// ------------------------------------------------------- notifications ---

export interface Nudge {
  readonly windowId: WindowId;
  /** Epoch ms: the window's start. */
  readonly at: number;
  /** Deliver without sound (quiet hours). */
  readonly silent: boolean;
}

/**
 * Gentle notifications due in (from, to]: one at the start of each window,
 * only if there is something to do then, never repeated, never for a missed
 * window. The morning reminder is the exception: with alwaysRemindMorning
 * (the default) it fires even when nothing is due. Respects the master
 * switch and each window's toggle. The app
 * calls this for the days ahead and uploads the result (see planNudges).
 */
export function nudgesBetween(library: Library, from: number, to: number): Nudge[] {
  const { dayStart, notifications } = library.settings;
  const out: Nudge[] = [];
  if (!notifications) return out;
  for (let date = practiceDay(from, dayStart); date <= practiceDay(to, dayStart); date = addDays(date, 1)) {
    for (const w of windowsFor(library, date)) {
      if (w.start <= from || w.start > to) continue;
      if (library.settings.windows.find((x) => x.id === w.id)?.notify === false) continue;
      const always = w.id === 'morning' && library.settings.alwaysRemindMorning;
      if (!always && sessionFor(library, w.start).empty) continue;
      out.push({ windowId: w.id, at: w.start, silent: isQuiet(library, w.start) });
    }
  }
  return out;
}
