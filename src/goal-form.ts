/**
 * The goal intake form (Blake, 2026-10-31): a gig or a deadline ("write a new
 * record by X"), plus the building blocks to practise toward it. Every block
 * is concrete and timed; nothing counts "ideas". Checks every field strictly,
 * then hands off to goalFromIntake, which validates the event again.
 *
 * Blocks the form can make:
 *   - timed tasks: "10 min in Chord Chemistry", checked off
 *   - a songwriting prompt: a concrete prompt each day, recorded (takes x minutes)
 *   - improv takes: N takes of M minutes, recorded; a gig can ramp N up near the date
 *   - guitar yoga (feel session) and recall time for the goal's songs
 */
import { goalFromIntake } from './goals.ts';
import type { Intake } from './goals.ts';
import type { Library } from './project.ts';
import type { EventBody, GoalBlock, GoalKind } from './model.ts';
import type { Validation } from './validate.ts';

export interface GoalForm {
  readonly kind: GoalKind;
  readonly what: string;
  readonly why: string;
  /** "YYYY-MM-DD": the gig, or the deadline. */
  readonly deadline: string;
  /** Songs (or any items) the goal is about. A gig's set. */
  readonly itemIds?: readonly string[];
  /** Daily minutes. Default: the sum of the blocks. */
  readonly dailyMinutes?: number;
  readonly weight?: number;
  readonly tasks?: readonly { readonly label: string; readonly minutes: number }[];
  /** Songwriting prompt: minutes per take and takes a day. */
  readonly songwriting?: { readonly minutes: number; readonly takes: number; readonly prompt?: string };
  readonly improv?: { readonly takes: number; readonly minutes: number; readonly prompt?: string; readonly rampTo?: number; readonly rampDays?: number };
  /** Guitar yoga minutes a day. */
  readonly feel?: number;
  /** Recall minutes a day for the goal's songs. */
  readonly recall?: number;
}

export const FORM_LIMITS = Object.freeze({
  taskMinutes: [1, 120],
  tasks: 5,
  writeMinutes: [1, 60],
  writeTakes: [1, 5],
  improvTakes: [1, 10],
  improvMinutes: [1, 30],
  rampDays: [1, 60],
  feel: [1, 60],
  recall: [1, 240],
} as const);

type Check<T> = Validation<T>;
const fail = (error: string): Check<never> => ({ ok: false, error });
const inRange = (v: unknown, [lo, hi]: readonly [number, number]) => Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi;
const text = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max && !/[\u0000-\u001f\u007f]/.test(v);

/** The blocks a form asks for, each checked. */
export function blocksFromForm(form: GoalForm): Check<GoalBlock[]> {
  const blocks: GoalBlock[] = [];
  if (form.feel !== undefined) {
    if (!inRange(form.feel, FORM_LIMITS.feel)) return fail('guitar yoga: 1 to 60 minutes');
    blocks.push({ id: 'yoga', kind: 'feel-session', label: 'Guitar yoga', minutes: form.feel });
  }
  if (form.recall !== undefined) {
    if (!inRange(form.recall, FORM_LIMITS.recall)) return fail('recall: 1 to 240 minutes');
    if (!form.itemIds?.length) return fail('recall time needs songs to recall');
    blocks.push({ id: 'recall', kind: 'recall', label: form.kind === 'gig' ? 'Set songs' : 'Goal songs', minutes: form.recall });
  }
  const tasks = form.tasks ?? [];
  if (tasks.length > FORM_LIMITS.tasks) return fail(`at most ${FORM_LIMITS.tasks} timed tasks`);
  for (const [i, t] of tasks.entries()) {
    if (!text(t.label, 200)) return fail(`timed task ${i + 1}: a label of 1 to 200 characters`);
    if (!inRange(t.minutes, FORM_LIMITS.taskMinutes)) return fail(`timed task ${i + 1}: 1 to 120 minutes`);
    blocks.push({ id: `task-${i + 1}`, kind: 'timed-task', label: t.label.trim(), minutes: t.minutes });
  }
  if (form.songwriting) {
    const w = form.songwriting;
    if (!inRange(w.minutes, FORM_LIMITS.writeMinutes)) return fail('songwriting: 1 to 60 minutes per take');
    if (!inRange(w.takes, FORM_LIMITS.writeTakes)) return fail('songwriting: 1 to 5 takes');
    if (w.prompt !== undefined && !text(w.prompt, 200)) return fail('songwriting prompt: 1 to 200 characters');
    blocks.push({
      id: 'write',
      kind: 'creative-prompt',
      label: 'Songwriting prompt',
      minutes: w.minutes * w.takes,
      params: { minutes: w.minutes, takes: w.takes, ...(w.prompt ? { prompt: w.prompt.trim() } : {}) },
    });
  }
  if (form.improv) {
    const v = form.improv;
    if (!inRange(v.takes, FORM_LIMITS.improvTakes)) return fail('improv: 1 to 10 takes');
    if (!inRange(v.minutes, FORM_LIMITS.improvMinutes)) return fail('improv: 1 to 30 minutes per take');
    if (v.prompt !== undefined && !text(v.prompt, 200)) return fail('improv prompt: 1 to 200 characters');
    if ((v.rampTo === undefined) !== (v.rampDays === undefined)) return fail('improv ramp: give both the takes to reach and over how many days');
    if (v.rampTo !== undefined && (!inRange(v.rampTo, FORM_LIMITS.improvTakes) || v.rampTo <= v.takes)) return fail('improv ramp: up to 10 takes, more than the starting takes');
    if (v.rampDays !== undefined && !inRange(v.rampDays, FORM_LIMITS.rampDays)) return fail('improv ramp: over 1 to 60 days');
    blocks.push({
      id: 'improv',
      kind: 'improv-takes',
      label: 'Improv takes',
      minutes: v.takes * v.minutes,
      params: {
        takes: v.takes,
        minutes: v.minutes,
        ...(v.prompt ? { prompt: v.prompt.trim() } : {}),
        ...(v.rampTo === undefined ? {} : { rampTo: v.rampTo, rampDays: v.rampDays! }),
      },
    });
  }
  return { ok: true, value: blocks };
}

/**
 * Timed tasks typed one per line, in plain words: "10 min in Chord Chemistry".
 * The line must start with the minutes; the whole line is the label.
 */
export function tasksFromText(text: string): Check<{ label: string; minutes: number }[]> {
  const out: { label: string; minutes: number }[] = [];
  for (const [i, raw] of String(text).split(/\r\n|\r|\n/).entries()) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^(\d{1,3})\s*(?:min|mins|minutes?)\b/i.exec(line);
    if (!m) return fail(`timed task line ${i + 1}: start with the minutes, e.g. "10 min in Chord Chemistry"`);
    out.push({ label: line, minutes: Number(m[1]) });
  }
  return { ok: true, value: out };
}

/** The intake form to a goal-set event body (checked twice: here and by the log). */
export function goalFromForm(form: GoalForm, goalId: string, library: Library, now: number): Validation<EventBody> {
  if (form.kind !== 'gig' && form.kind !== 'general') return fail('kind: gig or general');
  if (!text(form.what, 500)) return fail('what: 1 to 500 characters');
  const blocks = blocksFromForm(form);
  if (!blocks.ok) return blocks;
  if (blocks.value.length === 0) return fail('add at least one thing to practise toward the goal');
  for (const id of form.itemIds ?? []) if (!library.items.has(id)) return fail(`unknown song or item ${id}`);
  const sum = blocks.value.reduce((s, b) => s + b.minutes, 0);
  const intake: Intake = {
    kind: form.kind,
    what: form.what.trim(),
    why: (form.why ?? '').trim(),
    deadline: form.deadline,
    itemIds: [...(form.itemIds ?? [])],
    dailyMinutes: form.dailyMinutes ?? sum,
    ...(form.weight === undefined ? {} : { weight: form.weight }),
    blocks: blocks.value,
  };
  return goalFromIntake(intake, goalId, library, now);
}

/** Archives a goal (kept in history, no longer planned). */
export function archiveGoal(library: Library, goalId: string): Validation<EventBody> {
  const g = library.goals.get(goalId);
  if (!g) return fail(`no goal ${goalId}`);
  return { ok: true, value: { type: 'goal-set', goal: { ...g, archived: true } } };
}

/** A check-in: confirm or change the daily minutes. Re-saving clears the check-in. */
export function checkInGoal(library: Library, goalId: string, dailyMinutes: number): Validation<EventBody> {
  const g = library.goals.get(goalId);
  if (!g) return fail(`no goal ${goalId}`);
  if (!Number.isInteger(dailyMinutes) || dailyMinutes < 0 || dailyMinutes > 24 * 60) return fail('daily minutes: 0 to 1440');
  return { ok: true, value: { type: 'goal-set', goal: { ...g, dailyMinutes } } };
}
