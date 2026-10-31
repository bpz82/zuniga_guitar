// End-to-end check of the built harness in headless Chromium (Playwright):
// offline-first storage, the test deck through the module contract,
// settings and notification toggles, and the offline app shell.
// Run with `npm run test:browser` (needs Playwright and its Chromium).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import assert from 'node:assert/strict';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
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

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// 18:00 UTC: the neutral defaults' after-work window, so silent cards are served.
await page.clock.install({ time: new Date('2026-11-02T18:00:00Z') });
const status = () => page.textContent('[data-zg=\"status\"]');
const step = (name) => console.log(`ok - ${name}`);

try {
  await page.goto(url);
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.match(await status(), /this device only/);
  assert.match(await page.textContent('[data-zg=\"session\"]'), /after-work · sound/);
  assert.match(await page.textContent('[data-zg=\"question\"]'), /String \d .*which note\?|Spell /);
  step('loads offline-first with no account and serves the test deck');

  const first = await page.getAttribute('[data-zg=\"card\"]', 'data-card');
  await page.click('[data-zg=\"reveal\"]');
  assert.notEqual((await page.textContent('[data-zg=\"answer\"]')).trim(), '');
  await page.click('[data-zg=\"r-good\"]');
  await page.waitForFunction((c) => document.querySelector('[data-zg=\"card\"]').dataset.card !== c, first);
  const pending = await page.evaluate(() => window.zg.replica.pendingCount);
  const reviews = await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first);
  assert.equal(reviews, 1);
  step('rating a card records a review through the module contract');

  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
  assert.equal(await page.evaluate(() => window.zg.replica.pendingCount), pending);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.keys()].filter((k) => k.startsWith('td-')).length), 102, 'seeding again added nothing');
  assert.equal(await page.evaluate(() => window.zg.replica.library.cards.size), 107, 'plus the metronome\'s Free practice exercise and the 4 level-1 ear skills');
  step('the review survives a reload (IndexedDB), still queued to sync');

  assert.equal(await page.isChecked('[data-zg=\"notify-all\"]'), false);
  await page.check('[data-zg=\"notify-all\"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.notifications === true);
  await page.uncheck('[data-zg="notify-window"] input >> nth=2');
  await page.waitForFunction(() => window.zg.replica.library.settings.windows[2].notify === false);
  step('notification master switch and per-window toggle are saved');

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
  assert.equal(await page.inputValue('[data-zg=\"mx-bpm\"]'), '80');
  assert.match(await page.textContent('[data-zg=\"mx-exercise\"]'), /Free practice/);
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Quiet hours'));
  assert.equal(await page.evaluate(() => window.zg.metronome.player.playing), false);
  step('metronome refuses to play during quiet hours by default');

  await page.check('[data-zg=\"mx-allowDuringQuietHours\"]');
  await page.fill('[data-zg=\"mx-bpm\"]', '150');
  await page.selectOption('[data-zg=\"mx-groove\"]', 'rock');
  await page.fill('[data-zg=\"mx-countInBars\"]', '0');
  await page.click('[data-zg=\"mx-start\"]');
  await page.waitForFunction(() => window.zg.metronome.player.playing && window.zg.metronome.player.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.zg.metronome.player.stats?.bars ?? 0) >= 3, null, { timeout: 15000 });
  const stats = await page.evaluate(() => window.zg.metronome.player.stats);
  assert.equal(stats.dropped, 0, 'no late clicks');
  assert.ok(stats.scheduled >= 16);
  assert.match(await page.textContent('[data-zg=\"mx-position\"]'), /bar \d+ · beat \d\/4 · 150 BPM/);
  step('real drum kit decodes and the lookahead scheduler plays rock at 150 BPM with no dropped clicks');

  await page.selectOption('[data-zg=\"mx-sound\"]', 'beep');
  await page.selectOption('[data-zg=\"mx-groove\"]', 'click');
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
  await page.click('[data-zg="practice"]');
  const answerRight = async () => {
    await page.click('[data-zg="ear-play"]');
    await page.waitForFunction(() => window.zg.ear.ui.current().firstEnd !== null);
    const answer = await ear(() => window.zg.ear.ui.current().trial.answer);
    await page.click(`[data-zg="ear-choice"][data-choice="${answer}"]`);
    await page.waitForFunction(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✓'));
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
  await page.clock.runFor(16_000); // the bar ends; grading runs by itself
  await page.waitForFunction(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✓'));
  const tapped = await ear(() => window.zg.replica.library.reviews.get('ear-rhythm-r1-c')[0].details);
  assert.deepEqual([tapped.correct, tapped.missed, tapped.extra, tapped.lagMs], [true, 0, 0, 30]);
  step('ear: rhythm echo is tapped back and graded after the bar, touch lag removed');

  await page.fill('[data-zg="songs-new"]', '  Blackbird ');
  await page.click('[data-zg="songs-add"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 1);
  await page.fill('[data-zg="songs-new"]', 'BLACKBIRD');
  await page.click('[data-zg="songs-add"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('already in your songs'));
  await page.fill('[data-zg="songs-paste"]', 'Little Wing\n\nblackbird\nWonderwall\n');
  await page.click('[data-zg="songs-paste-add"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Added 2 songs; skipped 1'));
  assert.equal(await page.locator('[data-zg="songs-list"] [data-zg="song"]').count(), 3);
  step('songs: add a title, duplicates refused, paste a list (blank lines and repeats skipped)');

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

  await page.click('[data-zg="songs-list"] [data-zg="song"] >> nth=1 >> [data-zg="song-archive"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-archived"] [data-zg="song"]').length === 1);
  assert.equal(await page.textContent('[data-zg="question"]'), 'Play: Wonderwall', 'an archived song is not served');
  await page.click('[data-zg="songs-archived"] [data-zg="song-restore"]');
  await page.waitForFunction(() => document.querySelectorAll('[data-zg="songs-list"] [data-zg="song"]').length === 3);
  page.once('dialog', (d) => d.accept('Little Wing (live)'));
  await page.click('[data-zg="songs-list"] [data-zg="song"] >> nth=1 >> [data-zg="song-rename"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="songs-list"]').textContent.includes('Little Wing (live)'));
  step('songs: archive (not served, history kept), restore, rename');

  await ear(() => window.zg.ear.ui.select('ear-direction-same-c'));
  await page.click('[data-zg="ear-play"]');
  await page.waitForFunction(() => window.zg.ear.ui.current().firstEnd !== null);
  const wrong = await ear(() => window.zg.ear.ui.current().trial.choices.find((c) => c.id !== 'same').id);
  await page.click(`[data-zg="ear-choice"][data-choice="${wrong}"]`);
  await page.waitForFunction(() => document.querySelector('[data-zg="ear-feedback"]').textContent.startsWith('✗ The answer: Same'));
  assert.ok(await page.isVisible('[data-zg="ear-resolve"]'));
  await page.click('[data-zg="ear-resolve"]');
  await page.click('[data-zg="ear-next"]');
  assert.notEqual(await ear(() => window.zg.ear.ui.current().cardId), 'ear-direction-same-c', 'never the same skill twice in a row');
  step('ear: a wrong answer is corrected at once (the answer shown and replayed), then the next skill');

  await page.click('[data-zg="ear-unlock"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="ear-level"]').textContent.startsWith('Level 2'));
  assert.ok(await ear(() => window.zg.replica.library.cards.has('ear-degree-5-c')));
  await page.clock.setSystemTime(new Date('2026-11-03T18:00:00Z')); // quiet hours (17:00-19:00 set above)
  assert.ok(await page.isHidden('[data-zg="ear-next"]'), 'Next appears only after answering');
  const playsBefore = await ear(() => window.zg.ear.ui.current().plays);
  await page.click('[data-zg="ear-play"]');
  await page.waitForFunction(() => document.querySelector('[data-zg="status"]').textContent.includes('Quiet hours: ear training needs sound.'));
  assert.equal(await ear(() => window.zg.ear.ui.current().plays), playsBefore, 'nothing played');
  await page.clock.setSystemTime(new Date('2026-11-03T07:30:00Z'));
  step('ear: unlock the next level by hand; nothing plays in quiet hours');

  assert.ok(await page.isChecked('[data-zg="notify-morning-always"]'), 'morning reminder always on by default');
  await page.uncheck('[data-zg="notify-morning-always"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.alwaysRemindMorning === false);
  await page.check('[data-zg="notify-morning-always"]');
  await page.waitForFunction(() => window.zg.replica.library.settings.alwaysRemindMorning === true);
  step('morning-reminder setting is saved from its checkbox');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the worker take control and cache the shell
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.querySelector('[data-zg=\"status\"]').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
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
  assert.deepEqual([...requests].sort(), expected.sort(), 'keys are made locally; only the page and its stylesheets load, nothing is sent');
  await keys.close();
  step('setup-keys page makes valid keys in the browser and sends nothing');

  assert.deepEqual(errors, []);
  step('no page errors');
  console.log('browser tests passed');
} finally {
  await browser.close();
  server.close();
}
