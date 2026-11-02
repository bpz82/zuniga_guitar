/**
 * Bare metronome controls for the test harness. No design: every setting is
 * a plain form field so it can be tested on a phone. The product UI is built
 * separately.
 *
 * 2026-11-02 (Blake: "it makes no sound"): when the metronome will not play
 * (quiet hours, or audio the browser kept off) the reason now shows right
 * under Start, not only in the status line at the top of the page, and quiet
 * hours offer "Play anyway" for this one session.
 */
import { isQuiet, runModule } from '../src/index.ts';
import type { ModuleHost, Replica } from '../src/index.ts';
import { tapTempo, tapTiming, validateConfig, VOICES } from '../src/modules/metronome/core.ts';
import type { MetronomeConfig } from '../src/modules/metronome/core.ts';
import { MetronomePlayer } from '../src/modules/metronome/player.ts';
import {
  addExercise,
  bestCleanTempo,
  ensureFreePractice,
  exercises,
  ladderConfig,
  ladderFor,
  loadPrefs,
  logSession,
  savePrefs,
} from '../src/modules/metronome/practice.ts';
import type { LadderParams, SessionResult } from '../src/modules/metronome/practice.ts';
import { hook, MX_NUMBER_FIELDS, MX_TEXT_FIELDS } from './hooks.ts';
import type { Hook } from './hooks.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
const NUMBER_FIELDS = MX_NUMBER_FIELDS;
const TEXT_FIELDS = MX_TEXT_FIELDS;

export interface LadderRun {
  readonly params: LadderParams;
  readonly goalId: string;
  readonly blockId: string;
}

export function setupMetronome(replica: Replica, host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>) {
  const player = new MetronomePlayer();
  let taps: number[] = [];
  let tapsWhilePlaying: number[] = [];
  let beats: { time: number; bpm: number }[] = [];
  let started = 0;
  let ladder: LadderRun | null = null;
  let pending: Omit<SessionResult, 'clean'> | null = null;

  const readForm = (): unknown => {
    const c: Record<string, unknown> = {};
    for (const k of NUMBER_FIELDS) c[k] = Number($(`mx-${k}`).value);
    for (const k of TEXT_FIELDS) c[k] = $<HTMLSelectElement>(`mx-${k}`).value;
    c.allowDuringQuietHours = $('mx-allowDuringQuietHours').checked;
    c.volumes = Object.fromEntries(VOICES.map((v) => [v, Number($(`mx-vol-${v}` as Hook).value)]));
    return c;
  };
  const writeForm = (c: MetronomeConfig) => {
    for (const k of NUMBER_FIELDS) $(`mx-${k}`).value = String(c[k]);
    for (const k of TEXT_FIELDS) $<HTMLSelectElement>(`mx-${k}`).value = c[k];
    $('mx-allowDuringQuietHours').checked = c.allowDuringQuietHours;
    for (const v of VOICES) $(`mx-vol-${v}` as Hook).value = String(c.volumes[v]);
  };

  const renderExercises = () => {
    const sel = $<HTMLSelectElement>('mx-exercise');
    const keep = sel.value;
    sel.replaceChildren(
      ...exercises(host).map((e) => {
        const o = document.createElement('option');
        const best = bestCleanTempo(host.reviews(e.cardId));
        o.value = e.cardId;
        o.textContent = best ? `${e.name} (best clean ${best} BPM)` : e.name;
        return o;
      }),
    );
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  };

  const showPosition = () => {
    const t = player.audioTime;
    const beat = t && player.clock?.beatAt(t.now);
    $('mx-position').textContent = beat
      ? `${beat.countIn ? 'count-in' : `bar ${beat.bar + 1}`} · beat ${beat.beat + 1}/${beat.beatsPerBar} · ${beat.bpm} BPM${beat.muted ? ' · (silent bar)' : ''}`
      : player.playing
        ? 'starting…'
        : 'stopped';
    if (player.playing) requestAnimationFrame(showPosition);
  };

  const finish = () => {
    const stats = player.stats;
    const ms = Date.now() - started;
    const timing = tapTiming(tapsWhilePlaying, beats);
    const config = validateConfig(readForm());
    if (!stats || !config.ok || stats.bars < 1) {
      say('Stopped (too short to log).');
      return;
    }
    pending = {
      cardId: $<HTMLSelectElement>('mx-exercise').value,
      workout: ladder ? 'ladder' : config.value.workout,
      startTempo: stats.startTempo,
      tempo: stats.tempo,
      bars: stats.bars,
      durationMs: ms,
      ...(timing ? { timingErrorMs: Math.min(1000, timing.meanAbsMs), tapOffsetMs: Math.max(-1000, Math.min(1000, timing.meanOffsetMs)) } : {}),
      ...(ladder ? { goalId: ladder.goalId, blockId: ladder.blockId } : {}),
    };
    $('mx-result').hidden = false;
    $('mx-summary').textContent =
      `${stats.bars} bars, ${stats.startTempo}→${stats.tempo} BPM, ${Math.round(ms / 1000)} s` +
      (timing ? ` · tap timing ±${timing.meanAbsMs} ms (${timing.meanOffsetMs >= 0 ? 'behind' : 'ahead'} ${Math.abs(timing.meanOffsetMs)} ms)` : '');
    $('mx-start').textContent = 'Start';
  };

  const log = async (clean: boolean | null) => {
    $('mx-result').hidden = true;
    const result = pending;
    pending = null;
    if (!result || clean === null) return say('Not logged.');
    const r = await runModule(host, () => logSession(host, { ...result, clean }));
    if (!r.ok) return say(`Metronome switched off: ${r.error}`);
    if (!r.value.ok) return say(`Not logged: ${r.value.error}`);
    say(`Logged ${result.tempo} BPM (${clean ? 'clean' : 'sloppy'}).`);
    if (ladder) {
      const next = ladderFor(host, ladder.params);
      const current = validateConfig(readForm());
      writeForm(ladderConfig(current.ok ? current.value : loadPrefs(host), ladder.params, next));
      say(`Logged. Ladder: next rep at ${next.tempo} BPM${next.atTarget ? ' (target reached)' : ''}, clean streak ${next.cleanStreak}/${ladder.params.cleanReps}.`);
    }
    renderExercises();
    await afterChange();
  };

  /** A message next to Start (and in the status line). */
  const note = (text: string, offerAnyway = false) => {
    $('mx-note').textContent = text;
    $('mx-anyway').hidden = !offerAnyway;
    if (text) say(text);
  };

  /** `anyway`: the user chose to play through quiet hours this once. */
  const start = async (anyway = false) => {
    if (player.playing) {
      player.stop();
      finish();
      return;
    }
    const checked = validateConfig(readForm());
    if (!checked.ok) return note(`Metronome: ${checked.error}`);
    if (!anyway && isQuiet(replica.library, Date.now()) && !checked.value.allowDuringQuietHours) {
      const { start: from, end: to } = replica.library.settings.quietHours;
      return note(`Quiet hours (${from} to ${to}): the metronome stays silent. Play anyway, or change quiet hours in Settings.`, true);
    }
    try {
      await player.unlock();
    } catch (e) {
      return note(`Audio could not start: ${(e as Error).message}`);
    }
    note('');
    if (!ladder) await runModule(host, () => savePrefs(host, checked.value));
    taps = [];
    tapsWhilePlaying = [];
    beats = [];
    started = Date.now();
    player.start(checked.value, () => finish());
    const latency = player.audioTime?.latency ?? 0;
    player.clock?.onBeat((b) => beats.push({ time: b.time + latency, bpm: b.bpm }));
    $('mx-start').textContent = 'Stop';
    requestAnimationFrame(showPosition);
  };

  const tap = (e: Event) => {
    if (player.playing) {
      const at = player.eventTime(e.timeStamp);
      if (at !== null) tapsWhilePlaying.push(at);
      return;
    }
    taps.push(e.timeStamp);
    const bpm = tapTempo(taps);
    if (bpm) $('mx-bpm').value = String(bpm);
  };

  // Live changes while playing.
  const fields: Hook[] = [...NUMBER_FIELDS.map((k) => `mx-${k}` as const), ...TEXT_FIELDS.map((k) => `mx-${k}` as const), ...VOICES.map((v) => `mx-vol-${v}` as Hook), 'mx-allowDuringQuietHours'];
  for (const el of fields.map((f) => $(f))) {
    el.addEventListener('change', () => {
      if (!player.playing) return;
      const c = validateConfig(readForm());
      if (c.ok) player.update(c.value);
    });
  }
  $('mx-start').onclick = () => void start();
  $('mx-anyway').onclick = () => void start(true);
  $('mx-tap').addEventListener('pointerdown', tap);
  $('mx-clean').onclick = () => void log(true);
  $('mx-sloppy').onclick = () => void log(false);
  $('mx-skip').onclick = () => void log(null);
  $('mx-add').onclick = async () => {
    const r = await runModule(host, () => addExercise(host, crypto.randomUUID().slice(0, 8), $('mx-new').value));
    if (!r.ok || !r.value.ok) return say(r.ok ? (r.value as { error: string }).error : r.error);
    renderExercises();
    $<HTMLSelectElement>('mx-exercise').value = r.value.value.cardId;
    await afterChange();
  };

  return {
    player,
    async init() {
      await runModule(host, () => ensureFreePractice(host));
      writeForm(loadPrefs(host));
      renderExercises();
    },
    /** Practise a specific exercise (from the session's card). */
    select(cardId: string) {
      ladder = null;
      $<HTMLSelectElement>('mx-exercise').value = cardId;
      $('metronome').scrollIntoView();
    },
    /** Set up a goal's tempo-ladder block. */
    startLadder(run: LadderRun) {
      if (!exercises(host).some((e) => e.cardId === run.params.cardId)) return say(`Ladder exercise ${run.params.cardId} not found.`);
      ladder = run;
      const state = ladderFor(host, run.params);
      writeForm(ladderConfig(loadPrefs(host), run.params, state));
      $<HTMLSelectElement>('mx-exercise').value = run.params.cardId;
      $('metronome').scrollIntoView();
      say(`Ladder rep at ${state.tempo} BPM (clean streak ${state.cleanStreak}/${run.params.cleanReps}). Press Start.`);
    },
  };
}
