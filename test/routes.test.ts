/** App shell routing (pure parts): hashes, the start screen, the remembered tab. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SCREEN, hashOf, parseHash, readRemembered, remember, SCREENS, startScreen, TABS } from '../harness/routes.ts';

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
