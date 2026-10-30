import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as engine from '../src/index.ts';
import { append, canonical, emptyLog, merge, RejectedEvent, replay } from '../src/index.ts';
import type { EngineEvent } from '../src/index.ts';
import { card, device, item, record, review, shuffle } from './helpers.ts';

test('append returns a new log and never mutates the old one', () => {
  const phone = device('phone');
  const before = record(phone, [item('i1'), card('c1', 'i1')]);
  const snapshot = canonical(before);
  const { log: after, event } = append(before, review('c1'), phone);
  assert.equal(canonical(before), snapshot);
  assert.equal(before.length, 2);
  assert.equal(after.length, 3);
  assert.equal(after.at(-1), event);
});

test('events and the log are frozen: history cannot be edited in memory', () => {
  const log = record(device('phone'), [item('i1', { note: 'A' }), card('c1', 'i1'), review('c1')]);
  const ev = log[2] as Extract<EngineEvent, { type: 'review' }>;
  assert.throws(() => {
    (ev as { rating: string }).rating = 'easy';
  }, TypeError);
  assert.throws(() => {
    ((log[0] as Extract<EngineEvent, { type: 'item-set' }>).item.fields as Record<string, string>).note = 'B';
  }, TypeError);
  assert.throws(() => (log as EngineEvent[]).pop(), TypeError);
  assert.throws(() => (log as EngineEvent[]).splice(0, 1), TypeError);
});

test('invalid appends throw and leave the log unchanged', () => {
  const phone = device('phone');
  const log = record(phone, [item('i1')]);
  assert.throws(() => append(log, { type: 'review', cardId: 'c1', rating: 'meh', durationMs: 1 }, phone), RejectedEvent);
  assert.throws(() => append(log, review('c1'), { ...phone, now: () => Number.NaN }), RejectedEvent);
  assert.throws(() => append(log, review('c1'), { ...phone, device: '' }), RejectedEvent);
  assert.throws(() => append(log, review('c1'), { ...phone, newId: () => log[0]!.id }), /duplicate id/);
  assert.equal(log.length, 1);
});

test('callers cannot set id, time or device: append stamps them', () => {
  const phone = device('phone');
  assert.throws(() => append(emptyLog(), { ...review('c1'), id: 'forged' }, phone), RejectedEvent);
  assert.throws(() => append(emptyLog(), { ...review('c1'), at: 1 }, phone), RejectedEvent);
});

test('the engine exposes no way to edit or delete events', () => {
  const names = Object.keys(engine).map((k) => k.toLowerCase());
  for (const banned of ['update', 'delete', 'remove', 'edit', 'set', 'clear', 'truncate']) {
    assert.ok(!names.some((n) => n === banned || n.startsWith(banned)), `found ${banned}*`);
  }
});

function twoDevices() {
  const phone = record(device('phone', Date.UTC(2026, 9, 30, 12)), [
    item('i1'),
    card('c1', 'i1'),
    review('c1'),
    review('c1', 'again'),
  ]);
  const laptop = record(device('laptop', Date.UTC(2026, 9, 30, 12, 0, 1, 500)), [
    item('i2'),
    card('c2', 'i2'),
    review('c2', 'easy'),
    review('c1', 'hard'),
  ]);
  return { phone, laptop };
}

test('replay is deterministic regardless of arrival order', () => {
  const { phone, laptop } = twoDevices();
  const all = [...phone, ...laptop];
  const reference = canonical(merge(emptyLog(), all).log);
  for (let seed = 1; seed <= 20; seed++) {
    const shuffled = merge(emptyLog(), shuffle(all, seed)).log;
    assert.equal(canonical(shuffled), reference);
    const order = replay(shuffled, (acc: string[], e) => [...acc, e.id], []);
    assert.deepEqual(order, JSON.parse(reference).map((e: EngineEvent) => e.id));
  }
});

test('merge is commutative, idempotent and collapses duplicates', () => {
  const { phone, laptop } = twoDevices();
  const ab = merge(phone, laptop).log;
  const ba = merge(laptop, phone).log;
  assert.equal(canonical(ab), canonical(ba));
  assert.equal(ab.length, 8);
  const again = merge(ab, [...phone, ...laptop, ...phone]);
  assert.equal(canonical(again.log), canonical(ab));
  assert.equal(again.rejected.length, 0);
});

test('merge rejects and reports invalid remote events without storing them', () => {
  const { phone } = twoDevices();
  const junk = [
    null,
    'review',
    { v: 1, id: 'x1', at: Date.UTC(2026, 9, 30), device: 'evil', type: 'review', cardId: 'c1', rating: 'perfect', durationMs: 1 },
    { v: 9, id: 'x2', at: Date.UTC(2026, 9, 30), device: 'evil', type: 'played', minutes: 5 },
  ];
  const { log, rejected } = merge(phone, junk);
  assert.equal(canonical(log), canonical(phone));
  assert.equal(rejected.length, junk.length);
});

test('merge never replaces a stored event, even on an id conflict', () => {
  const at = Date.UTC(2026, 9, 30, 13);
  // b sorts before a canonically, so a "pick the smaller" rule would swap it in.
  const a = { v: 1, id: 'same', at, device: 'phone', type: 'played', minutes: 20 };
  const b = { v: 1, id: 'same', at, device: 'laptop', type: 'played', minutes: 10 };
  const stored = merge(emptyLog(), [a]).log;
  const { log, rejected } = merge(stored, [b]);
  assert.equal(log[0], stored[0]);
  assert.equal(log.length, 1);
  assert.equal(rejected.length, 1);
  assert.match(rejected[0]!.reason, /id conflict/);
});

test('merged events are frozen too', () => {
  const remote = { v: 1, id: 'r1', at: Date.UTC(2026, 9, 30), device: 'laptop', type: 'played', minutes: 10 };
  const { log } = merge(emptyLog(), [remote]);
  assert.throws(() => {
    (log[0] as { minutes: number }).minutes = 99;
  }, TypeError);
  remote.minutes = 99; // mutating the caller's copy afterwards must not leak in
  assert.equal((log[0] as { minutes: number }).minutes, 10);
});
