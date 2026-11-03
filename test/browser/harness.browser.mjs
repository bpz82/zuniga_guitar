// End-to-end check of the built harness in headless Chromium (Playwright):
// offline-first storage, the test deck through the module contract,
// settings and notification toggles, and the offline app shell.
// 2026-11-02: the curriculum, song tabs and baselines, the sign-in popup, the
// device time zone and the metronome's quiet-hours note. 2026-11-03: Home
// and Teach open with their objectives popups and move into their decks;
// one menu button replaces the tab bar; swiping between Home and Teach.
// Band members (2026-11-03): invite links, a member's Songs-only app, his
// own ratings, removal and the confirmed delete, against a fake server that
// mimics the database's rules (the rules themselves: test/sql/rls.test.sql).
// Run with `npm run test:browser` (needs Playwright and its Chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
// Real content types: browsers refuse a stylesheet served as anything but text/css.
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg' };
const server = createServer(async (req, res) => {
  const path = join('public', new URL(req.url, 'http://x').pathname.replace(/\/$/, '/index.html'));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch {
    res.writeHead(404).end();
  }
}).listen(0);
const url = `http://localhost:${server.address().port}/`;

// A fake microphone (a test tone), so the recorder really records.
const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
// UTC, so the neutral defaults (UTC) are this device's own zone and nothing is adjusted.
const context = await browser.newContext({ permissions: ['microphone'], timezoneId: 'UTC' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 18:00 UTC: the neutral defaults' after-work window, so silent cards are served.
await page.clock.install({ time: new Date('2026-11-02T18:00:00Z') });
const status = () => page.textContent('[data-zg=\"status\"]');
const step = (name) => console.log(`ok - ${name}`);
// The page clock is fake, so the page's own polling (waitForFunction) is not
// re-run while real async work finishes (storage, microphone, MediaRecorder).
// After such work, poll from here instead.
/** Bottom sheets (native dialogs): open by their button, close by theirs, and read whether one is open. */
const sheetIsOpen = (name) => page.evaluate((n) => document.querySelector(`[data-zg="sheet-${n}"]`).open, name);
/** A page's objectives popup, if it is up: Start, the way a person would. */
const dismissIntro = async () => {
  for (const [name, start] of [['objectives', 'today-start'], ['teach-objectives', 'teach-start']]) {
    if (!(await sheetIsOpen(name))) continue;
    await page.click(`[data-zg="${start}"]`);
    await until((n) => !document.querySelector(`[data-zg="sheet-${n}"]`).open, name);
  }
};
/** Opens a screen the way a person would: the menu, then its item; then past the page's popup if it opens. */
const show = async (screen) => {
  await page.click('[data-zg="menu"]');
  await page.click(screen === 'settings' ? '[data-zg="menu-settings"]' : `[data-zg="tab-${screen}"]`);
  await until((s) => !document.querySelector(`[data-zg="screen-${s}"]`).hidden, screen);
  await dismissIntro();
};
/** After the app (re)opens: ready, then past its opening (Start on a popup, Escape on the new-goal sheet). */
const ready = async () => {
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  await dismissIntro();
  if (await sheetIsOpen('goal-new')) {
    await page.keyboard.press('Escape');
    await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  }
};
const openSheet = async (name) => {
  await page.click(`[data-zg="open-${name}"]`);
  await until((n) => document.querySelector(`[data-zg="sheet-${n}"]`).open, name);
};
const closeSheet = async (name) => {
  await page.click(`[data-zg="close-${name}"]`);
  await until((n) => !document.querySelector(`[data-zg="sheet-${n}"]`).open, name);
};
/** Waits until a screen is really shown (its hash set and the hashchange handled). */
const arrive = (screen) => until((s) => location.hash === `#/${s}` && !document.querySelector(`[data-zg="screen-${s}"]`).hidden, screen);
const visibleScreens = () => page.evaluate(() => [...document.querySelectorAll('[data-zg^="screen-"]')].filter((e) => !e.hidden).map((e) => e.dataset.zg));
const until = async (fn, arg) => {
  for (let i = 0; i < 300; i++) {
    if (await page.evaluate(fn, arg)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${fn}`);
};

try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.match(await status(), /this device only/);
  const sheets = await page.evaluate(() => [...document.styleSheets].map((x) => [x.href.split('/').pop(), x.cssRules.length > 0]));
  assert.deepEqual(sheets, [['tokens.css', true], ['theme.css', true], ['base.css', true]], 'all three stylesheets load, in order');
  // No goal yet: the app opens on Goals with the new-goal sheet, instead of Home's popup (no extra history entry).
  assert.equal(new URL(page.url()).hash, '#/goals');
  assert.equal(await sheetIsOpen('goal-new'), true);
  assert.equal(await sheetIsOpen('objectives'), false);
  await page.keyboard.press('Escape');
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  step('opening with no goal yet: the new-goal sheet instead of the objectives popup');

  // Home: the day's deck. Its objectives popup opens again from its button.
  await show('today');
  assert.deepEqual(await visibleScreens(), ['screen-today']);
  assert.equal(await page.getAttribute('[data-zg="tab-today"]', 'aria-current'), 'page');
  assert.equal(await page.textContent('[data-zg="home-goal"]'), 'No goal yet. Set one in Goals and each day is planned around it.');
  for (const b of ['today', 'cards']) {
    assert.ok(await page.isHidden(`[data-zg="nav-badge-${b}"]`), `no ${b} badge with nothing due`);
    assert.equal(await page.getAttribute(`[data-zg="tab-${b}"]`, 'aria-label'), null);
  }
  await page.click('[data-zg="today-objectives"]');
  await until(() => document.querySelector('[data-zg="sheet-objectives"]').open);
  assert.equal(await page.textContent('[data-zg="goal-focus"]'), 'No goal yet');
  assert.equal(await page.textContent('[data-zg="goal-focus-link"]'), 'Set your goal');
  assert.match(await page.textContent('[data-zg="today-now"]'), /^After-work burst \(sound\): \d+ due, \d+ new\.$/);
  assert.equal(await page.textContent('[data-zg="today-reminder"]'), 'Reminders are off (turn them on in Settings).');
  const bulletsNow = () => page.evaluate(() => [...document.querySelectorAll('[data-zg="today-blocks"] > li')].map((li) => [li.dataset.zg, li.textContent]));
  assert.deepEqual((await bulletsNow()).map(([z]) => z), ['today-objective', 'today-lesson']);
  assert.match((await bulletsNow())[0][1], /^Today's deck: \d+ due, \d+ new$/);
  assert.equal((await bulletsNow())[1][1], 'On Teach: Lesson 1 · What sound is (swipe left)');
  // Only the popup shows: the backdrop is opaque and covers everything, the top bar included.
  const cover = await page.evaluate(() => {
    const d = document.querySelector('[data-zg="sheet-objectives"]');
    const bg = getComputedStyle(d, '::backdrop').backgroundColor;
    const [w, h] = [innerWidth, innerHeight];
    const pts = [[5, 5], [w - 5, 20], [w / 2, h - 5], [5, h * 0.7]];
    return { bg, hits: pts.map(([x, y]) => document.elementFromPoint(x, y) === d), focus: document.activeElement?.dataset.zg };
  });
  assert.match(cover.bg, /^rgb\(/, `opaque backdrop (${cover.bg})`);
  assert.deepEqual(cover.hits, [true, true, true, true], 'nothing else is reachable or visible');
  assert.equal(cover.focus, 'today-start', 'Start has the focus');
  await page.click('[data-zg="today-start"]');
  await until(() => !document.querySelector('[data-zg="sheet-objectives"]').open && document.activeElement?.dataset.zg === 'now');
  assert.equal(await page.getAttribute('[data-zg="screen-today"]', 'data-enter'), 'deck', 'the deck plays its entrance');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-zg="now"]')).animationName), 'zg-deck-in');
  assert.match(await page.textContent('[data-zg=\"session\"]'), /after-work · sound/);
  assert.match(await page.textContent('[data-zg=\"question\"]'), /String \d .*which note\?|Spell /);
  step('Home: the day\'s deck; its objectives popup (opaque, bullets, Start focused) moves into the deck with an entrance');

  const first = await page.getAttribute('[data-zg=\"card\"]', 'data-card');
  await page.click('[data-zg=\"reveal\"]');
  assert.notEqual((await page.textContent('[data-zg=\"answer\"]')).trim(), '');
  await page.click('[data-zg=\"r-good\"]');
  await until((c) => document.querySelector('[data-zg=\"card\"]').dataset.card !== c, first);
  const pending = await page.evaluate(() => window.zg.replica.pendingCount);
  const reviews = await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first);
  assert.equal(reviews, 1);
  step('rating a card records a review through the module contract');

  await page.reload();
  await ready();
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
  assert.equal(await page.evaluate(() => window.zg.replica.pendingCount), pending);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.keys()].filter((k) => k.startsWith('td-')).length), 102, 'seeding again added nothing');
  assert.equal(await page.evaluate(() => window.zg.replica.library.cards.size), 132, 'plus the metronome\'s Free practice exercise, the 4 level-1 ear skills, lesson 1 (8 cards) and the 17 Extras (off)');
  step('the review survives a reload (IndexedDB), still queued to sync');

  // App shell routing. (Reloading on Home with no goal reopened Goals; back to Home.)
  await show('today');
  assert.deepEqual(await visibleScreens(), ['screen-today']);
  await show('songs');
  assert.equal(new URL(page.url()).hash, '#/songs');
  assert.deepEqual(await visibleScreens(), ['screen-songs'], 'one screen at a time');
  assert.equal(await page.getAttribute('[data-zg="tab-songs"]', 'aria-current'), 'page');
  assert.equal(await page.getAttribute('[data-zg="tab-today"]', 'aria-current'), null);
  await show('ear');
  await page.goBack();
  await until(() => location.hash === '#/songs' && !document.querySelector('[data-zg="screen-songs"]').hidden);
  await page.goBack();
  await until(() => location.hash === '#/today' && !document.querySelector('[data-zg="screen-today"]').hidden);
  // Today is the long screen: scroll it, then a newly opened screen starts at the top.
  await page.evaluate(() => window.scrollTo(0, 400));
  assert.ok(await page.evaluate(() => window.scrollY) > 0);
  await page.goForward();
  await until(() => location.hash === '#/songs' && !document.querySelector('[data-zg="screen-songs"]').hidden);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'a newly opened screen starts at the top');
  step('shell: the menu switches screens one at a time; back and forward work');

  await show('settings');
  assert.equal(await page.getAttribute('[data-zg="menu-settings"]', 'aria-current'), 'page');
  assert.ok(await page.isVisible('[data-zg="notify-all"]') && await page.isVisible('[data-zg="sign-out"]') && await page.isVisible('[data-zg="quiet-start"]'));
  assert.ok(await page.isHidden('[data-zg="cfg-url"]') && await page.isHidden('[data-zg="settings"]'), 'setup and raw settings are tucked away');
  const historyBefore = await page.evaluate(() => history.length);
  await page.evaluate(() => (location.hash = '#/nope'));
  await until(() => location.hash === '#/settings');
  assert.deepEqual(await visibleScreens(), ['screen-settings'], 'a bad link changes nothing');
  assert.equal(await page.evaluate(() => history.length), historyBefore + 1, 'and is replaced, not kept in history');
  step('shell: Settings in the menu (setup tucked away); a bad link is ignored');

  await show('cards');
  await page.goto(url); // reopen the app without a hash
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(new URL(page.url()).hash, '#/goals', 'opening the app with no goal: the new-goal sheet (Home and its popup once there is a goal)');
  await ready();
  await page.goto('about:blank'); // a fresh open (a hash-only change would not reload)
  await page.goto(`${url}#/practice`); // an old link to the merged Practice screen: Home, so the same opening
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(new URL(page.url()).hash, '#/goals');
  await page.goto('about:blank');
  await page.goto(`${url}#/cards`);
  await ready();
  assert.deepEqual(await visibleScreens(), ['screen-cards'], 'a link opens its screen, no popup');
  assert.equal(await sheetIsOpen('objectives'), false);
  step('shell: opening the app goes to Home (with no goal, the new-goal sheet); links open their screen');

  // Navigation (2026-11-03): one menu button in the top corner; no tab bar, no side nav, no gear.
  const menuOpen = () => page.evaluate(() => [document.querySelector('[data-zg="menu"]').getAttribute('aria-expanded'), document.querySelector('[data-zg="menu-list"]').hasAttribute('data-open')]);
  const focused = () => page.evaluate(() => document.activeElement?.dataset.zg ?? null);
  const MENU_HOOKS = ['tab-today', 'tab-teach', 'tab-record', 'tab-songs', 'tab-ear', 'tab-goals', 'tab-cards', 'menu-settings'];
  const visible = async (hooks) => Promise.all(hooks.map((h) => page.isVisible(`[data-zg="${h}"]`)));
  for (const [w, h] of [[390, 844], [1280, 720]]) {
    await page.setViewportSize({ width: w, height: h });
    const box = await page.locator('[data-zg="menu"]').boundingBox();
    assert.ok(box.width >= 44 && box.height >= 44, `${w}px: the menu button is at least 44 by 44`);
    assert.ok(box.y < 60, `${w}px: at the top`);
    const right = await page.evaluate(() => document.querySelector('[data-zg="topbar"]').getBoundingClientRect().right);
    assert.ok(Math.abs(box.x + box.width - right) <= 4, `${w}px: in the corner (${box.x + box.width} vs ${right})`);
    assert.deepEqual(await visible(MENU_HOOKS), Array(8).fill(false), `${w}px: no tab bar or side nav; every item waits in the closed menu`);
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-zg="nav"]')).position), 'relative', 'nothing fixed to the screen edge');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-zg="menu"]');
  assert.deepEqual(await menuOpen(), ['true', true]);
  assert.deepEqual(await visible(MENU_HOOKS), Array(8).fill(true), 'Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings');
  assert.equal(await focused(), 'tab-today', 'focus moves into the list');
  const labels = await page.evaluate(() => [...document.querySelectorAll('[data-zg="menu-list"] > a')].map((a) => a.textContent.trim()));
  assert.deepEqual(labels, ['Home', 'Teach', 'Record', 'Songs', 'Ear training', 'Goals', 'Cards', 'Settings']);
  const ys = await Promise.all(MENU_HOOKS.map((h) => page.locator(`[data-zg="${h}"]`).boundingBox().then((b) => [b.y, b.height, b.x + b.width])));
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i][0] > ys[i - 1][0], 'one column, top to bottom');
  assert.ok(ys.every(([, hgt, r]) => hgt >= 44 && r <= 391), 'each item a 44px+ row, inside the screen');
  assert.equal(await page.getAttribute('[data-zg="tab-cards"]', 'aria-current'), 'page', 'the screen shown is marked');
  await page.keyboard.press('Escape');
  assert.deepEqual(await menuOpen(), ['false', false], 'Escape closes it');
  assert.equal(await focused(), 'menu', 'and returns focus to the button');
  await page.click('[data-zg="menu"]');
  await page.click('h1');
  assert.deepEqual(await menuOpen(), ['false', false], 'a tap outside closes it');
  await page.click('[data-zg="menu"]');
  await page.click('[data-zg="menu"]');
  assert.deepEqual(await menuOpen(), ['false', false], 'the button toggles');
  await page.click('[data-zg="menu"]');
  for (let i = 0; i < 9; i++) await page.keyboard.press('Tab');
  assert.deepEqual(await menuOpen(), ['false', false], 'tabbing past the last item closes it');
  await page.click('[data-zg="menu"]');
  await page.click('[data-zg="tab-record"]');
  await arrive('record');
  assert.deepEqual(await menuOpen(), ['false', false], 'choosing a screen closes the list');
  assert.ok(await page.isVisible('[data-zg="rec-start"]'));
  await page.goBack();
  await arrive('cards');
  step('menu: one 44px+ button in the top corner on phone and laptop (no tab bar, no side nav); its list opens Home, Teach, Record, Songs, Ear training, Goals, Cards, Settings and closes on Escape, a tap outside, the button, tabbing away or a choice');

  // Layout redesign (2026-11-01): touch targets and bottom sheets, on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  const small = [];
  for (const screen of ['today', 'teach', 'record', 'songs', 'ear', 'goals', 'cards', 'settings']) {
    await page.evaluate((x) => (location.hash = `#/${x}`), screen);
    await arrive(screen);
    await dismissIntro();
    small.push(...(await page.evaluate((x) => {
      const root = document.querySelector(`[data-zg="screen-${x}"]`);
      const controls = [...root.querySelectorAll('button, a, input, select, textarea, summary'), document.querySelector('[data-zg="menu"]'), ...document.querySelectorAll('[data-zg="pager"] > a')];
      return controls
        .filter((el) => el.getClientRects().length > 0 && !el.closest('dialog'))
        // A switch's touch target is its whole label row (a tap anywhere on it toggles the switch).
        .map((el) => [el.dataset.zg ?? el.tagName.toLowerCase(), (el.type === 'checkbox' && el.closest('label')) || el])
        .map(([z, target]) => [z, Math.round(target.getBoundingClientRect().height), Math.round(target.getBoundingClientRect().width)])
        .filter(([, h, w]) => h < 44 || w < 44)
        .map(([z, h, w]) => `${x}:${z} ${w}x${h}`);
    }, screen)));
  }
  assert.deepEqual([...new Set(small)], [], 'every control on every screen is at least 44 by 44');
  step('layout: every visible control on every screen is a 44px+ touch target on a phone');

  await page.evaluate(() => (location.hash = '#/goals'));
  await arrive('goals');
  await openSheet('goal-new');
  assert.equal(await page.evaluate(() => document.querySelector('[data-zg="sheet-goal-new"]').matches(':modal')), true, 'a modal sheet');
  // A tap on the dimmed page lands on the sheet's backdrop (hit-tested as the dialog), never on the page.
  const hit = await page.evaluate(() => [document.elementFromPoint(20, 20) === document.querySelector('[data-zg="sheet-goal-new"]'), document.elementFromPoint(40, 830)?.dataset.zg ?? null]);
  assert.equal(hit[0], true, 'the page behind the sheet is covered');
  assert.notEqual(hit[1], null, 'the bottom of the screen too');
  await page.keyboard.press('Escape');
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await openSheet('goal-new');
  await page.mouse.click(195, 30); // the backdrop, above the sheet
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await openSheet('goal-new');
  await page.evaluate(() => history.back()); // leaving the screen closes its sheet
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await page.evaluate(() => (location.hash = '#/today'));
  await arrive('today');
  await openSheet('mx-settings');
  await page.waitForTimeout(400); // let the slide-up finish (a CSS transition)
  const sheetBox2 = await page.locator('[data-zg="sheet-mx-settings"]').boundingBox();
  assert.ok(Math.abs(sheetBox2.y + sheetBox2.height - 844) < 2 && sheetBox2.width === 390, 'on a phone it rises from the bottom edge, full width');
  await closeSheet('mx-settings');
  step('sheets: modal bottom sheets close on Escape, a backdrop tap, the close button, or leaving the screen');
  await page.setViewportSize({ width: 1280, height: 720 });
  await show('today');

  await show('settings');
  assert.equal(await page.isChecked('[data-zg=\"notify-all\"]'), false);
  await page.check('[data-zg=\"notify-all\"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.notifications === true);
  await page.uncheck('[data-zg="notify-window"] input >> nth=2');
  await page.waitForFunction(() => window.zg.replica.library.settings.windows[2].notify === false);
  step('notification master switch and per-window toggle are saved');

  await page.click('[data-zg="dev"] summary'); // setup and developer tools
  const s = JSON.parse(await page.inputValue('[data-zg=\"settings\"]'));
  await page.fill('[data-zg=\"settings\"]', JSON.stringify({ ...s, morningMinutes: 20 }));
  await page.click('[data-zg=\"save-settings\"]');
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Refused'));
  await page.fill('[data-zg=\"settings\"]', JSON.stringify({ ...s, morningMinutes: 75, quietHours: { start: '17:00', end: '19:00' } }));
  await page.click('[data-zg=\"save-settings\"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.morningMinutes === 75);
  assert.match(await page.textContent('[data-zg=\"session\"]'), /silent \(quiet hours\)/);
  step('settings can be edited any time; invalid ones are refused');

  // Metronome. Quiet hours were just set to 17:00-19:00 and it is 18:00 UTC.
  await show('today');
  assert.equal(await page.inputValue('[data-zg=\"mx-bpm\"]'), '80');
  assert.match(await page.textContent('[data-zg=\"mx-exercise\"]'), /Free practice/);
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Quiet hours'));
  assert.equal(await page.evaluate(() => window.zg.metronome.player.playing), false);
  assert.equal(await page.textContent('[data-zg="mx-note"]'), 'Quiet hours (17:00 to 19:00): the metronome stays silent. Play anyway, or change quiet hours in Settings.', 'the reason shows right under Start');
  assert.ok(await page.isVisible('[data-zg="mx-anyway"]'));
  await page.click('[data-zg="mx-anyway"]');
  await page.waitForFunction(() => window.zg.metronome.player.playing && window.zg.metronome.player.ready, null, { timeout: 15000 });
  assert.equal(await page.textContent('[data-zg="mx-note"]'), '');
  assert.ok(await page.isHidden('[data-zg="mx-anyway"]'));
  await page.click('[data-zg=\"mx-start\"]'); // stop at once: too short to log
  await until(() => !window.zg.metronome.player.playing);
  await page.click('[data-zg=\"mx-start\"]');
  await until(() => document.querySelector('[data-zg="mx-note"]').textContent.startsWith('Quiet hours'));
  assert.equal(await page.evaluate(() => window.zg.metronome.player.playing), false, 'Play anyway is for that once only');
  step('metronome: silent in quiet hours by default, says why under Start, and Play anyway plays it this once');

  await openSheet('mx-settings');
  await page.check('[data-zg=\"mx-allowDuringQuietHours\"]');
  await page.selectOption('[data-zg=\"mx-groove\"]', 'rock');
  await page.fill('[data-zg=\"mx-countInBars\"]', '0');
  await closeSheet('mx-settings');
  await page.fill('[data-zg=\"mx-bpm\"]', '150');
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForFunction(() => window.zg.metronome.player.playing && window.zg.metronome.player.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.zg.metronome.player.stats?.bars ?? 0) >= 3, null, { timeout: 15000 });
  const stats = await page.evaluate(() => window.zg.metronome.player.stats);
  assert.equal(stats.dropped, 0, 'no late clicks');
  assert.ok(stats.scheduled >= 16);
  assert.match(await page.textContent('[data-zg=\"mx-position\"]'), /bar \d+ · beat \d\/4 · 150 BPM/);
  step('real drum kit decodes and the lookahead scheduler plays rock at 150 BPM with no dropped clicks');

  await openSheet('mx-settings'); // settings change while it plays
  await page.selectOption('[data-zg=\"mx-sound\"]', 'beep');
  await page.selectOption('[data-zg=\"mx-groove\"]', 'click');
  await closeSheet('mx-settings');
  await page.waitForTimeout(1500);
  assert.equal((await page.evaluate(() => window.zg.metronome.player.stats)).dropped, 0);
  step('switching to synth beeps while playing');

  await page.waitForTimeout(3500);
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForSelector('[data-zg="mx-result"]:not([hidden])');
  assert.match(await page.textContent('[data-zg=\"mx-summary\"]'), /150→150 BPM/);
  await page.click('[data-zg=\"mx-clean\"]');
  await page.waitForFunction(() => window.zg.replica.library.reviews.get('mx-free-c')?.length === 1);
  const details = await page.evaluate(() => window.zg.replica.library.reviews.get('mx-free-c')[0].details);
  assert.equal(details.tempo, 150);
  assert.equal(details.clean, true);
  assert.equal(await page.evaluate(() => window.zg.replica.library.items.get('mx-prefs').fields.groove), 'rock', 'settings saved through the contract');
  step('stopping logs the session (tempo, clean) as a review through the module contract');

  const timing = await page.evaluate(async () => {
    // Render real samples offline at known times and measure where each hit lands.
    const rate = 44100;
    const ctx = new OfflineAudioContext(1, rate * 5, rate);
    const out = [];
    const onset = (d) => { for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) > 0.02) return Math.max(0, i - 16); return 0; };
    const decoded = {};
    for (const v of ['kick', 'snare', 'rim', 'hihat']) {
      const buf = await ctx.decodeAudioData(await (await fetch(`./sounds/${v}.mp3`)).arrayBuffer());
      decoded[v] = { buf, lead: onset(buf.getChannelData(0)) };
    }
    const times = [0.5, 1.5, 2.5, 3.5]; // 1 s apart: longer than any of these samples
    ['kick', 'snare', 'rim', 'hihat'].forEach((v, i) => {
      const src = ctx.createBufferSource();
      src.buffer = decoded[v].buf;
      src.connect(ctx.destination);
      src.start(times[i], decoded[v].lead / decoded[v].buf.sampleRate);
    });
    const rendered = (await ctx.startRendering()).getChannelData(0);
    for (const t of times) {
      let i = Math.floor((t - 0.05) * rate);
      while (i < rendered.length && Math.abs(rendered[i]) <= 0.02) i++;
      out.push(((i / rate) - t) * 1000);
    }
    return { errorsMs: out, leads: Object.fromEntries(Object.entries(decoded).map(([k, v]) => [k, v.lead])) };
  });
  for (const e of timing.errorsMs) assert.ok(Math.abs(e) < 1, `hit landed ${e.toFixed(2)} ms off`);
  step(`rendered drum hits land within 1 ms of their scheduled time (${timing.errorsMs.map((e) => e.toFixed(2)).join(', ')} ms)`);

  await show('settings');
  await page.fill('[data-zg=\"cfg-key\"]', 'sb_secret_abc');
  await page.click('[data-zg=\"save-config\"]');
  assert.match(await status(), /looks like a secret key/);
  step('refuses a secret key in the app');

  // Songs I Already Know, in the next morning's guitar session (neutral defaults: morning at 07:00 UTC).
  await page.clock.setSystemTime(new Date('2026-11-03T07:05:00Z'));
  // Setup only: retire the metronome's free-practice card so a song is the next card served.
  await page.evaluate(async () => {
    const c = window.zg.replica.library.cards.get('mx-free-c');
    await window.zg.replica.record({ type: 'card-set', card: { ...c, retired: true } });
  });
  // Ear training (level 1) through the panel. Answering takes the new skills out of the morning queue.
  const ear = (fn, arg) => page.evaluate(fn, arg);
  await page.clock.runFor(30_000); // the page's own 30-second refresh picks up the new time
  assert.match(await page.textContent('[data-zg="ear-level"]'), /^Level 1: .* today 0 of 18 min/);
  assert.equal(await page.textContent('[data-zg="question"]'), 'Ear training: Up', 'the Now card serves a new ear skill');
  await show('today');
  await page.click('[data-zg="practice"]');
  await until(() => location.hash === '#/ear' && !document.querySelector('[data-zg="screen-ear"]').hidden);
  const answerRight = async () => {
    await page.click('[data-zg="ear-play"]');
    await until(() => window.zg.ear.ui.current().firstEnd !== null);
    const answer = await ear(() => window.zg.ear.ui.current().trial.answer);
    await page.click(`[data-zg="ear-choice"][data-choice="${answer}"]`);
    await until(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✓'));
  };
  await answerRight();
  for (const id of ['ear-direction-down-c', 'ear-direction-same-c']) {
    await ear((id) => window.zg.ear.ui.select(id), id);
    await answerRight();
  }
  const logged = await ear(() => window.zg.replica.library.reviews.get('ear-direction-up-c').map((r) => [r.details.correct, r.details.family, typeof r.details.latencyMs]));
  assert.deepEqual(logged, [[true, 'direction', 'number']]);
  assert.ok(await page.isVisible('[data-zg="ear-next"]'));
  assert.equal(await page.locator('[data-zg="ear-choice"]').count(), 0, 'choices close once answered');
  step('ear: played and answered in the panel, logged through the module contract');

  await ear(() => window.zg.ear.ui.select('ear-rhythm-r1-c'));
  assert.ok(await page.isVisible('[data-zg="ear-tap"]'));
  await page.click('[data-zg="ear-play"]');
  await page.dispatchEvent('[data-zg="ear-tap"]', 'pointerdown');
  assert.equal(await ear(() => window.zg.ear.ui.current().taps.length), 1, 'a tap is timed on the audio clock');
  await ear(() => {
    const c = window.zg.ear.ui.current();
    c.taps = c.trial.rhythm.onsets.map((o) => (o * 60) / c.trial.rhythm.bpm + 0.03); // a steady 30 ms touch lag
  });
  await page.clock.runFor(20_000); // the bar ends (about 12.5 s in); grading runs by itself
  await until(() => (window.zg.replica.library.reviews.get('ear-rhythm-r1-c') ?? []).length === 1);
  const tapped = await ear(() => window.zg.replica.library.reviews.get('ear-rhythm-r1-c')[0].details);
  assert.deepEqual([tapped.correct, tapped.missed, tapped.extra, tapped.lagMs], [true, 0, 0, 30], JSON.stringify(tapped));
  await until(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✓'));
  step('ear: rhythm echo is tapped back and graded after the bar, touch lag removed');

  await show('songs');
  await page.fill('[data-zg="songs-new"]', '  Blackbird ');
  await page.click('[data-zg="songs-add"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 1);
  await page.fill('[data-zg="songs-new"]', 'BLACKBIRD');
  await page.click('[data-zg="songs-add"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('already in your songs'));
  await openSheet('songs-paste');
  await page.fill('[data-zg="songs-paste"]', 'Little Wing\n\nblackbird\nWonderwall\n');
  await page.click('[data-zg="songs-paste-add"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Added 2 songs; skipped 1'));
  assert.equal(await sheetIsOpen('songs-paste'), false, 'the paste sheet closes once the songs are in');
  assert.equal(await page.locator('[data-zg="songs-list"] [data-zg="song"]').count(), 3);
  step('songs: add a title, duplicates refused, paste a list (blank lines and repeats skipped)');

  // Baseline (2026-11-02): every new song waits on the Songs screen for a rating without playing.
  assert.ok(await page.isVisible('[data-zg="songs-baseline"]'));
  assert.equal(await page.textContent('[data-zg="baseline-status"]'), '3 songs to rate.');
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-zg="baseline-song"]')].map((li) => li.firstChild.textContent.trim())), ['Blackbird', 'Little Wing', 'Wonderwall']);

  // Tabs (2026-11-02): a text tab and a picture, kept on this device; a web page is refused.
  const attachTabFile = async (title, file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.click(`[data-zg="songs-list"] [data-zg="song"] >> text=${title} >> [data-zg="song-tab-attach"]`);
    await (await chooser).setFiles(file);
  };
  await attachTabFile('Blackbird', { name: 'evil.html', mimeType: 'text/html', buffer: Buffer.from('<script>alert(1)</script>') });
  await until(() => document.querySelector('[data-zg="status"]').textContent.includes('Tab: a tab must be a PDF, a picture'));
  await attachTabFile('Blackbird', { name: 'blackbird.tab', mimeType: '', buffer: Buffer.from('e|---0---3---|\nB|-----0-----|') });
  await until(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song-tab"]').length === 1);
  assert.match(await status(), /Tab added to "Blackbird"; sign in to back it up/);
  const tabField = await page.evaluate(() => [...window.zg.replica.library.items.values()].find((i) => i.fields.title === 'Blackbird').fields);
  assert.deepEqual([tabField.tabName, tabField.tabType, tabField.tabBytes, tabField.tabUploaded], ['blackbird.tab', 'text/plain', 29, false]);
  await page.click('[data-zg="songs-list"] [data-zg="song"] >> text=Blackbird >> [data-zg="song-tab"]');
  await until(() => document.querySelector('[data-zg="sheet-songtab"]').open);
  assert.equal(await page.textContent('[data-zg="songtab-title"]'), 'Blackbird: tab');
  assert.equal(await page.textContent('pre[data-zg="songtab-content"]'), 'e|---0---3---|\nB|-----0-----|');
  assert.match(await page.getAttribute('[data-zg="songtab-open"]', 'href'), /^blob:/);
  await page.click('[data-zg="close-songtab"]');
  await until(() => !document.querySelector('[data-zg="sheet-songtab"]').open && document.querySelector('[data-zg="songtab-view"]').children.length === 0);
  // A 1x1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
  await attachTabFile('Wonderwall', { name: 'wonderwall.png', mimeType: 'image/png', buffer: png });
  await until(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song-tab"]').length === 2);
  await page.click('[data-zg="songs-list"] [data-zg="song"] >> text=Wonderwall >> [data-zg="song-tab"]');
  await until(() => document.querySelector('img[data-zg="songtab-content"]')?.complete && document.querySelector('img[data-zg="songtab-content"]').naturalWidth === 1);
  await page.keyboard.press('Escape');
  await until(() => !document.querySelector('[data-zg="sheet-songtab"]').open);
  step('songs: attach a tab (text or picture; a web page is refused), saved on this device, shown in the tab viewer');

  await show('today');
  assert.match(await page.textContent('[data-zg="session"]'), /morning · guitar/);
  assert.equal(await page.textContent('[data-zg="question"]'), 'Play: Blackbird');
  assert.ok(await page.isHidden('[data-zg="reveal"]'), 'nothing to reveal for a song');
  assert.ok(await page.isVisible('[data-zg="r-easy"]'));
  assert.ok(await page.isVisible('[data-zg="card-tab"]'), 'the song being played has its tab a tap away');
  await page.click('[data-zg="card-tab"]');
  await until(() => document.querySelector('[data-zg="sheet-songtab"]').open && document.querySelector('pre[data-zg="songtab-content"]'));
  await page.click('[data-zg="close-songtab"]');
  await until(() => !document.querySelector('[data-zg="sheet-songtab"]').open);
  await page.click('[data-zg="r-easy"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="question"]').textContent === 'Play: Little Wing');
  assert.ok(await page.isHidden('[data-zg="card-tab"]'), 'no tab, no button');
  const rated = await page.evaluate(() => {
    const card = [...window.zg.replica.library.cards.values()].find((c) => window.zg.replica.library.items.get(c.itemId)?.fields.title === 'Blackbird');
    return window.zg.replica.library.reviews.get(card.id).map((r) => r.rating);
  });
  assert.deepEqual(rated, ['easy']);
  assert.equal(await page.evaluate(() => window.zg.songs.enabled), true);
  step('songs: served in the morning session, played, rated through the module contract');

  await show('songs');
  await page.click('[data-zg="songs-list"] [data-zg="song"] >> nth=1 >> [data-zg="song-archive"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-archived"] [data-zg="song"]').length === 1);
  assert.equal(await page.textContent('[data-zg="question"]'), 'Play: Wonderwall', 'an archived song is not served');
  await page.click('[data-zg="songs-archive"] > summary'); // the archive is collapsed
  await page.click('[data-zg="songs-archived"] [data-zg="song-restore"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 3);
  page.once('dialog', (d) => d.accept('Little Wing (live)'));
  await page.click('[data-zg="songs-list"] [data-zg="song"] >> nth=1 >> [data-zg="song-rename"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="songs-list"]').textContent.includes('Little Wing (live)'));
  assert.ok(await page.evaluate(() => [...window.zg.replica.library.items.values()].find((i) => i.fields.title === 'Wonderwall').fields.tab), 'tabs survive the list changes');
  step('songs: archive (not served, history kept), restore, rename');

  // Baseline: Blackbird was played and rated, so it no longer waits; rate one of the others without playing it.
  assert.deepEqual(await page.evaluate(() => [...document.querySelectorAll('[data-zg="baseline-song"]')].map((li) => li.firstChild.textContent.trim())), ['Little Wing (live)', 'Wonderwall']);
  await page.click('[data-zg="baseline-song"]:has-text("Little Wing (live)") [data-zg="baseline-rate"][data-rating="good"]');
  await until(() => document.querySelector('[data-zg="baseline-status"]').textContent === '1 song to rate.');
  const base = await page.evaluate(() => {
    const lib = window.zg.replica.library;
    const card = [...lib.cards.values()].find((c) => lib.items.get(c.itemId)?.fields.title === 'Little Wing (live)');
    return lib.reviews.get(card.id).map((r) => [r.rating, r.durationMs, r.details.baseline]);
  });
  assert.deepEqual(base, [['good', 0, true]]);
  step('songs: baseline ratings without playing set each song\'s starting point in the scheduler');

  await show('ear');
  await ear(() => window.zg.ear.ui.select('ear-direction-same-c'));
  await page.click('[data-zg="ear-play"]');
  await until(() => window.zg.ear.ui.current().firstEnd !== null);
  const wrong = await ear(() => window.zg.ear.ui.current().trial.choices.find((c) => c.id !== 'same').id);
  await page.click(`[data-zg="ear-choice"][data-choice="${wrong}"]`);
  await until(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✗ The answer: Same'));
  assert.ok(await page.isVisible('[data-zg="ear-resolve"]'));
  await page.click('[data-zg="ear-resolve"]');
  await page.click('[data-zg="ear-next"]');
  assert.notEqual(await ear(() => window.zg.ear.ui.current().cardId), 'ear-direction-same-c', 'never the same skill twice in a row');
  step('ear: a wrong answer is corrected at once (the answer shown and replayed), then the next skill');

  await page.click('[data-zg="ear-unlock"]');
  await until(() => document.querySelector('[data-zg="ear-level"]').textContent.startsWith('Level 2'));
  assert.ok(await ear(() => window.zg.replica.library.cards.has('ear-degree-5-c')));
  await page.clock.setSystemTime(new Date('2026-11-03T18:00:00Z')); // quiet hours (17:00-19:00 set above)
  assert.ok(await page.isHidden('[data-zg="ear-next"]'), 'Next appears only after answering');
  const playsBefore = await ear(() => window.zg.ear.ui.current().plays);
  await page.click('[data-zg="ear-play"]');
  await until(() => document.querySelector('[data-zg="status"]').textContent.includes('Quiet hours: ear training needs sound.'));
  assert.equal(await ear(() => window.zg.ear.ui.current().plays), playsBefore, 'nothing played');
  await page.clock.setSystemTime(new Date('2026-11-03T07:30:00Z'));
  step('ear: unlock the next level by hand; nothing plays in quiet hours');

  // Recorder: a free take, then a timed improv run of 2 takes x 1 minute, saved separately.
  await show('record');
  const takesNow = () => page.evaluate(() => [...window.zg.replica.library.items.values()].filter((i) => i.module === 'recorder').map((i) => i.fields));
  await page.fill('[data-zg="rec-title"]', 'Blues in A');
  await page.click('[data-zg="rec-start"]');
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(2_000);
  await page.click('[data-zg="rec-stop"]');
  await until(() => document.querySelectorAll('[data-zg="takes-list"] [data-zg="take"]').length === 1);
  const [free] = await takesNow();
  assert.deepEqual([free.title, free.uploaded, free.archived, free.durationMs >= 2_000], ['Blues in A', false, false, true]);
  assert.match(free.type, /^audio\/(webm|mp4|ogg)$/);
  assert.ok(free.bytes > 0, 'real audio was captured');
  assert.match(await page.textContent('[data-zg="rec-status"]'), /Saved "Blues in A" .* sign in to back it up/);
  step('recorder: records a take from the microphone, saved on this device, queued for upload');

  await openSheet('improv');
  await page.fill('[data-zg="improv-prompt"]', 'Blues in E');
  await page.fill('[data-zg="improv-takes"]', '2');
  await page.fill('[data-zg="improv-minutes"]', '1');
  await closeSheet('improv');
  await page.click('[data-zg="improv-start"]');
  await until(() => document.querySelector('[data-zg="rec-timer"]').textContent.endsWith('/ 1:00'));
  await page.clock.runFor(61_000); // the 1-minute window runs out: the take stops and saves by itself
  await until(() => document.querySelector('[data-zg="improv-start"]').textContent === 'Start take 2 of 2');
  await page.click('[data-zg="improv-start"]');
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(1_500);
  await page.click('[data-zg="rec-stop"]');
  await until(() => document.querySelector('[data-zg="rec-status"]').textContent.startsWith('Improv finished: 2 takes'));
  const run = (await takesNow()).filter((f) => f.runId).sort((a, b) => a.index - b.index);
  assert.deepEqual(run.map((f) => [f.title, f.index, f.of, f.prompt]), [['Blues in E · take 1 of 2', 1, 2, 'Blues in E'], ['Blues in E · take 2 of 2', 2, 2, 'Blues in E']]);
  assert.equal(run[0].runId, run[1].runId);
  assert.ok(run[0].durationMs <= 60_000 && run[0].durationMs >= 59_000, 'the first take stopped at its window');
  step('recorder: timed improv run, each take stopped at its window and saved separately');

  page.once('dialog', (d) => d.accept('Blues in A (keeper)'));
  await page.click('[data-zg="takes-list"] [data-zg="take"] >> text=Blues in A · >> [data-zg="take-rename"]');
  await until(() => document.querySelector('[data-zg="takes-list"]').textContent.includes('Blues in A (keeper)'));
  await page.click('[data-zg="takes-list"] [data-zg="take"] >> text=Blues in A (keeper) >> [data-zg="take-archive"]');
  await until(() => document.querySelectorAll('[data-zg="takes-archived"] [data-zg="take"]').length === 1);
  await page.click('[data-zg="takes-archive"] > summary'); // the archive is collapsed
  await page.click('[data-zg="takes-archived"] [data-zg="take-restore"]');
  await until(() => document.querySelectorAll('[data-zg="takes-list"] [data-zg="take"]').length === 3);
  await page.click('[data-zg="takes-list"] [data-zg="take"] >> nth=0 >> [data-zg="take-play"]');
  await until(() => document.querySelector('[data-zg="take-player"]').src.startsWith('blob:'));
  const versions = await page.evaluate(() => window.zg.replica.log.filter((e) => e.type === 'item-set' && e.item.module === 'recorder').length);
  assert.equal(versions, 6, '3 takes + rename + archive + restore: every version kept');
  step('recorder: list, play, rename, archive and restore takes (no delete)');

  // Goals: "write a new record by X" with a timed task and a daily songwriting prompt (it is the morning session now).
  await show('goals');
  await openSheet('goal-new');
  await page.selectOption('[data-zg="goal-kind"]', 'general');
  await page.fill('[data-zg="goal-what"]', 'Write a new record');
  await page.fill('[data-zg="goal-why"]', 'Ten new songs by spring');
  await page.fill('[data-zg="goal-deadline"]', '2027-03-01');
  await page.fill('[data-zg="goal-tasks"]', '10 min in Chord Chemistry');
  await page.fill('[data-zg="goal-write-minutes"]', '1');
  await page.click('[data-zg="goal-save"]');
  await until(() => document.querySelectorAll('[data-zg="goals-list"] [data-zg="goal"]').length === 1);
  assert.equal(await sheetIsOpen('goal-new'), false, 'the new-goal sheet closes once the goal is saved');
  assert.match(await page.textContent('[data-zg="goals-list"]'), /Write a new record · general · by 2027-03-01 · 11 min a day · 10 min in Chord Chemistry, Songwriting prompt/);
  const blockText = await page.textContent('[data-zg="blocks"]');
  assert.match(blockText, /10 min in Chord Chemistry · 10 min/);
  assert.match(blockText, /Songwriting prompt · 1 min · .*[Rr]ecord.* \(1 × \d+ min, recorded\)/);
  step('goals: a deadline goal from the intake form; its timed task and today\'s songwriting prompt show in the session');

  assert.match(await page.textContent('[data-zg="today-blocks"]'), /10 min in Chord Chemistry · 10 min.*Songwriting prompt · 1 min/, 'Today lists the goal blocks');
  assert.equal(await page.textContent('[data-zg="goal-focus"]'), 'Write a new record', 'the goal leads Today');
  assert.match(await page.textContent('[data-zg="goal-focus-when"]'), /^Due Mon 1 Mar · \d+ days to go$/);
  assert.equal(await page.textContent('[data-zg="goal-focus-why"]'), 'Ten new songs by spring');
  assert.equal(await page.textContent('[data-zg="goal-focus-link"]'), 'All goals');
  await show('today');
  await page.click('[data-zg="blocks"] [data-zg="block-record"]');
  await until(() => location.hash === '#/record', null);
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(1_500);
  await page.click('[data-zg="rec-stop"]');
  await until(() => window.zg.replica.log.some((e) => e.type === 'task-done' && e.blockId === 'write'));
  const written = await takesNow();
  const forBlock = written.find((f) => f.blockId === 'write');
  assert.ok(forBlock && forBlock.goalId.startsWith('goal-') && forBlock.of === 1, 'the take is tied to the goal block');
  await until(() => !document.querySelector('[data-zg="blocks"]').textContent.includes('Record') || document.querySelectorAll('[data-zg="blocks"] [data-zg="block-record"]').length === 0);
  assert.match(await page.textContent('[data-zg="blocks"]'), /Songwriting prompt .*✓/);
  assert.match(await page.textContent('[data-zg="today-blocks"]'), /Songwriting prompt · 1 min ✓/, 'and ticks it off there too');
  step('goals: recording the songwriting prompt ticks the block off for today');

  await show('goals');
  await openSheet('goal-new');
  await page.selectOption('[data-zg="goal-kind"]', 'gig');
  await page.fill('[data-zg="goal-what"]', 'Friday gig');
  await page.fill('[data-zg="goal-deadline"]', '2026-11-10');
  await page.fill('[data-zg="goal-tasks"]', '');
  await page.fill('[data-zg="goal-write-minutes"]', '');
  await page.fill('[data-zg="goal-improv-takes"]', '5');
  await page.fill('[data-zg="goal-improv-minutes"]', '1');
  await page.fill('[data-zg="goal-improv-ramp-to"]', '4');
  await page.fill('[data-zg="goal-improv-ramp-days"]', '14');
  await page.click('[data-zg="goal-save"]');
  await until(() => document.querySelector('[data-zg="status"]').textContent.includes('Goal: improv ramp'));
  assert.equal(await sheetIsOpen('goal-new'), true, 'a refused goal keeps the sheet open to fix it');
  await page.fill('[data-zg="goal-improv-ramp-to"]', '10');
  await page.click('[data-zg="goal-save"]');
  await until(() => document.querySelectorAll('[data-zg="goals-list"] [data-zg="goal"]').length === 2);
  // 7 days before the gig, half way through a 14-day ramp from 5 to 10: 8 takes today.
  assert.match(await page.textContent('[data-zg="blocks"]'), /Improv takes · \d+ min · Improv takes \(8 × 1 min, recorded\)/);
  assert.match(await page.textContent('[data-zg="goals-list"]'), /Friday gig .*Post-gig rundown memo/);
  assert.equal(await page.textContent('[data-zg="goal-focus"]'), 'Friday gig', 'the nearest deadline leads');
  assert.match(await page.textContent('[data-zg="goal-focus-when"]'), /^Gig Tue 10 Nov · 7 days to go · and 1 more goal$/);
  const rowsToday = await page.evaluate(() => [...document.querySelectorAll('[data-zg="today-block"]')].map((li) => li.textContent));
  assert.ok(rowsToday[0].startsWith('Improv takes'), "the gig's own blocks come first");
  assert.ok(rowsToday.some((r) => /Songwriting prompt .*· for Write a new record$/.test(r)), "the other goal's blocks say whose they are");
  // Gig night: from 6pm on the gig's day the rundown memo shows, with Record (neutral defaults: UTC, day starts 4am).
  await page.clock.setSystemTime(new Date('2026-11-10T20:00:00Z'));
  await page.clock.runFor(30_000);
  await until(() => document.querySelector('[data-zg="blocks"]').textContent.includes('Post-gig rundown memo'));
  assert.match(await page.textContent('[data-zg="today-blocks"]'), /Post-gig rundown memo/, 'Today shows the memo on gig night');
  await show('today');
  await page.click('[data-zg="blocks"] [data-zg="block"] >> text=Post-gig rundown memo >> [data-zg="block-record"]');
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(2_000);
  await page.click('[data-zg="rec-stop"]');
  await until(() => window.zg.replica.log.some((e) => e.type === 'task-done' && e.blockId === 'memo'));
  assert.ok((await takesNow()).some((f) => f.blockId === 'memo' && f.title === 'Post-gig rundown memo'));
  await page.clock.setSystemTime(new Date('2026-11-03T07:40:00Z'));
  await page.clock.runFor(30_000);
  await show('goals');
  await page.click('[data-zg="goals-list"] [data-zg="goal"] >> text=Friday gig >> [data-zg="goal-archive"]');
  await until(() => document.querySelectorAll('[data-zg="goals-list"] [data-zg="goal"]').length === 1);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.goals.values()].filter((g) => g.archived).length), 1, 'archived, kept in history');
  step('goals: a gig goal ramps improv takes toward the date; its rundown memo shows on gig night and records; bad input refused; archive keeps the goal');

  // Theory and physics cards in the silent work-hours burst (neutral defaults: 12:30 UTC window, quiet hours 17-19 set above).
  await show('today');
  await page.clock.setSystemTime(new Date('2026-11-03T13:00:00Z'));
  await page.clock.runFor(30_000); // the page's own refresh picks up the new time
  assert.match(await page.textContent('[data-zg="session"]'), /during-work · silent/);
  const seen = new Set();
  for (let i = 0; i < 12 && seen.size < 2; i++) {
    const cardId = await page.evaluate(() => document.querySelector('[data-zg="card"]').dataset.card);
    const content = await page.evaluate((id) => window.zg.theory.content(id) ?? null, cardId);
    if (content) assert.ok(!/Benade|Winer|Source:|ch\. \d/.test(await page.textContent('[data-zg="card"]')), 'no sources on the card (Blake, 2026-11-02)');
    if (content) assert.equal(content.lesson, 1, 'only lesson 1 is unlocked');
    const before = await page.evaluate((id) => (window.zg.replica.library.reviews.get(id) ?? []).length, cardId);
    if (content?.type === 'mc' && !seen.has('mc')) {
      assert.equal(await page.locator('[data-zg="mc-choice"]').count(), 4);
      assert.ok(await page.isHidden('[data-zg="reveal"]'));
      const wrong = content.wrong[0];
      await page.click(`[data-zg="mc-choice"] >> text="${wrong}"`);
      await until((id) => (window.zg.replica.library.reviews.get(id) ?? []).length === 1, cardId);
      assert.match(await page.textContent('[data-zg="card-feedback"]'), /^✗ The answer: /);
      const r = await page.evaluate((id) => window.zg.replica.library.reviews.get(id)[0], cardId);
      assert.deepEqual([r.rating, r.details.correct, r.details.lesson], ['again', false, 1]);
      seen.add('mc');
      continue;
    }
    // Q/A (theory or test deck): show the answer, rate Good.
    await page.click('[data-zg="reveal"]');
    if (content?.type === 'qa' && !seen.has('qa')) {
      assert.equal(await page.textContent('[data-zg="answer"]'), content.answer);
      await page.click('[data-zg="r-good"]');
      await until((args) => (window.zg.replica.library.reviews.get(args.id) ?? []).length === args.n + 1, { id: cardId, n: before });
      const r = await page.evaluate((id) => window.zg.replica.library.reviews.get(id).at(-1), cardId);
      assert.deepEqual([r.rating, r.details.lesson], ['good', 1]);
      seen.add('qa');
      continue;
    }
    await page.click('[data-zg="r-good"]');
    await until((args) => (window.zg.replica.library.reviews.get(args.id) ?? []).length === args.n + 1, { id: cardId, n: before });
  }
  assert.deepEqual([...seen].sort(), ['mc', 'qa'], 'both card types came up in the silent burst');
  // Badges: the missed multiple-choice card's 1-minute step comes due. The gig-night step above moved the
  // clock to Nov 10 and back, and a device never back-dates its events, so these answers are stamped Nov 10:
  // look a day later, in the work-hours burst.
  await page.clock.setSystemTime(new Date('2026-11-11T13:05:00Z'));
  await page.clock.runFor(30_000);
  for (const [b, label] of [['today', 'Home'], ['cards', 'Cards']]) {
    await until((b) => !document.querySelector(`[data-zg="nav-badge-${b}"]`).hidden, b);
    const n = await page.textContent(`[data-zg="nav-badge-${b}"]`);
    assert.match(n, /^\d+$/, `${b} badge shows a count`);
    assert.ok(Number(n) >= 1);
    assert.equal(await page.getAttribute(`[data-zg="tab-${b}"]`, 'aria-label'), `${label}, ${n} due`, 'the count is read with the tab name');
  }
  const cardsDue = await page.evaluate(() => {
    const lib = window.zg.replica.library;
    return [...lib.cards.values()].filter((c) => lib.items.get(c.itemId)?.module === 'theory' && (lib.reviews.get(c.id) ?? []).some((r) => r.rating === 'again')).length;
  });
  assert.ok(Number(await page.textContent('[data-zg="nav-badge-cards"]')) >= cardsDue, 'Cards counts the theory cards due');
  step('badges: Home and Cards, in the menu, show their due counts once something is due');
  step('theory: the silent work-hours burst serves lesson 1\'s Q/A and multiple-choice cards, no sources shown, through the contract');

  // The course on the Cards screen: chapters, lesson 1 learning, the rest locked; the Extras switch.
  await show('cards');
  assert.equal(await page.locator('[data-zg="theory-chapter"]').count(), 5);
  const lessonRows = () => page.evaluate(() => [...document.querySelectorAll('[data-zg="theory-lesson"]')].map((li) => li.dataset.status));
  assert.deepEqual((await lessonRows()).slice(0, 3), ['current', 'locked', 'locked']);
  assert.equal((await lessonRows()).length, 24);
  assert.equal(await page.isChecked('[data-zg="theory-extras"]'), false, 'Extras start off');
  await page.click('label:has([data-zg="theory-extras"])');
  await until(() => document.querySelector('[data-zg="theory-extras-label"]').textContent.includes('(17 of 17 on)'));
  await page.click('label:has([data-zg="theory-extras"])');
  await until(() => document.querySelector('[data-zg="theory-extras-label"]').textContent.includes('(0 of 17 on)'));
  assert.ok(!/Benade|Winer/.test(await page.evaluate(() => document.body.innerText)), 'no sources anywhere on the page');
  // Graduation: every lesson 1 card right, then right again two days later (answered here through the module's host).
  const passLesson1 = () => page.evaluate(async () => {
    const host = window.zg.theory.host;
    for (const c of host.cards().filter((x) => x.id.startsWith('th-l01-'))) await host.reportRep(c.id, 'good', 2000);
  });
  await page.clock.setSystemTime(new Date('2026-11-12T13:05:00Z'));
  await passLesson1();
  await page.clock.setSystemTime(new Date('2026-11-12T13:20:00Z'));
  await passLesson1();
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  assert.equal((await lessonRows())[1], 'locked', 'right today is not enough');
  // Later days, right each time. The card missed earlier lapsed, so it needs a couple more on-time reviews than the rest.
  for (const day of ['2026-11-14', '2026-11-18', '2026-11-26']) {
    if ((await lessonRows())[0] === 'graduated') break;
    await page.clock.setSystemTime(new Date(`${day}T13:05:00Z`));
    await passLesson1();
    await page.reload();
    await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  }
  assert.deepEqual((await lessonRows()).slice(0, 3), ['graduated', 'current', 'locked'], 'right again on later days unlocks lesson 2');
  step('theory: the course by lesson; lesson 2 unlocks only when lesson 1 graduates (right again on a later day); Extras switch');

  // Teach (2026-11-03): the same flow as Home. Its popup lists today's objectives from the current chapter, then its deck.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => (location.hash = '#/today'));
  await arrive('today');
  assert.equal(await sheetIsOpen('objectives'), true, 'Home opens with its popup the first time');
  assert.equal(await page.textContent('[data-zg="today-lesson"]'), 'On Teach: Lesson 2 · Frequency, period and pitch (swipe left)');
  await dismissIntro();
  assert.ok(await page.isVisible('[data-zg="pager"]'), 'the page dots show on Home');
  assert.equal(await page.getAttribute('[data-zg="pager-today"]', 'aria-current'), 'page');
  await page.click('[data-zg="pager-teach"]'); // the visible way to the page beside Home
  await arrive('teach');
  assert.equal(await page.getAttribute('[data-zg="screen-teach"]', 'data-enter'), 'from-right', 'Teach slides in from the right');
  assert.equal(await sheetIsOpen('teach-objectives'), true, 'Teach opens with its popup, as Home does');
  assert.equal(await page.textContent('[data-zg="teach-chapter"]'), 'Chapter 1 · Sound itself · lesson 2 of 6');
  assert.equal(await page.textContent('[data-zg="teach-lesson"]'), 'Lesson 2 · Frequency, period and pitch');
  const teachBullets = await page.evaluate(() => [...document.querySelectorAll('[data-zg="teach-goals"] > [data-zg="teach-objective"]')].map((li) => li.textContent));
  assert.equal(teachBullets[0], 'Read the lesson: Frequency, period and pitch');
  assert.ok(teachBullets.includes('Learn 8 new cards'), teachBullets.join(' | '));
  assert.equal(teachBullets.at(-1), 'Make all 8 cards solid to unlock Lesson 3 · Amplitude and loudness (0 of 8 so far)');
  assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('[data-zg="sheet-teach-objectives"]'), '::backdrop').backgroundColor), /^rgb\(/, 'opaque, like Home');
  await page.click('[data-zg="teach-start"]');
  await until(() => !document.querySelector('[data-zg="sheet-teach-objectives"]').open && document.activeElement?.dataset.zg === 'lesson');
  assert.equal(await page.getAttribute('[data-zg="screen-teach"]', 'data-enter'), 'deck');
  assert.equal(await page.textContent('[data-zg="lesson-title"]'), 'Lesson 2 · Frequency, period and pitch (Sound itself)', 'a new lesson starts with its reading');
  // The deck: answer the card on show; the review lands through the module contract.
  const teachCard = await page.getAttribute('[data-zg="teach-card"]', 'data-card');
  assert.match(teachCard, /^th-l0[12]-/);
  const tc = await page.evaluate((id) => window.zg.theory.content(id), teachCard);
  if (tc.type === 'qa') {
    await page.click('[data-zg="teach-reveal"]');
    assert.equal(await page.textContent('[data-zg="teach-answer"]'), tc.answer);
    await page.click('[data-zg="teach-r-good"]');
  } else {
    await page.click(`[data-zg="teach-choice"] >> text="${tc.answer}"`);
    await until(() => document.querySelector('[data-zg="teach-feedback"]').textContent.startsWith('✓'));
  }
  await until((id) => (window.zg.replica.library.reviews.get(id) ?? []).some((r) => r.details.lesson >= 1 && r.at >= Date.now() - 60_000), teachCard);
  assert.notEqual(await page.getAttribute('[data-zg="teach-card"]', 'data-card'), teachCard, 'the next card');
  step('Teach: a popup of today\'s objectives from the current chapter (opaque, like Home), then the reading and the lesson deck; answers go through the contract');

  // Swiping: touch strokes and trackpad gestures move between Home and Teach; the dots mark the page.
  const stroke = async (from, to) => {
    await page.dispatchEvent('[data-zg="screens"]', 'pointerdown', { pointerType: 'touch', pointerId: 7, clientX: from, clientY: 400, isPrimary: true, bubbles: true });
    await page.dispatchEvent('[data-zg="screens"]', 'pointerup', { pointerType: 'touch', pointerId: 7, clientX: to, clientY: 410, isPrimary: true, bubbles: true });
  };
  await stroke(100, 320); // finger to the right: back to Home
  await arrive('today');
  assert.equal(await page.getAttribute('[data-zg="screen-today"]', 'data-enter'), 'from-left');
  assert.equal(await page.getAttribute('[data-zg="pager-today"]', 'aria-current'), 'page');
  assert.equal(await sheetIsOpen('objectives'), false, 'each page opens with its popup once');
  await stroke(320, 100); // finger to the left: Teach
  await arrive('teach');
  await stroke(320, 100); // nothing past the last page
  await page.waitForTimeout(150);
  assert.equal(new URL(page.url()).hash, '#/teach');
  await stroke(300, 280); // a nudge is not a swipe
  await page.waitForTimeout(150);
  assert.equal(new URL(page.url()).hash, '#/teach');
  await page.mouse.move(195, 500);
  await page.mouse.wheel(-150, 0); // two fingers moving right on a trackpad: Home
  await arrive('today');
  await page.waitForTimeout(300); // the gesture ends
  await page.mouse.wheel(150, 0); // and left: Teach
  await arrive('teach');
  await page.waitForTimeout(300);
  await page.mouse.wheel(0, 300); // scrolling down is just scrolling
  await page.waitForTimeout(150);
  assert.equal(new URL(page.url()).hash, '#/teach');
  await page.goBack();
  await arrive('today');
  step('swipe: touch and trackpad move between Home and Teach (back works, nothing past the ends, nudges and scrolling ignored); the page dots show where you are');

  // Reduced motion: the same flow, no entrances.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.click('[data-zg="today-objectives"]');
  await until(() => document.querySelector('[data-zg="sheet-objectives"]').open);
  await page.click('[data-zg="today-start"]');
  await until(() => document.activeElement?.dataset.zg === 'now');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-zg="now"]')).animationName), 'none', 'no entrance under reduced motion');
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('[data-zg="sheet-objectives"]')).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  step('reduced motion: the popups and the move into the deck happen without animation');
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.clock.setSystemTime(new Date('2026-11-03T07:40:00Z'));

  await show('settings');
  assert.ok(await page.isChecked('[data-zg="notify-morning-always"]'), 'morning reminder always on by default');
  await page.uncheck('[data-zg="notify-morning-always"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.alwaysRemindMorning === false);
  await page.check('[data-zg="notify-morning-always"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.alwaysRemindMorning === true);
  step('morning-reminder setting is saved from its checkbox');

  const firstReviews = await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the worker take control and cache the shell
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), firstReviews, 'every review still there offline');
  assert.ok(await page.evaluate(async () => Boolean(await caches.match('./sounds/kick.mp3'))), 'drum sounds cached for offline');
  await context.setOffline(false);
  step('works offline after the first visit (service worker shell + local data)');

  await show('settings');
  await page.click('[data-zg="open-signin"]');
  await until(() => document.querySelector('[data-zg="sheet-signin"]').open);
  await page.fill('[data-zg=\"email\"]', 'blake@example.com');
  await page.fill('[data-zg=\"code\"]', 'abc');
  await page.click('[data-zg=\"verify\"]');
  assert.match(await status(), /Enter the code/);
  assert.equal(await page.textContent('[data-zg="signin-note"]'), 'Enter the code from the email.', 'and says so inside the popup');
  await page.click('[data-zg="signin-later"]');
  await until(() => !document.querySelector('[data-zg="sheet-signin"]').open);
  step('sign-in (in its popup) by typed email code checks the code first');

  // Sign-in popup at launch (2026-11-02). A connection is set up (a fake Supabase client stands in for
  // supabase-js): signed out, the popup opens straight away; "Not now" keeps this device only.
  const FAKE_SUPABASE = `
    const db = (globalThis.__fakeDb ??= { events: [], seq: 0, files: new Map() });
    const ok = (data) => Promise.resolve({ data, error: null });
    export function createClient() {
      return {
        auth: {
          getSession: async () => ({ data: { session: localStorage.getItem('fake-session') ? { user: { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'blake@example.com' } } : null } }),
          signInWithOtp: async () => ({ error: null }),
          verifyOtp: async () => ({ error: { message: 'Token has expired or is invalid' } }),
          signOut: async () => localStorage.removeItem('fake-session'),
        },
        from() {
          return {
            upsert(rows) { for (const r of rows) if (!db.events.some((e) => e.id === r.id)) db.events.push({ seq: ++db.seq, id: r.id, event: r.event }); return ok(null); },
            select() { const q = { after: 0, eq() { return q; }, gt(c, v) { q.after = v; return q; }, order() { return q; }, limit(n) { return ok(db.events.filter((e) => e.seq > q.after).slice(0, n).map((e) => ({ seq: e.seq, event: e.event }))); } }; return q; },
          };
        },
        rpc: (fn) => ok(fn === 'band_status' ? { role: 'owner' } : null),
        storage: { from: (bucket) => ({
          upload: async (path, body) => { const k = bucket + '/' + path; if (db.files.has(k)) return { data: null, error: { message: 'already exists', statusCode: '409' } }; db.files.set(k, body); globalThis.__uploads = [...db.files.keys()]; return { data: { path }, error: null }; },
          download: async (path) => (db.files.has(bucket + '/' + path) ? { data: db.files.get(bucket + '/' + path), error: null } : { data: null, error: { message: 'not found' } }),
        }) },
      };
    }`;
  const connected = await browser.newContext({ timezoneId: 'UTC' });
  await connected.route('https://esm.sh/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_SUPABASE }));
  await connected.addInitScript(() => localStorage.setItem('zg-config', JSON.stringify({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' })));
  const signin = await connected.newPage();
  signin.on('pageerror', (e) => errors.push(e.message));
  await signin.goto(url);
  await signin.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  assert.equal(await signin.evaluate(() => document.querySelector('[data-zg="sheet-signin"]').open), true, 'signed out: the sign-in popup is up at launch');
  assert.equal(await signin.evaluate(() => document.querySelector('[data-zg="sheet-signin"]').matches(':modal')), true);
  assert.equal(await signin.evaluate(() => document.querySelector('[data-zg="account"]').textContent), 'Not signed in');
  await signin.fill('[data-zg="email"]', 'blake@example.com');
  await signin.click('[data-zg="sign-in"]');
  await signin.waitForFunction(() => document.querySelector('[data-zg="signin-note"]').textContent.startsWith('Check your email'));
  assert.equal(await signin.evaluate(() => document.querySelector('[data-zg="sheet-goal-new"]').open), true, 'on top of the opening (no goal yet: the new-goal sheet)');
  await signin.click('[data-zg="signin-later"]');
  await signin.waitForFunction(() => !document.querySelector('[data-zg="sheet-signin"]').open);
  assert.deepEqual(await signin.evaluate(() => [location.hash, document.querySelector('[data-zg="sheet-goal-new"]').open]), ['#/goals', true], 'and the opening carries on underneath');
  step('sign-in: signed out with a connection set up, the popup opens at launch, on top of the opening; Not now keeps this device only');

  // The first goal, from the opening's new-goal sheet: once saved, Home opens with its popup for it.
  await signin.fill('[data-zg="goal-what"]', 'Open mic');
  await signin.fill('[data-zg="goal-deadline"]', '2026-12-01');
  await signin.fill('[data-zg="goal-tasks"]', '10 min on the opener');
  await signin.click('[data-zg="goal-save"]');
  await signin.waitForFunction(() => location.hash === '#/today' && document.querySelector('[data-zg="sheet-objectives"]').open);
  assert.equal(await signin.textContent('[data-zg="goal-focus"]'), 'Open mic');
  assert.match(await signin.evaluate(() => document.querySelector('[data-zg="today-blocks"]').textContent), /10 min on the opener · \d+ min/);
  await signin.click('[data-zg="today-start"]');
  await signin.waitForFunction(() => !document.querySelector('[data-zg="sheet-objectives"]').open);
  // Opening again with a goal: Home's popup, nothing else.
  await signin.goto(url);
  await signin.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  assert.deepEqual(await signin.evaluate(() => [location.hash, document.querySelector('[data-zg="sheet-objectives"]').open, document.querySelector('[data-zg="sheet-signin"]').open]), ['#/today', true, true], 'Home\'s popup, with sign-in on top while signed out');
  await signin.click('[data-zg="signin-later"]');
  await signin.click('[data-zg="today-start"]');
  await signin.waitForFunction(() => !document.querySelector('[data-zg="sheet-objectives"]').open);
  step('first goal: saving it from the opening sheet opens Home with its popup; opening the app again shows that popup first');

  // Signed in: no popup; a tab added here is backed up to the user's own folder on sync.
  await signin.evaluate(() => localStorage.setItem('fake-session', '1'));
  await signin.reload();
  await signin.waitForFunction(() => /Synced|Offline/.test(document.querySelector('[data-zg="status"]').textContent));
  assert.equal(await signin.evaluate(() => document.querySelector('[data-zg="sheet-signin"]').open), false, 'signed in: no popup');
  await signin.evaluate(() => (location.hash = '#/songs'));
  await signin.fill('[data-zg="songs-new"]', 'Blackbird');
  await signin.click('[data-zg="songs-add"]');
  await signin.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 1);
  const chooser = signin.waitForEvent('filechooser');
  await signin.click('[data-zg="song-tab-attach"]');
  await (await chooser).setFiles({ name: 'blackbird.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await signin.waitForFunction(() => (globalThis.__uploads ?? []).some((k) => /^tabs\/aaaaaaaa-0000-0000-0000-000000000001\/tab-[A-Za-z0-9-]+\.pdf$/.test(k)));
  await signin.waitForFunction(() => [...window.zg.replica.library.items.values()].some((i) => i.fields.title === 'Blackbird' && i.fields.tabUploaded === true));
  await connected.close();
  step('tabs: signed in, a tab is uploaded on sync to tabs/<user id>/tab-<id>.pdf and marked backed up');


  // ----------------------------------------------------------- band members (2026-11-03)
  // A fake Supabase shared by every browser context (Node side, so the owner and the member see one server).
  // It mimics the migration's rules closely enough to drive the app; the real rules are proven in test/sql.
  const OWNER = 'aaaaaaaa-0000-4000-8000-000000000001';
  const MEMBER = 'cccccccc-0000-4000-8000-000000000003';
  const NEWBIE = 'dddddddd-0000-4000-8000-000000000004';
  const server = (() => {
    const ids = { 'blake@example.com': OWNER, 'mike@example.com': MEMBER, 'sam@example.com': NEWBIE };
    const events = [];
    const files = new Map();
    const invites = [];
    const members = new Map();
    const calls = [];
    let seq = 0;
    const ok = (data) => ({ data, error: null });
    const err = (message) => ({ data: null, error: { message } });
    const ownerOf = (me) => (members.get(me)?.status === 'active' ? members.get(me).owner : null);
    const songsOnly = (e) => (e.type === 'item-set' && e.item?.module === 'songs') || (e.type === 'card-set' && e.card?.template === 'song');
    const visible = (me, row) => row.user === me || (row.user === ownerOf(me) && songsOnly(row.event));
    const status = (i) => (i.revoked ? 'revoked' : i.used ? 'used' : i.expires <= Date.now() ? 'expired' : 'open');
    const rpc = (me, fn, a) => {
      calls.push(fn);
      if (!me) return err('not signed in');
      const m = members.get(me);
      switch (fn) {
        case 'band_status':
          return ok(!m ? { role: 'owner' } : m.status === 'active' ? { role: 'member', owner_id: m.owner } : { role: 'removed' });
        case 'create_band_invite': {
          if (m) return err('band members cannot invite anyone');
          const i = { id: randomUUID(), owner: me, token: randomBytes(32).toString('hex'), note: a.p_note, created: Date.now(), expires: Date.now() + 7 * 864e5 };
          invites.push(i);
          return ok({ id: i.id, token: i.token, expires_at: new Date(i.expires).toISOString() });
        }
        case 'revoke_band_invite': {
          const i = invites.find((x) => x.id === a.p_id && x.owner === me && status(x) === 'open');
          if (!i) return err('no open invite of yours with that id');
          i.revoked = true;
          return ok(null);
        }
        case 'accept_band_invite': {
          const i = invites.find((x) => x.token === a.p_token);
          if (!i) return err('This invite link is not valid.');
          if (status(i) !== 'open') return err(`This invite was ${status(i) === 'used' ? 'already used' : status(i)}. Ask for a new link.`);
          if (m || events.some((e) => e.user === me)) return err('Invites are for new accounts. Sign in with an email that has no Zuniga Guitar account yet.');
          i.used = true;
          members.set(me, { owner: i.owner, note: i.note, status: 'active', joined: Date.now(), removed: null, deleted: false });
          return ok({ role: 'member', owner_id: i.owner });
        }
        case 'band_overview':
          if (m) return err('band members cannot manage a band');
          return ok({
            invites: invites.filter((i) => i.owner === me).reverse().map((i) => ({ id: i.id, note: i.note, created_at: new Date(i.created).toISOString(), expires_at: new Date(i.expires).toISOString(), status: status(i) })),
            members: [...members].filter(([, x]) => x.owner === me).map(([id, x]) => ({ member_id: id, note: x.note, status: x.status, joined_at: new Date(x.joined).toISOString(), removed_at: x.removed && new Date(x.removed).toISOString(), data_deleted: x.deleted })),
          });
        case 'remove_band_member': {
          const x = members.get(a.p_member);
          if (!x || x.owner !== me || x.status !== 'active') return err('no active member of your band with that id');
          Object.assign(x, { status: 'removed', removed: Date.now() });
          return ok(null);
        }
        case 'delete_band_member_data': {
          const x = members.get(a.p_member);
          if (!x || x.owner !== me || x.status !== 'removed') return err('only a member you have removed from your band');
          const before = events.length;
          events.splice(0, events.length, ...events.filter((e) => e.user !== a.p_member));
          x.deleted = true;
          return ok(before - events.length);
        }
        case 'replace_nudges':
        case 'save_push_subscription':
          return m ? err('band members have no reminders') : ok(null);
        default:
          return err(`no function ${fn}`);
      }
    };
    const handle = (op, p) => {
      const me = p.me ?? null;
      switch (op) {
        case 'signup':
          return ok(ids[p.email] ?? null);
        case 'email':
          return ok(Object.keys(ids).find((k) => ids[k] === p.id) ?? null);
        case 'upsert': {
          if (!me) return err('not signed in');
          if (members.has(me) && (!ownerOf(me) || p.rows.some((r) => !['review', 'settings-set'].includes(r.event.type)))) return err('new row violates row-level security policy for table "events"');
          for (const r of p.rows) if (!events.some((e) => e.user === me && e.id === r.id)) events.push({ seq: ++seq, user: me, id: r.id, event: r.event });
          return ok(null);
        }
        case 'select':
          return ok(events.filter((e) => e.seq > p.after && (p.stream === null || e.user === p.stream) && visible(me, e)).slice(0, p.limit).map(({ seq: q, event }) => ({ seq: q, event })));
        case 'rpc':
          return rpc(me, p.fn, p.args);
        case 'upload': {
          if (!me || p.path.split('/')[0] !== me || members.has(me)) return err('new row violates row-level security policy');
          const key = `${p.bucket}/${p.path}`;
          if (files.has(key)) return { data: null, error: { message: 'already exists', statusCode: '409' } };
          files.set(key, { b64: p.b64, type: p.type });
          return ok({ path: p.path });
        }
        case 'download': {
          const folder = p.path.split('/')[0];
          const key = `${p.bucket}/${p.path}`;
          if (!me || !(folder === me || (p.bucket === 'tabs' && folder === ownerOf(me))) || !files.has(key)) return err('Object not found');
          return ok(files.get(key));
        }
      }
      return err(`bad op ${op}`);
    };
    return { handle, events, files, invites, members, calls };
  })();
  const FAKE_BAND_SUPABASE = `
    const call = (op, p) => window.fakeSupabase(op, p);
    const me = () => localStorage.getItem('fake-session');
    const b64 = async (blob) => { let s = ''; for (const x of new Uint8Array(await blob.arrayBuffer())) s += String.fromCharCode(x); return btoa(s); };
    export function createClient() {
      return {
        auth: {
          getSession: async () => { const id = me(); return { data: { session: id ? { user: { id, email: (await call('email', { id })).data } } : null } }; },
          signInWithOtp: async () => ({ error: null }),
          verifyOtp: async ({ email, token }) => { if (token !== '123456') return { error: { message: 'Token has expired or is invalid' } }; localStorage.setItem('fake-session', (await call('signup', { email })).data); return { error: null }; },
          signOut: async () => { localStorage.removeItem('fake-session'); return {}; },
        },
        from() {
          return {
            upsert: (rows) => call('upsert', { me: me(), rows }),
            select() { const q = { stream: null, after: 0, eq(c, v) { q.stream = v; return q; }, gt(c, v) { q.after = v; return q; }, order() { return q; }, limit(n) { return call('select', { me: me(), stream: q.stream, after: q.after, limit: n }); } }; return q; },
          };
        },
        rpc: (fn, args) => call('rpc', { me: me(), fn, args }),
        storage: { from: (bucket) => ({
          upload: async (path, body) => call('upload', { me: me(), bucket, path, b64: await b64(body), type: body.type }),
          download: async (path) => { const r = await call('download', { me: me(), bucket, path }); return r.error ? r : { data: new Blob([Uint8Array.from(atob(r.data.b64), (c) => c.charCodeAt(0))], { type: r.data.type }), error: null }; },
        }) },
      };
    }`;
  /** A browser context (one person's device) on the shared fake server, signed in as `who` (or signed out). */
  const device = async (who, timezoneId = 'UTC') => {
    const ctx = await browser.newContext({ timezoneId });
    await ctx.exposeFunction('fakeSupabase', (op, p) => server.handle(op, p));
    await ctx.route('https://esm.sh/**', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_BAND_SUPABASE }));
    await ctx.addInitScript((id) => {
      if (location.protocol === 'about:') return; // about:blank has no storage
      localStorage.setItem('zg-config', JSON.stringify({ supabaseUrl: 'https://example.supabase.co', publishableKey: 'sb_publishable_test' }));
      if (id && !sessionStorage.getItem('signed')) (localStorage.setItem('fake-session', id), sessionStorage.setItem('signed', '1'));
    }, who);
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    return { ctx, p };
  };
  /** ZG_SHOTS=<folder>: also save screenshots of the band screens there, to look at. */
  const shot = (p, name) => (process.env.ZG_SHOTS ? p.screenshot({ path: join(process.env.ZG_SHOTS, `${name}.png`), fullPage: true }) : null);
  const openSheetIn = (p, n) => p.waitForFunction((x) => document.querySelector(`[data-zg="sheet-${x}"]`).open, n);
  const go = async (p, screen) => {
    await p.evaluate((s) => (location.hash = `#/${s}`), screen);
    await p.waitForFunction((s) => !document.querySelector(`[data-zg="screen-${s}"]`).hidden, screen);
  };

  // Blake: two songs (one with a tab), his own rating of one, then an invite for Mike and a spare he revokes.
  const blake = await device(OWNER);
  await blake.p.goto(url);
  await blake.p.waitForFunction(() => /Synced/.test(document.querySelector('[data-zg="status"]').textContent));
  await blake.p.keyboard.press('Escape'); // no goal yet: past the new-goal sheet
  await go(blake.p, 'songs');
  for (const [n, title] of ['Blackbird', 'Wonderwall'].entries()) {
    await blake.p.fill('[data-zg="songs-new"]', title);
    await blake.p.click('[data-zg="songs-add"]');
    await blake.p.waitForFunction((k) => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === k, n + 1);
  }
  await blake.p.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 2);
  const chooserB = blake.p.waitForEvent('filechooser');
  await blake.p.click('[data-zg="songs-list"] [data-zg="song"]:has-text("Blackbird") [data-zg="song-tab-attach"]');
  await (await chooserB).setFiles({ name: 'blackbird.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%%EOF\n') });
  await blake.p.click('[data-zg="baseline-song"]:has-text("Blackbird") [data-zg="baseline-rate"][data-rating="easy"]');
  await blake.p.waitForFunction(() => [...window.zg.replica.library.items.values()].some((i) => i.fields.tabUploaded === true) && window.zg.replica.pendingCount === 0);
  assert.ok([...server.files.keys()].some((k) => k.startsWith(`tabs/${OWNER}/tab-`)), 'Blake\'s tab is in his folder');
  await go(blake.p, 'settings');
  assert.match(await blake.p.textContent('[data-zg="band-role"]'), /^Invite your band\./);
  assert.equal(await blake.p.isVisible('[data-zg="band-manage"]'), true);
  await blake.p.fill('[data-zg="band-invite-note"]', 'Mike (bass)');
  await blake.p.click('[data-zg="band-invite"]');
  await blake.p.waitForFunction(() => !document.querySelector('[data-zg="band-invite-made"]').hidden);
  const link = await blake.p.inputValue('[data-zg="band-invite-link"]');
  assert.match(link, new RegExp(`^${url.replace(/[/.]/g, '\\$&')}\\?invite=[0-9a-f]{64}$`), 'the link is the app with the token');
  await blake.p.waitForFunction(() => document.querySelector('[data-zg="band-invites"]').textContent.includes('Mike (bass) · open, expires'));
  await blake.p.fill('[data-zg="band-invite-note"]', 'Spare');
  await blake.p.click('[data-zg="band-invite"]');
  await blake.p.waitForFunction(() => document.querySelectorAll('[data-zg="band-invite-row"]').length === 2);
  await blake.p.click('[data-zg="band-invite-row"]:has-text("Spare") [data-zg="band-invite-revoke"]');
  await blake.p.waitForFunction(() => document.querySelector('[data-zg="band-invite-row"][data-status="revoked"]')?.textContent.startsWith('Spare · revoked'));
  assert.deepEqual(await blake.p.evaluate(() => [document.querySelector('[data-zg="band-invite-made"]').hidden, document.querySelector('[data-zg="band-invite-link"]').value]), [true, ''], 'a revoked invite\'s link is taken off the page');
  assert.equal(await blake.p.$$eval('[data-zg="band-invite-row"][data-status="revoked"] button', (b) => b.length), 0, 'nothing to do on a revoked invite');
  await shot(blake.p, 'band-owner-settings');
  await go(blake.p, 'songs');
  assert.equal(await blake.p.inputValue('[data-zg="band-invite-link"]'), '', 'leaving Settings takes the link (it holds the token) off the page');
  step('band: Blake makes a single-use invite link in Settings, sees his invites, and revokes one');

  // Mike opens the link on his phone, signed out: the token leaves the address bar; he signs in with a new email and joins.
  const mike = await device(null, 'America/New_York'); // his own time zone: his one settings event
  await mike.p.goto(link);
  await mike.p.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  assert.equal(new URL(mike.p.url()).search, '', 'the token is out of the address');
  await openSheetIn(mike.p, 'signin');
  assert.equal(await mike.p.isVisible('[data-zg="signin-invite"]'), true, 'the popup says he was invited');
  await mike.p.fill('[data-zg="email"]', 'mike@example.com');
  await mike.p.fill('[data-zg="code"]', '123456');
  await mike.p.click('[data-zg="verify"]');
  await mike.p.waitForFunction(() => window.zg?.role?.role === 'member' && document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 2);
  assert.equal(await mike.p.evaluate(() => localStorage.getItem('zg-invite')), null, 'the token is gone once used');
  assert.equal(new URL(mike.p.url()).hash, '#/songs', 'his app opens on Songs');
  assert.match(await mike.p.textContent('[data-zg="account"]'), /mike@example\.com \(band member\)$/);
  step('band: Mike opens the link signed out, signs in with a new email, and joins as a band member');

  // Only Songs and Settings, in the menu and by URL.
  await mike.p.click('[data-zg="menu"]');
  const menuShown = await mike.p.$$eval('[data-zg="menu-list"] > a', (as) => as.filter((a) => !a.hidden).map((a) => a.dataset.zg));
  assert.deepEqual(menuShown, ['tab-songs', 'menu-settings']);
  await mike.p.keyboard.press('Escape');
  for (const s of ['today', 'teach', 'record', 'ear', 'goals', 'cards']) {
    await mike.p.evaluate((x) => (location.hash = `#/${x}`), s);
    await mike.p.waitForFunction(() => location.hash === '#/songs');
    assert.deepEqual(await mike.p.evaluate(() => [...document.querySelectorAll('[data-zg^="screen-"]')].filter((e) => !e.hidden).map((e) => e.dataset.zg)), ['screen-songs'], `#/${s} leads back to Songs`);
  }
  await mike.p.goto('about:blank'); // a hash-only change would not reload
  await mike.p.goto(`${url}#/goals`);
  await mike.p.waitForFunction(() => window.zg?.role?.role === 'member' && document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 2);
  assert.equal(new URL(mike.p.url()).hash, '#/songs', 'a fresh load of another screen lands on Songs too');
  assert.equal(await mike.p.evaluate(() => [...document.querySelectorAll('dialog')].some((d) => d.open)), false, 'no objectives popup, no new-goal sheet');
  assert.equal(await mike.p.evaluate(() => Boolean(window.zg.deck || window.zg.theory || window.zg.metronome)), false, 'no other module is even set up');
  assert.deepEqual(await mike.p.evaluate(() => [window.zg.replica.log.map((e) => e.type), window.zg.replica.library.settings.dayStart.timeZone]), [['settings-set'], 'America/New_York'], 'his log: only his own time zone; nothing seeded');
  step('band: Mike\'s menu has only Songs and Settings; every other screen is out of reach by URL; nothing else is set up');

  // Songs, read only: Blake's titles and tab, none of Blake's ratings; he rates in his own log.
  for (const h of ['songs-new-label', 'songs-add', 'open-songs-paste', 'songs-archive']) assert.equal(await mike.p.isHidden(`[data-zg="${h}"]`), true, `${h} hidden`);
  assert.equal(await mike.p.isVisible('[data-zg="songs-band"]'), true);
  assert.equal(await mike.p.$$eval('[data-zg="songs-list"] button', (bs) => bs.filter((b) => /rename|archive|attach/.test(b.dataset.zg)).length), 0, 'no rename, archive or tab buttons');
  assert.deepEqual(await mike.p.$$eval('[data-zg="baseline-song"] > span', (xs) => xs.map((x) => x.textContent)), ['Blackbird', 'Wonderwall'], 'Blake\'s baseline is not his: both wait for his');
  await mike.p.click('[data-zg="songs-list"] [data-zg="song"]:has-text("Blackbird") [data-zg="song-tab"]');
  await openSheetIn(mike.p, 'songtab');
  assert.equal(await mike.p.getAttribute('[data-zg="songtab-open"]', 'download'), 'blackbird.pdf', 'he can download the tab');
  assert.match(await mike.p.getAttribute('[data-zg="songtab-open"]', 'href'), /^blob:/);
  await mike.p.click('[data-zg="close-songtab"]');
  await mike.p.click('[data-zg="baseline-song"]:has-text("Blackbird") [data-zg="baseline-rate"][data-rating="hard"]');
  await mike.p.waitForFunction(() => document.querySelector('[data-zg="songs-list"] [data-zg="song"]')?.querySelector('[data-zg="song-due"]')?.textContent.startsWith('Next: '));
  await mike.p.click('[data-zg="songs-list"] [data-zg="song"]:has-text("Blackbird") [data-zg="song-rate"][data-rating="good"]');
  await mike.p.waitForFunction(() => window.zg.replica.log.filter((e) => e.type === 'review').length === 2 && window.zg.replica.pendingCount === 0);
  const blackbirdCard = await mike.p.evaluate(() => [...window.zg.replica.library.items.values()].find((i) => i.fields.title === 'Blackbird').id + '-c');
  assert.deepEqual(await mike.p.evaluate((c) => window.zg.replica.library.reviews.get(c).map((r) => r.rating), blackbirdCard), ['hard', 'good'], 'his ratings only: not Blake\'s Easy');
  assert.deepEqual(server.events.filter((e) => e.user === MEMBER).map((e) => e.event.type).sort(), ['review', 'review', 'settings-set'], 'his rows: his ratings and his time zone, nothing else');
  assert.equal(server.events.filter((e) => e.user === OWNER && e.event.type === 'review').length, 1, 'Blake\'s rows: still only his own rating');
  await shot(mike.p, 'band-member-songs');
  await assert.rejects(mike.p.evaluate(() => window.zg.replica.record({ type: 'item-set', item: { id: 'song-x', module: 'songs', fields: { title: 'Mine' } } })), /only record review and settings-set/, 'his app refuses a song write too');
  step('band: Mike sees Blake\'s songs and tab read only, downloads the tab, and rates (baseline, then played) in his own rows only');

  // His Settings: account, band, backup; no reminders, practice times or setup tools.
  await go(mike.p, 'settings');
  for (const h of ['settings-notify', 'settings-times', 'dev', 'band-manage']) assert.equal(await mike.p.isHidden(`[data-zg="${h}"]`), true, `${h} hidden`);
  assert.match(await mike.p.textContent('[data-zg="band-role"]'), /^You're a band member/);
  for (const h of ['sign-out', 'sync', 'export']) assert.equal(await mike.p.isVisible(`[data-zg="${h}"]`), true, h);
  step('band: Mike\'s Settings: his account, sign-out, sync and backup only');

  // Blake sees Mike in his band, never his ratings; removes him; Mike's app is cut off on its next sync.
  await go(blake.p, 'settings');
  await blake.p.waitForFunction(() => document.querySelector('[data-zg="band-member-row"]')?.textContent.startsWith('Mike (bass) · member since'));
  await blake.p.click('[data-zg="sync"]');
  await blake.p.waitForFunction(() => /Synced/.test(document.querySelector('[data-zg="status"]').textContent));
  assert.equal(await blake.p.evaluate(() => window.zg.replica.log.filter((e) => e.type === 'review').length), 1, 'Mike\'s ratings never reach Blake');
  await blake.p.click('[data-zg="band-member-remove"]');
  await blake.p.waitForFunction(() => document.querySelector('[data-zg="band-member-row"]')?.dataset.status === 'removed');
  await mike.p.click('[data-zg="sync"]');
  await mike.p.waitForFunction(() => window.zg?.role?.role === 'removed');
  await go(mike.p, 'songs');
  assert.equal(await mike.p.textContent('[data-zg="songs-band-title"]'), 'Access removed');
  assert.equal(await mike.p.$$eval('[data-zg="songs-list"] > li', (x) => x.length), 0, 'none of Blake\'s songs left on his phone');
  assert.deepEqual(await mike.p.evaluate(async () => (await indexedDB.databases()).map((d) => d.name).filter((n) => n.endsWith('-band')).length), 0, 'the copy of Blake\'s songs and tabs is deleted from his device');
  assert.equal(await mike.p.evaluate(() => window.zg.replica.log.length), 3, 'his own ratings stay with him');
  step('band: Blake sees Mike, never his ratings; removing him cuts him off and clears Blake\'s songs and tabs from his phone');

  // Deleting Mike's data: only after removal, only Blake, behind a confirm (Keep it does nothing).
  await blake.p.click('[data-zg="band-member-delete"]');
  await openSheetIn(blake.p, 'band-delete');
  assert.equal(await blake.p.textContent('[data-zg="band-delete-who"]'), 'Mike (bass): their ratings and settings.');
  assert.equal(await blake.p.evaluate(() => document.activeElement.dataset.zg), 'band-delete-cancel', 'the safe choice has the focus');
  await shot(blake.p, 'band-delete-confirm');
  await blake.p.click('[data-zg="band-delete-cancel"]');
  await blake.p.waitForFunction(() => !document.querySelector('[data-zg="sheet-band-delete"]').open);
  assert.equal(server.events.filter((e) => e.user === MEMBER).length, 3, 'Keep it: nothing deleted');
  assert.ok(!server.calls.includes('delete_band_member_data'));
  await blake.p.click('[data-zg="band-member-delete"]');
  await openSheetIn(blake.p, 'band-delete');
  await blake.p.click('[data-zg="band-delete-confirm"]');
  await blake.p.waitForFunction(() => document.querySelector('[data-zg="band-member-row"]')?.textContent === 'Mike (bass) · removed, data deleted ');
  assert.equal(server.events.filter((e) => e.user === MEMBER).length, 0, 'his rows are gone from the server');
  assert.equal(server.events.filter((e) => e.user === OWNER).length > 0, true, 'Blake\'s untouched');
  step('band: deleting a removed member\'s data asks first; Keep it does nothing; confirmed, only his rows go');

  // A used link: Sam can't join with it; he is signed out again and told why. Without a link, a sign-up is an owner as always.
  const sam = await device(null);
  await sam.p.goto(link);
  await openSheetIn(sam.p, 'signin');
  await sam.p.fill('[data-zg="email"]', 'sam@example.com');
  await sam.p.fill('[data-zg="code"]', '123456');
  await sam.p.click('[data-zg="verify"]');
  await sam.p.waitForFunction(() => document.querySelector('[data-zg="signin-note"]')?.textContent.startsWith('This invite was already used.'));
  assert.equal(await sam.p.textContent('[data-zg="account"]'), 'Not signed in');
  assert.equal(await sam.p.evaluate(() => localStorage.getItem('fake-session')), null);
  assert.equal(await sam.p.isHidden('[data-zg="signin-invite"]'), true, 'the used token is dropped');
  await sam.p.fill('[data-zg="email"]', 'sam@example.com');
  await sam.p.fill('[data-zg="code"]', '123456');
  await sam.p.click('[data-zg="verify"]');
  await sam.p.waitForFunction(() => /Synced/.test(document.querySelector('[data-zg="status"]').textContent));
  assert.equal(await sam.p.evaluate(() => window.zg.shell.current()), 'goals', 'an owner app: no goal yet, so Goals');
  assert.equal(server.members.has(NEWBIE), false, 'a sign-up without a link stays an owner');
  // Blake opening an invite link on his own, signed-in phone: nothing joins, nothing is kept.
  await blake.p.goto(`${url}?invite=${'e'.repeat(64)}`);
  await blake.p.waitForFunction(() => window.zg?.replica && /Synced/.test(document.querySelector('[data-zg="status"]').textContent));
  assert.equal(await blake.p.evaluate(() => [location.search, localStorage.getItem('zg-invite')].join('|')), '|');
  assert.equal(server.members.has(OWNER), false);
  for (const d of [blake, mike, sam]) await d.ctx.close();
  step('band: a used link is refused (signed out, told why); without a link a sign-up is an owner; a signed-in owner opening a link stays himself');

  // The metronome's root cause (2026-11-02): settings never set left the zone at UTC, so the default 9-to-5 quiet
  // hours fell at 4am to noon in New York and silenced the metronome all morning. Now the device's zone is used.
  const nyContext = await browser.newContext({ timezoneId: 'America/New_York' });
  const nyPage = await nyContext.newPage();
  nyPage.on('pageerror', (e) => errors.push(e.message));
  await nyPage.clock.install({ time: new Date('2026-11-03T12:30:00Z') }); // 7:30 in the morning in New York
  await nyPage.goto(url);
  await nyPage.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes("Using this device's time zone (America/New_York)"));
  assert.equal(await nyPage.evaluate(() => window.zg.replica.library.settings.dayStart.timeZone), 'America/New_York');
  await nyPage.keyboard.press('Escape'); // no goal yet: past the new-goal sheet, to Home's deck
  await nyPage.evaluate(() => (location.hash = '#/today'));
  await nyPage.waitForFunction(() => !document.querySelector('[data-zg="screen-today"]').hidden && !document.querySelector('dialog[open]'));
  await nyPage.click('[data-zg="mx-start"]');
  await nyPage.waitForFunction(() => window.zg.metronome.player.playing && window.zg.metronome.player.ready, null, { timeout: 15000 });
  assert.equal(await nyPage.textContent('[data-zg="mx-note"]'), '', 'no quiet-hours refusal at 7:30am');
  await nyPage.click('[data-zg="mx-start"]');
  await nyPage.reload();
  await nyPage.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Ready'));
  assert.equal(await nyPage.evaluate(() => window.zg.replica.log.filter((e) => e.type === 'settings-set').length), 1, 'set once, never again');
  await nyContext.close();
  step("metronome: the device's own time zone is used when settings were never set, so it plays in the New York morning");

  const keys = await context.newPage();
  const requests = [];
  keys.on('request', (r) => requests.push(r.url()));
  await keys.goto(`${url}setup-keys.html`);
  await keys.waitForFunction(() => document.querySelector('[data-zg=\"key-cron\"]').value.length > 0);
  const [pub, priv, cron] = await Promise.all(['[data-zg=\"key-pub\"]', '[data-zg=\"key-priv\"]', '[data-zg=\"key-cron\"]'].map((id) => keys.inputValue(id)));
  assert.equal(Buffer.from(pub, 'base64url').length, 65);
  assert.equal(Buffer.from(pub, 'base64url')[0], 4, 'uncompressed P-256 point');
  assert.equal(Buffer.from(priv, 'base64url').length, 32);
  assert.equal(Buffer.from(cron, 'base64url').length, 32);
  const expected = ['setup-keys.html', 'theme/tokens.css', 'theme/theme.css', 'base.css'].map((f) => `${url}${f}`);
  // The theme's own font files (same origin) may load too, now that the stylesheets really do.
  const extra = requests.filter((r) => !expected.includes(r));
  assert.ok(extra.every((r) => (r.startsWith(`${url}theme/fonts/`) && r.endsWith('.woff2')) || (r.startsWith(`${url}theme/img/`) && r.endsWith('.webp'))), `only the page, its stylesheets and theme fonts load: ${extra.join(', ')}`);
  assert.deepEqual(requests.filter((r) => expected.includes(r)).sort(), expected.sort(), 'keys are made locally; nothing is sent');
  await keys.close();
  step('setup-keys page makes valid keys in the browser and sends nothing');

  assert.deepEqual(errors, []);
  step('no page errors');
  console.log('browser tests passed');
} finally {
  await browser.close();
  server.close();
}
