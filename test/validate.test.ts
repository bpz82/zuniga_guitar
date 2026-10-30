import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBody, validateEvent } from '../src/index.ts';
import { card, gigGoal, item, review } from './helpers.ts';

const meta = { v: 1, id: 'e1', at: Date.UTC(2026, 9, 30), device: 'phone' };

test('accepts every valid event type', () => {
  const bodies = [
    item('i1'),
    card('c1', 'i1'),
    gigGoal('g1'),
    { type: 'settings-set', settings: { desiredRetention: 0.9, windows: [{ id: 'morning', start: '06:30' }] } },
    review('c1', 'hard'),
    { type: 'review', cardId: 'c1', rating: 'good', durationMs: 900, details: { tempo: 96, clean: true } },
    { type: 'feel-session', durationMs: 600_000, note: 'Loose wrists today' },
    { type: 'task-done', goalId: 'g1', blockId: 'b2', durationMs: 600_000 },
    { type: 'played', minutes: 25 },
  ];
  for (const b of bodies) {
    const r = validateBody(b);
    assert.ok(r.ok, `${JSON.stringify(b)} -> ${r.ok ? '' : r.error}`);
    assert.ok(validateEvent({ ...meta, ...b }).ok);
  }
});

test('reserved goal block kinds are accepted so modules slot in later', () => {
  assert.ok(validateBody(gigGoal('g1')).ok);
});

const bad: [string, unknown][] = [
  ['not an object', 'review'],
  ['unknown type', { type: 'delete', cardId: 'c1' }],
  ['unknown field', { ...review('c1'), extra: 1 }],
  ['missing field', { type: 'review', cardId: 'c1', rating: 'good' }],
  ['bad rating', { ...review('c1'), rating: 'perfect' }],
  ['negative duration', { ...review('c1'), durationMs: -1 }],
  ['fractional duration', { ...review('c1'), durationMs: 1.5 }],
  ['NaN duration', { ...review('c1'), durationMs: Number.NaN }],
  ['nested details', { ...review('c1'), details: { a: { b: 1 } } }],
  ['empty card id', { ...review(''), cardId: '' }],
  ['oversized id', review('x'.repeat(65))],
  ['card with no tags', { type: 'card-set', card: { id: 'c', itemId: 'i', template: 't', tags: [], retired: false } }],
  ['unknown tag', { type: 'card-set', card: { id: 'c', itemId: 'i', template: 't', tags: ['bass'], retired: false } }],
  ['retention out of range', { type: 'settings-set', settings: { desiredRetention: 1, windows: [] } }],
  ['bad window time', { type: 'settings-set', settings: { desiredRetention: 0.9, windows: [{ id: 'morning', start: '25:00' }] } }],
  ['bad deadline', { type: 'goal-set', goal: { ...(gigGoal('g') as { goal: object }).goal, deadline: '12/04/2026' } }],
  ['unknown block kind', { type: 'goal-set', goal: { ...(gigGoal('g') as { goal: object }).goal, blocks: [{ id: 'b', kind: 'dance', label: 'x', minutes: 1 }] } }],
  ['oversized note', { type: 'feel-session', durationMs: 1, note: 'x'.repeat(10_001) }],
];

for (const [name, body] of bad) {
  test(`rejects body: ${name}`, () => {
    const r = validateBody(body);
    assert.equal(r.ok, false);
  });
}

test('rejects stored events with bad metadata', () => {
  const b = review('c1');
  assert.equal(validateEvent({ ...meta, ...b, v: 2 }).ok, false);
  assert.equal(validateEvent({ ...meta, ...b, at: 0 }).ok, false);
  assert.equal(validateEvent({ ...meta, ...b, device: '' }).ok, false);
  const { id: _, ...noId } = meta;
  assert.equal(validateEvent({ ...noId, ...b }).ok, false);
});

test('error messages point at the bad field', () => {
  const r = validateBody({ ...review('c1'), rating: 'perfect' });
  assert.ok(!r.ok && r.error.startsWith('event.rating'));
});
