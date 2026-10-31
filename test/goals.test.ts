import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  append,
  apportion,
  buildQueue,
  canonical,
  dayBegins,
  emptyLog,
  GIG_DEFAULT_RETENTION,
  goalFromIntake,
  goalQueue,
  memoryOf,
  planGoals,
  project,
  retrievability,
  splitTime,
} from '../src/index.ts';
import type { EventBody, Intake, Log, PlannedBlock, Rating } from '../src/index.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';
import { card, item } from './helpers.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const DAY = 24 * H;
/** 9:00am New York on a practice day. */
const at9 = (date: string) => dayBegins(date, NY) + 6 * H;

function writer() {
  let clock = at9('2026-10-01');
  let n = 0;
  let log: Log = emptyLog();
  const ctx = { device: 'phone', now: () => clock, newId: () => `e${String(++n).padStart(5, '0')}` };
  const w = {
    at(ms: number) {
      clock = ms;
      log = append(log, BLAKE_SETTINGS_EVENT, ctx).log;
  return w;
    },
    add(...bodies: EventBody[]) {
      // Tests back-date events freely; a real device can't, so each event
      // here is recorded as its own device to keep the times exactly as written.
      for (const b of bodies) log = append(log, b, { ...ctx, device: `${ctx.device}-${log.length}` }).log;
      log = append(log, BLAKE_SETTINGS_EVENT, ctx).log;
  return w;
    },
    rate(cardId: string, rating: Rating, ms: number) {
      return w.at(ms).add({ type: 'review', cardId, rating, durationMs: 3000 });
    },
    get log() {
      return log;
    },
    get lib() {
      return project(log);
    },
  };
  log = append(log, BLAKE_SETTINGS_EVENT, ctx).log;
  return w;
}

const gigIntake = (over: Partial<Intake> = {}): Intake => ({
  kind: 'gig',
  what: 'Friday set at the Brunswick Inn',
  why: 'First paid gig',
  deadline: '2026-12-04',
  itemIds: ['set1', 'set2'],
  dailyMinutes: 30,
  weight: 2,
  ...over,
});

function withGig(w: ReturnType<typeof writer>, over: Partial<Intake> = {}, savedAt = at9('2026-10-30')) {
  const body = goalFromIntake(gigIntake(over), 'gig', w.lib, savedAt);
  assert.ok(body.ok, body.ok ? '' : body.error);
  return w.at(savedAt).add(body.value);
}

/** A library: two set songs, two other items, one card each, all reviewed once. */
function library() {
  const w = writer();
  for (const id of ['set1', 'set2', 'other1', 'other2']) w.add(item(id), card(`c-${id}`, id));
  return w;
}

// ------------------------------------------------------------- intake ----

test('intake produces a valid goal with sensible defaults', () => {
  const w = writer();
  const r = goalFromIntake({ what: 'Learn the fretboard', why: 'Speed', deadline: '2027-03-01', itemIds: ['i1'], dailyMinutes: 15 }, 'g1', w.lib, at9('2026-10-30'));
  assert.ok(r.ok);
  const goal = (r.value as Extract<EventBody, { type: 'goal-set' }>).goal;
  assert.equal(goal.kind, 'general');
  assert.equal(goal.weight, 1);
  assert.equal(goal.archived, false);
  assert.deepEqual(goal.blocks, []);
});

test('intake refuses a past deadline and bad values', () => {
  const lib = writer().lib;
  const now = at9('2026-10-30');
  assert.equal(goalFromIntake(gigIntake({ deadline: '2026-10-29' }), 'g', lib, now).ok, false);
  assert.ok(goalFromIntake(gigIntake({ deadline: '2026-10-30' }), 'g', lib, now).ok, 'today is fine');
  assert.equal(goalFromIntake(gigIntake({ dailyMinutes: -5 }), 'g', lib, now).ok, false);
  assert.equal(goalFromIntake(gigIntake({ what: '' }), 'g', lib, now).ok, false);
});

// ------------------------------------------------- active and expiry -----

test('a goal is active through its deadline day and expires at the next 3am', () => {
  const w = withGig(library());
  const gigNight = dayBegins('2026-12-04', NY) + 20 * H; // 11pm on gig day
  const nextDay = dayBegins('2026-12-05', NY);
  assert.equal(planGoals(w.lib, gigNight).active.length, 1);
  assert.equal(planGoals(w.lib, nextDay - 1).active.length, 1, '2:59am still counts as gig day');
  const after = planGoals(w.lib, nextDay);
  assert.equal(after.active.length, 0);
  assert.equal(after.retentionFor('c-set1'), 0.9);
  assert.equal(after.blocks.length, 0);
});

test('an archived goal has no effect', () => {
  const w = withGig(library());
  const g = w.lib.goals.get('gig')!;
  w.at(at9('2026-11-01')).add({ type: 'goal-set', goal: { ...g, archived: true } });
  assert.equal(planGoals(w.lib, at9('2026-11-02')).active.length, 0);
});

// ----------------------------------------------- retention and order -----

test('gig material gets 95% retention by default; everything else keeps the setting', () => {
  const plan = planGoals(withGig(library()).lib, at9('2026-11-01'));
  assert.equal(plan.retentionFor('c-set1'), GIG_DEFAULT_RETENTION);
  assert.equal(plan.retentionFor('c-other1'), 0.9);
  assert.equal(plan.retentionFor('no-such-card'), 0.9);
});

test("a goal's own target wins; overlapping goals take the higher target", () => {
  const w = withGig(library(), { targetRetention: 0.92 });
  const general = goalFromIntake({ what: 'Theory', why: 'x', deadline: '2027-01-01', itemIds: ['set1', 'other1'], dailyMinutes: 10, targetRetention: 0.97 }, 'g2', w.lib, at9('2026-10-30'));
  assert.ok(general.ok);
  w.add(general.value);
  const plan = planGoals(w.lib, at9('2026-11-01'));
  assert.equal(plan.retentionFor('c-set1'), 0.97);
  assert.equal(plan.retentionFor('c-set2'), 0.92);
  assert.equal(plan.retentionFor('c-other1'), 0.97);
});

test('goals never change memory state: only due dates move', () => {
  const w = library();
  let t = at9('2026-10-01');
  for (const id of ['set1', 'other1']) {
    w.rate(`c-${id}`, 'good', t).rate(`c-${id}`, 'good', t + 10 * 60_000).rate(`c-${id}`, 'good', t + 4 * DAY);
    t += H;
  }
  const before = canonical(w.log);
  const plain = w.lib;
  withGig(w);
  const plan = planGoals(w.lib, at9('2026-11-01'));
  for (const cardId of ['c-set1', 'c-other1']) {
    const a = memoryOf(cardId, plain.reviews.get(cardId)!, 0.9, NY);
    const b = memoryOf(cardId, w.lib.reviews.get(cardId)!, plan.retentionFor(cardId), NY);
    for (const k of ['phase', 'stability', 'difficulty', 'reps', 'lapses', 'lastReview'] as const) assert.equal(a[k], b[k], `${cardId} ${k}`);
  }
  assert.ok(canonical(w.log).startsWith(before.slice(0, -1)), 'planning appended nothing besides the goal itself');
});

test('goal material goes first among equally risky cards, and new goal cards are introduced first', () => {
  const w = library();
  const t = at9('2026-10-01');
  for (const id of ['other1', 'set1']) w.rate(`c-${id}`, 'easy', t); // identical histories
  w.add(item('set3'), card('c-new-other', 'other2'), card('c-new-set', 'set3'));
  withGig(w, { itemIds: ['set1', 'set2', 'set3'] });
  const now = at9('2026-11-20');
  const plain = buildQueue(w.lib, { now });
  const withGoals = goalQueue(w.lib, now);
  assert.deepEqual(plain.due.map((d) => d.memory.cardId).sort(), ['c-other1', 'c-set1']);
  assert.equal(withGoals.due[0]!.memory.cardId, 'c-set1');
  assert.ok(withGoals.fresh.indexOf('c-new-set') < withGoals.fresh.indexOf('c-new-other'));
});

// ---------------------------------------------------------- peaking -----

test('peaking guarantee: no set song drops below its gig target before the end of gig day', () => {
  // Set songs are scheduled at the gig's 95% target, so almost all are already
  // reviewed in time. Fuzz can stretch a few intervals past the gig; those are
  // pulled forward. This sweeps 600 realistic histories to prove both halves.
  const w = writer();
  const ids: string[] = [];
  for (let d = 0; d < 60; d++) {
    for (const h of [1, 5, 9, 14, 19]) {
      for (const g of ['good', 'easy'] as const) {
        const id = `s${d}-${h}-${g}`;
        ids.push(id);
        const start = dayBegins('2026-09-01', NY) + h * H + d * DAY;
        w.add(item(id), card(`c-${id}`, id));
        w.rate(`c-${id}`, 'easy', start).rate(`c-${id}`, g, start + 9 * DAY).rate(`c-${id}`, 'good', start + 30 * DAY);
      }
    }
  }
  w.add(item('o1'), card('c-o1', 'o1')).rate('c-o1', 'easy', at9('2026-10-01')).rate('c-o1', 'easy', at9('2026-10-20'));
  withGig(w, { itemIds: ids });
  const lib = w.lib;
  const today = at9('2026-11-30');
  const due = new Set(goalQueue(lib, today).due.map((d) => d.memory.cardId));
  const endOfGigDay = dayBegins('2026-12-05', NY);
  let pulled = 0;
  for (const id of ids) {
    const m = memoryOf(`c-${id}`, lib.reviews.get(`c-${id}`)!, GIG_DEFAULT_RETENTION, NY);
    const comesUpInTime = m.due! < endOfGigDay;
    const holdsUp = retrievability(m, endOfGigDay)! >= GIG_DEFAULT_RETENTION;
    if (!comesUpInTime && !holdsUp) {
      pulled++;
      assert.ok(due.has(`c-${id}`), `c-${id} should be pulled forward`);
    }
    if (!comesUpInTime && holdsUp) assert.ok(!due.has(`c-${id}`), `c-${id} should not be pulled`);
  }
  assert.ok(pulled > 0, 'the sweep should include songs that need pulling');
  assert.ok(!due.has('c-o1'), 'non-gig material is never pulled');
});

test('a pulled-forward song is not pulled again the same practice day', () => {
  // Find a history that needs pulling (same sweep as above), then review it.
  const endOfGigDay = dayBegins('2026-12-05', NY);
  let start = 0;
  for (let d = 0; d < 60 && start === 0; d++) {
    for (const h of [1, 5, 9, 14, 19]) {
      const s0 = dayBegins('2026-09-01', NY) + h * H + d * DAY;
      const hist = (['easy', 'good', 'good'] as const).map((rating, i) => ({
        v: 1 as const, id: `r${i}`, at: s0 + [0, 9, 30][i]! * DAY, device: 'd', type: 'review' as const, cardId: 'c-s', rating, durationMs: 1,
      }));
      const m = memoryOf('c-s', hist, GIG_DEFAULT_RETENTION, NY);
      if (m.due! >= endOfGigDay && retrievability(m, endOfGigDay)! < GIG_DEFAULT_RETENTION) {
        start = s0;
        break;
      }
    }
  }
  assert.ok(start > 0, 'found a song that needs pulling');
  const w = writer().add(item('s'), card('c-s', 's'));
  w.rate('c-s', 'easy', start).rate('c-s', 'good', start + 9 * DAY).rate('c-s', 'good', start + 30 * DAY);
  withGig(w, { itemIds: ['s'] });
  const day = at9('2026-11-30');
  assert.ok(goalQueue(w.lib, day).due.some((d) => d.memory.cardId === 'c-s'), 'pulled forward');
  w.rate('c-s', 'good', day + H);
  assert.ok(!goalQueue(w.lib, day + 2 * H).due.some((d) => d.memory.cardId === 'c-s'), 'not again today');

  // The same song under a general (non-gig) goal is never pulled forward.
  const g2 = writer().add(item('s'), card('c-s', 's'));
  g2.rate('c-s', 'easy', start).rate('c-s', 'good', start + 9 * DAY).rate('c-s', 'good', start + 30 * DAY);
  withGig(g2, { kind: 'general', targetRetention: GIG_DEFAULT_RETENTION, itemIds: ['s'] });
  assert.ok(!goalQueue(g2.lib, day).due.some((d) => d.memory.cardId === 'c-s'), 'general goals do not peak');
});

// ----------------------------------------------------- blocks and time ---

test('blocks scale to the goal\'s daily minutes; reserved kinds wait and give their time to the rest', () => {
  const blocks = [
    { id: 'b1', kind: 'recall' as const, label: 'Set songs', minutes: 15 },
    { id: 'b2', kind: 'feel-session' as const, label: 'Guitar yoga', minutes: 10 },
    { id: 'b3', kind: 'gig-memo' as const, label: 'Post-gig memo', minutes: 5 },
  ];
  const plan = planGoals(withGig(library(), { blocks, dailyMinutes: 30 }).lib, at9('2026-11-01'));
  assert.deepEqual(plan.blocks.map((b) => [b.blockId, b.minutes, b.protected]), [['b1', 18, false], ['b2', 12, true]]);
});

test('improv takes and songwriting prompts are runnable now (recorder, 2026-10-31): they keep their time and their params', () => {
  const blocks = [
    { id: 'b1', kind: 'recall' as const, label: 'Set songs', minutes: 15 },
    { id: 'b2', kind: 'improv-takes' as const, label: 'Improv takes', minutes: 5, params: { takes: 5, minutes: 1 } },
    { id: 'b3', kind: 'creative-prompt' as const, label: 'Songwriting prompt', minutes: 10, params: { takes: 1, minutes: 10 } },
  ];
  const plan = planGoals(withGig(library(), { blocks, dailyMinutes: 30 }).lib, at9('2026-11-01'));
  assert.deepEqual(plan.blocks.map((b) => [b.blockId, b.kind, b.minutes]), [['b1', 'recall', 15], ['b2', 'improv-takes', 5], ['b3', 'creative-prompt', 10]]);
  assert.deepEqual(plan.blocks[1]!.params, { takes: 5, minutes: 1 });
  assert.equal(plan.blocks[1]!.daysLeft, 33, 'days to the 2026-12-04 deadline');
});

test('planned blocks carry their params to the module (the tempo ladder button needed this)', () => {
  const ladder = { cardId: 'mx-free-c', startBpm: 60, targetBpm: 90, stepBpm: 5, cleanReps: 2, repBars: 4 };
  const blocks = [{ id: 'lad', kind: 'tempo-ladder' as const, label: 'Ladder', minutes: 10, params: ladder }];
  const plan = planGoals(withGig(library(), { blocks, dailyMinutes: 10 }).lib, at9('2026-11-01'));
  assert.deepEqual(plan.blocks[0]!.params, ladder);
  assert.deepEqual(splitTime(plan.blocks, 60)[0]!.params, ladder, 'and keep them through the time split');
});

test('a goal with no blocks gets one recall block for its whole daily time', () => {
  const plan = planGoals(withGig(library()).lib, at9('2026-11-01'));
  assert.deepEqual(plan.blocks.map((b) => [b.blockId, b.kind, b.minutes]), [['recall', 'recall', 30]]);
});

test("a gig's final week turns recall time into full set run-throughs", () => {
  const lib = withGig(library()).lib;
  const eightDaysOut = planGoals(lib, at9(addDays('2026-12-04', -7)));
  const sixDaysOut = planGoals(lib, at9(addDays('2026-12-04', -6)));
  const gigDay = planGoals(lib, at9('2026-12-04'));
  assert.equal(eightDaysOut.blocks[0]!.kind, 'recall');
  assert.equal(sixDaysOut.blocks[0]!.label, 'Full set run-through');
  assert.equal(sixDaysOut.blocks[0]!.kind, 'timed-task');
  assert.equal(sixDaysOut.blocks[0]!.minutes, 30);
  assert.equal(gigDay.blocks[0]!.label, 'Full set run-through');
});

const block = (goalId: string, minutes: number, weight: number, isProtected = false): PlannedBlock => ({
  goalId,
  blockId: `${goalId}-b`,
  kind: isProtected ? 'feel-session' : 'recall',
  label: goalId,
  minutes,
  weight,
  daysLeft: 10,
  protected: isProtected,
});

test('splitTime: everything fits, nothing changes', () => {
  const out = splitTime([block('a', 20, 1), block('b', 10, 3)], 60);
  assert.deepEqual(out.map((b) => b.minutes), [20, 10]);
});

test('splitTime: over budget, goals share by weight, capped at what they asked for', () => {
  // 60 minutes for requests of 40 (weight 1), 40 (weight 3) and 5 (weight 1):
  // c is met in full, b hits its 40 cap, a gets the remaining 15.
  const out = splitTime([block('a', 40, 1), block('b', 40, 3), block('c', 5, 1)], 60);
  assert.deepEqual(out.map((b) => [b.goalId, b.minutes]), [['a', 15], ['b', 40], ['c', 5]]);
  // Uncapped: 30 minutes split 1:3.
  const even = splitTime([block('a', 40, 1), block('b', 40, 3)], 32);
  assert.deepEqual(even.map((b) => b.minutes), [8, 24]);
});

test('splitTime: guitar yoga is protected; if even it does not fit, only it is shrunk', () => {
  const yoga = block('yoga', 15, 1, true);
  const out = splitTime([block('a', 50, 5), yoga], 30);
  assert.deepEqual(out.map((b) => [b.goalId, b.minutes]), [['a', 15], ['yoga', 15]]);
  const tiny = splitTime([block('a', 50, 5), yoga], 10);
  assert.deepEqual(tiny.map((b) => [b.goalId, b.minutes]), [['yoga', 10]]);
});

test('splitTime and apportion always produce whole minutes that add up', () => {
  for (let budget = 0; budget <= 90; budget += 7) {
    const out = splitTime([block('a', 23, 1.5), block('b', 31, 2), block('c', 17, 0.7), block('y', 9, 1, true)], budget);
    const total = out.reduce((s, b) => s + b.minutes, 0);
    assert.equal(total, Math.min(budget, 80), `budget ${budget}`);
    for (const b of out) assert.ok(Number.isInteger(b.minutes) && b.minutes > 0);
  }
  assert.deepEqual(apportion([1, 1, 1], 10), [4, 3, 3]);
  assert.deepEqual(apportion([0, 0], 10), [0, 0]);
  assert.throws(() => splitTime([], -1), RangeError);
});

// ---------------------------------------------------------- check-ins ---

test('check-ins come due at 14, 7 and 2 days out, and re-saving the goal clears each one', () => {
  const w = withGig(library(), {}, at9('2026-10-30'));
  const lib = () => w.lib;
  assert.deepEqual(planGoals(lib(), at9('2026-11-19')).checkIns, []); // 15 days out
  assert.deepEqual(planGoals(lib(), at9('2026-11-20')).checkIns, [{ goalId: 'gig', daysLeft: 14 }]);
  // Blake adjusts daily time at the check-in.
  const g = lib().goals.get('gig')!;
  w.at(at9('2026-11-20')).add({ type: 'goal-set', goal: { ...g, dailyMinutes: 45 } });
  assert.deepEqual(planGoals(lib(), at9('2026-11-21')).checkIns, []);
  assert.deepEqual(planGoals(lib(), at9('2026-11-27')).checkIns, [{ goalId: 'gig', daysLeft: 7 }]);
  w.at(at9('2026-11-27')).add({ type: 'goal-set', goal: { ...g, dailyMinutes: 45 } });
  assert.deepEqual(planGoals(lib(), at9('2026-12-01')).checkIns, []);
  assert.deepEqual(planGoals(lib(), at9('2026-12-02')).checkIns, [{ goalId: 'gig', daysLeft: 2 }]);
});

test('a goal created 5 days out waits for the 2-day check-in only', () => {
  const w = withGig(library(), {}, at9('2026-11-29'));
  assert.deepEqual(planGoals(w.lib, at9('2026-11-30')).checkIns, []);
  assert.deepEqual(planGoals(w.lib, at9('2026-12-02')).checkIns, [{ goalId: 'gig', daysLeft: 2 }]);
});

// ------------------------------------------------- done means (spec) -----

test('done means: a gig goal created through the intake visibly reshapes the queue and the time split', () => {
  const w = library();
  const t = at9('2026-10-01');
  // Comparable histories; the other material was reviewed two days earlier, so
  // it is slightly riskier and comes first without a goal.
  for (const id of ['other1', 'other2']) w.rate(`c-${id}`, 'easy', t).rate(`c-${id}`, 'good', t + 8 * DAY);
  for (const id of ['set1', 'set2']) w.rate(`c-${id}`, 'easy', t + 2 * DAY).rate(`c-${id}`, 'good', t + 10 * DAY);
  const now = at9('2026-11-28');
  const before = buildQueue(w.lib, { now }).due.map((d) => d.memory.cardId);
  const planBefore = planGoals(w.lib, now);

  withGig(w);
  const after = goalQueue(w.lib, now).due.map((d) => d.memory.cardId);
  const planAfter = planGoals(w.lib, now);

  assert.deepEqual(before.slice(0, 2).sort(), ['c-other1', 'c-other2']);
  assert.deepEqual(after.slice(0, 2).sort(), ['c-set1', 'c-set2']);
  assert.deepEqual(planBefore.blocks, []);
  assert.deepEqual(planAfter.blocks.map((b) => [b.label, b.minutes]), [['Full set run-through', 30]]);
});
