/**
 * Practice with the instrument (Blake, 2026-11-08): the engine assembles one
 * flowing sequence of cards for the current goal. Pure functions: the library
 * and the time go in, a plan comes out; the run (timers, picks, what is done)
 * is a small value the app keeps, and every change to it is a function here.
 *
 * The sequence, in order:
 *   1. guitar yoga, 5 min          } the four required steps: at least five
 *   2. metronome work, 5 min       } minutes EACH, whatever the goal, so 20
 *   3. ear training, 5 min         } minutes at least. The goal never replaces
 *   ...improvisation, 5 min (last) } them; its own work is added.
 *   +  the goal's own timed work (tasks, songwriting, improv takes, ladders)
 *   +  Songs I Already Know as cards: play it, then rate it. Due songs come
 *      back through the normal scheduler; unrated songs are introduced a few
 *      at a time.
 *
 * Timers gate the flow: a timed step can be finished only once its time has
 * run, and only the step in front can be finished, so no required time is
 * skipped on the way to a later card. Time counts while the timer runs (wall
 * clock), so a reload or a locked screen doesn't lose it.
 *
 * Nothing here writes to the log: recordFor returns the event for the app to
 * append (the same feel-session and task-done events the goal blocks already
 * use), so the work is recorded for good and shows on every device.
 *
 * Short sessions (Blake, via the Fable review, 2026-11-11): the full session
 * (20 minutes at least) stays the default, but a run can be ended early. The
 * step in front is recorded with the time actually played, and a record
 * shorter than its step is a SHORT record (isShortRecord): it stays in the log
 * for good but never counts as the step done, so a later run that day still
 * asks for the full time. No new event type and no new field, so older app
 * versions on other devices read these events unchanged.
 */
import { focusGoal, goalQueue } from './goals.ts';
import type { PlannedBlock } from './goals.ts';
import { practiceDay } from './day.ts';
import { todayBlocks } from './session.ts';
import type { Library } from './project.ts';
import { memoryOf, usesSteps } from './scheduler.ts';
import type { BlockKind, EventBody, EventOf } from './model.ts';
import type { Validation } from './validate.ts';
import { validateBody } from './validate.ts';
import { suggestionOf as earSuggestion } from './modules/ear/randomizer.ts';
import type { EarSuggestion } from './modules/ear/randomizer.ts';
import { improvSuggestion } from './modules/recorder/randomizer.ts';
import type { ImprovSuggestion } from './modules/recorder/randomizer.ts';
import { metronomeSuggestion } from './modules/metronome/randomizer.ts';
import type { MetronomeSuggestion } from './modules/metronome/randomizer.ts';
import { improvFor, memoFor, songwritingFor } from './modules/recorder/blocks.ts';

// ------------------------------------------------------------- the plan ---

/** The least time on each required area, in minutes. */
export const REQUIRED_MINUTES = 5;
/** The four required areas, in the order they come (improvisation is the last step of the sequence). */
export const REQUIRED_AREAS = Object.freeze(['yoga', 'metronome', 'ear', 'improv'] as const);
export type RequiredArea = (typeof REQUIRED_AREAS)[number];
/** A session's songs: due ones up to this many, and (on top) a few never-rated ones. */
export const SONGS_PER_SESSION = 10;
export const NEW_SONGS_PER_SESSION = 3;

const SONGS_MODULE = 'songs';
const MIN = 60_000;

/**
 * The block id a required step writes its task-done against: "req-metronome",
 * "req-ear", "req-improv" ("req-yoga" too, though the required yoga is written
 * as a goal-less feel-session). The done check matches this id whatever goal
 * the record carries, so a change of focus goal mid-day keeps the work done.
 */
export const REQUIRED_BLOCK_PREFIX = 'req-';
/** The longest yoga feel note kept (it syncs to the server as free text; the app says so). */
export const NOTE_MAX = 500;
export const requiredBlockId = (area: RequiredArea): string => `${REQUIRED_BLOCK_PREFIX}${area}`;

/** Which of the app's tools a step uses. */
export type Tool = 'metronome' | 'recorder' | 'ear' | null;

export interface TimedStep {
  readonly kind: 'timed';
  /** "req:metronome" or "goal:<goal>:<block>". Stable, so a run can be resumed. */
  readonly id: string;
  readonly required: boolean;
  readonly area: RequiredArea | 'goal';
  readonly title: string;
  /** What to do, in words. */
  readonly instructions: string;
  readonly minutes: number;
  readonly tool: Tool;
  /** The randomizer this step draws from, if it has one. */
  readonly randomizer: 'metronome' | 'ear' | 'improv' | null;
  /** The goal block this step writes its completion against. */
  readonly goalId: string | null;
  readonly blockId: string;
  readonly blockKind: BlockKind | null;
  /** The goal block's own prompt (improv or songwriting), shown as written. */
  readonly prompt: string | null;
  /** Already done today according to the log (so another device's work counts). */
  readonly done: boolean;
}

export interface SongStep {
  readonly kind: 'song';
  /** "song:<card id>". */
  readonly id: string;
  readonly cardId: string;
  readonly title: string;
  /** False: never rated yet. */
  readonly due: boolean;
  /** Rated since the run chose its songs (here or on another device): finished, kept in place so step numbers hold. */
  readonly done: boolean;
  /** Eight lapses or more (the scheduler's leech flag): suggest breaking it into sections. */
  readonly leech: boolean;
}

export type Step = TimedStep | SongStep;

export interface PracticePlan {
  /** Practice day. */
  readonly date: string;
  readonly goalId: string;
  readonly goal: string;
  /** 1 for the day's first run; "another round" counts up. */
  readonly round: number;
  readonly steps: readonly Step[];
  /** Minutes of the required steps (20). */
  readonly requiredMinutes: number;
  /** Minutes of the goal's own timed work, on top. */
  readonly goalMinutes: number;
}

const YOGA_TEXT = 'Guitar yoga: slow, easy stretches and light playing. Note how it feels when the time is up.';
const REQUIRED_TEXT: Readonly<Record<RequiredArea, { title: string; instructions: string; tool: Tool; randomizer: TimedStep['randomizer'] }>> = {
  yoga: { title: 'Guitar yoga', instructions: YOGA_TEXT, tool: null, randomizer: null },
  metronome: { title: 'Metronome work', instructions: 'Play today\'s workout with the metronome. Your sessions are logged when you stop.', tool: 'metronome', randomizer: 'metronome' },
  ear: { title: 'Ear training', instructions: 'Train your ear with today\'s combination, or the Beato exercise instead.', tool: 'ear', randomizer: 'ear' },
  improv: { title: 'Improvisation', instructions: 'Improvise and record it in the recording module.', tool: 'recorder', randomizer: 'improv' },
};

const TOOL_OF: Readonly<Partial<Record<BlockKind, Tool>>> = { 'tempo-ladder': 'metronome', 'improv-takes': 'recorder', 'creative-prompt': 'recorder', 'gig-memo': 'recorder' };

function goalStep(b: PlannedBlock, date: string, done: boolean): TimedStep {
  const take = improvFor(b) ?? songwritingFor(b, date) ?? memoFor(b);
  return {
    kind: 'timed',
    id: `goal:${b.goalId}:${b.blockId}`,
    required: false,
    area: 'goal',
    title: b.label,
    instructions: take ? `${take.prompt} (${take.takes} × ${take.minutes} min, recorded)` : b.kind === 'feel-session' ? YOGA_TEXT : `${b.label}.`,
    minutes: b.minutes,
    tool: TOOL_OF[b.kind] ?? null,
    randomizer: null,
    goalId: b.goalId,
    blockId: b.blockId,
    blockKind: b.kind,
    prompt: take?.prompt ?? null,
    done,
  };
}

/** The songs a run plays, chosen once when it starts so step numbers don't shift as songs are rated (Fable review item 7). */
export interface ChosenSongs {
  /** When they were chosen (epoch ms): a rating at or after this finishes the song, wherever it was made. */
  readonly at: number;
  readonly songs: readonly { readonly cardId: string; readonly due: boolean }[];
}

/** The most songs a run can hold. */
export const MAX_RUN_SONGS = SONGS_PER_SESSION + NEW_SONGS_PER_SESSION;

const isSongCard = (library: Library, cardId: string) => library.items.get(library.cards.get(cardId)?.itemId ?? '')?.module === SONGS_MODULE;

/**
 * The songs for a run starting now: due ones first (the goal's songs ahead of
 * the rest, then the scheduler's order), then a few never rated. Null when
 * there is no live goal.
 */
export function chooseSongs(library: Library, now: number): ChosenSongs | null {
  const focus = focusGoal(library, practiceDay(now, library.settings.dayStart));
  if (!focus) return null;
  const queue = goalQueue(library, now);
  const ofGoal = new Set(focus.goal.itemIds);
  const inGoal = (cardId: string) => ofGoal.has(library.cards.get(cardId)?.itemId ?? '');
  const byGoalFirst = (ids: string[]) => [...ids.filter(inGoal), ...ids.filter((id) => !inGoal(id))];
  const due = byGoalFirst(queue.due.map((d) => d.memory.cardId).filter((id) => isSongCard(library, id)));
  const unrated = byGoalFirst(queue.fresh.filter((id) => isSongCard(library, id)));
  return {
    at: now,
    songs: [
      ...due.slice(0, SONGS_PER_SESSION).map((cardId) => ({ cardId, due: true })),
      ...unrated.slice(0, NEW_SONGS_PER_SESSION).map((cardId) => ({ cardId, due: false })),
    ],
  };
}

/** A run with its songs chosen. Once only: a run that has them keeps them. */
export function withSongs(run: PracticeRun, library: Library, now: number): PracticeRun {
  if (run.songs) return run;
  const songs = chooseSongs(library, now);
  return songs ? { ...run, songs } : run;
}

/**
 * Whether a feel-session or task-done is shorter than the step it records
 * (an ended-early session). Short records stay in the log for good; they just
 * don't count as the step done.
 */
export const isShortRecord = (e: { readonly durationMs: number }, minutes: number): boolean => e.durationMs < Math.round(minutes * MIN);

type Activity = EventOf<'feel-session'> | EventOf<'task-done'>;

/**
 * Today's practice for the focus goal. Null when there is no live goal: the
 * session is goal-led, so the app asks for a goal first.
 *
 * `round` 1 knows what the log says was already done today (a second device
 * continues where the first stopped); later rounds start every step fresh.
 * `songs` are the run's own (chooseSongs, frozen when it started); without
 * them they are chosen now, from the live queue.
 */
export function planPractice(library: Library, now: number, round = 1, songs?: ChosenSongs): PracticePlan | null {
  const date = practiceDay(now, library.settings.dayStart);
  const focus = focusGoal(library, date);
  if (!focus) return null;
  const goal = focus.goal;
  const today = library.activity.filter((e): e is Activity => e.type !== 'played' && practiceDay(e.at, library.settings.dayStart) === date);
  const fresh = round > 1;
  // A required step is done by a full-length record of its own block id, whatever goal it was written
  // against, so a change of focus goal keeps it done (Fable review item 3). The required yoga is a
  // feel-session written without a goal, so it is told apart from the goal's own yoga block.
  const reqDone = (area: RequiredArea) =>
    !fresh &&
    today.some(
      (e) =>
        !isShortRecord(e, REQUIRED_MINUTES) &&
        (area === 'yoga' ? e.type === 'feel-session' && e.goalId === undefined : e.type === 'task-done' && e.blockId === requiredBlockId(area)),
    );

  const required = (area: RequiredArea): TimedStep => ({
    kind: 'timed',
    id: `req:${area}`,
    required: true,
    area,
    ...REQUIRED_TEXT[area],
    minutes: REQUIRED_MINUTES,
    goalId: area === 'yoga' ? null : goal.id,
    blockId: requiredBlockId(area),
    blockKind: null,
    prompt: null,
    done: reqDone(area),
  });

  // The goal's own timed work, on top: not recall (the cards below are that), and the focus goal's only.
  // Done by a full-length record; a short one (an ended-early session) is kept but not counted.
  const fullOwn = (b: PlannedBlock) =>
    today.some(
      (e) =>
        !isShortRecord(e, b.minutes) &&
        (e.type === 'task-done' ? e.goalId === b.goalId && e.blockId === b.blockId : b.kind === 'feel-session' && e.goalId === b.goalId),
    );
  const own = todayBlocks(library, now)
    .filter((b) => b.block.goalId === goal.id)
    .map((b) => goalStep(b.block, date, !fresh && b.done && fullOwn(b.block)));

  // Songs: the run's own, less any archived since. A song rated since they were chosen (here or on
  // another device) is finished but keeps its place, so step numbers don't shift.
  const chosen = songs ?? chooseSongs(library, now)!;
  const { dayStart, desiredRetention } = library.settings;
  const titleOf = (cardId: string) => String(library.items.get(library.cards.get(cardId)?.itemId ?? '')?.fields.title ?? cardId);
  const songSteps: SongStep[] = chosen.songs
    .filter((c) => isSongCard(library, c.cardId) && library.cards.get(c.cardId)?.retired !== true)
    .map((c) => {
      const reviews = library.reviews.get(c.cardId) ?? [];
      return {
        kind: 'song',
        id: `song:${c.cardId}`,
        cardId: c.cardId,
        title: titleOf(c.cardId),
        due: c.due,
        done: songs !== undefined && reviews.some((r) => r.at >= songs.at),
        leech: memoryOf(c.cardId, reviews, desiredRetention, dayStart, usesSteps(library, c.cardId)).leech,
      };
    });

  const steps: Step[] = [required('yoga'), required('metronome'), required('ear'), ...own, ...songSteps, required('improv')];
  const sum = (xs: readonly Step[]) => xs.reduce((s, x) => s + (x.kind === 'timed' ? x.minutes : 0), 0);
  return {
    date,
    goalId: goal.id,
    goal: goal.what,
    round,
    steps,
    requiredMinutes: sum(steps.filter((s) => s.kind === 'timed' && s.required)),
    goalMinutes: sum(own),
  };
}

// ---------------------------------------------------------------- timers --

/** A countdown that counts only while it runs. Plain data, so it can be saved as it is. */
export interface TimerState {
  readonly requiredMs: number;
  /** Time counted before the current run started. */
  readonly elapsedMs: number;
  /** When the current run started (epoch ms), or null while paused. */
  readonly runningSince: number | null;
}

export const newTimer = (minutes: number): TimerState => ({ requiredMs: Math.round(minutes * 60_000), elapsedMs: 0, runningSince: null });

/** Time counted so far at `now`, never more than the time required. */
export function elapsedOf(t: TimerState, now: number): number {
  const live = t.runningSince === null ? 0 : Math.max(0, now - t.runningSince);
  return Math.min(t.requiredMs, t.elapsedMs + live);
}
export const remainingOf = (t: TimerState, now: number): number => t.requiredMs - elapsedOf(t, now);
export const isComplete = (t: TimerState, now: number): boolean => remainingOf(t, now) <= 0;
export const isRunning = (t: TimerState, now: number): boolean => t.runningSince !== null && !isComplete(t, now);

/** Settles a timer at `now`: a run that has used up the time stops there. */
function settle(t: TimerState, now: number): TimerState {
  const e = elapsedOf(t, now);
  return e >= t.requiredMs ? { requiredMs: t.requiredMs, elapsedMs: t.requiredMs, runningSince: null } : t;
}

export function startTimer(t: TimerState, now: number): TimerState {
  const s = settle(t, now);
  return s.runningSince !== null || s.elapsedMs >= s.requiredMs ? s : { ...s, runningSince: now };
}

export function pauseTimer(t: TimerState, now: number): TimerState {
  const s = settle(t, now);
  return s.runningSince === null ? s : { requiredMs: s.requiredMs, elapsedMs: elapsedOf(s, now), runningSince: null };
}

/** "4:07" for a time left. */
export function clock(ms: number): string {
  const s = Math.ceil(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------- run --

export type Pick = { readonly metronome: MetronomeSuggestion } | { readonly ear: EarSuggestion } | { readonly improv: ImprovSuggestion };

/** The suggestion inside a pick, whichever randomizer made it: its text, and the ear's Beato alternative. */
export function pickText(pick: Pick): { readonly text: string; readonly alternative: string | null } {
  if ('metronome' in pick) return { text: pick.metronome.text, alternative: null };
  if ('ear' in pick) return { text: pick.ear.text, alternative: pick.ear.alternative };
  return { text: pick.improv.text, alternative: null };
}

export interface StepProgress {
  readonly timer?: TimerState;
  readonly done?: boolean;
  readonly skipped?: boolean;
  readonly pick?: Pick;
  /** Time already recorded short for this step when the run was ended early (ms). Counts toward the bar, never as done. */
  readonly played?: number;
}

/** One run of the plan: what the app keeps (and saves) between taps and reloads. */
export interface PracticeRun {
  readonly v: 1;
  readonly day: string;
  readonly round: number;
  readonly steps: Readonly<Record<string, StepProgress>>;
  /** The songs this run plays, chosen when it started (withSongs). */
  readonly songs?: ChosenSongs;
  /** Ended early (endEarly): a short session. Nothing is in front until it carries on (carryOn). */
  readonly short?: true;
}

export const newRun = (day: string, round = 1): PracticeRun => ({ v: 1, day, round, steps: {} });
const progress = (run: PracticeRun, id: string): StepProgress => run.steps[id] ?? {};
const withProgress = (run: PracticeRun, id: string, p: StepProgress): PracticeRun => ({ ...run, steps: { ...run.steps, [id]: p } });
/** Sets one step's progress on a run: how a commitStep result is applied to the run as it is after the await. */
export const withStepProgress = withProgress;

/** Whether a step is finished: done in this run, skipped, or done according to the log (a step the plan marked done). */
export function isFinished(plan: PracticePlan, run: PracticeRun, step: Step): boolean {
  const p = progress(run, step.id);
  return p.done === true || p.skipped === true || step.done;
}

/** The step in front: the first not finished. Null when the whole sequence is done, or the run was ended early. */
export function currentStep(plan: PracticePlan, run: PracticeRun): Step | null {
  if (run.short) return null;
  return plan.steps.find((s) => !isFinished(plan, run, s)) ?? null;
}

/** The timer of a timed step in this run (a new one if it hasn't started). */
export function timerOf(run: PracticeRun, step: TimedStep): TimerState {
  return progress(run, step.id).timer ?? newTimer(step.minutes);
}

const must = (plan: PracticePlan, run: PracticeRun, stepId: string): Validation<Step> => {
  const step = plan.steps.find((s) => s.id === stepId);
  if (!step) return { ok: false, error: `no step ${stepId}` };
  const current = currentStep(plan, run);
  if (current?.id !== stepId) return { ok: false, error: current ? `Finish "${current.title}" first.` : run.short ? 'This session was ended early.' : 'Everything is done.' };
  return { ok: true, value: step };
};

/** Starts (or resumes) the timer of the step in front. */
export function startStep(plan: PracticePlan, run: PracticeRun, stepId: string, now: number): Validation<PracticeRun> {
  const step = must(plan, run, stepId);
  if (!step.ok) return step;
  if (step.value.kind !== 'timed') return { ok: false, error: 'a song has no timer' };
  const p = progress(run, stepId);
  return { ok: true, value: withProgress(run, stepId, { ...p, timer: startTimer(timerOf(run, step.value), now) }) };
}

export function pauseStep(plan: PracticePlan, run: PracticeRun, stepId: string, now: number): Validation<PracticeRun> {
  const step = must(plan, run, stepId);
  if (!step.ok) return step;
  if (step.value.kind !== 'timed') return { ok: false, error: 'a song has no timer' };
  const p = progress(run, stepId);
  return { ok: true, value: withProgress(run, stepId, { ...p, timer: pauseTimer(timerOf(run, step.value), now) }) };
}

/** Remembers the step's random suggestion (so a reload shows the same one). */
export function pickFor(run: PracticeRun, stepId: string, pick: Pick): PracticeRun {
  return withProgress(run, stepId, { ...progress(run, stepId), pick });
}

/**
 * Finishes the step in front. A timed step needs its time to have run: before
 * that this refuses, and nothing changes. A song step is finished by rating
 * it. Returns the new run and the time to record.
 */
export function finishStep(plan: PracticePlan, run: PracticeRun, stepId: string, now: number): Validation<{ run: PracticeRun; durationMs: number }> {
  const step = must(plan, run, stepId);
  if (!step.ok) return step;
  if (step.value.kind === 'song') return { ok: true, value: { run: withProgress(run, stepId, { ...progress(run, stepId), done: true }), durationMs: 0 } };
  const timer = timerOf(run, step.value);
  if (!isComplete(timer, now)) return { ok: false, error: `Finish the timer first: ${clock(remainingOf(timer, now))} left.` };
  const done = settle(timer, now);
  return { ok: true, value: { run: withProgress(run, stepId, { ...progress(run, stepId), timer: done, done: true }), durationMs: done.requiredMs } };
}

/** Skips the step in front. Only the extras can be skipped: the four required steps and their time can't. */
export function skipStep(plan: PracticePlan, run: PracticeRun, stepId: string): Validation<PracticeRun> {
  const step = must(plan, run, stepId);
  if (!step.ok) return step;
  if (step.value.kind === 'timed' && step.value.required) return { ok: false, error: `"${step.value.title}" is required: ${step.value.minutes} minutes.` };
  return { ok: true, value: withProgress(run, stepId, { ...progress(run, stepId), skipped: true }) };
}

/**
 * Finishes the step in front for good: checks it may finish, writes it (its
 * log event, or the song's rating) and only then hands back the step's
 * finished progress. If the write fails nothing changes, so the device never
 * shows a step done that no other device will see (Fable review item 6).
 * Apply the result with withStepProgress to the run as it is after the await:
 * the app may have saved other changes meanwhile.
 */
export async function commitStep(
  plan: PracticePlan,
  run: PracticeRun,
  stepId: string,
  now: number,
  write: (durationMs: number, step: Step) => Promise<void>,
): Promise<Validation<StepProgress>> {
  const out = finishStep(plan, run, stepId, now);
  if (!out.ok) return out;
  const step = plan.steps.find((s) => s.id === stepId)!;
  try {
    await write(out.value.durationMs, step);
  } catch (e) {
    return { ok: false, error: `Not saved (${e instanceof Error ? e.message : String(e)}). Try again.` };
  }
  return { ok: true, value: progress(out.value.run, stepId) };
}

/** Time played on a timed step in this run so far: its timer, plus any time recorded short when the run was ended early. */
export const playedOf = (run: PracticeRun, step: TimedStep, now: number): number =>
  Math.min(Math.round(step.minutes * MIN), elapsedOf(timerOf(run, step), now) + (progress(run, step.id).played ?? 0));

/**
 * Ends the run early (Fable review item 10). The step in front, if it is
 * timed and has run for a second or more, comes back to be recorded with the
 * time actually played (whole seconds): a short record, unless its time had
 * all run. Its timer is cleared, so carrying on plays that step in full and
 * no minute is logged twice. Steps already finished were recorded then.
 */
export function endEarly(plan: PracticePlan, run: PracticeRun, now: number): Validation<{ run: PracticeRun; record: { step: TimedStep; durationMs: number } | null }> {
  const step = currentStep(plan, run);
  if (!step) return { ok: false, error: run.short ? 'This session was already ended.' : 'Everything is done.' };
  const played = step.kind === 'timed' ? Math.floor(elapsedOf(timerOf(run, step), now) / 1000) * 1000 : 0;
  const { timer: _timer, ...rest } = progress(run, step.id);
  const kept = played >= 1000 ? { ...rest, played: Math.min(Math.round(step.kind === 'timed' ? step.minutes * MIN : 0), (rest.played ?? 0) + played) } : rest;
  const ended: PracticeRun = { ...withProgress(run, step.id, kept), short: true };
  return { ok: true, value: { run: ended, record: step.kind === 'timed' && played >= 1000 ? { step, durationMs: played } : null } };
}

/** Carries on after ending early: the same run, the step that was in front starting over. */
export function carryOn(run: PracticeRun): PracticeRun {
  const { short: _short, ...rest } = run;
  return rest;
}

/** The required time played so far in this run (finished steps count in full) and the total required. */
export function requiredProgress(plan: PracticePlan, run: PracticeRun, now: number): { readonly doneMs: number; readonly totalMs: number } {
  const req = plan.steps.filter((s): s is TimedStep => s.kind === 'timed' && s.required);
  const totalMs = req.reduce((n, s) => n + s.minutes * MIN, 0);
  const doneMs = req.reduce((n, s) => n + (isFinished(plan, run, s) ? s.minutes * MIN : playedOf(run, s, now)), 0);
  return { doneMs: Math.min(totalMs, doneMs), totalMs };
}

/**
 * The event that records a finished timed step, validated here so a bad one is
 * never handed back. The required yoga is a feel-session written without a
 * goal (so it stays apart from the goal's own yoga block); a goal's yoga block
 * is a feel-session for the goal; everything else is a task-done against its
 * goal block.
 */
export function recordFor(step: TimedStep, durationMs: number, note = ''): Validation<EventBody> {
  const text = note.trim().slice(0, NOTE_MAX);
  if (step.area === 'yoga') return validateBody({ type: 'feel-session', durationMs, note: text });
  if (step.goalId === null) return { ok: false, error: `${step.title} has no goal to record against` };
  if (step.blockKind === 'feel-session') return validateBody({ type: 'feel-session', goalId: step.goalId, durationMs, note: text });
  return validateBody({ type: 'task-done', goalId: step.goalId, blockId: step.blockId, durationMs });
}

// ---------------------------------------------------------------- saving --

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown, lo: number, hi: number): v is number => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;

function parsePick(v: unknown): Pick | undefined {
  if (!isObj(v)) return undefined;
  try {
    if (isObj(v.metronome)) return { metronome: metronomeSuggestion(v.metronome.workout as never, v.metronome.key as never) };
    if (isObj(v.ear)) return { ear: earSuggestion(v.ear.guitar as never, v.ear.source as never) };
    if (isObj(v.improv)) return { improv: improvSuggestion(v.improv.guitar as never, v.improv.chords as number) };
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * A saved run, checked before use. Anything wrong (not an object, another
 * day, bad numbers) gives a fresh run for `day` instead of an error: a saved
 * run is a convenience, the log is the record. The suggestions are rebuilt
 * from their parts, never trusted as saved.
 */
export function parseRun(raw: unknown, day: string): PracticeRun {
  if (!isObj(raw) || raw.v !== 1 || raw.day !== day || !finite(raw.round, 1, 1000) || !Number.isInteger(raw.round) || !isObj(raw.steps)) return newRun(day);
  const steps: Record<string, StepProgress> = {};
  for (const [id, p] of Object.entries(raw.steps)) {
    if (!isObj(p) || id.length > 200) continue;
    const timer = isObj(p.timer) && finite(p.timer.requiredMs, 1000, 4 * 60 * 60_000) && finite(p.timer.elapsedMs, 0, 4 * 60 * 60_000) && (p.timer.runningSince === null || finite(p.timer.runningSince, 0, 8.64e15))
      ? ({ requiredMs: p.timer.requiredMs, elapsedMs: Math.min(p.timer.elapsedMs, p.timer.requiredMs), runningSince: p.timer.runningSince as number | null } satisfies TimerState)
      : undefined;
    const pick = parsePick(p.pick);
    const played = finite(p.played, 1000, 4 * 60 * 60_000) ? Math.round(p.played) : undefined;
    steps[id] = { ...(timer ? { timer } : {}), ...(p.done === true ? { done: true } : {}), ...(p.skipped === true ? { skipped: true } : {}), ...(pick ? { pick } : {}), ...(played ? { played } : {}) };
  }
  const songs = parseSongs(raw.songs);
  return { v: 1, day, round: raw.round as number, steps, ...(songs ? { songs } : {}), ...(raw.short === true ? { short: true as const } : {}) };
}

/** A run's saved songs, all or nothing (a damaged list is chosen again). */
function parseSongs(v: unknown): ChosenSongs | undefined {
  if (!isObj(v) || !finite(v.at, 0, 8.64e15) || !Array.isArray(v.songs) || v.songs.length > MAX_RUN_SONGS) return undefined;
  const songs: { cardId: string; due: boolean }[] = [];
  for (const x of v.songs) {
    if (!isObj(x) || typeof x.cardId !== 'string' || x.cardId.length === 0 || x.cardId.length > 200 || typeof x.due !== 'boolean') return undefined;
    songs.push({ cardId: x.cardId, due: x.due });
  }
  return { at: v.at, songs };
}
