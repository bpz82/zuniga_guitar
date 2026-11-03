/** App shell routing (pure parts): hashes and the start screen. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { APP_SHEETS, BADGED, badgeText, DEFAULT_SCREEN, hashOf, homeFor, isPage, MAX_BADGE, MEMBER_SCREENS, MENU, MENU_LABEL, PAGES, pageAfter, parseHash, SCREENS, screenFor, screensFor, SHEETS, startScreen, TABS } from '../harness/routes.ts';

test('the screens: Home ("today") first, Teach, the module screens, Settings', () => {
  assert.deepEqual([...TABS], ['today', 'teach', 'songs', 'ear', 'record', 'goals', 'cards']);
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

test('menu (2026-11-03): Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings; every screen exactly once', () => {
  assert.deepEqual([...MENU], ['today', 'teach', 'record', 'songs', 'ear', 'goals', 'cards', 'settings']);
  assert.deepEqual([...MENU].sort(), [...SCREENS].sort());
  assert.deepEqual(MENU.map((m) => MENU_LABEL[m]), ['Home', 'Teach', 'Record', 'Songs', 'Ear training', 'Goals', 'Cards', 'Settings']);
});

test('pages: Home then Teach; a swipe left goes to the page on the right and back; nothing past the ends or off the pages', () => {
  assert.deepEqual([...PAGES], ['today', 'teach']);
  assert.equal(pageAfter('today', 'left'), 'teach');
  assert.equal(pageAfter('teach', 'right'), 'today');
  assert.equal(pageAfter('today', 'right'), null);
  assert.equal(pageAfter('teach', 'left'), null);
  for (const s of ['songs', 'record', 'settings'] as const) {
    assert.equal(isPage(s), false);
    assert.equal(pageAfter(s, 'left'), null);
  }
});

test('badges: on Home and Cards (in the menu); nothing when none due, the count, then 99+', () => {
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

test('sheets: four screen sheets, and five app sheets (sign-in, tab viewer, the two objectives popups, the band-delete confirm) with their own names', () => {
  assert.deepEqual([...SHEETS], ['mx-settings', 'songs-paste', 'improv', 'goal-new']);
  assert.deepEqual([...APP_SHEETS], ['signin', 'songtab', 'objectives', 'teach-objectives', 'band-delete']);
  assert.equal(new Set([...SHEETS, ...APP_SHEETS]).size, 9);
});

// ---------------------------------------------------- roles (2026-11-03) --

test('roles: an owner reaches every screen; a band member only Songs and Settings', () => {
  assert.deepEqual([...screensFor('owner')], [...SCREENS]);
  assert.deepEqual([...MEMBER_SCREENS], ['songs', 'settings']);
  assert.deepEqual([...screensFor('member')], ['songs', 'settings']);
  assert.equal(homeFor('owner'), 'today');
  assert.equal(homeFor('member'), 'songs');
});

test('roles: a band member\'s links to any other screen lead nowhere (he lands on Songs, the URL rewritten)', () => {
  for (const s of SCREENS) {
    const ok = s === 'songs' || s === 'settings';
    assert.equal(screenFor(hashOf(s), 'member'), ok ? s : null, s);
    assert.deepEqual(startScreen(hashOf(s), 'member'), ok ? { screen: s, replace: false } : { screen: 'songs', replace: true }, s);
    assert.equal(screenFor(hashOf(s), 'owner'), s, 'an owner reaches it');
  }
  assert.deepEqual(startScreen('', 'member'), { screen: 'songs', replace: true });
  assert.deepEqual(startScreen('#/nope', 'member'), { screen: 'songs', replace: true });
  assert.deepEqual(startScreen(''), { screen: 'today', replace: true }, 'an owner by default, exactly as before');
});
