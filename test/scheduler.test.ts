import { test } from 'node:test';
import assert from 'node:assert/strict';
import { append, buildQueue, emptyLog, LEECH_LAPSES, memoryOf, project, retrievability } from '../src/index.ts';
import type { EventBody, EventOf, Log, Rating } from '../src/index.ts';
import { card, item, shuffle } from './helpers.ts';

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = Date.UTC(2026, 9, 1, 8);

/** A log writer with a clock the test controls. */
function writer(device = 'phone') {
  let clock = T0;
  let n = 0;
  let log: Log = emptyLog();
  const ctx = { device, now: () => clock, newId: () => `${device}-${String(++n).padStart(5, '0')}` };
  return {
    at(ms: number) {
      clock = ms;
      return this;
    },
    add(...bodies: EventBody[]) {
      for (const b of bodies) log = append(log, b, ctx).log;
      return this;
    },
    rate(cardId: string, rating: Rating, at: number) {
      return this.at(at).add({ type: 'review', cardId, rating, durationMs: 3000 });
    },
    get log() {
      return log;
    },
  };
}

function reviews(cardId: string, seq: [Rating, number][]): EventOf<'review'>[] {
  return seq.map(([rating, at], i) => ({ v: 1, id: `r${i}`, at, device: 'd', type: 'review', cardId, rating, durationMs: 1 }));
}

// ------------------------------------------------------------ state ------

test('a card with no reviews is new', () => {
  const m = memoryOf('c', [], 0.9);
  assert.equal(m.phase, 'new');
  assert.equal(m.due, null);
  assert.equal(retrievability(m, T0), null);
});

test('learning steps: Good on a new card waits 10 minutes, then graduates', () => {
  const first = memoryOf('c', reviews('c', [['good', T0]]), 0.9);
  assert.equal(first.phase, 'learning');
  assert.equal(first.due, T0 + 10 * MIN);
  const second = memoryOf('c', reviews('c', [['good', T0], ['good', T0 + 10 * MIN]]), 0.9);
  assert.equal(second.phase, 'review');
  assert.ok(second.due! >= T0 + DAY);
});

test('Again on a new card repeats after 1 minute; Easy skips learning', () => {
  assert.equal(memoryOf('c', reviews('c', [['again', T0]]), 0.9).due, T0 + MIN);
  const easy = memoryOf('c', reviews('c', [['easy', T0]]), 0.9);
  assert.equal(easy.phase, 'review');
  assert.ok(easy.due! - T0 >= DAY);
});

test('a lapse moves a review card to relearning with a 10 minute step', () => {
  const m = memoryOf('c', reviews('c', [['easy', T0], ['again', T0 + 5 * DAY]]), 0.9);
  assert.equal(m.phase, 'relearning');
  assert.equal(m.lapses, 1);
  assert.equal(m.due, T0 + 5 * DAY + 10 * MIN);
});

test('stability grows with successful reviews and recall decays with time', () => {
  const a = memoryOf('c', reviews('c', [['easy', T0]]), 0.9);
  const b = memoryOf('c', reviews('c', [['easy', T0], ['good', T0 + 8 * DAY]]), 0.9);
  assert.ok(b.stability > a.stability);
  const soon = retrievability(b, b.lastReview! + DAY)!;
  const later = retrievability(b, b.lastReview! + 60 * DAY)!;
  assert.ok(soon > later && soon <= 1 && later > 0);
  // At the scheduled due date, recall is close to the 90% target.
  assert.ok(Math.abs(retrievability(b, b.due!)! - 0.9) < 0.05);
});

// ---------------------------------------- goals never change memory ------

test('retention changes when a card is due, never its memory state', () => {
  const seq = reviews('c', [['good', T0], ['good', T0 + 10 * MIN], ['good', T0 + 3 * DAY], ['again', T0 + 20 * DAY], ['good', T0 + 20 * DAY + 10 * MIN], ['hard', T0 + 30 * DAY]]);
  const relaxed = memoryOf('c', seq, 0.8);
  const strict = memoryOf('c', seq, 0.95);
  for (const k of ['phase', 'stability', 'difficulty', 'reps', 'lapses', 'lastReview', 'leech'] as const) {
    assert.equal(relaxed[k], strict[k], k);
  }
  assert.ok(strict.due! < relaxed.due!, 'higher retention means sooner review');
});

test('out-of-range retention is refused', () => {
  assert.throws(() => memoryOf('c', [], 0.5), RangeError);
  assert.throws(() => memoryOf('c', [], 1), RangeError);
});

// ---------------------------------------------------- fuzz, determinism --

test('memory is identical on every replay, including fuzzed due dates', () => {
  const seq = reviews('c', [['easy', T0], ['good', T0 + 9 * DAY], ['good', T0 + 40 * DAY]]);
  const first = memoryOf('c', seq, 0.9);
  for (let i = 0; i < 5; i++) assert.deepEqual(memoryOf('c', seq, 0.9), first);
});

test('fuzz is on: identical histories a few minutes apart do not all land on the same day', () => {
  const days = new Set<number>();
  for (let i = 0; i < 30; i++) {
    const start = T0 + i * 7 * MIN;
    const m = memoryOf('c', reviews('c', [['easy', start], ['good', start + 9 * DAY], ['good', start + 40 * DAY]]), 0.9);
    days.add(Math.round((m.due! - m.lastReview!) / DAY));
  }
  assert.ok(days.size > 1, `all landed ${[...days]} days out`);
});

// ------------------------------------------------------------ leeches ----

test(`${LEECH_LAPSES} lapses flags a leech; it stays scheduled, never suspended`, () => {
  const w = writer().add(item('i1'), card('c1', 'i1'));
  let t = T0;
  w.rate('c1', 'easy', t);
  for (let lapse = 1; lapse <= LEECH_LAPSES; lapse++) {
    t += 3 * DAY;
    w.rate('c1', 'again', t);
    t += 10 * MIN;
    w.rate('c1', 'good', t);
    const m = memoryOf('c1', project(w.log).reviews.get('c1')!, 0.9);
    assert.equal(m.lapses, lapse);
    assert.equal(m.leech, lapse >= LEECH_LAPSES);
  }
  const q = buildQueue(project(w.log), { now: t + 365 * DAY });
  assert.deepEqual(q.leeches, ['c1']);
  assert.deepEqual(q.due.map((d) => d.memory.cardId), ['c1']);
});

// -------------------------------------------------------------- queue ----

test('queue: new cards in added order, retired and unknown cards left out, future cards not due', () => {
  const w = writer()
    .add(item('i1'), card('n2', 'i1'), card('n1', 'i1'), card('due', 'i1'), card('later', 'i1'), card('gone', 'i1'))
    .rate('due', 'easy', T0)
    .rate('later', 'easy', T0 + 29 * DAY)
    .rate('gone', 'easy', T0)
    .add(card('gone', 'i1', true))
    .rate('ghost', 'easy', T0);
  const q = buildQueue(project(w.log), { now: T0 + 30 * DAY });
  assert.deepEqual(q.fresh, ['n2', 'n1']);
  assert.deepEqual(q.due.map((d) => d.memory.cardId), ['due']);
});

test('queue: (re)learning steps come first, then reviews riskiest first', () => {
  const w = writer().add(item('i1'), card('step', 'i1'), card('weak', 'i1'), card('strong', 'i1'));
  w.rate('weak', 'good', T0).rate('weak', 'good', T0 + 10 * MIN); // graduated, low stability
  w.rate('strong', 'easy', T0).rate('strong', 'easy', T0 + 15 * DAY); // high stability
  const now = T0 + 120 * DAY;
  w.rate('step', 'again', now - 5 * MIN);
  const q = buildQueue(project(w.log), { now });
  assert.deepEqual(q.due.map((d) => d.memory.cardId), ['step', 'weak', 'strong']);
  assert.ok(q.due[1]!.retrievability < q.due[2]!.retrievability);
});

test('queue: weights reorder reviews; bad weights are refused', () => {
  const w = writer().add(item('i1'), card('weak', 'i1'), card('strong', 'i1'));
  w.rate('weak', 'good', T0).rate('weak', 'good', T0 + 10 * MIN);
  w.rate('strong', 'easy', T0).rate('strong', 'easy', T0 + 15 * DAY);
  const lib = project(w.log);
  const now = T0 + 120 * DAY;
  const boosted = buildQueue(lib, { now, weightFor: (id) => (id === 'strong' ? 50 : 1) });
  assert.deepEqual(boosted.due.map((d) => d.memory.cardId), ['strong', 'weak']);
  assert.throws(() => buildQueue(lib, { now, weightFor: () => 0 }), RangeError);
  assert.throws(() => buildQueue(lib, { now, weightFor: () => Number.NaN }), RangeError);
});

test('queue: per-card retention from goals changes what is due today', () => {
  const w = writer().add(item('i1'), card('c1', 'i1')).rate('c1', 'easy', T0).rate('c1', 'good', T0 + 8 * DAY);
  const lib = project(w.log);
  const relaxed = memoryOf('c1', lib.reviews.get('c1')!, 0.8);
  const strict = memoryOf('c1', lib.reviews.get('c1')!, 0.97);
  const between = Math.floor((strict.due! + relaxed.due!) / 2);
  assert.equal(buildQueue(lib, { now: between, retentionFor: () => 0.8 }).due.length, 0);
  assert.equal(buildQueue(lib, { now: between, retentionFor: () => 0.97 }).due.length, 1);
});

test('queue: same result however the log arrived (two devices, any merge order)', async () => {
  const { merge } = await import('../src/index.ts');
  const phone = writer('phone').add(item('i1'), card('a', 'i1'), card('b', 'i1')).rate('a', 'easy', T0).rate('b', 'hard', T0 + DAY);
  const laptop = writer('laptop').rate('a', 'good', T0 + 9 * DAY).rate('b', 'again', T0 + 10 * DAY);
  const all = [...phone.log, ...laptop.log];
  const now = T0 + 60 * DAY;
  const reference = JSON.stringify(buildQueue(project(merge(phone.log, laptop.log).log), { now }));
  for (let seed = 1; seed <= 10; seed++) {
    const log = merge(emptyLog(), shuffle(all, seed)).log;
    assert.equal(JSON.stringify(buildQueue(project(log), { now })), reference);
  }
});

// ---------------------------------------------- return after a break -----

test('after a 6-week break the backlog clears riskiest-first and spreads across days under a daily cap', () => {
  const w = writer().add(item('i1'));
  const ids: string[] = [];
  for (let i = 0; i < 60; i++) {
    const id = `c${String(i).padStart(2, '0')}`;
    ids.push(id);
    w.add(card(id, 'i1'));
    // Varied histories so stability differs card to card.
    w.rate(id, i % 3 === 0 ? 'hard' : 'easy', T0 + i * MIN);
    if (i % 2 === 0) w.rate(id, 'good', T0 + 6 * DAY + i * MIN);
    if (i % 5 === 0) w.rate(id, 'easy', T0 + 14 * DAY + i * MIN);
  }
  const cap = 20;
  let now = T0 + 56 * DAY;
  const backlog = new Set(buildQueue(project(w.log), { now }).due.map((d) => d.memory.cardId));
  assert.ok(backlog.size > 40, `backlog ${backlog.size}`);

  let days = 0;
  while (true) {
    const q = buildQueue(project(w.log), { now });
    const stillOwed = q.due.filter((d) => backlog.has(d.memory.cardId));
    if (stillOwed.length === 0) break;
    const today = q.due.slice(0, cap);
    // Unfinished learning steps go first; the rest is riskiest-first.
    const phases = today.map((d) => d.memory.phase);
    const firstReview = phases.indexOf('review');
    assert.ok(firstReview === -1 || phases.slice(firstReview).every((p) => p === 'review'), `day ${days + 1}: steps after reviews`);
    const r = today.filter((d) => d.memory.phase === 'review').map((d) => d.retrievability);
    assert.deepEqual(r, [...r].sort((a, b) => a - b), `day ${days + 1} is not riskiest-first`);
    today.forEach((d, i) => w.rate(d.memory.cardId, 'good', now + i * MIN));
    for (const d of today) backlog.delete(d.memory.cardId);
    days++;
    now += DAY;
    assert.ok(days <= 5, 'backlog should clear within a few days');
  }
  assert.ok(days >= 3, `spread over ${days} days`);
});

test('pullForward: a review card can be pulled forward at most once per practice day', () => {
  const w = writer().add(item('i1'), card('c1', 'i1'), card('c2', 'i1'));
  w.rate('c1', 'easy', T0).rate('c2', 'easy', T0);
  const now = T0 + 2 * DAY; // neither is due yet
  w.rate('c2', 'good', now - 60 * MIN); // c2 already practiced today
  const always = () => true;
  const q = buildQueue(project(w.log), { now, pullForward: always });
  assert.deepEqual(q.due.map((d) => d.memory.cardId), ['c1']);
  assert.deepEqual(buildQueue(project(w.log), { now }).due, [], 'nothing due without the hook');
});
