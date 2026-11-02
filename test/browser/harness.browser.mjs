// End-to-end check of the built harness in headless Chromium (Playwright):
// offline-first storage, the test deck through the module contract,
// settings and notification toggles, and the offline app shell.
// Run with `npm run test:browser` (needs Playwright and its Chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

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
const context = await browser.newContext({ permissions: ['microphone'] });
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
/** Opens a screen the way a person would: its tab, or the gear for Settings. */
const show = async (screen) => {
  await page.click(screen === 'settings' ? '[data-zg="gear"]' : `[data-zg="tab-${screen}"]`);
  await until((s) => !document.querySelector(`[data-zg="screen-${s}"]`).hidden, screen);
};
/** Bottom sheets (native dialogs): open by their button, close by theirs, and read whether one is open. */
const sheetIsOpen = (name) => page.evaluate((n) => document.querySelector(`[data-zg="sheet-${n}"]`).open, name);
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
  // The app shell opens on Today: one screen, what is due now, Start session.
  assert.equal(new URL(page.url()).hash, '#/today');
  assert.deepEqual(await visibleScreens(), ['screen-today']);
  assert.equal(await page.getAttribute('[data-zg="tab-today"]', 'aria-current'), 'page');
  assert.match(await page.textContent('[data-zg="today-now"]'), /^After-work burst \(sound\): \d+ due, \d+ new\.$/);
  assert.equal(await page.textContent('[data-zg="today-reminder"]'), 'Reminders are off (turn them on in Settings).');
  for (const b of ['practice', 'cards']) {
    assert.ok(await page.isHidden(`[data-zg="nav-badge-${b}"]`), `no ${b} badge with nothing due`);
    assert.equal(await page.getAttribute(`[data-zg="tab-${b}"]`, 'aria-label'), null);
  }
  await page.click('[data-zg="today-start"]');
  await until(() => location.hash === '#/practice' && !document.querySelector('[data-zg="screen-practice"]').hidden);
  assert.deepEqual(await visibleScreens(), ['screen-practice']);
  assert.match(await page.textContent('[data-zg=\"session\"]'), /after-work · sound/);
  assert.match(await page.textContent('[data-zg=\"question\"]'), /String \d .*which note\?|Spell /);
  step('loads offline-first with no account and serves the test deck');

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
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
  assert.equal(await page.evaluate(() => window.zg.replica.pendingCount), pending);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.keys()].filter((k) => k.startsWith('td-')).length), 102, 'seeding again added nothing');
  assert.equal(await page.evaluate(() => window.zg.replica.library.cards.size), 227, 'plus the metronome\'s Free practice exercise, the 4 level-1 ear skills and the 120 theory cards');
  step('the review survives a reload (IndexedDB), still queued to sync');

  // App shell routing.
  assert.equal(new URL(page.url()).hash, '#/practice', 'a reload stays on the same screen');
  assert.deepEqual(await visibleScreens(), ['screen-practice']);
  await show('songs');
  assert.equal(new URL(page.url()).hash, '#/songs');
  assert.deepEqual(await visibleScreens(), ['screen-songs'], 'one screen at a time');
  assert.equal(await page.getAttribute('[data-zg="tab-songs"]', 'aria-current'), 'page');
  assert.equal(await page.getAttribute('[data-zg="tab-practice"]', 'aria-current'), null);
  await show('ear');
  await page.goBack();
  await until(() => location.hash === '#/songs' && !document.querySelector('[data-zg="screen-songs"]').hidden);
  await page.goBack();
  await until(() => location.hash === '#/practice' && !document.querySelector('[data-zg="screen-practice"]').hidden);
  // Practice is the long screen: scroll it, then a newly opened screen starts at the top.
  await page.evaluate(() => window.scrollTo(0, 400));
  assert.ok(await page.evaluate(() => window.scrollY) > 0);
  await page.goForward();
  await until(() => location.hash === '#/songs' && !document.querySelector('[data-zg="screen-songs"]').hidden);
  assert.equal(await page.evaluate(() => window.scrollY), 0, 'a newly opened screen starts at the top');
  step('shell: tabs switch screens one at a time; back and forward work');

  await show('settings');
  assert.equal(await page.getAttribute('[data-zg="gear"]', 'aria-current'), 'page');
  assert.ok(await page.isVisible('[data-zg="notify-all"]') && await page.isVisible('[data-zg="sign-out"]') && await page.isVisible('[data-zg="quiet-start"]'));
  assert.ok(await page.isHidden('[data-zg="cfg-url"]') && await page.isHidden('[data-zg="settings"]'), 'setup and raw settings are tucked away');
  const historyBefore = await page.evaluate(() => history.length);
  await page.evaluate(() => (location.hash = '#/nope'));
  await until(() => location.hash === '#/settings');
  assert.deepEqual(await visibleScreens(), ['screen-settings'], 'a bad link changes nothing');
  assert.equal(await page.evaluate(() => history.length), historyBefore + 1, 'and is replaced, not kept in history');
  step('shell: Settings behind the gear (setup tucked away); a bad link is ignored');

  await show('cards');
  await page.goto(url); // reopen the app without a hash, same practice day
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(new URL(page.url()).hash, '#/cards', 'the last tab is remembered');
  assert.deepEqual(await visibleScreens(), ['screen-cards']);
  await show('settings');
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(new URL(page.url()).hash, '#/cards', 'Settings is never the remembered tab');
  await page.clock.setSystemTime(new Date('2026-11-03T05:00:00Z')); // the next practice day (neutral day start 4:00 UTC)
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(new URL(page.url()).hash, '#/today', 'a new practice day opens on Today');
  await page.clock.setSystemTime(new Date('2026-11-02T18:00:30Z'));
  await page.goto(`${url}#/practice`);
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  step('shell: the last tab is remembered for the practice day; a new day opens on Today; links open their screen');

  const layout = () => page.evaluate(() => {
    const nav = getComputedStyle(document.querySelector('[data-zg="nav"]'));
    return { position: nav.position, direction: nav.flexDirection, bottom: nav.bottom };
  });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.deepEqual(await layout(), { position: 'fixed', direction: 'row', bottom: '0px' }, 'phone: a tab bar along the bottom');
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.deepEqual((({ position, direction }) => ({ position, direction }))(await layout()), { position: 'sticky', direction: 'column' }, 'laptop: a side nav');
  step('shell: bottom tab bar on a phone, side nav on a laptop');

  // Social-style tab bar on a phone (2026-11-01).
  await page.setViewportSize({ width: 390, height: 844 });
  const visible = async (hooks) => Promise.all(hooks.map((h) => page.isVisible(`[data-zg="${h}"]`)));
  const BAR_HOOKS = ['tab-today', 'tab-practice', 'tab-record', 'tab-songs', 'nav-more'];
  const SHEET_HOOKS = ['tab-ear', 'tab-goals', 'tab-cards', 'more-settings'];
  assert.deepEqual(await visible(BAR_HOOKS), [true, true, true, true, true], 'five slots in the bar');
  assert.deepEqual(await visible(SHEET_HOOKS), [false, false, false, false], 'the rest wait in the closed sheet');
  const boxes = await Promise.all(BAR_HOOKS.map((h) => page.locator(`[data-zg="${h}"]`).boundingBox()));
  // Structure only: the theme's global button style still pads the More button (see THEME.md), so sizes are not compared.
  const midY = (b) => b.y + b.height / 2;
  for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].x > boxes[i - 1].x && Math.abs(midY(boxes[i]) - midY(boxes[0])) < 10, 'one row, left to right');
  assert.ok(boxes.every((b) => b.x >= 0 && b.x + b.width <= 391), 'all five fit on a 390px screen');
  const icon = (h) => page.evaluate((h) => document.querySelector(`[data-zg="${h}"] svg`).getBoundingClientRect().width, h);
  assert.ok((await icon('tab-record')) > (await icon('tab-today')), 'Record is the larger button');
  step('tabs: five slots on a phone: Today, Practice, Record (larger, centre), Songs, More');

  const sheetOpen = () => page.evaluate(() => [document.querySelector('[data-zg="nav-more"]').getAttribute('aria-expanded'), document.querySelector('[data-zg="more-sheet"]').hasAttribute('data-open')]);
  const focused = () => page.evaluate(() => document.activeElement?.dataset.zg ?? null);
  await page.click('[data-zg="nav-more"]');
  assert.deepEqual(await sheetOpen(), ['true', true]);
  assert.deepEqual(await visible(SHEET_HOOKS), [true, true, true, true], 'Ear training, Goals, Cards, Settings');
  assert.equal(await focused(), 'tab-ear', 'focus moves into the sheet');
  await page.waitForTimeout(400); // let the opening rise finish (a CSS transition)
  const sheetBox = await page.locator('[data-zg="more-sheet"]').boundingBox();
  const navBox = await page.locator('[data-zg="nav"]').boundingBox();
  assert.ok(sheetBox.y + sheetBox.height <= navBox.y + 1 && sheetBox.height > 0, 'the sheet opens just above the bar');
  await page.keyboard.press('Escape');
  assert.deepEqual(await sheetOpen(), ['false', false], 'Escape closes it');
  assert.equal(await focused(), 'nav-more', 'and returns focus to More');
  await page.click('[data-zg="nav-more"]');
  await page.click('h1');
  assert.deepEqual(await sheetOpen(), ['false', false], 'a tap outside closes it');
  await page.click('[data-zg="nav-more"]');
  await page.click('[data-zg="nav-more"]');
  assert.deepEqual(await sheetOpen(), ['false', false], 'More toggles');
  await page.click('[data-zg="nav-more"]');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  assert.deepEqual(await sheetOpen(), ['false', false], 'tabbing past the last item closes it');
  step('more: the sheet opens above the bar and closes on Escape, a tap outside, More again, or tabbing away');

  const at = () => page.evaluate(() => [location.hash, [...document.querySelectorAll('[data-zg^="screen-"]')].filter((e) => !e.hidden).map((e) => e.dataset.zg)]);
  await page.click('[data-zg="tab-songs"]');
  await arrive('songs');
  await page.click('[data-zg="nav-more"]');
  await page.click('[data-zg="tab-goals"]');
  await arrive('goals');
  assert.deepEqual(await at(), ['#/goals', ['screen-goals']]);
  assert.deepEqual(await sheetOpen(), ['false', false], 'choosing a screen closes the sheet');
  assert.equal(await page.getAttribute('[data-zg="tab-goals"]', 'aria-current'), 'page');
  assert.equal(await page.getAttribute('[data-zg="nav-more"]', 'data-current'), '', 'More shows that the screen lives in its sheet');
  await page.goBack();
  await arrive('songs');
  assert.equal(await page.getAttribute('[data-zg="nav-more"]', 'data-current'), null);
  await page.goForward();
  await arrive('goals');
  await page.click('[data-zg="nav-more"]');
  await page.click('[data-zg="more-settings"]');
  await arrive('settings');
  for (const h of ['more-settings', 'gear']) assert.equal(await page.getAttribute(`[data-zg="${h}"]`, 'aria-current'), 'page', h);
  await page.click('[data-zg="nav-more"]');
  await page.click('[data-zg="tab-ear"]');
  await arrive('ear');
  await page.goto(url); // reopen with no hash, same practice day: the More-sheet screen is remembered
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.deepEqual(await at(), ['#/ear', ['screen-ear']]);
  assert.equal(await page.getAttribute('[data-zg="nav-more"]', 'data-current'), '');
  await page.click('[data-zg="tab-record"]');
  await arrive('record');
  assert.ok(await page.isVisible('[data-zg="rec-start"]'), 'the centre button opens the Recorder, Record button ready');
  step('more: sheet screens route with back and forward, mark More as current, and are remembered; the centre button opens the Recorder');

  await page.setViewportSize({ width: 1280, height: 720 });
  assert.deepEqual(await visible([...BAR_HOOKS.slice(0, 4), ...SHEET_HOOKS]), Array(8).fill(true), 'the side nav shows every section');
  assert.equal(await page.isVisible('[data-zg="nav-more"]'), false, 'no More button on a laptop');
  const ys = await Promise.all([...BAR_HOOKS.slice(0, 4), ...SHEET_HOOKS].map((h) => page.locator(`[data-zg="${h}"]`).boundingBox().then((b) => b.y)));
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] > ys[i - 1], 'one column, top to bottom');
  step('tabs: from 800px the side nav lists every section; no More button');

  // Layout redesign (2026-11-01): touch targets and bottom sheets, on a phone.
  await page.setViewportSize({ width: 390, height: 844 });
  const small = [];
  for (const screen of ['today', 'practice', 'record', 'songs', 'ear', 'goals', 'cards', 'settings']) {
    await page.evaluate((x) => (location.hash = `#/${x}`), screen);
    await arrive(screen);
    small.push(...(await page.evaluate((x) => {
      const root = document.querySelector(`[data-zg="screen-${x}"]`);
      const controls = [...root.querySelectorAll('button, a, input, select, textarea, summary'), ...document.querySelectorAll('[data-zg="nav"] > a, [data-zg="nav"] > button, [data-zg="gear"]')];
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
  assert.notEqual(hit[1], 'tab-today', 'the tab bar too');
  await page.keyboard.press('Escape');
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await openSheet('goal-new');
  await page.mouse.click(195, 30); // the backdrop, above the sheet
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await openSheet('goal-new');
  await page.evaluate(() => history.back()); // leaving the screen closes its sheet
  await until(() => !document.querySelector('[data-zg="sheet-goal-new"]').open);
  await page.evaluate(() => (location.hash = '#/practice'));
  await arrive('practice');
  await openSheet('mx-settings');
  await page.waitForTimeout(400); // let the slide-up finish (a CSS transition)
  const sheetBox2 = await page.locator('[data-zg="sheet-mx-settings"]').boundingBox();
  assert.ok(Math.abs(sheetBox2.y + sheetBox2.height - 844) < 2 && sheetBox2.width === 390, 'on a phone it rises from the bottom edge, full width');
  await closeSheet('mx-settings');
  step('sheets: modal bottom sheets close on Escape, a backdrop tap, the close button, or leaving the screen');
  await page.setViewportSize({ width: 1280, height: 720 });
  await show('practice');

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
  await show('practice');
  assert.equal(await page.inputValue('[data-zg=\"mx-bpm\"]'), '80');
  assert.match(await page.textContent('[data-zg=\"mx-exercise\"]'), /Free practice/);
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Quiet hours'));
  assert.equal(await page.evaluate(() => window.zg.metronome.player.playing), false);
  step('metronome refuses to play during quiet hours by default');

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
  await show('practice');
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

  await show('practice');
  assert.match(await page.textContent('[data-zg="session"]'), /morning · guitar/);
  assert.equal(await page.textContent('[data-zg="question"]'), 'Play: Blackbird');
  assert.ok(await page.isHidden('[data-zg="reveal"]'), 'nothing to reveal for a song');
  assert.ok(await page.isVisible('[data-zg="r-easy"]'));
  await page.click('[data-zg="r-easy"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="question"]').textContent === 'Play: Little Wing');
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
  step('songs: archive (not served, history kept), restore, rename');

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
  await show('practice');
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
  // Gig night: from 6pm on the gig's day the rundown memo shows, with Record (neutral defaults: UTC, day starts 4am).
  await page.clock.setSystemTime(new Date('2026-11-10T20:00:00Z'));
  await page.clock.runFor(30_000);
  await until(() => document.querySelector('[data-zg="blocks"]').textContent.includes('Post-gig rundown memo'));
  assert.match(await page.textContent('[data-zg="today-blocks"]'), /Post-gig rundown memo/, 'Today shows the memo on gig night');
  await show('practice');
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
  await show('practice');
  await page.clock.setSystemTime(new Date('2026-11-03T13:00:00Z'));
  await page.clock.runFor(30_000); // the page's own refresh picks up the new time
  assert.match(await page.textContent('[data-zg="session"]'), /during-work · silent/);
  const seen = new Set();
  for (let i = 0; i < 12 && seen.size < 2; i++) {
    const cardId = await page.evaluate(() => document.querySelector('[data-zg="card"]').dataset.card);
    const content = await page.evaluate((id) => window.zg.theory.content(id) ?? null, cardId);
    if (content) assert.match(await page.textContent('[data-zg="card-source"]'), /^Source: (Benade|Winer|.*not from Benade or Winer)/);
    const before = await page.evaluate((id) => (window.zg.replica.library.reviews.get(id) ?? []).length, cardId);
    if (content?.type === 'mc' && !seen.has('mc')) {
      assert.equal(await page.locator('[data-zg="mc-choice"]').count(), 4);
      assert.ok(await page.isHidden('[data-zg="reveal"]'));
      const wrong = content.wrong[0];
      await page.click(`[data-zg="mc-choice"] >> text="${wrong}"`);
      await until((id) => (window.zg.replica.library.reviews.get(id) ?? []).length === 1, cardId);
      assert.match(await page.textContent('[data-zg="card-feedback"]'), /^✗ The answer: /);
      const r = await page.evaluate((id) => window.zg.replica.library.reviews.get(id)[0], cardId);
      assert.deepEqual([r.rating, r.details.correct, r.details.topic], ['again', false, content.topic]);
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
      assert.deepEqual([r.rating, r.details.topic], ['good', content.topic]);
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
  for (const [b, label] of [['practice', 'Practice'], ['cards', 'Cards']]) {
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
  step('badges: Practice and Cards show their due counts once something is due');
  step('theory: silent work-hours burst serves Q/A and multiple-choice cards with their sources, through the contract');

  await show('cards');
  await page.click('[data-zg="theory-topic"] >> text=Tape and noise reduction >> input');
  await until(() => document.querySelector('[data-zg="theory-topics"]').textContent.includes('Tape and noise reduction (0 of 12 cards on)'));
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.values()].filter((c) => c.id.startsWith('th-tape-') && c.retired).length), 12);
  await page.click('[data-zg="theory-topic"] >> text=Tape and noise reduction >> input');
  await until(() => document.querySelector('[data-zg="theory-topics"]').textContent.includes('Tape and noise reduction (12 of 12 cards on)'));
  step('theory: cards by topic, switched off and back on');
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

  await page.fill('[data-zg=\"email\"]', 'blake@example.com');
  await page.fill('[data-zg=\"code\"]', 'abc');
  await page.click('[data-zg=\"verify\"]');
  assert.match(await status(), /Enter the code/);
  step('sign-in by typed email code checks the code first');

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
