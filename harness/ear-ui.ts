/**
 * Bare ear-training panel for the test harness. No design. One trial at a
 * time: Play (again = a replay), answer by button or by tapping the rhythm,
 * then immediate correction (the right answer, replayed and resolved) and Next.
 */
import { dayBegins, isQuiet, practiceDay, runModule } from '../src/index.ts';
import type { ModuleHost, Replica } from '../src/index.ts';
import { EarPlayer } from '../src/modules/ear/audio.ts';
import { DAILY_MINUTES, skillOf } from '../src/modules/ear/core.ts';
import type { Trial } from '../src/modules/ear/core.ts';
import { answerRhythm, answerTrial, cardInfo, minutesSince, pickEarCard, progress, trialFor, unlockNext } from '../src/modules/ear/practice.ts';
import type { Outcome } from '../src/modules/ear/practice.ts';
import { hook } from './hooks.ts';
import type { Hook } from './hooks.ts';

const $ = <T extends HTMLElement = HTMLButtonElement>(name: Hook) => hook<T>(name);
const randomSeed = () => crypto.getRandomValues(new Uint32Array(1))[0]! >>> 1;

interface Current {
  readonly cardId: string;
  readonly trial: Trial;
  readonly shownAt: number;
  plays: number;
  /** Wall-clock ms when the first playback ended (latency starts here). */
  firstEnd: number | null;
  /** Audio-clock seconds when the learner's rhythm bar starts. */
  barStart: number | null;
  taps: number[];
  done: boolean;
}

export function setupEar(replica: Replica, host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>) {
  const player = new EarPlayer();
  let current: Current | null = null;
  let last: string | undefined;

  const soundAllowed = () => !isQuiet(replica.library, Date.now());

  const renderLevel = () => {
    if (!host.enabled) {
      $('ear-level').textContent = `Ear training switched off: ${host.disabledReason}`;
      return;
    }
    const p = progress(host);
    const { dayStart } = replica.library.settings;
    const today = minutesSince(host, dayBegins(practiceDay(Date.now(), dayStart), dayStart));
    const acc = p.accuracy === null ? '–' : `${Math.round(p.accuracy * 100)}%`;
    $('ear-level').textContent =
      `Level ${p.level}: ${p.label} · ${p.answers} answers, ${p.sessions} sessions, recent ${acc}` +
      `${p.mastered ? ' · mastered' : ''} · today ${today} of ${DAILY_MINUTES} min`;
    $('ear-unlock').hidden = p.next === null;
  };

  const showChoices = (trial: Trial | null) => {
    $('ear-choices').replaceChildren(
      ...(trial && !current?.done ? trial.choices : []).map((c) => {
        const b = document.createElement('button');
        b.dataset.zg = 'ear-choice';
        b.dataset.choice = c.id;
        b.textContent = c.label;
        b.onclick = () => void choose(c.id);
        return b;
      }),
    );
    $('ear-tap').hidden = !trial?.rhythm || Boolean(current?.done);
  };

  const finish = async (out: Outcome) => {
    if (!current) return;
    current.done = true;
    const label = current.trial.choices.find((c) => c.id === current!.trial.answer)?.label ?? skillOf(current.trial.family, current.trial.category)?.label ?? '';
    $('ear-feedback').textContent = out.grade.correct
      ? `✓ ${label}. ${current.trial.explain}`
      : `✗ The answer: ${label}. ${current.trial.explain}${current.trial.rhythm ? ` (missed ${out.grade.details.missed}, extra ${out.grade.details.extra})` : ''}`;
    if (!out.grade.correct) player.play(current.trial.feedback); // immediate correction, heard
    if (out.newLevel !== null) say(`Ear training: level ${out.newLevel} unlocked`);
    $('ear-resolve').hidden = false;
    $('ear-next').hidden = false;
    showChoices(current.trial);
    await afterChange();
  };

  const run = async (fn: () => ReturnType<typeof answerTrial>) => {
    const r = await runModule(host, fn);
    if (!r.ok) return say(`Ear training switched off: ${r.error}`);
    if (!r.value.ok) return say(`Ear training: ${r.value.error}`);
    await finish(r.value.value);
  };

  const choose = async (choice: string) => {
    if (!current || current.done) return;
    if (current.firstEnd === null) return say('Play it first.');
    const latencyMs = Math.max(0, Date.now() - current.firstEnd);
    const c = current;
    await run(() => answerTrial(host, c.cardId, c.trial, { choice, latencyMs, replays: c.plays - 1 }, Date.now() - c.shownAt));
  };

  const gradeTaps = async () => {
    if (!current || current.done || !current.trial.rhythm) return;
    const c = current;
    await run(() => answerRhythm(host, c.cardId, c.trial, c.taps, c.plays - 1, Date.now() - c.shownAt));
  };

  const select = (cardId: string) => {
    if (!cardInfo(host, cardId)) return say(`Not an ear card: ${cardId}`);
    const t = trialFor(host, cardId, randomSeed());
    if (!t.ok) return say(`Ear training: ${t.error}`);
    current = { cardId, trial: t.value, shownAt: Date.now(), plays: 0, firstEnd: null, barStart: null, taps: [], done: false };
    last = cardId;
    $('ear-prompt').textContent = `${t.value.scaffold ? '(Narrowed to two choices.) ' : ''}${t.value.prompt}`;
    $('ear-feedback').textContent = '';
    $('ear-resolve').hidden = true;
    $('ear-next').hidden = true;
    showChoices(t.value);
  };

  const next = () => {
    if (!host.enabled) return;
    if (!soundAllowed()) {
      current = null;
      showChoices(null);
      $('ear-prompt').textContent = 'Quiet hours: ear training needs sound.';
      return;
    }
    const id = pickEarCard(host, Date.now(), true, last);
    if (id) select(id);
  };

  return {
    player,
    current: () => current,
    select,
    render: renderLevel,
    wire() {
      $('ear-play').onclick = async () => {
        if (!current) next();
        if (!current) return;
        if (!soundAllowed()) return say('Quiet hours: ear training needs sound.');
        await player.unlock();
        const c = current;
        const { start, end } = player.play(c.trial.events);
        c.plays++;
        const endMs = Date.now() + Math.round((end - player.now()) * 1000);
        if (c.firstEnd === null && !c.trial.rhythm) c.firstEnd = endMs;
        if (c.trial.rhythm && !c.done) {
          c.taps = [];
          c.barStart = start + c.trial.rhythm.answerAt;
          const playsNow = c.plays;
          // Whole milliseconds: the audio clock is fractional, and timers should fire on whole ms.
          window.setTimeout(() => {
            if (current === c && c.plays === playsNow) void gradeTaps();
          }, Math.ceil(endMs - Date.now() + 400));
        }
      };
      $('ear-tap').onpointerdown = () => {
        if (current?.barStart != null && !current.done) current.taps.push(player.now() - current.barStart);
      };
      $('ear-resolve').onclick = async () => {
        if (!current) return;
        await player.unlock();
        player.play(current.trial.feedback);
      };
      $('ear-next').onclick = next;
      $('ear-unlock').onclick = async () => {
        const r = await runModule(host, () => unlockNext(host));
        say(!r.ok ? `Ear training switched off: ${r.error}` : r.value.ok ? `Ear training: level ${r.value.value} unlocked` : `Ear training: ${r.value.error}`);
        await afterChange();
      };
    },
  };
}
