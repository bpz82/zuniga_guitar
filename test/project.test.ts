import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cardsOfItem, DEFAULT_SETTINGS, merge, project } from '../src/index.ts';
import { card, device, gigGoal, item, record, review } from './helpers.ts';

test('empty log gives an empty library with default settings', () => {
  const lib = project([]);
  assert.equal(lib.items.size, 0);
  assert.equal(lib.settings, DEFAULT_SETTINGS);
  assert.equal(lib.settings.desiredRetention, 0.9);
});

test('latest -set event wins; earlier versions stay in the log', () => {
  const log = record(device('phone'), [item('i1', { note: 'A' }), item('i1', { note: 'A#' })]);
  const lib = project(log);
  assert.equal(lib.items.get('i1')?.fields.note, 'A#');
  assert.equal(log.length, 2);
});

test('across devices, the later edit wins by time, not by device or id', () => {
  // The laptop's ids sort before the phone's, but its edit happens later.
  const phone = record(device('zz-phone', Date.UTC(2026, 9, 30, 12)), [item('i1', { note: 'A' })]);
  const laptop = record(device('aa-laptop', Date.UTC(2026, 9, 30, 13)), [item('i1', { note: 'Bb' })]);
  for (const [x, y] of [[phone, laptop], [laptop, phone]] as const) {
    const lib = project(merge(x, y).log);
    assert.equal(lib.items.get('i1')?.fields.note, 'Bb');
  }
});

test('retiring a card keeps its review history', () => {
  const log = record(device('phone'), [item('i1'), card('c1', 'i1'), review('c1'), review('c1', 'again'), card('c1', 'i1', true)]);
  const lib = project(log);
  assert.equal(lib.cards.get('c1')?.retired, true);
  assert.deepEqual(lib.reviews.get('c1')?.map((r) => r.rating), ['good', 'again']);
});

test('reviews are grouped per card in time order', () => {
  const log = record(device('phone'), [review('c1', 'again'), review('c2'), review('c1', 'easy')]);
  const lib = project(log);
  assert.deepEqual(lib.reviews.get('c1')?.map((r) => r.rating), ['again', 'easy']);
  assert.equal(lib.reviews.get('c2')?.length, 1);
});

test('goals, settings and ungraded activity are projected', () => {
  const log = record(device('phone'), [
    gigGoal('g1'),
    { type: 'settings-set', settings: { desiredRetention: 0.85, windows: [{ id: 'morning', start: '06:00' }] } },
    { type: 'feel-session', durationMs: 600_000, note: 'Relaxed' },
    { type: 'played', minutes: 20 },
  ]);
  const lib = project(log);
  assert.equal(lib.goals.get('g1')?.kind, 'gig');
  assert.equal(lib.settings.desiredRetention, 0.85);
  assert.deepEqual(lib.activity.map((a) => a.type), ['feel-session', 'played']);
});

test('sibling cards are linked through their item', () => {
  const log = record(device('phone'), [item('i1'), card('c1', 'i1'), card('c2', 'i1'), item('i2'), card('c3', 'i2')]);
  assert.deepEqual(cardsOfItem(project(log), 'i1').map((c) => c.id), ['c1', 'c2']);
});
