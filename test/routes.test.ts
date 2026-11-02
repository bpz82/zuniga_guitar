/** App shell routing (pure parts): hashes and the start screen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_SHEETS, BADGED, badgeText, BAR, DEFAULT_SCREEN, hashOf, inMore, MAX_BADGE, MORE, parseHash, SCREENS, SHEETS, startScreen, TABS } from '../harness/routes.ts';

test('the screens: Today first (the single page, 2026-11-02), the module tabs, Settings behind the gear', () => {
  assert.deepEqual([...TABS], ['today', 'songs', 'ear', 'record', 'goals', 'cards']);
  assert.deepEqual([...SCREENS], [...TABS, 'settings']);
  assert.equal(DEFAULT_SCREEN, 'today');
  assert.ok(!(SCREENS as readonly string[]).includes('practice'), 'Practice is part of Today now');
});

test('hashes: every screen round-trips; anything else is no screen', () => {
  for (const s of SCREENS) assert.equal(parseHash(hashOf(s)), s);
  assert.equal(parseHash('#/ear/'), 'ear', 'a trailing slash is fine');
  for (const bad of ['', '#', '#/', '#ear', '#/Ear', '#/nope', '#/ear/x', '#/settings?x=1', 'javascript:alert(1)', '#/__proto__', '#/constructor', '#/practice']) {
    assert.equal(parseHash(bad), null, bad);
  }
});

test('start screen: a valid hash wins (links, reloads) and is kept as is', () => {
  assert.deepEqual(startScreen('#/goals'), { screen: 'goals', replace: false });
  assert.deepEqual(startScreen('#/settings'), { screen: 'settings', replace: false });
});

test('start screen with no hash (opening the app): always Today, so the goal comes first; the URL gets the hash without a new history entry', () => {
  assert.deepEqual(startScreen(''), { screen: 'today', replace: true });
  assert.deepEqual(startScreen('#/nope'), { screen: 'today', replace: true }, 'a bad hash is replaced');
  assert.deepEqual(startScreen('#/practice'), { screen: 'today', replace: true }, 'an old Practice link lands on Today, where practice now is');
});

// ------------------------------------------------ social-style bar (2026-11-01) --

test('phone bar: Today, Goals, Record in the centre, Songs, More', () => {
  assert.deepEqual([...BAR], ['today', 'goals', 'record', 'songs', 'more']);
  assert.equal(BAR[Math.floor(BAR.length / 2)], 'record', 'Record is the centre slot');
});

test('More sheet: Ear training, Cards, Settings; every screen is reachable on a phone exactly once', () => {
  assert.deepEqual([...MORE], ['ear', 'cards', 'settings']);
  const reachable = [...BAR.filter((b) => b !== 'more'), ...MORE];
  assert.deepEqual([...reachable].sort(), [...SCREENS].sort());
  assert.equal(new Set(reachable).size, reachable.length);
  for (const s of SCREENS) assert.equal(inMore(s), (MORE as readonly string[]).includes(s), s);
});

test('screens in the More sheet still route', () => {
  for (const s of MORE) assert.equal(parseHash(hashOf(s)), s);
});

test('badges: on Today and Cards; nothing when none due, the count, then 99+', () => {
  assert.deepEqual([...BADGED], ['today', 'cards']);
  for (const b of BADGED) assert.ok((TABS as readonly string[]).includes(b));
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-3), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(MAX_BADGE), '99');
  assert.equal(badgeText(MAX_BADGE + 1), '99+');
  assert.equal(badgeText(4.7), '4');
});

test('sheets: four screen sheets, and two app sheets (sign-in, tab viewer) with their own names', () => {
  assert.deepEqual([...SHEETS], ['mx-settings', 'songs-paste', 'improv', 'goal-new']);
  assert.deepEqual([...APP_SHEETS], ['signin', 'songtab']);
  assert.equal(new Set([...SHEETS, ...APP_SHEETS]).size, 6);
});
