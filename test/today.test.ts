/** Home's objectives (2026-11-02, 2026-11-03): which goal leads, how its deadline reads, how blocks group, the bullets. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { append, dayBegins, emptyLog, project } from '../src/index.ts';
import type { BlockSegment, EventBody, Log } from '../src/index.ts';
import { blocksForFocus, focusGoal, goalWhen, homeObjectives } from '../harness/home/today.ts';
import { BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

let n = 0;
const ctx = { device: 'phone', now: () => Date.UTC(2026, 10, 2, 12) + n * 1000, newId: () => `e${++n}` };
const goal = (id: string, deadline: string, extra: Record<string, unknown> = {}): EventBody =>
  ({ type: 'goal-set', goal: { id, kind: 'general', what: `Goal ${id}`, why: '', deadline, itemIds: [], dailyMinutes: 10, weight: 1, blocks: [], archived: false, ...extra } }) as EventBody;
const lib = (...bodies: EventBody[]) => project(bodies.reduce((log: Log, b) => append(log, b, ctx).log, emptyLog()));

test('the goal on top is the live goal with the nearest deadline', () => {
  const l = lib(goal('record', '2027-03-01'), goal('gig', '2026-11-13', { kind: 'gig' }), goal('old', '2026-10-01'), goal('shelved', '2026-11-05', { archived: true }));
  const f = focusGoal(l, '2026-11-02')!;
  assert.equal(f.goal.id, 'gig');
  assert.equal(f.others, 1, 'past and archived goals do not count');
  assert.equal(focusGoal(lib(), '2026-11-02'), null);
  assert.equal(focusGoal(lib(goal('old', '2026-10-01')), '2026-11-02'), null);
});

test('ties: the heavier goal, then a stable order', () => {
  const l = lib(goal('b', '2026-12-01', { weight: 1 }), goal('a', '2026-12-01', { weight: 3 }));
  assert.equal(focusGoal(l, '2026-11-02')!.goal.id, 'a');
  const m = lib(goal('b', '2026-12-01'), goal('a', '2026-12-01'));
  assert.equal(focusGoal(m, '2026-11-02')!.goal.id, 'a');
});

test('the deadline reads as a date and a countdown', () => {
  const l = lib(goal('gig', '2026-11-13', { kind: 'gig' }), goal('rec', '2027-03-01'));
  assert.equal(goalWhen(l.goals.get('gig')!, '2026-11-02'), 'Gig Fri 13 Nov · 11 days to go');
  assert.equal(goalWhen(l.goals.get('gig')!, '2026-11-12'), 'Gig Fri 13 Nov · tomorrow');
  assert.equal(goalWhen(l.goals.get('gig')!, '2026-11-13'), 'Gig Fri 13 Nov · today');
  assert.equal(goalWhen(l.goals.get('rec')!, '2026-11-02'), 'Due Mon 1 Mar · 119 days to go');
});

test("today's blocks: the focus goal's first, the rest after, each marked", () => {
  const seg = (goalId: string, blockId: string): BlockSegment => ({ kind: 'block', done: false, block: { goalId, blockId, kind: 'timed-task', label: blockId, minutes: 5, weight: 1, protected: false, daysLeft: 3 } });
  const rows = blocksForFocus([seg('x', 'x1'), seg('f', 'f1'), seg('x', 'x2'), seg('f', 'f2')], 'f');
  assert.deepEqual(rows.map((r) => [r.seg.block.blockId, r.focus]), [['f1', true], ['f2', true], ['x1', false], ['x2', false]]);
  assert.deepEqual(blocksForFocus([seg('x', 'x1')], null).map((r) => r.focus), [false]);
});

test("Home's objectives: the goal's blocks first, its songs in the session, the rest of the deck, other goals' blocks, the Teach lesson", () => {
  const blocks = [
    { id: 'b1', kind: 'timed-task', label: '15 min on the set opener', minutes: 15 },
    { id: 'b2', kind: 'feel-session', label: 'Guitar yoga', minutes: 10 },
  ];
  const song = (k: string): EventBody[] => [
    { type: 'item-set', item: { id: `song-${k}`, module: 'songs', fields: { title: k } } },
    { type: 'card-set', card: { id: `song-${k}-c`, itemId: `song-${k}`, template: 'song', tags: ['guitar'], retired: false } },
  ];
  const l = lib(
    BLAKE_SETTINGS_EVENT,
    ...song('a'), ...song('b'), ...song('c'),
    goal('gig', '2026-11-20', { kind: 'gig', what: 'Bluebird gig', itemIds: ['song-a', 'song-b'], dailyMinutes: 25, blocks }),
    goal('rec', '2027-03-01', { what: 'New record', dailyMinutes: 10, blocks: [{ id: 'w', kind: 'timed-task', label: 'Write', minutes: 10 }] }),
  );
  const morning = dayBegins('2026-11-03', l.settings.dayStart) + 60 * 60 * 1000; // 4am New York: the morning guitar session
  const items = homeObjectives(l, morning, 'Lesson 1 · What sound is');
  assert.deepEqual(items.map((o) => o.kind), ['block', 'block', 'songs', 'deck', 'block', 'lesson']);
  assert.match(items[0]!.text, /^15 min on the set opener · \d+ min$/);
  assert.equal(items[2]!.text, 'Play 2 songs for Bluebird gig');
  assert.equal(items[3]!.text, "Today's deck: 0 due, 1 new", 'the third song, not counted twice');
  assert.match(items[4]!.text, /^Write · \d+ min · for New record$/);
  assert.equal(items[5]!.text, 'On Teach: Lesson 1 · What sound is (swipe left)');
});

test("Home's objectives with no goal and nothing due say so", () => {
  const l = lib(BLAKE_SETTINGS_EVENT);
  const items = homeObjectives(l, dayBegins('2026-11-03', l.settings.dayStart) + 3600_000, null);
  assert.deepEqual(items.map((o) => o.kind), ['none']);
});
