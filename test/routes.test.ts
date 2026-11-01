/** App shell routing (pure parts): hashes, the start screen, the remembered tab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BADGED, badgeText, BAR, DEFAULT_SCREEN, hashOf, inMore, MAX_BADGE, MORE, parseHash, readRemembered, remember, SCREENS, startScreen, TABS } from '../harness/routes.ts';

test('the screens: Today first, the six module tabs, Settings behind the gear', () => {
  assert.deepEqual([...TABS], ['today', 'practice', 'songs', 'ear', 'record', 'goals', 'cards']);
  assert.deepEqual([...SCREENS], [...TABS, 'settings']);
  assert.equal(DEFAULT_SCREEN, 'today');
});

test('hashes: every screen round-trips; anything else is no screen', () => {
  for (const s of SCREENS) assert.equal(parseHash(hashOf(s)), s);
  assert.equal(parseHash('#/ear/'), 'ear', 'a trailing slash is fine');
  for (const bad of ['', '#', '#/', '#ear', '#/Ear', '#/nope', '#/ear/x', '#/settings?x=1', 'javascript:alert(1)', '#/__proto__', '#/constructor']) {
    assert.equal(parseHash(bad), null, bad);
  }
});

test('start screen: a valid hash wins (links, reloads) and is kept as is', () => {
  assert.deepEqual(startScreen('#/goals', { tab: 'songs', day: '2026-11-02' }, '2026-11-02'), { screen: 'goals', replace: false });
  assert.deepEqual(startScreen('#/settings', null, '2026-11-02'), { screen: 'settings', replace: false });
});

test('start screen with no hash: the last tab if used today, otherwise Today; the URL gets the hash without a new history entry', () => {
  assert.deepEqual(startScreen('', { tab: 'songs', day: '2026-11-02' }, '2026-11-02'), { screen: 'songs', replace: true });
  assert.deepEqual(startScreen('', { tab: 'songs', day: '2026-11-01' }, '2026-11-02'), { screen: 'today', replace: true }, 'a new practice day opens on Today');
  assert.deepEqual(startScreen('', null, '2026-11-02'), { screen: 'today', replace: true });
  assert.deepEqual(startScreen('#/nope', { tab: 'ear', day: '2026-11-02' }, '2026-11-02'), { screen: 'ear', replace: true }, 'a bad hash is replaced');
});

test('remembering: tabs are remembered with the practice day; Settings never is', () => {
  assert.deepEqual(remember('cards', '2026-11-02'), { tab: 'cards', day: '2026-11-02' });
  assert.equal(remember('settings', '2026-11-02'), null);
});

test('a stored tab is read defensively: anything malformed counts as nothing remembered', () => {
  assert.deepEqual(readRemembered(JSON.stringify({ tab: 'ear', day: '2026-11-02' })), { tab: 'ear', day: '2026-11-02' });
  for (const raw of [null, '', 'not json', '"ear"', '[]', JSON.stringify({ tab: 'settings', day: '2026-11-02' }), JSON.stringify({ tab: 'nope', day: '2026-11-02' }), JSON.stringify({ tab: 'ear', day: 'tomorrow' }), JSON.stringify({ tab: 'ear' })]) {
    assert.equal(readRemembered(raw), null, String(raw));
  }
});

// ------------------------------------------------ social-style bar (2026-11-01) --

test('phone bar: Today, Practice, Record in the centre, Songs, More', () => {
  assert.deepEqual([...BAR], ['today', 'practice', 'record', 'songs', 'more']);
  assert.equal(BAR[Math.floor(BAR.length / 2)], 'record', 'Record is the centre slot');
});

test('More sheet: Ear training, Goals, Cards, Settings; every screen is reachable on a phone exactly once', () => {
  assert.deepEqual([...MORE], ['ear', 'goals', 'cards', 'settings']);
  const reachable = [...BAR.filter((b) => b !== 'more'), ...MORE];
  assert.deepEqual([...reachable].sort(), [...SCREENS].sort());
  assert.equal(new Set(reachable).size, reachable.length);
  for (const s of SCREENS) assert.equal(inMore(s), (MORE as readonly string[]).includes(s), s);
});

test('screens in the More sheet still route and are remembered like any tab (Settings still never is)', () => {
  for (const s of MORE) assert.equal(parseHash(hashOf(s)), s);
  assert.deepEqual(remember('ear', '2026-11-02'), { tab: 'ear', day: '2026-11-02' });
  assert.deepEqual(startScreen('', { tab: 'goals', day: '2026-11-02' }, '2026-11-02'), { screen: 'goals', replace: true });
  assert.equal(remember('settings', '2026-11-02'), null);
});

test('badges: on Practice and Cards; nothing when none due, the count, then 99+', () => {
  assert.deepEqual([...BADGED], ['practice', 'cards']);
  for (const b of BADGED) assert.ok((TABS as readonly string[]).includes(b));
  assert.equal(badgeText(0), null);
  assert.equal(badgeText(-3), null);
  assert.equal(badgeText(Number.NaN), null);
  assert.equal(badgeText(1), '1');
  assert.equal(badgeText(MAX_BADGE), '99');
  assert.equal(badgeText(MAX_BADGE + 1), '99+');
  assert.equal(badgeText(4.7), '4');
});
