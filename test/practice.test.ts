/**
 * Practice with the instrument (Blake, 2026-11-08): the engine-assembled
 * sequence for the current goal. Four required steps of five minutes each
 * (yoga, metronome, ear training, improvisation) whatever the goal, the
 * goal's own work on top, Songs I Already Know as cards that keep coming back
 * when due; timers that gate the flow; runs that survive a reload.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSong,
  changeGoal,
  clock,
  createHost,
  currentStep,
  dayBegins,
  elapsedOf,
  finishStep,
  focusGoal,
  isComplete,
  isFinished,
  isRunning,
  memoryStore,
  newRun,
  newTimer,
  NEW_SONGS_PER_SESSION,
  parseRun,
  pauseStep,
  pauseTimer,
  pickFor,
  planPractice,
  randomEar,
  randomImprov,
  randomMetronome,
  rateBaseline,
  rateSong,
  recordFor,
  remainingOf,
  REQUIRED_AREAS,
  REQUIRED_MINUTES,
  Replica,
  seededRng,
  skipStep,
  SONGS,
  SONGS_PER_SESSION,
  startStep,
  startTimer,
  timerOf,
  REQUIRED_BLOCK_PREFIX,
  requiredBlockId,
  chooseSongs,
  withSongs,
  commitStep,
  withStepProgress,
  endEarly,
  carryOn,
  isShortRecord,
  requiredProgress,
  pickText,
  MAX_RUN_SONGS,
  NOTE_MAX,
  memoryOf,
  LEECH_LAPSES,
} from '../src/index.ts';
import type { EventBody, ModuleHost, PracticePlan, PracticeRun, SongStep, TimedStep } from '../src/index.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 3600_000;
/** 10am New York on a date (practice days begin at 3am). */
const day = (date: string, hour = 10) => dayBegins(date, NY) + (hour - 3) * H;
const MIN = 60_000;

let t = day('2026-11-09');
async function setup() {
  t = day('2026-11-09');
  const replica = await Replica.open(memoryStore(), 'phone', { now: () => t });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const songs = createHost(replica, SONGS, { now: () => t });
  return { replica, songs };
}
const goal = (id = 'g1', extra: Record<string, unknown> = {}): EventBody =>
  ({ type: 'goal-set', goal: { id, kind: 'general', what: 'Write a new record', why: '', deadline: '2026-12-31', itemIds: [], dailyMinutes: 30, weight: 1, blocks: [], archived: false, ...extra } }) as EventBody;
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const timed = (p: PracticePlan) => p.steps.filter((s): s is TimedStep => s.kind === 'timed');
const songsOf = (p: PracticePlan) => p.steps.filter((s): s is SongStep => s.kind === 'song');
const plan = (replica: Replica, at = t, round = 1) => planPractice(replica.library, at, round)!;

// ------------------------------------------------------------ the sequence --

test('no live goal, no plan: the session is goal-led', async () => {
  const { replica } = await setup();
  assert.equal(planPractice(replica.library, t), null);
  await replica.record(goal('old', { deadline: '2026-10-01' }));
  assert.equal(planPractice(replica.library, t), null, 'a goal that has passed is not a goal');
});

test('whatever the goal: yoga, metronome, ear training and improvisation, five minutes EACH, twenty at least', async () => {
  const { replica } = await setup();
  await replica.record(goal()); // a goal with no blocks at all
  const p = plan(replica);
  const required = timed(p).filter((s) => s.required);
  assert.deepEqual(required.map((s) => s.area), ['yoga', 'metronome', 'ear', 'improv']);
  assert.deepEqual([...REQUIRED_AREAS], ['yoga', 'metronome', 'ear', 'improv']);
  assert.ok(required.every((s) => s.minutes >= 5 && s.minutes === REQUIRED_MINUTES));
  assert.equal(p.requiredMinutes, 20);
  assert.equal(p.goalMinutes, 0);
  assert.deepEqual(p.steps.map((s) => s.id), ['req:yoga', 'req:metronome', 'req:ear', 'req:improv']);
  assert.equal(p.goal, 'Write a new record');
});

test('required steps use the right tools and randomizers; yoga has none', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const byArea = Object.fromEntries(timed(plan(replica)).map((s) => [s.area, s]));
  assert.deepEqual([byArea.yoga!.tool, byArea.yoga!.randomizer], [null, null]);
  assert.deepEqual([byArea.metronome!.tool, byArea.metronome!.randomizer], ['metronome', 'metronome']);
  assert.deepEqual([byArea.ear!.tool, byArea.ear!.randomizer], ['ear', 'ear']);
  assert.deepEqual([byArea.improv!.tool, byArea.improv!.randomizer], ['recorder', 'improv'], 'improvisation opens the recording module');
});

test('the goal\'s own exercises are ADDED, never replacing the four: a yoga block, tasks, improv takes and a songwriting prompt', async () => {
  const { replica } = await setup();
  await replica.record(
    goal('gig', {
      kind: 'gig',
      blocks: [
        { id: 'yoga', kind: 'feel-session', label: 'Guitar yoga', minutes: 10 },
        { id: 'task-1', kind: 'timed-task', label: '10 min in Chord Chemistry', minutes: 10 },
        { id: 'improv', kind: 'improv-takes', label: 'Improv takes', minutes: 6, params: { takes: 3, minutes: 2 } },
        { id: 'write', kind: 'creative-prompt', label: 'Songwriting prompt', minutes: 5, params: { minutes: 5, takes: 1 } },
        { id: 'memo', kind: 'gig-memo', label: 'Post-gig rundown memo', minutes: 10 },
      ],
      dailyMinutes: 31,
    }),
  );
  const p = plan(replica);
  const own = timed(p).filter((s) => !s.required);
  assert.deepEqual(own.map((s) => s.blockId), ['yoga', 'task-1', 'improv', 'write']);
  assert.ok(own.every((s) => s.area === 'goal' && s.id.startsWith('goal:gig:')));
  assert.equal(timed(p).filter((s) => s.required).length, 4, 'the four are all still there');
  assert.equal(p.requiredMinutes, 20);
  assert.equal(p.goalMinutes, 31);
  // Order: the required yoga, metronome and ear first; the goal's work; the required improvisation last.
  const ids = p.steps.map((s) => s.id);
  assert.deepEqual(ids.slice(0, 3), ['req:yoga', 'req:metronome', 'req:ear']);
  assert.equal(ids.at(-1), 'req:improv');
  assert.equal(own.find((s) => s.blockId === 'improv')!.tool, 'recorder');
  assert.match(own.find((s) => s.blockId === 'improv')!.instructions, /3 × 2 min, recorded/);
  assert.equal(own.find((s) => s.blockId === 'write')!.tool, 'recorder');
  assert.equal(own.find((s) => s.blockId === 'task-1')!.tool, null);
  assert.ok(!ids.some((i) => i.includes('memo')), 'the gig memo is for gig night');
});

test('only the focus goal\'s own work is added; recall is the song cards, not a timed step', async () => {
  const { replica } = await setup();
  await replica.record(goal('soon', { deadline: '2026-11-20', blocks: [{ id: 'task-1', kind: 'timed-task', label: 'Scales', minutes: 5 }], dailyMinutes: 5 }));
  await replica.record(goal('later', { deadline: '2026-12-20', blocks: [{ id: 'task-1', kind: 'timed-task', label: 'Other goal task', minutes: 5 }], dailyMinutes: 5 }));
  await replica.record(goal('recall', { deadline: '2026-11-25', blocks: [{ id: 'recall', kind: 'recall', label: 'Goal songs', minutes: 15 }], dailyMinutes: 15, itemIds: ['x'] }));
  assert.equal(focusGoal(replica.library, '2026-11-09')!.goal.id, 'soon');
  const p = plan(replica);
  assert.deepEqual(timed(p).filter((s) => !s.required).map((s) => s.title), ['Scales']);
});

// ------------------------------------------------------------------ songs --

test('Songs I Already Know come as cards: title-only saved songs, ahead of the closing improvisation', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  for (const [i, title] of ['Blackbird', 'Wonderwall', 'Tennessee Whiskey'].entries()) ok(await addSong(songs, `k${i}`, title));
  const p = plan(replica);
  assert.deepEqual(songsOf(p).map((s) => s.title), ['Blackbird', 'Wonderwall', 'Tennessee Whiskey']);
  assert.ok(songsOf(p).every((s) => !s.due), 'never rated: new');
  assert.equal(p.steps.at(-1)!.id, 'req:improv');
  assert.ok(p.steps.indexOf(songsOf(p)[0]!) > p.steps.findIndex((s) => s.id === 'req:ear'));
  // The goal's own songs come before the rest.
  await replica.record(goal('g1', { itemIds: ['song-k2'] }));
  assert.equal(songsOf(plan(replica))[0]!.title, 'Tennessee Whiskey');
});

test('a session has a limited number of songs: due ones up to the cap, a few new ones on top', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  for (let i = 0; i < 30; i++) ok(await addSong(songs, `s${i}`, `Song ${i}`));
  const first = songsOf(plan(replica));
  assert.equal(first.length, NEW_SONGS_PER_SESSION, 'nothing due: only the new ones');
  // Rate 20 as a baseline so they are in practice and come due.
  for (let i = 0; i < 20; i++) ok(await rateBaseline(songs, `song-s${i}-c`, 'again'));
  t = day('2026-11-11');
  const second = songsOf(plan(replica));
  assert.equal(second.filter((s) => s.due).length, SONGS_PER_SESSION);
  assert.equal(second.filter((s) => !s.due).length, NEW_SONGS_PER_SESSION);
});

test('rated songs keep coming back when they are due: good, again and easy, over four months, none disappears', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal('g1', { deadline: '2027-12-31' }));
  ok(await addSong(songs, 'a', 'Blackbird'));
  ok(await addSong(songs, 'b', 'Wonderwall'));
  ok(await addSong(songs, 'c', 'Hotel California'));
  const ratings = { 'song-a-c': 'good', 'song-b-c': 'again', 'song-c-c': 'easy' } as const;
  const seen: Record<string, string[]> = { 'song-a-c': [], 'song-b-c': [], 'song-c-c': [] };
  for (let d = 0; d < 120; d++) {
    t = day('2026-11-09') + d * 24 * H;
    for (const s of songsOf(plan(replica))) {
      seen[s.cardId]!.push(new Date(t).toISOString().slice(0, 10));
      ok(await rateSong(songs, s.cardId, ratings[s.cardId as keyof typeof ratings], 60_000));
      const again = songsOf(plan(replica)).map((x) => x.cardId);
      assert.ok(!again.includes(s.cardId), 'rated today: not served again the same day');
    }
  }
  const gaps = (days: string[]) => days.slice(1).map((d, i) => (Date.parse(d) - Date.parse(days[i]!)) / (24 * H));
  assert.ok(seen['song-a-c']!.length >= 4, `Good: ${seen['song-a-c']!.length} times`);
  assert.ok(seen['song-c-c']!.length >= 3, `Easy: ${seen['song-c-c']!.length} times`);
  assert.equal(seen['song-a-c']![0], '2026-11-09', 'the first time is the first day');
  assert.ok(seen['song-c-c']!.length < seen['song-a-c']!.length && seen['song-a-c']!.length < seen['song-b-c']!.length, 'easier means further apart');
  assert.ok(gaps(seen['song-a-c']!).every((g, i, a) => i === 0 || g >= a[i - 1]! - 1), 'intervals grow');
  assert.ok(seen['song-b-c']!.length >= 100, 'Again: back every day');
  assert.ok(gaps(seen['song-b-c']!).every((g) => g <= 3));
});

test('a song rated Good comes back on its due day and not before', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  ok(await rateSong(songs, 'song-a-c', 'good', 1000));
  const due = replica.library.reviews.get('song-a-c')!;
  assert.equal(due.length, 1);
  assert.equal(songsOf(plan(replica)).length, 0, 'same day: not due');
  let back = -1;
  for (let d = 1; d <= 10 && back < 0; d++) {
    t = day('2026-11-09') + d * 24 * H;
    if (songsOf(plan(replica)).some((s) => s.due)) back = d;
  }
  assert.ok(back >= 1 && back <= 5, `back after ${back} days`);
});

test('an archived song is not in the sequence', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  await songs.retireCard('song-a-c');
  assert.equal(songsOf(plan(replica)).length, 0);
});

// -------------------------------------------------------------- the timers --

test('a timer counts only while it runs, never beyond the time, and survives pausing', () => {
  let tm = newTimer(5);
  assert.equal(tm.requiredMs, 5 * MIN);
  assert.equal(elapsedOf(tm, 1_000_000), 0, 'not started');
  tm = startTimer(tm, 1_000_000);
  assert.equal(elapsedOf(tm, 1_000_000 + 2 * MIN), 2 * MIN);
  assert.equal(isRunning(tm, 1_000_000 + MIN), true);
  tm = pauseTimer(tm, 1_000_000 + 2 * MIN);
  assert.equal(elapsedOf(tm, 1_000_000 + 60 * MIN), 2 * MIN, 'paused: nothing counts');
  assert.equal(isRunning(tm, 1_000_000 + 60 * MIN), false);
  tm = startTimer(tm, 2_000_000);
  assert.equal(remainingOf(tm, 2_000_000 + MIN), 2 * MIN);
  assert.equal(isComplete(tm, 2_000_000 + 2 * MIN), false);
  assert.equal(isComplete(tm, 2_000_000 + 3 * MIN), true);
  assert.equal(elapsedOf(tm, 2_000_000 + 99 * MIN), 5 * MIN, 'capped at the required time');
  assert.equal(isRunning(tm, 2_000_000 + 99 * MIN), false, 'a finished timer is not running');
  assert.equal(elapsedOf(startTimer(tm, 5_000_000), 9_000_000), 5 * MIN, 'starting a finished timer changes nothing');
  assert.equal(elapsedOf(startTimer(startTimer(newTimer(5), 100), 90_000), 120_000), 119_900, 'starting twice does not restart');
  assert.equal(elapsedOf({ requiredMs: MIN, elapsedMs: 0, runningSince: 5000 }, 1000), 0, 'a clock that went backwards counts nothing');
  assert.equal(clock(4 * MIN + 7_000), '4:07');
  assert.equal(clock(0), '0:00');
  assert.equal(clock(-5), '0:00');
  assert.equal(clock(59_001), '1:00', 'rounds up: never shows 0:00 with time left');
});

test('the gate: a required step cannot be finished before its five minutes have run, and nothing changes when it is refused', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const p = plan(replica);
  let run = newRun(p.date);
  assert.equal(currentStep(p, run)!.id, 'req:yoga');
  let r = finishStep(p, run, 'req:yoga', t);
  assert.equal(r.ok, false, 'not started');
  assert.match((r as { error: string }).error, /Finish the timer first: 5:00 left/);
  run = ok(startStep(p, run, 'req:yoga', t));
  r = finishStep(p, run, 'req:yoga', t + 4 * MIN + 59_000);
  assert.equal(r.ok, false, 'one second short');
  assert.match((r as { error: string }).error, /0:01 left/);
  assert.equal(currentStep(p, run)!.id, 'req:yoga', 'still on the same step');
  const done = ok(finishStep(p, run, 'req:yoga', t + 5 * MIN));
  assert.equal(done.durationMs, 5 * MIN, 'exactly the time required is what is recorded');
  assert.equal(currentStep(p, done.run)!.id, 'req:metronome');
  assert.equal(run.steps['req:yoga']!.done, undefined, 'the run it was given is untouched (values, not mutation)');
});

test('the gate: steps come in order, so later cards cannot be reached past a required step', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  const p = plan(replica);
  const run = newRun(p.date);
  for (const id of ['req:metronome', 'req:ear', 'req:improv', songsOf(p)[0]!.id]) {
    const r = finishStep(p, run, id, t + 999 * MIN);
    assert.equal(r.ok, false, id);
    assert.match((r as { error: string }).error, /Finish "Guitar yoga" first/);
    assert.equal(startStep(p, run, id, t).ok, false, 'a later timer cannot be started either');
  }
  assert.equal(finishStep(p, run, 'nope', t).ok, false);
});

test('required steps cannot be skipped; the goal\'s own work and songs can', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal('g1', { blocks: [{ id: 'task-1', kind: 'timed-task', label: 'Scales', minutes: 5 }], dailyMinutes: 5 }));
  ok(await addSong(songs, 'a', 'Blackbird'));
  const p = plan(replica);
  let run = newRun(p.date);
  const skip = skipStep(p, run, 'req:yoga');
  assert.equal(skip.ok, false);
  assert.match((skip as { error: string }).error, /required: 5 minutes/);
  // Do the three required steps that come first.
  for (const id of ['req:yoga', 'req:metronome', 'req:ear']) {
    run = ok(startStep(p, run, id, t));
    t += 5 * MIN;
    run = ok(finishStep(p, run, id, t)).run;
  }
  assert.equal(currentStep(p, run)!.id, 'goal:g1:task-1');
  run = ok(skipStep(p, run, 'goal:g1:task-1'));
  assert.equal(currentStep(p, run)!.kind, 'song');
  run = ok(skipStep(p, run, currentStep(p, run)!.id));
  assert.equal(currentStep(p, run)!.id, 'req:improv', 'the closing improvisation is still required');
  assert.equal(skipStep(p, run, 'req:improv').ok, false);
});

test('pausing keeps the time; a paused timer does not unlock the step', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const p = plan(replica);
  let run = ok(startStep(p, newRun(p.date), 'req:yoga', t));
  run = ok(pauseStep(p, run, 'req:yoga', t + 3 * MIN));
  assert.equal(finishStep(p, run, 'req:yoga', t + 100 * MIN).ok, false, 'two minutes still to run');
  run = ok(startStep(p, run, 'req:yoga', t + 100 * MIN));
  assert.equal(finishStep(p, run, 'req:yoga', t + 101 * MIN).ok, false);
  assert.equal(finishStep(p, run, 'req:yoga', t + 102 * MIN).ok, true);
  assert.equal(remainingOf(timerOf(run, p.steps[0] as TimedStep), t + 101 * MIN), MIN);
});

test('a song is finished by rating it (no timer), and only when it is its turn', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  const p = plan(replica);
  let run = newRun(p.date);
  for (const id of ['req:yoga', 'req:metronome', 'req:ear']) {
    run = ok(startStep(p, run, id, t));
    t += 5 * MIN;
    run = ok(finishStep(p, run, id, t)).run;
  }
  const song = currentStep(p, run)!;
  assert.equal(song.kind, 'song');
  assert.equal(startStep(p, run, song.id, t).ok, false, 'a song has no timer');
  run = ok(finishStep(p, run, song.id, t)).run;
  assert.equal(currentStep(p, run)!.id, 'req:improv');
});

// ------------------------------------------------------- recorded for good --

test('each finished step is recorded in the log as an event the engine already validates', async () => {
  const { replica } = await setup();
  await replica.record(goal('g1', { blocks: [{ id: 'yoga', kind: 'feel-session', label: 'Guitar yoga', minutes: 5 }], dailyMinutes: 5 }));
  const steps = timed(plan(replica));
  const yoga = recordFor(steps[0]!, 5 * MIN, '  loose and easy  ');
  assert.deepEqual(ok(yoga), { type: 'feel-session', durationMs: 5 * MIN, note: 'loose and easy' }, 'the required yoga has no goal, so it stays apart from the goal\'s yoga block');
  assert.deepEqual(ok(recordFor(steps[1]!, 5 * MIN)), { type: 'task-done', goalId: 'g1', blockId: 'req-metronome', durationMs: 5 * MIN });
  assert.deepEqual(ok(recordFor(steps[2]!, 5 * MIN)), { type: 'task-done', goalId: 'g1', blockId: 'req-ear', durationMs: 5 * MIN });
  assert.deepEqual(ok(recordFor(steps.at(-1)!, 5 * MIN)), { type: 'task-done', goalId: 'g1', blockId: 'req-improv', durationMs: 5 * MIN });
  const own = steps.find((s) => s.blockId === 'yoga')!;
  assert.deepEqual(ok(recordFor(own, 5 * MIN, 'ok')), { type: 'feel-session', goalId: 'g1', durationMs: 5 * MIN, note: 'ok' }, 'the goal\'s yoga is a feel session for the goal');
  assert.equal(recordFor(steps[0]!, 5 * MIN, 'x'.repeat(5000)).ok, true, 'a long note is cut to fit');
});

test('what was done is read back from the log: another device continues, a new round starts fresh', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  let p = plan(replica);
  for (const s of timed(p).slice(0, 3)) await replica.record(ok(recordFor(s, 5 * MIN)));
  p = plan(replica);
  assert.deepEqual(timed(p).map((s) => s.done), [true, true, true, false], 'yoga, metronome, ear done today');
  assert.equal(currentStep(p, newRun(p.date))!.id, 'req:improv', 'a fresh run on another device starts where the log says');
  await replica.record(ok(recordFor(timed(p).at(-1)!, 5 * MIN)));
  p = plan(replica);
  assert.equal(currentStep(p, newRun(p.date)), null, 'the whole sequence is done');
  // Another round: every step is back, the log keeps both rounds.
  const again = plan(replica, t, 2);
  assert.ok(timed(again).every((s) => !s.done));
  assert.equal(again.round, 2);
  assert.equal(currentStep(again, newRun(again.date, 2))!.id, 'req:yoga');
  // And tomorrow all of it is due again.
  t = day('2026-11-10');
  assert.ok(timed(plan(replica)).every((s) => !s.done));
});

test('the goal\'s own yoga block is not marked done by the required yoga, nor the other way round', async () => {
  const { replica } = await setup();
  await replica.record(goal('g1', { blocks: [{ id: 'yoga', kind: 'feel-session', label: 'Guitar yoga', minutes: 5 }], dailyMinutes: 5 }));
  let p = plan(replica);
  await replica.record(ok(recordFor(timed(p)[0]!, 5 * MIN)));
  p = plan(replica);
  assert.equal(timed(p).find((s) => s.id === 'req:yoga')!.done, true);
  assert.equal(timed(p).find((s) => s.id === 'goal:g1:yoga')!.done, false);
  await replica.record(ok(recordFor(timed(p).find((s) => s.id === 'goal:g1:yoga')!, 5 * MIN)));
  assert.equal(timed(plan(replica)).find((s) => s.id === 'goal:g1:yoga')!.done, true);
});

// -------------------------------------------------------------- persistence --

test('a run is saved as plain data and comes back whole after a reload, timer still running', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const p = plan(replica);
  let run = ok(startStep(p, newRun(p.date), 'req:yoga', t));
  run = ok(pauseStep(p, run, 'req:yoga', t + MIN));
  run = ok(startStep(p, run, 'req:yoga', t + 2 * MIN));
  run = pickFor(run, 'req:metronome', { metronome: randomMetronome(seededRng(5)) });
  run = pickFor(run, 'req:ear', { ear: randomEar(seededRng(5)) });
  run = pickFor(run, 'req:improv', { improv: randomImprov(seededRng(5)) });
  const saved = JSON.parse(JSON.stringify(run));
  const back = parseRun(saved, p.date);
  assert.deepEqual(back, run);
  // The app was closed, then opened 4 minutes later: wall time kept counting from the run's start.
  const later = t + 6 * MIN;
  assert.equal(elapsedOf(timerOf(back, p.steps[0] as TimedStep), later), 5 * MIN, '1 minute before the pause + 4 after the restart');
  assert.equal(ok(finishStep(p, back, 'req:yoga', later)).durationMs, 5 * MIN);
  assert.equal((back.steps['req:metronome']!.pick as { metronome: { text: string } }).metronome.text, randomMetronome(seededRng(5)).text, 'the same suggestion after a reload');
});

test('a saved run is checked: another day, damage or hostile values give a fresh run or are dropped', () => {
  const day1 = '2026-11-09';
  assert.deepEqual(parseRun(null, day1), newRun(day1));
  assert.deepEqual(parseRun('x', day1), newRun(day1));
  assert.deepEqual(parseRun({ v: 1, day: '2026-11-08', round: 1, steps: {} }, day1), newRun(day1), 'yesterday\'s run is not today\'s');
  assert.deepEqual(parseRun({ v: 2, day: day1, round: 1, steps: {} }, day1), newRun(day1));
  assert.deepEqual(parseRun({ v: 1, day: day1, round: 0, steps: {} }, day1), newRun(day1));
  assert.deepEqual(parseRun({ v: 1, day: day1, round: 1.5, steps: {} }, day1), newRun(day1));
  const r = parseRun(
    {
      v: 1,
      day: day1,
      round: 3,
      steps: {
        a: { timer: { requiredMs: 300000, elapsedMs: 400000, runningSince: null }, done: 'yes' },
        a2: { timer: { requiredMs: 300000, elapsedMs: 99999999, runningSince: null } },
        b: { timer: { requiredMs: -5, elapsedMs: 0, runningSince: null } },
        c: { timer: { requiredMs: 300000, elapsedMs: 0, runningSince: 'now' } },
        d: { pick: { improv: { guitar: 'electric', chords: 9 } } },
        e: { pick: { metronome: { workout: 'tapping', key: 'C' } } },
        f: { pick: { ear: { guitar: 'electric', source: 'vinyl' } }, skipped: true },
        g: 5,
      },
    },
    day1,
  );
  assert.equal(r.round, 3);
  assert.deepEqual(r.steps.a, { timer: { requiredMs: 300000, elapsedMs: 300000, runningSince: null } }, 'time capped, a non-true flag ignored');
  assert.deepEqual(r.steps.a2, {}, 'an absurd elapsed time is dropped, not believed');
  assert.deepEqual(r.steps.b, {}, 'a bad timer is dropped');
  assert.deepEqual(r.steps.c, {});
  assert.deepEqual(r.steps.d, {}, 'seven chords is not a suggestion');
  assert.deepEqual(r.steps.e, {});
  assert.deepEqual(r.steps.f, { skipped: true, pick: { ear: { guitar: 'electric', source: 'vinyl', text: 'Electric + vinyl', alternative: r.steps.f!.pick && 'ear' in r.steps.f!.pick ? r.steps.f!.pick.ear.alternative : '' } } });
  assert.equal('g' in r.steps, false);
});

test('a step the log says is done counts as finished for the run, so a second device does not repeat it', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  await replica.record(ok(recordFor(timed(plan(replica))[0]!, 5 * MIN)));
  const p = plan(replica);
  assert.equal(isFinished(p, newRun(p.date), p.steps[0]!), true);
  assert.equal(isFinished(p, newRun(p.date), p.steps[1]!), false);
});

// ------------------------------------------------------------ editing a goal --

test('the goal popup edits the wording and date; everything else about the goal carries over', async () => {
  const { replica } = await setup();
  await replica.record(goal('g1', { kind: 'gig', weight: 3, itemIds: ['song-a'], blocks: [{ id: 'task-1', kind: 'timed-task', label: 'Scales', minutes: 5 }], dailyMinutes: 5 }));
  const body = ok(changeGoal(replica.library, 'g1', { what: 'Play the Friday set', deadline: '2026-12-04' }, t));
  await replica.record(body);
  const g = replica.library.goals.get('g1')!;
  assert.equal(g.what, 'Play the Friday set');
  assert.equal(g.deadline, '2026-12-04');
  assert.equal(g.why, '', 'untouched');
  assert.deepEqual([g.kind, g.weight, g.itemIds, g.blocks.length, g.dailyMinutes], ['gig', 3, ['song-a'], 1, 5]);
  assert.equal(replica.library.goals.size, 1, 'the same goal, not a new one');
  for (const [change, why] of [
    [{ deadline: '2026-11-01' }, /already passed/],
    [{ what: '' }, /what/],
    [{ what: 'x'.repeat(600) }, /what/],
  ] as const) {
    const r = changeGoal(replica.library, 'g1', change, t);
    assert.equal(r.ok, false);
    assert.match((r as { error: string }).error, why);
  }
  assert.equal(changeGoal(replica.library, 'nope', { what: 'x' }, t).ok, false);
  await replica.record(ok((await import('../src/index.ts')).archiveGoal(replica.library, 'g1')));
  assert.equal(changeGoal(replica.library, 'g1', { what: 'x' }, t).ok, false, 'an archived goal is not edited');
});

// ------------------------------------------------ the Fable review (2026-11-11) --

const doRequired = async (p: PracticePlan, run: PracticeRun, ids: string[]) => {
  for (const id of ids) {
    run = ok(startStep(p, run, id, t));
    t += 5 * MIN;
    run = ok(finishStep(p, run, id, t)).run;
  }
  return run;
};

test('item 3: required steps stay done when the focus goal changes mid-day (matched by their req- block id)', async () => {
  const { replica } = await setup();
  await replica.record(goal('later', { deadline: '2026-12-31' }));
  let p = plan(replica);
  for (const s of timed(p).slice(0, 3)) await replica.record(ok(recordFor(s, 5 * MIN)));
  assert.ok(timed(p).slice(0, 3).every((s) => s.blockId.startsWith(REQUIRED_BLOCK_PREFIX)));
  assert.equal(requiredBlockId('metronome'), 'req-metronome');
  // A nearer deadline arrives: it becomes the focus goal.
  await replica.record(goal('sooner', { deadline: '2026-11-20' }));
  p = plan(replica);
  assert.equal(p.goalId, 'sooner');
  assert.deepEqual(timed(p).map((s) => [s.id, s.done]), [['req:yoga', true], ['req:metronome', true], ['req:ear', true], ['req:improv', false]]);
  assert.equal(currentStep(p, newRun(p.date))!.id, 'req:improv', 'a reload or a second device does not repeat them');
  // Editing the deadline (a new goal-set for the same goal) keeps them done too.
  await replica.record(ok(changeGoal(replica.library, 'sooner', { deadline: '2026-11-25' }, t)));
  assert.ok(timed(plan(replica)).slice(0, 3).every((s) => s.done));
  // A goal's own block with the same id as a goal block elsewhere is still matched by goal (only req- ids are goal-free).
  assert.equal(ok(recordFor(timed(p).at(-1)!, 5 * MIN)).type, 'task-done');
});

test('item 2: the goal going away mid-run gives no plan, and nothing in the engine throws on that', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  const p = plan(replica);
  let run = withSongs(newRun(p.date), replica.library, t);
  run = ok(startStep(p, run, 'req:yoga', t));
  await replica.record(ok((await import('../src/index.ts')).archiveGoal(replica.library, 'g1')));
  assert.equal(planPractice(replica.library, t + MIN, run.round, run.songs), null, 'archived on another device: no plan');
  assert.equal(chooseSongs(replica.library, t), null);
  assert.equal(withSongs(newRun(p.date), replica.library, t).songs, undefined, 'no goal, no songs chosen');
  assert.deepEqual(parseRun(JSON.parse(JSON.stringify(run)), p.date), run, 'the saved run is kept for when a goal is back');
  // The deadline passing at the day boundary is the same: tomorrow's plan for a goal that ended today is null.
  const { replica: r2 } = await setup();
  await r2.record(goal('g', { deadline: '2026-11-09' }));
  assert.ok(planPractice(r2.library, t));
  assert.equal(planPractice(r2.library, day('2026-11-10', 3) + 1), null);
});

test('item 6: a step is not finished in the run when its log write fails; the run is untouched', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const p = plan(replica);
  const run = ok(startStep(p, newRun(p.date), 'req:yoga', t));
  const before = JSON.parse(JSON.stringify(run));
  const failed = await commitStep(p, run, 'req:yoga', t + 5 * MIN, async () => {
    throw new Error('disk full');
  });
  assert.equal(failed.ok, false);
  assert.match((failed as { error: string }).error, /Not saved \(disk full\)/);
  assert.deepEqual(run, before, 'nothing changed');
  assert.equal(currentStep(p, run)!.id, 'req:yoga', 'still in front: Done can be tapped again');
  assert.equal(replica.log.filter((e) => e.type === 'feel-session').length, 0);
  // Refused before writing anything: the timer has not run.
  let wrote = 0;
  const early = await commitStep(p, run, 'req:yoga', t + MIN, async () => void wrote++);
  assert.equal(early.ok, false);
  assert.equal(wrote, 0, 'nothing written when the step may not finish');
  // A write that works: the log first, then the progress, applied to the run as it is NOW (a pick saved meanwhile is kept).
  const done = await commitStep(p, run, 'req:yoga', t + 5 * MIN, async (ms, step) => {
    await replica.record(ok(recordFor(step as TimedStep, ms)));
  });
  const meanwhile = pickFor(run, 'req:metronome', { metronome: randomMetronome(seededRng(1)) });
  const after = withStepProgress(meanwhile, 'req:yoga', ok(done));
  assert.equal(after.steps['req:yoga']!.done, true);
  assert.ok(after.steps['req:metronome']!.pick, 'not overwritten by a stale copy');
  assert.equal(currentStep(p, after)!.id, 'req:metronome');
  assert.equal(replica.log.filter((e) => e.type === 'feel-session').length, 1);
});

test('item 7: a run\'s songs are chosen once, so "step 7 of 12" stays "of 12" as songs are rated', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  for (let i = 0; i < 6; i++) ok(await addSong(songs, `s${i}`, `Song ${i}`));
  for (let i = 0; i < 6; i++) ok(await rateBaseline(songs, `song-s${i}-c`, 'again'));
  t = day('2026-11-11');
  const p0 = plan(replica);
  let run = withSongs(newRun(p0.date), replica.library, t);
  assert.equal(withSongs(run, replica.library, t + H), run, 'chosen once: a run keeps its songs');
  const p = planPractice(replica.library, t, 1, run.songs)!;
  const total = p.steps.length;
  run = await doRequired(p, run, ['req:yoga', 'req:metronome', 'req:ear']);
  const song = currentStep(p, run) as SongStep;
  assert.equal(song.kind, 'song');
  const number = p.steps.indexOf(song) + 1;
  ok(await rateSong(songs, song.cardId, 'good', 60_000));
  run = ok(finishStep(p, run, song.id, t)).run;
  const live = plan(replica);
  assert.equal(live.steps.length, total - 1, 'the live queue has lost the rated song (the old shifting count)');
  const frozen = planPractice(replica.library, t, 1, run.songs)!;
  assert.equal(frozen.steps.length, total, 'the run\'s own songs: the count holds');
  assert.equal(frozen.steps.indexOf(currentStep(frozen, run)!) + 1, number + 1, 'and the next step is the next number');
  assert.equal(frozen.steps.find((s) => s.id === song.id)!.kind, 'song');
  assert.ok(isFinished(frozen, run, frozen.steps.find((s) => s.id === song.id)!));
  // Saved and reloaded, the song list comes back as it was; a damaged one is chosen again.
  assert.deepEqual(parseRun(JSON.parse(JSON.stringify(run)), p.date).songs, run.songs);
  assert.equal(parseRun({ ...JSON.parse(JSON.stringify(run)), songs: { at: 1, songs: [{ cardId: 5, due: true }] } }, p.date).songs, undefined);
  assert.equal(parseRun({ ...JSON.parse(JSON.stringify(run)), songs: { at: 1, songs: Array(MAX_RUN_SONGS + 1).fill({ cardId: 'x', due: true }) } }, p.date).songs, undefined);
});

test('a song rated on another device mid-run drops out of what is left without breaking currentStep', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  for (const [i, title] of ['Blackbird', 'Wonderwall', 'Vincent'].entries()) ok(await addSong(songs, `k${i}`, title));
  const run0 = withSongs(newRun(plan(replica).date), replica.library, t);
  const p = planPractice(replica.library, t, 1, run0.songs)!;
  let run = await doRequired(p, run0, ['req:yoga', 'req:metronome', 'req:ear']);
  const [first, second, third] = songsOf(p);
  assert.equal(currentStep(p, run)!.id, first!.id);
  // The laptop rates the song in front, and the next one; their reviews sync in.
  ok(await rateSong(songs, first!.cardId, 'good', 60_000));
  ok(await rateSong(songs, second!.cardId, 'hard', 60_000));
  const after = planPractice(replica.library, t, 1, run.songs)!;
  assert.equal(after.steps.length, p.steps.length, 'numbers hold');
  assert.equal(currentStep(after, run)!.id, third!.id, 'the phone moves on to the song not played yet');
  assert.ok(songsOf(after).filter((s) => s.done).map((s) => s.title).join() === 'Blackbird,Wonderwall');
  assert.equal(finishStep(after, run, first!.id, t).ok, false, 'the one played elsewhere cannot be rated again here');
  // One archived meanwhile leaves the list entirely; the step in front is still sound.
  await songs.retireCard(third!.cardId);
  const archived = planPractice(replica.library, t, 1, run.songs)!;
  assert.equal(songsOf(archived).length, 2);
  assert.equal(currentStep(archived, run)!.id, 'req:improv');
  run = ok(startStep(archived, run, 'req:improv', t));
  assert.equal(currentStep(archived, run)!.id, 'req:improv');
});

test('item 10: ending early records what was played, marked short; it never counts as the step done; carrying on plays it in full', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  let p = plan(replica);
  let run = await doRequired(p, newRun(p.date), ['req:yoga']);
  await replica.record(ok(recordFor(p.steps[0] as TimedStep, 5 * MIN)));
  // Ten minutes free today: two and a half minutes into the metronome, end early.
  run = ok(startStep(p, run, 'req:metronome', t));
  const ended = ok(endEarly(p, run, t + 2.5 * MIN + 400));
  assert.deepEqual([ended.record!.step.id, ended.record!.durationMs], ['req:metronome', 150_000], 'the time played, in whole seconds');
  assert.equal(ended.run.short, true);
  assert.equal(currentStep(p, ended.run), null, 'nothing in front of an ended run');
  assert.equal(ended.run.steps['req:metronome']?.timer, undefined, 'its timer is cleared, so no minute is logged twice');
  assert.equal(endEarly(p, ended.run, t).ok, false, 'ended once');
  assert.match((startStep(p, ended.run, 'req:metronome', t) as { error: string }).error, /ended early/);
  const event = ok(recordFor(ended.record!.step, ended.record!.durationMs));
  assert.deepEqual(event, { type: 'task-done', goalId: 'g1', blockId: 'req-metronome', durationMs: 150_000 }, 'the same validated event, nothing new');
  await replica.record(event);
  assert.equal(isShortRecord(event as { durationMs: number }, REQUIRED_MINUTES), true, 'flagged short: under its five minutes');
  assert.equal(isShortRecord({ durationMs: 5 * MIN }, REQUIRED_MINUTES), false);
  p = plan(replica);
  assert.deepEqual(timed(p).map((s) => s.done), [true, false, false, false], 'the short metronome is in the log but not done');
  assert.equal(ended.run.steps['req:metronome']!.played, 150_000, 'the run remembers what was recorded short');
  assert.deepEqual(requiredProgress(p, ended.run, t), { doneMs: 7.5 * MIN, totalMs: 20 * MIN }, 'the summary counts it honestly: 5 + 2.5 minutes');
  assert.equal(replica.log.filter((e) => e.type === 'task-done').length, 1, 'kept for good');
  // Later that day: carry on. The metronome is in front again, its five minutes from the start.
  const again = carryOn(ended.run);
  assert.equal(again.short, undefined);
  assert.equal(currentStep(p, again)!.id, 'req:metronome');
  assert.equal(remainingOf(timerOf(again, p.steps[1] as TimedStep), t), 5 * MIN);
  // Ending before any time has run records nothing (a timer at zero is not practice).
  const nothing = ok(endEarly(p, again, t));
  assert.equal(nothing.record, null);
  assert.equal(nothing.run.short, true);
  // A goal's own block ended early is short too, and not done.
  const { replica: r2 } = await setup();
  await r2.record(goal('g2', { blocks: [{ id: 'task-1', kind: 'timed-task', label: 'Scales', minutes: 10 }], dailyMinutes: 10 }));
  const own = timed(plan(r2)).find((s) => s.id === 'goal:g2:task-1')!;
  await r2.record(ok(recordFor(own, 4 * MIN)));
  assert.equal(timed(plan(r2)).find((s) => s.id === own.id)!.done, false);
  await r2.record(ok(recordFor(own, 10 * MIN)));
  assert.equal(timed(plan(r2)).find((s) => s.id === own.id)!.done, true);
  // A parsed run keeps its short mark; anything but true is ignored.
  assert.equal(parseRun(JSON.parse(JSON.stringify(ended.run)), p.date).short, true);
  assert.equal(parseRun({ ...JSON.parse(JSON.stringify(ended.run)), short: 'yes' }, p.date).short, undefined);
});

test('item 11: a song with eight lapses is flagged on its card as a leech', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal('g1', { deadline: '2027-12-31' }));
  ok(await addSong(songs, 'a', 'Blackbird'));
  ok(await addSong(songs, 'b', 'Wonderwall'));
  ok(await rateSong(songs, 'song-a-c', 'good', 1000));
  for (let d = 1; d <= LEECH_LAPSES; d++) {
    t = day('2026-11-09') + d * 3 * 24 * H;
    ok(await rateSong(songs, 'song-a-c', 'good', 1000));
    t += 24 * H;
    ok(await rateSong(songs, 'song-a-c', 'again', 1000));
  }
  t += 24 * H;
  const chosen = { at: t, songs: [{ cardId: 'song-a-c', due: true }, { cardId: 'song-b-c', due: false }] };
  const steps = songsOf(planPractice(replica.library, t, 1, chosen)!);
  assert.deepEqual(steps.map((s) => [s.title, s.leech]), [['Blackbird', true], ['Wonderwall', false]]);
});

test('item 13: pickText reads any randomizer\'s pick without casts', () => {
  const m = randomMetronome(seededRng(3));
  const e = randomEar(seededRng(3));
  const i = randomImprov(seededRng(3));
  assert.deepEqual(pickText({ metronome: m }), { text: m.text, alternative: null });
  assert.deepEqual(pickText({ ear: e }), { text: e.text, alternative: e.alternative });
  assert.deepEqual(pickText({ improv: i }), { text: i.text, alternative: null });
});

test('item 1: the plan is cheap to rebuild for the same library; memory is replayed once per card history', async () => {
  const { replica, songs } = await setup();
  await replica.record(goal());
  ok(await addSong(songs, 'a', 'Blackbird'));
  ok(await rateSong(songs, 'song-a-c', 'good', 1000));
  const reviews = replica.library.reviews.get('song-a-c')!;
  const a = memoryOf('song-a-c', reviews, 0.9, NY, false);
  assert.equal(memoryOf('song-a-c', reviews, 0.9, NY, false), a, 'the same history: the same answer, not replayed');
  assert.notEqual(memoryOf('song-a-c', reviews, 0.95, NY, false), a, 'another retention is its own entry');
  assert.deepEqual(memoryOf('song-a-c', [...reviews], 0.9, NY, false), a, 'a copy replays to the same memory');
  assert.ok(Object.isFrozen(a), 'shared, so frozen');
  assert.deepEqual(planPractice(replica.library, t), planPractice(replica.library, t));
});

test('item 15 (UI): the yoga note cap is one constant, the one recordFor applies', async () => {
  const { replica } = await setup();
  await replica.record(goal());
  const yoga = timed(plan(replica))[0]!;
  assert.equal(NOTE_MAX, 500);
  assert.equal((ok(recordFor(yoga, 5 * MIN, 'x'.repeat(900))) as { note: string }).note.length, NOTE_MAX);
});

void (null as unknown as [ModuleHost, PracticeRun]);
