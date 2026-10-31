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
const status = () => page.textContent('#status');
const step = (name) => console.log(`ok - ${name}`);

try {
  await page.goto(url);
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Ready'));
  assert.match(await status(), /this device only/);
  assert.match(await page.textContent('#session'), /after-work · sound/);
  assert.match(await page.textContent('#question'), /String \d .*which note\?|Spell /);
  step('loads offline-first with no account and serves the test deck');

  const first = await page.getAttribute('#card', 'data-card');
  await page.click('#reveal');
  assert.notEqual((await page.textContent('#answer')).trim(), '');
  await page.click('#r-good');
  await page.waitForFunction((c) => document.getElementById('card').dataset.card !== c, first);
  const pending = await page.evaluate(() => window.zg.replica.pendingCount);
  const reviews = await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first);
  assert.equal(reviews, 1);
  step('rating a card records a review through the module contract');

  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
  assert.equal(await page.evaluate(() => window.zg.replica.pendingCount), pending);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.keys()].filter((k) => k.startsWith('td-')).length), 102, 'seeding again added nothing');
  assert.equal(await page.evaluate(() => window.zg.replica.library.cards.size), 103, 'plus the metronome\'s Free practice exercise');
  step('the review survives a reload (IndexedDB), still queued to sync');

  assert.equal(await page.isChecked('#notify-all'), false);
  await page.check('#notify-all');
  await page.waitForFunction(() => window.zg.replica.library.settings.notifications === true);
  await page.uncheck('#notify-windows input >> nth=2');
  await page.waitForFunction(() => window.zg.replica.library.settings.windows[2].notify === false);
  step('notification master switch and per-window toggle are saved');

  const s = JSON.parse(await page.inputValue('#settings'));
  await page.fill('#settings', JSON.stringify({ ...s, morningMinutes: 20 }));
  await page.click('#save-settings');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Refused'));
  await page.fill('#settings', JSON.stringify({ ...s, morningMinutes: 75, quietHours: { start: '17:00', end: '19:00' } }));
  await page.click('#save-settings');
  await page.waitForFunction(() => window.zg.replica.library.settings.morningMinutes === 75);
  assert.match(await page.textContent('#session'), /silent \(quiet hours\)/);
  step('settings can be edited any time; invalid ones are refused');

  // Metronome. Quiet hours were just set to 17:00-19:00 and it is 18:00 UTC.
  assert.equal(await page.inputValue('#mx-bpm'), '80');
  assert.match(await page.textContent('#mx-exercise'), /Free practice/);
  await page.click('#mx-start');
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Quiet hours'));
  assert.equal(await page.evaluate(() => window.zg.metronome.player.playing), false);
  step('metronome refuses to play during quiet hours by default');

  await page.check('#mx-allowDuringQuietHours');
  await page.fill('#mx-bpm', '150');
  await page.selectOption('#mx-groove', 'rock');
  await page.fill('#mx-countInBars', '0');
  await page.click('#mx-start');
  await page.waitForFunction(() => window.zg.metronome.player.playing && window.zg.metronome.player.ready, null, { timeout: 15000 });
  await page.waitForFunction(() => (window.zg.metronome.player.stats?.bars ?? 0) >= 3, null, { timeout: 15000 });
  const stats = await page.evaluate(() => window.zg.metronome.player.stats);
  assert.equal(stats.dropped, 0, 'no late clicks');
  assert.ok(stats.scheduled >= 16);
  assert.match(await page.textContent('#mx-position'), /bar \d+ · beat \d\/4 · 150 BPM/);
  step('real drum kit decodes and the lookahead scheduler plays rock at 150 BPM with no dropped clicks');

  await page.selectOption('#mx-sound', 'beep');
  await page.selectOption('#mx-groove', 'click');
  await page.waitForTimeout(1500);
  assert.equal((await page.evaluate(() => window.zg.metronome.player.stats)).dropped, 0);
  step('switching to synth beeps while playing');

  await page.waitForTimeout(3500);
  await page.click('#mx-start');
  await page.waitForSelector('#mx-result:not([hidden])');
  assert.match(await page.textContent('#mx-summary'), /150→150 BPM/);
  await page.click('#mx-clean');
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

  await page.fill('#cfg-key', 'sb_secret_abc');
  await page.click('#save-config');
  assert.match(await status(), /looks like a secret key/);
  step('refuses a secret key in the app');

  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the worker take control and cache the shell
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Ready'));
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => document.getElementById('status').textContent.includes('Ready'));
  assert.equal(await page.evaluate((c) => window.zg.replica.library.reviews.get(c)?.length, first), 1);
  assert.ok(await page.evaluate(async () => Boolean(await caches.match('./sounds/kick.mp3'))), 'drum sounds cached for offline');
  await context.setOffline(false);
  step('works offline after the first visit (service worker shell + local data)');

  await page.fill('#email', 'blake@example.com');
  await page.fill('#code', 'abc');
  await page.click('#verify');
  assert.match(await status(), /Enter the code/);
  step('sign-in by typed email code checks the code first');

  const keys = await context.newPage();
  const requests = [];
  keys.on('request', (r) => requests.push(r.url()));
  await keys.goto(`${url}setup-keys.html`);
  await keys.waitForFunction(() => document.getElementById('cron').value.length > 0);
  const [pub, priv, cron] = await Promise.all(['#pub', '#priv', '#cron'].map((id) => keys.inputValue(id)));
  assert.equal(Buffer.from(pub, 'base64url').length, 65);
  assert.equal(Buffer.from(pub, 'base64url')[0], 4, 'uncompressed P-256 point');
  assert.equal(Buffer.from(priv, 'base64url').length, 32);
  assert.equal(Buffer.from(cron, 'base64url').length, 32);
  assert.deepEqual(requests, [`${url}setup-keys.html`], 'keys are made locally; nothing is sent');
  await keys.close();
  step('setup-keys page makes valid keys in the browser and sends nothing');

  assert.deepEqual(errors, []);
  step('no page errors');
  console.log('browser tests passed');
} finally {
  await browser.close();
  server.close();
}
