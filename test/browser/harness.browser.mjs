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

  await page.fill('[data-zg="improv-prompt"]', 'Blues in E');
  await page.fill('[data-zg="improv-takes"]', '2');
  await page.fill('[data-zg="improv-minutes"]', '1');
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
  await page.click('[data-zg="takes-archived"] [data-zg="take-restore"]');
  await until(() => document.querySelectorAll('[data-zg="takes-list"] [data-zg="take"]').length === 3);
  await page.click('[data-zg="takes-list"] [data-zg="take"] >> nth=0 >> [data-zg="take-play"]');
  await until(() => document.querySelector('[data-zg="take-player"]').src.startsWith('blob:'));
  const versions = await page.evaluate(() => window.zg.replica.log.filter((e) => e.type === 'item-set' && e.item.module === 'recorder').length);
  assert.equal(versions, 6, '3 takes + rename + archive + restore: every version kept');
  step('recorder: list, play, rename, archive and restore takes (no delete)');

  // Goals: "write a new record by X" with a timed task and a daily songwriting prompt (it is the morning session now).
  await page.selectOption('[data-zg="goal-kind"]', 'general');
  await page.fill('[data-zg="goal-what"]', 'Write a new record');
  await page.fill('[data-zg="goal-why"]', 'Ten new songs by spring');
  await page.fill('[data-zg="goal-deadline"]', '2027-03-01');
  await page.fill('[data-zg="goal-tasks"]', '10 min in Chord Chemistry');
  await page.fill('[data-zg="goal-write-minutes"]', '1');
  await page.click('[data-zg="goal-save"]');
  await until(() => document.querySelectorAll('[data-zg="goals-list"] [data-zg="goal"]').length === 1);
  assert.match(await page.textContent('[data-zg="goals-list"]'), /Write a new record · general · by 2027-03-01 · 11 min a day · 10 min in Chord Chemistry, Songwriting prompt/);
  const blockText = await page.textContent('[data-zg="blocks"]');
  assert.match(blockText, /10 min in Chord Chemistry · 10 min/);
  assert.match(blockText, /Songwriting prompt · 1 min · .*[Rr]ecord.* \(1 × \d+ min, recorded\)/);
  step('goals: a deadline goal from the intake form; its timed task and today\'s songwriting prompt show in the session');

  await page.click('[data-zg="blocks"] [data-zg="block-record"]');
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(1_500);
  await page.click('[data-zg="rec-stop"]');
  await until(() => window.zg.replica.log.some((e) => e.type === 'task-done' && e.blockId === 'write'));
  const written = await takesNow();
  const forBlock = written.find((f) => f.blockId === 'write');
  assert.ok(forBlock && forBlock.goalId.startsWith('goal-') && forBlock.of === 1, 'the take is tied to the goal block');
  await until(() => !document.querySelector('[data-zg="blocks"]').textContent.includes('Record') || document.querySelectorAll('[data-zg="blocks"] [data-zg="block-record"]').length === 0);
  assert.match(await page.textContent('[data-zg="blocks"]'), /Songwriting prompt .*✓/);
  step('goals: recording the songwriting prompt ticks the block off for today');

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
  await page.click('[data-zg="blocks"] [data-zg="block"] >> text=Post-gig rundown memo >> [data-zg="block-record"]');
  await until(() => !document.querySelector('[data-zg="rec-stop"]').hidden);
  await page.clock.runFor(2_000);
  await page.click('[data-zg="rec-stop"]');
  await until(() => window.zg.replica.log.some((e) => e.type === 'task-done' && e.blockId === 'memo'));
  assert.ok((await takesNow()).some((f) => f.blockId === 'memo' && f.title === 'Post-gig rundown memo'));
  await page.clock.setSystemTime(new Date('2026-11-03T07:40:00Z'));
  await page.clock.runFor(30_000);
  await page.click('[data-zg="goals-list"] [data-zg="goal"] >> text=Friday gig >> [data-zg="goal-archive"]');
  await until(() => document.querySelectorAll('[data-zg="goals-list"] [data-zg="goal"]').length === 1);
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.goals.values()].filter((g) => g.archived).length), 1, 'archived, kept in history');
  step('goals: a gig goal ramps improv takes toward the date; its rundown memo shows on gig night and records; bad input refused; archive keeps the goal');

  // Theory and physics cards in the silent work-hours burst (neutral defaults: 12:30 UTC window, quiet hours 17-19 set above).
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
  step('theory: silent work-hours burst serves Q/A and multiple-choice cards with their sources, through the contract');

  await page.click('[data-zg="theory-topic"] >> text=Tape and noise reduction >> input');
  await until(() => document.querySelector('[data-zg="theory-topics"]').textContent.includes('Tape and noise reduction (0 of 12 cards on)'));
  assert.equal(await page.evaluate(() => [...window.zg.replica.library.cards.values()].filter((c) => c.id.startsWith('th-tape-') && c.retired).length), 12);
  await page.click('[data-zg="theory-topic"] >> text=Tape and noise reduction >> input');
  await until(() => document.querySelector('[data-zg="theory-topics"]').textContent.includes('Tape and noise reduction (12 of 12 cards on)'));
  step('theory: cards by topic, switched off and back on');
  await page.clock.setSystemTime(new Date('2026-11-03T07:40:00Z'));

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
