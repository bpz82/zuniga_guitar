/**
 * Proves the vendored ts-fsrs computes the same FSRS-6 numbers as the
 * reference: values copied from upstream's own tests, which take them from
 * fsrs-rs (the Rust implementation Anki uses).
 * Source: ts-fsrs v5.4.2 packages/fsrs/__tests__/FSRS-6.test.ts
 *
 * Upstream starts from a local-time date, which makes its expected values
 * depend on the machine's time zone, because FSRS counts elapsed days as UTC
 * calendar days. Here the start is a fixed UTC instant, so the test passes in
 * every time zone. The engine itself only ever passes absolute timestamps
 * from the log, so devices in different time zones always agree.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyCard, fsrs, FSRSVersion, Rating } from '../vendor/ts-fsrs/dist/ts-fsrs.mjs';
import type { Grade } from '../vendor/ts-fsrs/dist/ts-fsrs.mjs';
import { memoryOf } from '../src/index.ts';
import type { EventOf, Rating as OurRating } from '../src/index.ts';

const W6 = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835, 0.0614, 0.2629, 1.6483,
  0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];
const DAY = 24 * 60 * 60 * 1000;
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 5e-5, `${actual} is not close to ${expected}`);

test('vendored library is ts-fsrs v5.4.2 running FSRS-6 with the reference default parameters', () => {
  assert.equal(FSRSVersion, 'v5.4.2 using FSRS-6.0');
  assert.deepEqual([...fsrs().parameters.w], W6);
});

const ratings: Grade[] = [Rating.Again, Rating.Good, Rating.Good, Rating.Good, Rating.Good, Rating.Good];
const gaps = [0, 0, 1, 3, 8, 21];

test('memory state matches fsrs-rs (short-term steps on)', () => {
  const f = fsrs({ w: W6, enable_short_term: true });
  let card = createEmptyCard();
  let now = new Date(Date.UTC(2022, 11, 29, 12, 30));
  for (const [i, g] of ratings.entries()) {
    now = new Date(+now + gaps[i]! * DAY);
    card = f.next(card, now, g).card;
  }
  close(card.stability, 53.62691);
  close(card.difficulty, 6.3574867);
});

test('interval history matches upstream (fuzz off)', () => {
  const f = fsrs({ w: W6 });
  const seq: Grade[] = [3, 3, 3, 3, 3, 3, 1, 1, 3, 3, 3, 3, 3].map((n) => n as Grade);
  let card = createEmptyCard();
  let now = new Date(Date.UTC(2022, 11, 29, 12, 30));
  const ivls: number[] = [];
  for (const g of seq) {
    card = f.next(card, now, g).card;
    ivls.push(card.scheduled_days);
    now = card.due;
  }
  assert.deepEqual(ivls, [0, 2, 11, 46, 163, 498, 0, 0, 2, 4, 7, 12, 21]);
});

test("the engine's memoryOf reproduces the fsrs-rs memory state from log events", () => {
  const names: OurRating[] = ['again', 'good', 'good', 'good', 'good', 'good'];
  let at = new Date(Date.UTC(2022, 11, 29, 12, 30)).getTime();
  const reviews = names.map((rating, i) => {
    at += gaps[i]! * DAY;
    return { v: 1, id: `r${i}`, at, device: 'd', type: 'review', cardId: 'c', rating, durationMs: 1 } as EventOf<'review'>;
  });
  // Fuzz is on in the engine; it moves due dates only, never memory state.
  const m = memoryOf('c', reviews, 0.9);
  close(m.stability, 53.62691);
  close(m.difficulty, 6.3574867);
});
