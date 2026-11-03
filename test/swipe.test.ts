/** Swiping between Home and Teach (2026-11-03): touch strokes and trackpad gestures. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SWIPE_MAX_MS, SWIPE_MIN_PX, swipeOf, WHEEL_GAP_MS, WHEEL_SWIPE_PX, WheelSwipe } from '../harness/swipe.ts';

test('touch: a quick, mostly sideways stroke is a swipe; its direction is where the finger went', () => {
  assert.equal(swipeOf(-120, 10, 200), 'left');
  assert.equal(swipeOf(120, -20, 200), 'right');
  assert.equal(swipeOf(-SWIPE_MIN_PX, 0, 100), 'left', 'just far enough');
});

test('touch: taps, short nudges, vertical scrolls, diagonals and slow drags are not swipes', () => {
  assert.equal(swipeOf(0, 0, 80), null, 'a tap');
  assert.equal(swipeOf(-SWIPE_MIN_PX + 1, 0, 100), null, 'too short');
  assert.equal(swipeOf(-20, 300, 300), null, 'scrolling');
  assert.equal(swipeOf(-100, 80, 200), null, 'too diagonal');
  assert.equal(swipeOf(-200, 0, SWIPE_MAX_MS + 1), null, 'too slow');
  assert.equal(swipeOf(Number.NaN, 0, 100), null);
});

test('trackpad: enough sideways scrolling is one swipe per gesture; scrolling content right is a swipe left', () => {
  const w = new WheelSwipe();
  let t = 1000;
  const feed = (dx: number, dy = 0) => w.feed(dx, dy, (t += 16));
  assert.equal(feed(40), null);
  assert.equal(feed(40), null);
  assert.equal(feed(WHEEL_SWIPE_PX - 80), 'left');
  assert.equal(feed(200), null, 'the same gesture never swipes twice');
  t += WHEEL_GAP_MS + 1; // fingers lifted
  assert.equal(feed(-WHEEL_SWIPE_PX), 'right');
});

test('trackpad: vertical scrolling, and sideways bits inside a vertical scroll, never swipe', () => {
  const w = new WheelSwipe();
  let t = 0;
  for (let i = 0; i < 50; i++) assert.equal(w.feed(5, 40, (t += 16)), null);
  assert.equal(w.feed(Number.NaN, 0, (t += 16)), null);
});
