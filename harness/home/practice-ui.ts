/**
 * Home's goal-led practice (Blake, 2026-11-08), the screens. On open: a popup
 * with the current goal (and a way to edit it), then, with nothing behind it,
 * two choices: practice with the instrument (the engine's flowing sequence of
 * cards, timers gating each required step) or without (flashcards: Due today
 * or Do more). All the rules live in src/ (practice.ts, review.ts); this file
 * only draws them and keeps the small saved run between taps and reloads.
 *
 * Fable review fixes (Blake, 2026-11-11):
 * - The plan is built once per open and once per change to the log (cached on
 *   the library, which is a new object after every event); the one-second
 *   tick only redraws the clock, the bar and the step's own row.
 * - Every handler copes with the goal going away under it (no current()!).
 * - A step is shown done only once the log (or the songs module) has it.
 * - While a timer runs, the screen is kept awake (Screen Wake Lock, Safari
 *   16.4+), and a short chime plays when it ends with the app on screen. A
 *   web app cannot sound on a locked iPhone; the time still counts by the clock.
 * - A run can be ended early; what was played is recorded, marked short.
 * - With a run in progress, Home skips the goal popup for "Back to practice".
 */
import {
  CHECK_IN_DAYS,
  carryOn,
  changeGoal,
  checkInGoal,
  clock,
  commitStep,
  currentStep,
  endEarly,
  focusGoal,
  isComplete,
  isFinished,
  isRunning,
  newRun,
  nextReview,
  parseRun,
  pauseStep,
  pickFor,
  pickText,
  planGoals,
  planPractice,
  practiceDay,
  randomEar,
  randomImprov,
  randomMetronome,
  recordFor,
  remainingOf,
  requiredProgress,
  reviewCounts,
  seededRng,
  skipStep,
  startStep,
  timerOf,
  withSongs,
  withStepProgress,
} from '../../src/index.ts';
import type { ChosenSongs, EventBody, Library, PracticePlan, PracticeRun, Rating, ReviewFilter, ReviewMode, Step, StepProgress, TimedStep, Tool, Validation } from '../../src/index.ts';
import { RATINGS, hook } from '../shared/hooks.ts';
import type { Hook } from '../shared/hooks.ts';
import type { Sheets } from '../shared/sheets.ts';
import { goalWhen } from './today.ts';

const $ = <T extends HTMLElement = HTMLElement>(name: Hook) => hook<T>(name);

export interface PracticeDeps {
  readonly library: () => Library;
  readonly sheets: Sheets;
  readonly say: (s: string) => void;
  /** Appends a validated event, then redraws the app. Throws if the log could not take it. */
  readonly record: (r: Validation<EventBody>) => Promise<void>;
  /** The saved run lives under this key (per account on this device). */
  readonly storageKey: () => string;
  /** Rates a song card (the songs module's own scheduler write). Throws if it was not saved. */
  readonly rateSong: (cardId: string, rating: Rating, durationMs: number) => Promise<void>;
  /** Opens one of the app's tools (metronome, recorder, ear training). */
  readonly openTool: (tool: Exclude<Tool, null>) => void;
  /** Which flashcards review may show, and which may come as new (the chapter horizon). */
  readonly reviewFilter: () => ReviewFilter;
  /** Draws a flashcard in the review sheet; false when it is not one. */
  readonly drawCard: (cardId: string, revealed: boolean, startedAt: () => number) => boolean;
  /** Rates a flashcard in the review sheet (an early repeat is logged as extra by the theory module). */
  readonly rateCard: (cardId: string, rating: Rating, durationMs: number) => Promise<void>;
}

/** The chime at the end of a timer: an existing sample, no new asset. */
const CHIME_URL = './sounds/ride.mp3';
/** A timer that ended longer ago than this (the page was asleep) gets no chime: it would only startle. */
const CHIME_LATE_MS = 5000;
/** A song's time is counted from when its card appeared, up to this (a card left open is not hours of playing). */
const SONG_MAX_MS = 30 * 60_000;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function setupPractice(deps: PracticeDeps) {
  const { sheets } = deps;
  let run: PracticeRun | null = null;
  let tick = 0;
  let seed = Date.now() % 2 ** 31;
  const rng = () => seededRng((seed = (seed * 48271 + 11) % 2 ** 31 || 1));

  // ------------------------------------------------------------ the goal --

  const lib = () => deps.library();
  const today = () => practiceDay(Date.now(), lib().settings.dayStart);
  const focus = () => focusGoal(lib(), today());

  /** The first popup: the goal, with a way to edit it, and its check-in when one is due (14, 7, 2 days out). */
  function renderGoalOpen() {
    const f = focus();
    $('goal-open-what').textContent = f ? f.goal.what : 'No goal yet';
    $('goal-open-when').textContent = f ? goalWhen(f.goal, today()) : 'Set a goal in Goals and every day is planned around it.';
    $('goal-open-why').textContent = f?.goal.why ?? '';
    $('goal-open-why').hidden = !f?.goal.why;
    $('goal-open-edit').hidden = !f;
    $('goal-open-next').hidden = !f;
    $('goal-open-set').hidden = !!f;
    const checkIn = f ? planGoals(lib(), Date.now()).checkIns.find((c) => c.goalId === f.goal.id) : undefined;
    $('goal-open-checkin').hidden = !checkIn;
    if (f && checkIn) {
      const point = [...CHECK_IN_DAYS].sort((a, b) => a - b).find((p) => checkIn.daysLeft <= p) ?? checkIn.daysLeft;
      const days = checkIn.daysLeft === 1 ? '1 day' : `${checkIn.daysLeft} days`;
      $('goal-open-checkin-text').textContent = `${point}-day check-in: ${days} to go. Is ${f.goal.dailyMinutes} minutes a day still right?`;
      const input = $<HTMLInputElement>('goal-open-checkin-minutes');
      if (document.activeElement !== input) {
        input.value = String(f.goal.dailyMinutes);
        $('goal-open-checkin-save').textContent = 'Keep this plan';
      }
    }
  }

  function showEditForm(on: boolean) {
    const f = focus();
    $('goal-open-form').hidden = !on;
    $('goal-open-view').hidden = on;
    if (on && f) {
      $<HTMLInputElement>('goal-edit-what').value = f.goal.what;
      $<HTMLInputElement>('goal-edit-why').value = f.goal.why ?? '';
      $<HTMLInputElement>('goal-edit-deadline').value = f.goal.deadline;
    }
  }

  // ------------------------------------------------------- the run (with) --

  function load(): PracticeRun {
    let raw: unknown = null;
    try {
      raw = JSON.parse(localStorage.getItem(deps.storageKey()) ?? 'null');
    } catch {
      raw = null;
    }
    return parseRun(raw, today());
  }
  function save() {
    try {
      if (run) localStorage.setItem(deps.storageKey(), JSON.stringify(run));
    } catch {
      /* private mode: the run just isn't kept */
    }
  }
  /** Today's run as it is now (yesterday's is replaced by a fresh one). */
  function latestRun(): PracticeRun {
    run = run && run.day === today() ? run : load();
    return run;
  }

  // The plan, built once per library (a new object after every event), day, round and song list.
  let cache: { library: Library; day: string; round: number; songs: ChosenSongs | undefined; plan: PracticePlan | null } | null = null;
  const current = (): { plan: PracticePlan; run: PracticeRun } | null => {
    const r = latestRun();
    const library = lib();
    if (!cache || cache.library !== library || cache.day !== r.day || cache.round !== r.round || cache.songs !== r.songs) {
      cache = { library, day: r.day, round: r.round, songs: r.songs, plan: planPractice(library, Date.now(), r.round, r.songs) };
    }
    return cache.plan ? { plan: cache.plan, run: r } : null;
  };

  /** Freezes the run's songs when it starts, so the step count holds while songs are rated. */
  function chooseRunSongs() {
    const r = latestRun();
    const withChosen = withSongs(r, lib(), Date.now());
    if (withChosen !== r) {
      run = withChosen;
      save();
    }
  }

  /** Whether a run has been started and not finished: the "Back to practice" button shows. */
  function inProgress(): boolean {
    const c = current();
    if (!c) return false;
    const touched = Object.keys(c.run.steps).length > 0;
    return touched && currentStep(c.plan, c.run) !== null;
  }

  function stepLabel(step: Step, plan: PracticePlan, r: PracticeRun, now: number): string {
    if (step.kind === 'song') return `Song: ${step.title}${isFinished(plan, r, step) ? ' ✓' : ''}`;
    const done = isFinished(plan, r, step);
    const left = done ? 0 : remainingOf(timerOf(r, step), now);
    return `${step.title} · ${step.minutes} min${done ? ' ✓' : left < step.minutes * 60_000 ? ` · ${clock(left)} left` : ''}${step.required ? '' : ' (goal)'}`;
  }

  /** The bar and the line under it: required minutes done of the 20, however the goal reshapes the rest. */
  function renderProgress(plan: PracticePlan, r: PracticeRun, step: Step | null, now: number) {
    const { doneMs, totalMs } = requiredProgress(plan, r, now);
    const bar = $<HTMLProgressElement>('practice-bar');
    bar.max = Math.max(1, totalMs);
    bar.value = Math.min(totalMs, doneMs);
    const where = r.short ? ' · ended early (short session)' : step ? ` · step ${plan.steps.indexOf(step) + 1} of ${plan.steps.length}` : ' · done';
    $('practice-progress').textContent = `Required time: ${clock(doneMs)} of ${clock(totalMs)}${where}`;
  }

  /** The step list's rows, by step id, so the tick can redraw one without looking anything up. */
  const rows = new Map<string, HTMLLIElement>();
  /** When the song card on show appeared (its rating is timed from then). */
  let songShown: { id: string; at: number } | null = null;

  function renderPractice() {
    const c = current();
    const now = Date.now();
    $('practice-error').textContent = '';
    if (!c) {
      $('practice-goal').textContent = 'No goal yet. Set one in Goals first.';
      $('practice-step').hidden = $('practice-song').hidden = $('practice-finish').hidden = $('practice-end-early').hidden = true;
      rows.clear();
      $('practice-steps').replaceChildren();
      return;
    }
    const { plan, run: r } = c;
    $('practice-goal').textContent = `${plan.goal}${plan.round > 1 ? ` · round ${plan.round}` : ''}`;
    const step = currentStep(plan, r);
    renderProgress(plan, r, step, now);
    rows.clear();
    $('practice-steps').replaceChildren(
      ...plan.steps.map((s) => {
        const li = document.createElement('li');
        li.dataset.zg = 'practice-step-item';
        li.dataset.step = s.id;
        if (isFinished(plan, r, s)) li.dataset.done = '';
        if (s === step) li.setAttribute('aria-current', 'step');
        li.textContent = stepLabel(s, plan, r, now);
        rows.set(s.id, li);
        return li;
      }),
    );

    const timed = step?.kind === 'timed' ? step : null;
    const song = step?.kind === 'song' ? step : null;
    $('practice-step').hidden = !timed;
    $('practice-song').hidden = !song;
    $('practice-finish').hidden = step !== null;
    $('practice-end-early').hidden = step === null;
    $('practice-step').dataset.step = timed?.id ?? '';
    $('practice-song').dataset.step = song?.id ?? '';
    if (!step) {
      // The end: the full session, or a short one ended early (recorded honestly, marked short).
      const { doneMs, totalMs } = requiredProgress(plan, r, now);
      $('practice-finish-title').textContent = r.short ? 'Short session' : 'Practice done';
      $('practice-finish-note').textContent = r.short
        ? `This session was short: ${clock(doneMs)} of the ${clock(totalMs)} required. What you played is saved, marked short.`
        : 'The required time is in, and it is saved.';
      $('practice-again').textContent = r.short ? 'Carry on' : 'Another round';
    }
    if (song) {
      if (songShown?.id !== song.id) songShown = { id: song.id, at: now };
      $('practice-song-title').textContent = song.title;
      $('practice-song-note').textContent = song.due ? 'Play it, then rate how it went.' : 'New to the app: play it, then rate how it went.';
      $('practice-song-leech').hidden = !song.leech;
    }
    if (!timed) return;

    $('practice-title').textContent = `${timed.title} · ${timed.minutes} min${timed.required ? ' (required)' : ''}`;
    $('practice-text').textContent = timed.instructions;
    // The randomizer's suggestion, kept so a reload shows the same one.
    const stored = r.steps[timed.id]?.pick;
    const sug = $('practice-suggestion');
    const beato = $('practice-beato');
    $('practice-randomize').hidden = sug.hidden = timed.randomizer === null;
    beato.hidden = true;
    if (timed.randomizer && !stored) {
      const pick = timed.randomizer === 'metronome' ? { metronome: randomMetronome(rng()) } : timed.randomizer === 'ear' ? { ear: randomEar(rng()) } : { improv: randomImprov(rng()) };
      run = pickFor(r, timed.id, pick);
      save();
      return renderPractice();
    }
    if (stored) {
      const s = pickText(stored);
      sug.textContent = s.text;
      beato.hidden = s.alternative === null;
      beato.textContent = s.alternative ?? '';
    }
    $('practice-note').parentElement!.hidden = timed.area !== 'yoga'; // the label around it
    $('practice-tool').hidden = timed.tool === null;
    $('practice-tool').textContent = timed.tool === 'metronome' ? 'Open the metronome' : timed.tool === 'recorder' ? 'Open the recorder' : timed.tool === 'ear' ? 'Open ear training' : '';
    renderTimer(timed, r, now);
  }

  /** The step's clock and its buttons. */
  function renderTimer(timed: TimedStep, r: PracticeRun, now: number) {
    const t = timerOf(r, timed);
    const running = isRunning(t, now);
    const complete = isComplete(t, now);
    $('practice-timer').textContent = clock(remainingOf(t, now));
    $('practice-timer').dataset.state = complete ? 'done' : running ? 'running' : t.elapsedMs > 0 ? 'paused' : 'ready';
    $('practice-start').hidden = running || complete;
    $('practice-start').textContent = t.elapsedMs > 0 ? 'Resume' : 'Start timer';
    $('practice-pause').hidden = !running;
    $<HTMLButtonElement>('practice-done').disabled = !complete;
    $('practice-skip').hidden = timed.required;
    $('practice-done').textContent = complete ? 'Done, next' : 'Done (when the timer ends)';
  }

  /** The tick: the clock, the bar and the step's own row only. The plan is not rebuilt. */
  function renderClock() {
    const c = current();
    if (!c) return renderPractice();
    const now = Date.now();
    const step = currentStep(c.plan, c.run);
    if (step?.kind !== 'timed') return;
    if (isComplete(timerOf(c.run, step), now) && $('practice-timer').dataset.state !== 'done') return renderPractice(); // Done unlocks
    renderProgress(c.plan, c.run, step, now);
    renderTimer(step, c.run, now);
    const row = rows.get(step.id);
    if (row) row.textContent = stepLabel(step, c.plan, c.run, now);
  }

  /** One second at a time while the practice sheet is open (time itself counts by the clock, not by ticks). */
  function startTicking() {
    if (tick) return;
    tick = window.setInterval(() => {
      if (sheets.isOpen('practice')) renderClock();
      else stopTicking();
    }, 1000);
  }
  function stopTicking() {
    window.clearInterval(tick);
    tick = 0;
  }

  // ----------------------------------------- keeping awake, and the chime --

  let lock: WakeLockSentinel | null = null;
  let wantLock = false;
  let requesting = false;
  /** Keeps the screen on while a timer runs (Screen Wake Lock; Safari 16.4+). Without it, nothing changes. */
  async function holdScreen(on: boolean) {
    wantLock = on;
    if (!on) {
      const l = lock;
      lock = null;
      if (l && !l.released) await l.release().catch(() => undefined);
      return;
    }
    const wakeLock = (navigator as { wakeLock?: WakeLock }).wakeLock;
    if (lock || requesting || !wakeLock || document.visibilityState !== 'visible') return;
    requesting = true;
    try {
      const l = await wakeLock.request('screen');
      if (!wantLock) await l.release();
      else {
        lock = l;
        // The browser lets go by itself when the page is hidden; it is asked again on return.
        l.addEventListener('release', () => {
          if (lock === l) lock = null;
        });
      }
    } catch {
      /* refused (low battery, not allowed): the timer still counts by the clock */
    } finally {
      requesting = false;
    }
  }

  let chime: HTMLAudioElement | null = null;
  /** Readies the chime inside a tap: iOS lets a page play a sound later only once it has played in a tap. */
  function primeChime() {
    if (chime) return;
    try {
      const a = new Audio(CHIME_URL);
      a.preload = 'auto';
      a.muted = true;
      chime = a;
      void a.play().then(
        () => {
          a.pause();
          a.currentTime = 0;
          a.muted = false;
        },
        () => (a.muted = false),
      );
    } catch {
      chime = null;
    }
  }
  function ring() {
    try {
      chime ??= new Audio(CHIME_URL);
      chime.muted = false;
      chime.currentTime = 0;
      void chime.play().catch(() => undefined);
    } catch {
      /* no audio here: the screen still says the time is up */
    }
  }

  let alarm = 0;
  /** Keeps the wake lock and the end-of-timer alarm in step with the timer in front (running or not). */
  function syncTimer() {
    window.clearTimeout(alarm);
    alarm = 0;
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    const now = Date.now();
    const t = c && step?.kind === 'timed' ? timerOf(c.run, step) : null;
    const running = t !== null && isRunning(t, now);
    void holdScreen(running);
    if (t && step && running) {
      const endsAt = now + remainingOf(t, now);
      alarm = window.setTimeout(() => timerEnded(step.id, endsAt), endsAt - now + 50);
    }
  }
  function timerEnded(stepId: string, endsAt: number) {
    alarm = 0;
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    const now = Date.now();
    if (!c || step?.id !== stepId || step.kind !== 'timed' || !isComplete(timerOf(c.run, step), now)) return syncTimer(); // paused or moved on meanwhile
    // Only with the app on screen and on time: a web app can't sound on a locked iPhone, and a late chime only startles.
    if (document.visibilityState === 'visible' && now - endsAt < CHIME_LATE_MS) ring();
    void holdScreen(false);
    if (sheets.isOpen('practice')) renderPractice();
    renderResume();
  }

  // ------------------------------------------------------------ actions --

  function showError(message: string) {
    if (sheets.isOpen('practice')) renderPractice();
    $('practice-error').textContent = message;
  }

  /** After any change to the run: save, redraw, and keep the screen lock and alarm in step. */
  function changed() {
    save();
    if (sheets.isOpen('practice')) renderPractice();
    renderResume();
    syncTimer();
  }

  /** Applies an engine function to the step in front; shows its refusal; saves. Safe when the goal has gone. */
  function onStep(f: (plan: PracticePlan, r: PracticeRun, step: Step) => Validation<PracticeRun>): boolean {
    const c = current();
    if (!c) {
      showError('There is no live goal now (it ended or was archived). Set one in Goals.');
      return false;
    }
    const step = currentStep(c.plan, c.run);
    if (!step) {
      showError(c.run.short ? 'This session was ended early.' : 'Everything is done.');
      return false;
    }
    const out = f(c.plan, c.run, step);
    if (!out.ok) {
      showError(out.error);
      return false;
    }
    run = out.value;
    changed();
    return true;
  }

  /** A finished step, applied to the run as it is now (the app may have saved a pick meanwhile), never a stale copy. */
  function applyFinished(day: string, stepId: string, p: StepProgress) {
    const r = latestRun();
    if (r.day === day) run = withStepProgress(r, stepId, p); // past the day's end the log has it; the new day starts fresh
    changed();
  }

  let busy = false;

  /** Done: the log gets the step first; only then is it shown done (Fable review item 6). */
  async function finish() {
    if (busy) return;
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    if (!c || step?.kind !== 'timed') return showError(c ? 'Nothing to finish here.' : 'There is no live goal now. Set one in Goals.');
    const note = $<HTMLInputElement>('practice-note');
    busy = true;
    try {
      const out = await commitStep(c.plan, c.run, step.id, Date.now(), async (durationMs) => {
        const event = recordFor(step, durationMs, note.value);
        if (!event.ok) throw new Error(event.error);
        await deps.record(event); // the log has it for good; the app redraws
      });
      if (!out.ok) return showError(out.error);
      note.value = '';
      applyFinished(c.run.day, step.id, out.value);
    } finally {
      busy = false;
    }
  }

  /** A song: the rating is saved first, timed from when its card appeared; a failure says so and changes nothing. */
  async function rateSong(rating: Rating) {
    if (busy) return;
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    if (!c || step?.kind !== 'song') return showError(c ? 'There is no song in front now.' : 'There is no live goal now. Set one in Goals.');
    const shownAt = songShown?.id === step.id ? songShown.at : Date.now();
    busy = true;
    try {
      const out = await commitStep(c.plan, c.run, step.id, Date.now(), () => deps.rateSong(step.cardId, rating, Math.min(SONG_MAX_MS, Math.max(0, Date.now() - shownAt))));
      if (!out.ok) return showError(out.error);
      applyFinished(c.run.day, step.id, out.value);
    } finally {
      busy = false;
    }
  }

  /** End early: the time played on the step in front is recorded (marked short when under its minutes), then the run ends. */
  async function endNow() {
    if (busy) return;
    const c = current();
    if (!c) return showError('There is no live goal now. Set one in Goals.');
    const out = endEarly(c.plan, c.run, Date.now());
    if (!out.ok) return showError(out.error);
    const record = out.value.record;
    const note = $<HTMLInputElement>('practice-note');
    busy = true;
    try {
      if (record) {
        const event = recordFor(record.step, record.durationMs, note.value);
        if (!event.ok) return showError(event.error);
        try {
          await deps.record(event);
        } catch (e) {
          return showError(`Not saved (${errorText(e)}). Try again.`);
        }
        note.value = '';
      }
      // End the run as it is now (a pick saved meanwhile is kept), with the step's progress exactly as recorded.
      const r = latestRun();
      const front = currentStep(c.plan, c.run);
      if (r.day === c.run.day) run = { ...(front ? withStepProgress(r, front.id, out.value.run.steps[front.id] ?? {}) : r), short: true };
      changed();
    } finally {
      busy = false;
    }
  }

  function renderResume() {
    const b = $('practice-resume');
    b.hidden = !inProgress() || sheets.isOpen('practice') || sheets.isOpen('practice-choice');
  }

  // -------------------------------------------------- practice without --

  let mode: ReviewMode | null = null;
  let revealed = false;
  const shown = new Set<string>();

  function renderReview() {
    const f = deps.reviewFilter();
    const counts = reviewCounts(lib(), Date.now(), f);
    $('review-counts').textContent = `${counts.due} due · ${counts.newToday} new left today · ${counts.newTotal} new in reach · ${counts.repeats} to repeat`;
    $('review-mode-due').setAttribute('aria-pressed', String(mode === 'due'));
    $('review-mode-more').setAttribute('aria-pressed', String(mode === 'more'));
    const stage = $('review-stage');
    stage.hidden = mode === null;
    if (mode === null) return;
    const pick = nextReview(lib(), Date.now(), mode, f, shown);
    $('review-empty').hidden = pick !== null;
    $('review-deck').hidden = pick === null;
    if (!pick) {
      $('review-kind').textContent = '';
      $('review-empty').textContent = mode === 'due' ? 'All done for today. Tap Do more to keep going.' : 'No flashcards to review yet.';
      return;
    }
    if (pick.cycle) shown.clear();
    $('review-kind').textContent = pick.kind === 'due' ? 'Due' : pick.kind === 'new' ? 'New' : 'Repeat (extra practice)';
    $('review-kind').dataset.kind = pick.kind;
    const card = $('review-card');
    if (card.dataset.card !== pick.cardId) {
      revealed = false;
      card.dataset.started = String(Date.now());
    }
    deps.drawCard(pick.cardId, revealed, () => Number(card.dataset.started ?? Date.now()));
  }

  async function rateReview(rating: Rating) {
    const card = $('review-card');
    const cardId = card.dataset.card;
    if (!cardId) return;
    const started = Number(card.dataset.started ?? Date.now());
    revealed = false;
    shown.add(cardId);
    await deps.rateCard(cardId, rating, Math.max(0, Date.now() - started));
    card.dataset.started = String(Date.now());
  }

  /** Lets go of everything held: the tick, the alarm and the screen lock. */
  function cleanup() {
    stopTicking();
    window.clearTimeout(alarm);
    alarm = 0;
    void holdScreen(false);
  }

  // ------------------------------------------------------------- wiring --

  return {
    /** The app opened on Home: the goal popup first, unless a run is in progress (then straight to "Back to practice"). */
    openGoal() {
      if (inProgress()) {
        renderResume();
        $('practice-resume').focus();
        return;
      }
      renderGoalOpen();
      showEditForm(false);
      sheets.open('goal-open');
    },
    render() {
      renderGoalOpen();
      if (sheets.isOpen('practice')) renderPractice();
      if (sheets.isOpen('review')) renderReview();
      renderResume();
      syncTimer();
    },
    /** Opens the practice sheet (continuing the saved run; a new run chooses its songs now). */
    startWith() {
      chooseRunSongs();
      sheets.open('practice');
      renderPractice();
      startTicking();
      syncTimer();
    },
    startWithout() {
      mode = null;
      sheets.open('review');
      renderReview();
    },
    cleanup,
    wire() {
      // The popup: edit the goal, or carry on to the choice.
      $('goal-open-edit').onclick = () => showEditForm(true);
      $('goal-edit-cancel').onclick = () => showEditForm(false);
      $('goal-edit-save').onclick = async () => {
        const f = focus();
        if (!f) return;
        const r = changeGoal(lib(), f.goal.id, { what: $<HTMLInputElement>('goal-edit-what').value.trim(), why: $<HTMLInputElement>('goal-edit-why').value.trim(), deadline: $<HTMLInputElement>('goal-edit-deadline').value }, Date.now());
        if (!r.ok) {
          $('goal-edit-error').textContent = r.error;
          return;
        }
        $('goal-edit-error').textContent = '';
        await deps.record(r);
        showEditForm(false);
        renderGoalOpen();
      };
      // The check-in (14, 7 and 2 days out): keep the daily minutes or change them. Either clears it.
      const checkInMinutes = $<HTMLInputElement>('goal-open-checkin-minutes');
      checkInMinutes.oninput = () => {
        const f = focus();
        $('goal-open-checkin-save').textContent = f && Number(checkInMinutes.value) === f.goal.dailyMinutes ? 'Keep this plan' : 'Save new daily minutes';
      };
      $('goal-open-checkin-save').onclick = async () => {
        const f = focus();
        if (!f) return renderGoalOpen();
        const r = checkInGoal(lib(), f.goal.id, Number(checkInMinutes.value));
        if (!r.ok) {
          $('goal-open-checkin-text').textContent = `Not saved: ${r.error}`;
          return;
        }
        checkInMinutes.blur();
        await deps.record(r);
        renderGoalOpen();
      };
      $('goal-open-next').onclick = () => {
        sheets.close('goal-open');
        sheets.open('practice-choice');
      };
      // The choice, with nothing behind it.
      $('choose-with').onclick = () => {
        sheets.close('practice-choice');
        this.startWith();
      };
      $('choose-without').onclick = () => {
        sheets.close('practice-choice');
        this.startWithout();
      };
      $('practice-choose-again').onclick = () => {
        sheets.close('practice');
        sheets.open('practice-choice');
      };
      $('review-choose-again').onclick = () => {
        sheets.close('review');
        sheets.open('practice-choice');
      };
      // Practice with the instrument. Every handler goes through onStep, so a goal that has gone is a message, not a crash.
      $('practice-randomize').onclick = () =>
        onStep((_, r, step) => {
          if (step.kind !== 'timed' || !step.randomizer) return { ok: false, error: 'Nothing to randomize here.' };
          const old = r.steps[step.id]?.pick;
          const pick =
            step.randomizer === 'metronome'
              ? { metronome: randomMetronome(rng(), old && 'metronome' in old ? old.metronome : undefined) }
              : step.randomizer === 'ear'
                ? { ear: randomEar(rng(), old && 'ear' in old ? old.ear : undefined) }
                : { improv: randomImprov(rng(), old && 'improv' in old ? old.improv : undefined) };
          return { ok: true, value: pickFor(r, step.id, pick) };
        });
      $('practice-start').onclick = () => {
        primeChime();
        if (onStep((p, r, step) => startStep(p, r, step.id, Date.now()))) startTicking();
      };
      $('practice-pause').onclick = () => void onStep((p, r, step) => pauseStep(p, r, step.id, Date.now()));
      $('practice-done').onclick = () => void finish();
      $('practice-skip').onclick = () => void onStep((p, r, step) => skipStep(p, r, step.id));
      $('practice-song-skip').onclick = () => void onStep((p, r, step) => skipStep(p, r, step.id));
      // Opening the step's tool starts its timer (Fable review item 9): the minutes count while you play.
      $('practice-tool').onclick = () => {
        const c = current();
        const step = c && currentStep(c.plan, c.run);
        if (step?.kind !== 'timed' || !step.tool) return void onStep(() => ({ ok: false, error: 'This step has no tool.' }));
        primeChime();
        onStep((p, r) => startStep(p, r, step.id, Date.now()));
        deps.openTool(step.tool);
      };
      for (const rating of RATINGS) $(`practice-r-${rating}`).onclick = () => void rateSong(rating);
      $('practice-end-early').onclick = () => void endNow();
      $('practice-again').onclick = () => {
        const r = latestRun();
        // After a short session: carry on with the same run. After a full one: another round, its songs chosen now.
        run = r.short ? carryOn(r) : newRun(today(), (current()?.plan.round ?? r.round) + 1);
        save();
        chooseRunSongs();
        changed();
      };
      $('practice-resume').onclick = () => this.startWith();
      sheets.onClose('practice', () => (stopTicking(), renderResume()));
      sheets.onClose('practice-choice', renderResume);
      // A hidden page loses its wake lock (the browser lets go); back on screen, a running timer asks again.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') syncTimer();
      });
      window.addEventListener('pagehide', cleanup);
      // Practice without the instrument.
      $('review-mode-due').onclick = () => {
        mode = 'due';
        shown.clear();
        renderReview();
      };
      $('review-mode-more').onclick = () => {
        mode = 'more';
        shown.clear();
        renderReview();
      };
      $('review-reveal').onclick = () => ((revealed = true), renderReview());
      for (const rating of RATINGS) $(`review-r-${rating}`).onclick = () => void rateReview(rating);
    },
  };
}
