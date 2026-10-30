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
  assert.equal(await page.evaluate(() => window.zg.replica.library.cards.size), 102, 'seeding again added nothing');
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
