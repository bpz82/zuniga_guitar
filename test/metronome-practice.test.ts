import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonical, ContractViolation, createHost, goalFromIntake, memoryStore, planGoals, Replica, sessionFor, validateBody, TEST_DECK } from '../src/index.ts';
import type { ModuleHost } from '../src/index.ts';
import {
  addExercise,
  bestCleanTempo,
  ensureFreePractice,
  exercises,
  FREE_PRACTICE,
  ladderConfig,
  ladderFor,
  ladderParams,
  ladderState,
  loadPrefs,
  logSession,
  METRONOME,
  PREFS_ITEM,
  savePrefs,
  sessionReview,
  tempoHistory,
} from '../src/modules/metronome/practice.ts';
import type { LadderParams, SessionResult } from '../src/modules/metronome/practice.ts';
import { DEFAULT_CONFIG } from '../src/modules/metronome/core.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';
import { dayBegins } from '../src/day.ts';

let t = Date.UTC(2026, 10, 2, 9);
const clock = () => (t += 60_000);

async function setup() {
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, METRONOME, { now: clock });
  return { replica, host };
}

const session = (cardId: string, over: Partial<SessionResult> = {}): SessionResult => ({
  cardId,
  workout: 'steady',
  startTempo: 100,
  tempo: 100,
  bars: 16,
  durationMs: 40_000,
  clean: true,
  ...over,
});

// ------------------------------------------------------------ exercises ---

test('exercises are the module\'s own guitar cards; adding twice is a no-op', async () => {
  const { host, replica } = await setup();
  const free = await ensureFreePractice(host);
  assert.equal(free.cardId, FREE_PRACTICE.cardId);
  await ensureFreePractice(host);
  const r = await addExercise(host, 'chromatic', 'Chromatic 1-2-3-4');
  assert.ok(r.ok);
  assert.deepEqual(exercises(host).map((e) => e.name).sort(), ['Chromatic 1-2-3-4', 'Free practice']);
  assert.deepEqual(replica.library.cards.get('mx-chromatic-c')!.tags, ['guitar']);
  assert.equal((await addExercise(host, 'bad id!', 'x')).ok, false);
  assert.equal((await addExercise(host, 'ok', '  ')).ok, false);
  assert.ok(host.enabled, 'bad input is refused before the contract, so the module stays on');
});

test('exercise cards show up in the morning guitar session, never in pocket bursts', async () => {
  const { host, replica } = await setup();
  await ensureFreePractice(host);
  const day = '2026-11-02';
  const at = (h: number) => dayBegins(day, BLAKE_SETTINGS.dayStart) + (h - 3) * 3600_000;
  const fresh = (h: number) => (sessionFor(replica.library, at(h)).segments.find((s) => s.kind === 'review') as { fresh: readonly string[] }).fresh;
  assert.deepEqual(fresh(4), [FREE_PRACTICE.cardId]);
  assert.deepEqual(fresh(13), []);
});

// ------------------------------------------------------------- sessions ---

test('a session is logged as a review with tempo details', async () => {
  const { host, replica } = await setup();
  const ex = await ensureFreePractice(host);
  const r = await logSession(host, session(ex.cardId, { workout: 'ramp', startTempo: 90, tempo: 120, timingErrorMs: 14, tapOffsetMs: -6 }));
  assert.ok(r.ok);
  const [rev] = replica.library.reviews.get(ex.cardId)!;
  assert.equal(rev!.rating, 'good');
  assert.equal(rev!.durationMs, 40_000);
  assert.deepEqual(rev!.details, { workout: 'ramp', tempo: 120, startTempo: 90, bars: 16, clean: true, timingErrorMs: 14, tapOffsetMs: -6 });
  await logSession(host, session(ex.cardId, { tempo: 130, clean: false }));
  assert.equal(replica.library.reviews.get(ex.cardId)![1]!.rating, 'again');
});

test('bad sessions are refused without writing anything, and the module stays on', async () => {
  const { host, replica } = await setup();
  const ex = await ensureFreePractice(host);
  const before = canonical(replica.log);
  for (const bad of [
    session(ex.cardId, { durationMs: 2000 }),
    session(ex.cardId, { tempo: 400 }),
    session(ex.cardId, { tempo: 99.5 }),
    session(ex.cardId, { bars: 0 }),
    session(ex.cardId, { workout: 'disco' as never }),
    session(ex.cardId, { timingErrorMs: -1 }),
    session(ex.cardId, { goalId: 'g' }),
    session('td-fret-6-5-c'),
  ]) {
    assert.equal((await logSession(host, bad)).ok, false, JSON.stringify(bad));
  }
  assert.equal(canonical(replica.log), before);
  assert.ok(host.enabled);
});

test('sessionReview keeps optional fields optional', () => {
  const r = sessionReview(session('c', { goalId: 'g1', blockId: 'b1' }));
  assert.ok(r.ok);
  assert.deepEqual(Object.keys(r.value.details).sort(), ['bars', 'blockId', 'clean', 'goalId', 'startTempo', 'tempo', 'workout']);
});

test('speed progress: history in order and the best clean tempo', async () => {
  const { host, replica } = await setup();
  const ex = await ensureFreePractice(host);
  for (const [tempo, clean] of [[100, true], [120, false], [112, true], [108, true]] as const) await logSession(host, session(ex.cardId, { tempo, clean }));
  const reviews = replica.library.reviews.get(ex.cardId)!;
  assert.deepEqual(tempoHistory(reviews).map((p) => [p.tempo, p.clean]), [[100, true], [120, false], [112, true], [108, true]]);
  assert.equal(bestCleanTempo(reviews), 112);
  assert.equal(bestCleanTempo([]), null);
});

// ---------------------------------------------------------- tempo ladder ---

const L: LadderParams = { cardId: 'mx-free-c', startBpm: 100, targetBpm: 120, stepBpm: 5, cleanReps: 3, repBars: 8 };
const reps = (...xs: [number, boolean][]) => xs.map(([tempo, clean]) => ({ tempo, clean }));

test('ladder: up only after N clean reps in a row', () => {
  assert.deepEqual(ladderState(L, []), { tempo: 100, cleanStreak: 0, atTarget: false, reps: 0 });
  assert.equal(ladderState(L, reps([100, true], [100, true])).tempo, 100);
  assert.deepEqual(ladderState(L, reps([100, true], [100, true], [100, true])), { tempo: 105, cleanStreak: 0, atTarget: false, reps: 3 });
});

test('ladder: a sloppy rep drops back a step and resets the streak; never below the start', () => {
  const s = ladderState(L, reps([100, true], [100, true], [100, true], [105, true], [105, false]));
  assert.deepEqual([s.tempo, s.cleanStreak], [100, 0]);
  assert.equal(ladderState(L, reps([100, false], [100, false])).tempo, 100);
});

test('ladder: stops at the target; a rep at an unexpected tempo re-anchors within range', () => {
  const climb = reps(...[100, 105, 110, 115].flatMap((b) => [[b, true], [b, true], [b, true]] as [number, boolean][]));
  const top = ladderState(L, climb);
  assert.deepEqual([top.tempo, top.atTarget], [120, true]);
  assert.equal(ladderState(L, reps(...climb.map((r) => [r.tempo, r.clean] as [number, boolean]), [120, true], [120, true], [120, true])).tempo, 120);
  assert.equal(ladderState(L, reps([150, true])).tempo, 120, 'clamped to target');
  assert.deepEqual([ladderState(L, reps([110, true])).tempo, ladderState(L, reps([110, true])).cleanStreak], [110, 1]);
});

test('ladder from the log: only ladder reps on its card count, and the next rep is set up', async () => {
  const { host } = await setup();
  const ex = await ensureFreePractice(host);
  for (let i = 0; i < 3; i++) await logSession(host, session(ex.cardId, { workout: 'ladder', tempo: 100 }));
  await logSession(host, session(ex.cardId, { workout: 'steady', tempo: 140, clean: false }));
  const state = ladderFor(host, L);
  assert.equal(state.tempo, 105);
  const c = ladderConfig(DEFAULT_CONFIG, L, state);
  assert.deepEqual([c.workout, c.bpm, c.targetBpm, c.repBars], ['ladder', 105, 120, 8]);
});

test('tempo-ladder goal blocks: strict settings, then they run in the morning session', async () => {
  const { replica } = await setup();
  const params = { cardId: 'mx-free-c', startBpm: 90, targetBpm: 120, stepBpm: 5, cleanReps: 3, repBars: 8 };
  const goal = (p: unknown) => ({
    type: 'goal-set',
    goal: { id: 'g', kind: 'general', what: 'Speed', why: 'x', deadline: '2027-01-01', itemIds: [], dailyMinutes: 15, weight: 1, archived: false, blocks: [{ id: 'lad', kind: 'tempo-ladder', label: 'Ladder', minutes: 15, ...(p === undefined ? {} : { params: p }) }] },
  });
  assert.ok(validateBody(goal(params)).ok);
  for (const bad of [undefined, { ...params, targetBpm: 90 }, { ...params, startBpm: 10 }, { ...params, cleanReps: 0 }, { ...params, extra: 1 }, { ...params, cardId: '' }]) {
    assert.equal(validateBody(goal(bad)).ok, false, JSON.stringify(bad));
  }
  const intake = goalFromIntake(
    { what: 'Speed', why: 'x', deadline: '2027-01-01', itemIds: [], dailyMinutes: 15, blocks: [{ id: 'lad', kind: 'tempo-ladder', label: 'Ladder', minutes: 15, params }] },
    'g',
    replica.library,
    t,
  );
  assert.ok(intake.ok);
  await replica.record(intake.value);
  const plan = planGoals(replica.library, dayBegins('2026-11-02', BLAKE_SETTINGS.dayStart) + 3600_000);
  assert.deepEqual(plan.blocks.map((b) => [b.kind, b.minutes]), [['tempo-ladder', 15]]);
  const block = replica.library.goals.get('g')!.blocks[0]!;
  assert.deepEqual(ladderParams(block), params);
  assert.equal(ladderParams({ kind: 'timed-task' }), null);
});

// --------------------------------------------------------- preferences ---

test('preferences: saved through the contract, read back, unchanged saves write nothing', async () => {
  const { host, replica } = await setup();
  assert.deepEqual(loadPrefs(host), DEFAULT_CONFIG);
  const mine = { ...DEFAULT_CONFIG, bpm: 92, groove: 'rock' as const, sound: 'beep' as const };
  assert.ok((await savePrefs(host, mine)).ok);
  assert.deepEqual(loadPrefs(host), mine);
  const n = replica.log.length;
  await savePrefs(host, mine);
  assert.equal(replica.log.length, n);
  assert.equal(replica.library.items.get(PREFS_ITEM)!.module, 'metronome');
});

test('invalid preferences are refused without a write; the module stays on', async () => {
  const { host, replica } = await setup();
  const n = replica.log.length;
  const r = await savePrefs(host, { ...DEFAULT_CONFIG, bpm: 1000 });
  assert.ok(!r.ok && /bpm/.test(r.error));
  assert.equal(replica.log.length, n);
  assert.ok(host.enabled);
});

// ------------------------------------------------------------- contract ---

test('the metronome can read reviews of its own cards only', async () => {
  const { replica, host } = await setup();
  const ex = await ensureFreePractice(host);
  await logSession(host, session(ex.cardId));
  assert.equal(host.reviews(ex.cardId).length, 1);
  const other: ModuleHost = createHost(replica, TEST_DECK, { now: clock });
  assert.throws(() => other.reviews(ex.cardId), ContractViolation);
  assert.equal(other.enabled, false);
  assert.ok(host.enabled);
});
