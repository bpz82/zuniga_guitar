/**
 * Home's goal-led practice (Blake, 2026-11-08), the screens. On open: a popup
 * with the current goal (and a way to edit it), then, with nothing behind it,
 * two choices: practice with the instrument (the engine's flowing sequence of
 * cards, timers gating each required step) or without (flashcards: Due today
 * or Do more). All the rules live in src/ (practice.ts, review.ts); this file
 * only draws them and keeps the small saved run between taps and reloads.
 */
import {
  changeGoal,
  clock,
  currentStep,
  finishStep,
  focusGoal,
  isComplete,
  isFinished,
  newRun,
  nextReview,
  parseRun,
  pauseStep,
  pickFor,
  planPractice,
  practiceDay,
  randomEar,
  randomImprov,
  randomMetronome,
  recordFor,
  remainingOf,
  reviewCounts,
  seededRng,
  skipStep,
  startStep,
  timerOf,
  isRunning,
} from '../../src/index.ts';
import type { EventBody, Library, PracticePlan, PracticeRun, Rating, ReviewFilter, ReviewMode, Step, TimedStep, Tool, Validation } from '../../src/index.ts';
import { RATINGS, hook } from '../shared/hooks.ts';
import type { Hook } from '../shared/hooks.ts';
import type { Sheets } from '../shared/sheets.ts';
import { goalWhen } from './today.ts';

const $ = <T extends HTMLElement = HTMLElement>(name: Hook) => hook<T>(name);

export interface PracticeDeps {
  readonly library: () => Library;
  readonly sheets: Sheets;
  readonly say: (s: string) => void;
  /** Appends a validated event, then redraws the app. */
  readonly record: (r: Validation<EventBody>) => Promise<void>;
  /** The saved run lives under this key (per account on this device). */
  readonly storageKey: () => string;
  /** Rates a song card (the songs module's own scheduler write). */
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

const REQUIRED_TOTAL = (plan: PracticePlan) => plan.steps.filter((s): s is TimedStep => s.kind === 'timed' && s.required);

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

  /** The first popup: the goal, with a way to edit it. */
  function renderGoalOpen() {
    const f = focus();
    $('goal-open-what').textContent = f ? f.goal.what : 'No goal yet';
    $('goal-open-when').textContent = f ? goalWhen(f.goal, today()) : 'Set a goal in Goals and every day is planned around it.';
    $('goal-open-why').textContent = f?.goal.why ?? '';
    $('goal-open-why').hidden = !f?.goal.why;
    $('goal-open-edit').hidden = !f;
    $('goal-open-next').hidden = !f;
    $('goal-open-set').hidden = !!f;
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
  const current = (): { plan: PracticePlan; run: PracticeRun } | null => {
    run = run && run.day === today() ? run : load();
    const plan = planPractice(lib(), Date.now(), run.round);
    return plan ? { plan, run } : null;
  };

  /** Whether a run has been started and not finished: the "Back to practice" button shows. */
  function inProgress(): boolean {
    const c = current();
    if (!c) return false;
    const touched = Object.keys(c.run.steps).length > 0;
    return touched && currentStep(c.plan, c.run) !== null;
  }

  const timedRow = (step: TimedStep, r: PracticeRun, now: number) => {
    const t = timerOf(r, step);
    const done = isFinished(current()!.plan, r, step);
    return { t, done, left: done ? 0 : remainingOf(t, now) };
  };

  function stepLabel(step: Step, plan: PracticePlan, r: PracticeRun, now: number): string {
    if (step.kind === 'song') return `Song: ${step.title}`;
    const { done, left } = timedRow(step, r, now);
    return `${step.title} · ${step.minutes} min${done ? ' ✓' : left < step.minutes * 60_000 ? ` · ${clock(left)} left` : ''}${step.required ? '' : ' (goal)'}`;
  }

  function renderPractice() {
    const c = current();
    const now = Date.now();
    if (!c) {
      $('practice-goal').textContent = 'No goal yet. Set one in Goals first.';
      $('practice-step').hidden = $('practice-song').hidden = $('practice-finish').hidden = true;
      return;
    }
    const { plan, run: r } = c;
    $('practice-goal').textContent = `${plan.goal}${plan.round > 1 ? ` · round ${plan.round}` : ''}`;
    const step = currentStep(plan, r);

    // The global bar: required minutes done of the 20, however the goal reshapes the rest.
    const req = REQUIRED_TOTAL(plan);
    const totalMs = req.reduce((s, x) => s + x.minutes * 60_000, 0);
    const doneMs = req.reduce((s, x) => {
      const row = timedRow(x, r, now);
      return s + (row.done ? x.minutes * 60_000 : Math.min(row.t.requiredMs, row.t.requiredMs - row.left));
    }, 0);
    const bar = $<HTMLProgressElement>('practice-bar');
    bar.max = Math.max(1, totalMs);
    bar.value = Math.min(totalMs, doneMs);
    $('practice-progress').textContent = `Required time: ${clock(doneMs)} of ${clock(totalMs)}${step ? ` · step ${plan.steps.indexOf(step) + 1} of ${plan.steps.length}` : ' · done'}`;
    $('practice-steps').replaceChildren(
      ...plan.steps.map((s) => {
        const li = document.createElement('li');
        li.dataset.zg = 'practice-step-item';
        li.dataset.step = s.id;
        if (isFinished(plan, r, s)) li.dataset.done = '';
        if (s === step) li.setAttribute('aria-current', 'step');
        li.textContent = stepLabel(s, plan, r, now);
        return li;
      }),
    );

    const timed = step?.kind === 'timed' ? step : null;
    const song = step?.kind === 'song' ? step : null;
    $('practice-step').hidden = !timed;
    $('practice-song').hidden = !song;
    $('practice-finish').hidden = step !== null;
    $('practice-error').textContent = '';
    $('practice-step').dataset.step = timed?.id ?? '';
    $('practice-song').dataset.step = song?.id ?? '';
    if (song) {
      $('practice-song-title').textContent = song.title;
      $('practice-song-note').textContent = song.due ? 'Play it, then rate how it went.' : 'New to the app: play it, then rate how it went.';
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
      const p = stored as Record<string, { text: string; alternative?: string }>;
      const s = p.metronome ?? p.ear ?? p.improv!;
      sug.textContent = s.text;
      beato.hidden = !p.ear;
      beato.textContent = p.ear?.alternative ?? '';
    }
    $('practice-note').parentElement!.hidden = timed.area !== 'yoga'; // the label around it
    $('practice-tool').hidden = timed.tool === null;
    $('practice-tool').textContent = timed.tool === 'metronome' ? 'Open the metronome' : timed.tool === 'recorder' ? 'Open the recorder' : timed.tool === 'ear' ? 'Open ear training' : '';
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

  /** One second at a time while the practice sheet is open (time itself counts by the clock, not by ticks). */
  function startTicking() {
    if (tick) return;
    tick = window.setInterval(() => {
      if (sheets.isOpen('practice')) renderPractice();
      else stopTicking();
    }, 1000);
  }
  function stopTicking() {
    window.clearInterval(tick);
    tick = 0;
  }

  /** Applies an engine function to the run; shows its refusal; saves. */
  function apply(f: (plan: PracticePlan, r: PracticeRun) => Validation<PracticeRun>) {
    const c = current();
    if (!c) return;
    const out = f(c.plan, c.run);
    if (!out.ok) {
      $('practice-error').textContent = out.error;
      return;
    }
    run = out.value;
    save();
    renderPractice();
    renderResume();
  }

  async function finish() {
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    if (!c || !step || step.kind !== 'timed') return;
    const out = finishStep(c.plan, c.run, step.id, Date.now());
    if (!out.ok) {
      $('practice-error').textContent = out.error;
      return;
    }
    const event = recordFor(step, out.value.durationMs, $<HTMLInputElement>('practice-note').value);
    if (!event.ok) {
      $('practice-error').textContent = event.error;
      return;
    }
    run = out.value.run;
    save();
    $<HTMLInputElement>('practice-note').value = '';
    await deps.record(event); // the log has it for good; the app redraws
    renderPractice();
    renderResume();
  }

  async function rateSong(rating: Rating) {
    const c = current();
    const step = c && currentStep(c.plan, c.run);
    if (!c || !step || step.kind !== 'song') return;
    await deps.rateSong(step.cardId, rating, 60_000);
    const out = finishStep(c.plan, c.run, step.id, Date.now());
    if (out.ok) run = out.value.run;
    save();
    renderPractice();
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

  // ------------------------------------------------------------- wiring --

  return {
    /** The app opened on Home: the goal popup first. */
    openGoal() {
      renderGoalOpen();
      showEditForm(false);
      sheets.open('goal-open');
    },
    render() {
      renderGoalOpen();
      if (sheets.isOpen('practice')) renderPractice();
      if (sheets.isOpen('review')) renderReview();
      renderResume();
    },
    /** Opens the practice sheet (continuing the saved run). */
    startWith() {
      run = current()?.run ?? load();
      sheets.open('practice');
      renderPractice();
      startTicking();
    },
    startWithout() {
      mode = null;
      sheets.open('review');
      renderReview();
    },
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
      // Practice with the instrument.
      $('practice-randomize').onclick = () => {
        const c = current();
        const step = c && currentStep(c.plan, c.run);
        if (!c || step?.kind !== 'timed' || !step.randomizer) return;
        const old = c.run.steps[step.id]?.pick as Record<string, { text: string }> | undefined;
        const prev = old ? (old.metronome ?? old.ear ?? old.improv) : undefined;
        const pick = step.randomizer === 'metronome' ? { metronome: randomMetronome(rng(), prev) } : step.randomizer === 'ear' ? { ear: randomEar(rng(), prev) } : { improv: randomImprov(rng(), prev) };
        run = pickFor(c.run, step.id, pick);
        save();
        renderPractice();
      };
      $('practice-start').onclick = () => {
        const step = currentStep(current()!.plan, current()!.run);
        if (step) apply((p, r) => startStep(p, r, step.id, Date.now()));
        startTicking();
      };
      $('practice-pause').onclick = () => {
        const step = currentStep(current()!.plan, current()!.run);
        if (step) apply((p, r) => pauseStep(p, r, step.id, Date.now()));
      };
      $('practice-done').onclick = () => void finish();
      $('practice-skip').onclick = () => {
        const step = currentStep(current()!.plan, current()!.run);
        if (step) apply((p, r) => skipStep(p, r, step.id));
      };
      $('practice-song-skip').onclick = () => {
        const step = currentStep(current()!.plan, current()!.run);
        if (step) apply((p, r) => skipStep(p, r, step.id));
      };
      $('practice-tool').onclick = () => {
        const step = currentStep(current()!.plan, current()!.run);
        if (step?.kind === 'timed' && step.tool) deps.openTool(step.tool);
      };
      for (const rating of RATINGS) $(`practice-r-${rating}`).onclick = () => void rateSong(rating);
      $('practice-again').onclick = () => {
        const c = current();
        run = newRun(today(), (c?.plan.round ?? 1) + 1);
        save();
        renderPractice();
      };
      $('practice-resume').onclick = () => this.startWith();
      sheets.onClose('practice', () => (stopTicking(), renderResume()));
      sheets.onClose('practice-choice', renderResume);
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
