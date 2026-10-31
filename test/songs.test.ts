/**
 * Songs I Already Know (Blake, 2026-10-31): title-only songs, served in the
 * morning guitar session, rated Again/Hard/Good/Easy, archived not deleted.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addSong,
  archiveSong,
  cleanTitle,
  createHost,
  dayBegins,
  MAX_PASTE,
  MAX_TITLE,
  memoryStore,
  pasteSongs,
  rateSong,
  renameSong,
  Replica,
  restoreSong,
  runModule,
  seedTestDeck,
  sessionFor,
  SONGS,
  songs,
  TEST_DECK,
  usesSteps,
} from '../src/index.ts';
import type { ModuleManifest, ReviewSegment, Session } from '../src/index.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
/** New York wall-clock time on a practice day (the day starts at 3am). */
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * 60_000;
};

let t = ny('2026-11-02', '04:00');
const clock = () => (t += 1000);
let k = 0;
const key = () => `k${++k}`;

async function setup() {
  t = ny('2026-11-02', '04:00');
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, SONGS, { now: clock });
  return { replica, host };
}

const review = (s: Session) => s.segments.find((x): x is ReviewSegment => x.kind === 'review');
const served = (s: Session) => [...(review(s)?.due.map((d) => d.memory.cardId) ?? []), ...(review(s)?.fresh ?? [])];
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

test('manifest: one card type, "song", practiced on the guitar only', () => {
  assert.equal(SONGS.id, 'songs');
  assert.deepEqual(SONGS.templates.map((x) => [x.template, [...x.tags]]), [['song', ['guitar']]]);
});

test('titles are trimmed and checked; nothing else is stored on a song', () => {
  assert.deepEqual(cleanTitle('  Wish   You Were  Here '), { ok: true, value: 'Wish You Were Here' });
  assert.equal(cleanTitle('   ').ok, false);
  assert.equal(cleanTitle('x'.repeat(MAX_TITLE)).ok, true);
  assert.equal(cleanTitle('x'.repeat(MAX_TITLE + 1)).ok, false);
  assert.equal(cleanTitle('two\nlines').ok, false);
  assert.equal(cleanTitle('nul\u0000').ok, false);
});

test('a new song is one item with only a title and one guitar card, in the morning session', async () => {
  const { replica, host } = await setup();
  const song = ok(await addSong(host, 'a1', ' Blackbird '));
  assert.deepEqual(song, { itemId: 'song-a1', cardId: 'song-a1-c', title: 'Blackbird', archived: false });
  assert.deepEqual(replica.library.items.get('song-a1'), { id: 'song-a1', module: 'songs', fields: { title: 'Blackbird' } });
  assert.deepEqual(replica.library.cards.get('song-a1-c')?.tags, ['guitar']);
  assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-02', '04:05'))), ['song-a1-c']);
});

test('songs are guitar-only: never served in a pocket burst', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  for (const hhmm of ['09:50', '13:05', '16:35']) assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-02', hhmm))), [], hhmm);
});

test('duplicates are refused (any case), including archived ones, with nothing written', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  const before = replica.log.length;
  const dup = await addSong(host, 'a2', 'BLACKBIRD');
  assert.equal(dup.ok, false);
  ok(await archiveSong(host, 'song-a1'));
  const archived = await addSong(host, 'a3', 'blackbird');
  assert.ok(!archived.ok && /archive/.test(archived.error));
  assert.equal(replica.log.length, before + 1, 'only the archive was written');
  assert.ok(host.enabled);
});

test('bad input comes back as an error and never trips the contract', async () => {
  const { replica, host } = await setup();
  const before = replica.log.length;
  assert.equal((await addSong(host, 'bad id!', 'Song')).ok, false);
  assert.equal((await addSong(host, 'a1', '')).ok, false);
  assert.equal((await renameSong(host, 'song-nope', 'X')).ok, false);
  assert.equal((await archiveSong(host, 'song-nope')).ok, false);
  assert.equal((await rateSong(host, 'song-nope-c', 'good', 1000)).ok, false);
  assert.equal(replica.log.length, before);
  assert.ok(host.enabled);
});

test('bulk paste: one title per line, blanks ignored, duplicates skipped', async () => {
  const { host } = await setup();
  ok(await addSong(host, 'a0', 'Blackbird'));
  const report = ok(await pasteSongs(host, 'Little Wing\r\n\n  Blackbird\nWonderwall\nlittle wing\n\n', key));
  assert.deepEqual(report.added.map((s) => s.title), ['Little Wing', 'Wonderwall']);
  assert.deepEqual(report.skipped, ['Blackbird', 'little wing']);
  assert.deepEqual(songs(host).map((s) => s.title), ['Blackbird', 'Little Wing', 'Wonderwall']);
});

test('bulk paste checks every line first: one bad line means nothing is added', async () => {
  const { replica, host } = await setup();
  const before = replica.log.length;
  const r = await pasteSongs(host, `Good Song\n${'x'.repeat(MAX_TITLE + 1)}\nAnother`, key);
  assert.ok(!r.ok && /line 2/.test(r.error));
  assert.equal((await pasteSongs(host, '\n \n', key)).ok, false);
  const big = Array.from({ length: MAX_PASTE + 1 }, (_, i) => `Song ${i}`).join('\n');
  assert.equal((await pasteSongs(host, big, key)).ok, false);
  assert.equal(replica.log.length, before);
});

test('a full paste stays inside the contract write budget', async () => {
  const { host } = await setup();
  const list = Array.from({ length: MAX_PASTE }, (_, i) => `Song ${i}`).join('\n');
  assert.equal(ok(await pasteSongs(host, list, key)).added.length, MAX_PASTE);
  assert.ok(host.enabled);
});

test('rename changes only the title; the practice history stays with the song', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbrid'));
  ok(await rateSong(host, 'song-a1-c', 'good', 180_000));
  ok(await renameSong(host, 'song-a1', 'Blackbird'));
  assert.equal(songs(host)[0]!.title, 'Blackbird');
  assert.equal(replica.library.reviews.get('song-a1-c')?.length, 1);
  ok(await addSong(host, 'a2', 'Wonderwall'));
  assert.equal((await renameSong(host, 'song-a2', 'blackbird')).ok, false, 'rename cannot create a duplicate');
});

test('rating logs a review through the contract and FSRS schedules the song', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  ok(await rateSong(host, 'song-a1-c', 'easy', 200_000));
  const r = replica.library.reviews.get('song-a1-c')!;
  assert.deepEqual([r.length, r[0]!.rating, r[0]!.durationMs], [1, 'easy', 200_000]);
  // Easy on a song he knows: not due again tomorrow morning.
  assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-03', '04:05'))), []);
  // A forgotten song comes back.
  ok(await addSong(host, 'a2', 'Wonderwall'));
  ok(await rateSong(host, 'song-a2-c', 'again', 60_000));
  assert.ok(served(sessionFor(replica.library, ny('2026-11-03', '04:05'))).includes('song-a2-c'));
});

test('rating clamps a silly duration instead of being rejected', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  ok(await rateSong(host, 'song-a1-c', 'good', -5));
  ok(await rateSong(host, 'song-a1-c', 'good', Number.NaN));
  assert.deepEqual(replica.library.reviews.get('song-a1-c')!.map((r) => r.durationMs), [0, 0]);
  assert.ok(host.enabled);
});

test('archive stops serving a song and keeps its history; restore brings it back with that history', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  ok(await rateSong(host, 'song-a1-c', 'again', 60_000));
  ok(await archiveSong(host, 'song-a1'));
  assert.equal(songs(host)[0]!.archived, true);
  assert.equal(replica.library.cards.get('song-a1-c')?.retired, true);
  assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-03', '04:05'))), []);
  assert.equal((await rateSong(host, 'song-a1-c', 'good', 1000)).ok, false, 'archived songs cannot be rated');
  ok(await restoreSong(host, 'song-a1'));
  const s = sessionFor(replica.library, ny('2026-11-03', '04:05'));
  assert.deepEqual(review(s)!.due.map((d) => d.memory.cardId), ['song-a1-c'], 'due, not fresh: history kept');
  assert.equal(replica.library.reviews.get('song-a1-c')?.length, 1);
});

test('archive and restore are idempotent (no extra writes)', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  const n = replica.log.length;
  ok(await restoreSong(host, 'song-a1'));
  assert.equal(replica.log.length, n);
  ok(await archiveSong(host, 'song-a1'));
  ok(await archiveSong(host, 'song-a1'));
  assert.equal(replica.log.length, n + 1);
});

test('isolation: songs and the test deck cannot see or touch each other', async () => {
  const { replica, host } = await setup();
  const deck = createHost(replica, TEST_DECK, { now: clock });
  ok(await runModule(deck, () => seedTestDeck(deck)));
  ok(await addSong(host, 'a1', 'Blackbird'));
  assert.deepEqual(songs(host).map((s) => s.itemId), ['song-a1']);
  assert.deepEqual(songs(deck), [], 'the deck host sees no songs');
  assert.equal((await renameSong(deck, 'song-a1', 'Hijacked')).ok, false);
  assert.equal(songs(host)[0]!.title, 'Blackbird');
  assert.ok(host.cards().every((c) => c.itemId.startsWith('song-')));
});

test('a crashing songs module is switched off; the deck and the log carry on', async () => {
  const { replica, host } = await setup();
  const deck = createHost(replica, TEST_DECK, { now: clock });
  ok(await addSong(host, 'a1', 'Blackbird'));
  const crash = await runModule(host, async () => {
    await host.reportRep('td-fret-6-0-c', 'good', 1000); // not its card
  });
  assert.equal(crash.ok, false);
  assert.equal(host.enabled, false);
  assert.equal(deck.enabled, true);
  ok(await runModule(deck, () => seedTestDeck(deck)));
  assert.equal(replica.library.reviews.get('td-fret-6-0-c'), undefined, 'nothing the module tried got in');
});

test('songs sync like everything else: a second device replays the same list and history', async () => {
  const { replica, host } = await setup();
  ok(await pasteSongs(host, 'Blackbird\nWonderwall', key));
  ok(await rateSong(host, songs(host)[0]!.cardId, 'good', 1000));
  ok(await archiveSong(host, songs(host)[1]!.itemId));
  const other = await Replica.open(memoryStore(), 'laptop', { now: clock });
  await other.restore(JSON.parse(replica.exportJson()).events);
  const there = createHost(other, SONGS, { now: clock });
  assert.deepEqual(songs(there), songs(host));
  assert.equal(other.library.reviews.get(songs(there)[0]!.cardId)?.length, 1);
});

// ------------------------------------------- no learning steps (Blake, 2026-10-31) --

const OTHER: ModuleManifest = { id: 'other-guitar', contract: 1, templates: [{ template: 'drill', tags: ['guitar'] }] };

test('song cards skip learning steps; every other card keeps them', async () => {
  const { replica, host } = await setup();
  const deck = createHost(replica, TEST_DECK, { now: clock });
  ok(await runModule(deck, () => seedTestDeck(deck)));
  ok(await addSong(host, 'a1', 'Blackbird'));
  assert.equal(usesSteps(replica.library, 'song-a1-c'), false);
  assert.equal(usesSteps(replica.library, 'td-fret-6-0-c'), true);
  assert.equal(usesSteps(replica.library, 'no-such-card'), true);
});

test('a first rating of a song schedules it in days: never again the same session', async () => {
  for (const rating of ['again', 'hard', 'good', 'easy'] as const) {
    const { replica, host } = await setup();
    ok(await addSong(host, 'a1', 'Blackbird'));
    t = ny('2026-11-02', '04:05');
    ok(await rateSong(host, 'song-a1-c', rating, 200_000));
    for (const hhmm of ['04:20', '04:59']) {
      assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-02', hhmm))), [], `${rating}: not back at ${hhmm}`);
    }
    const tomorrow = served(sessionFor(replica.library, ny('2026-11-03', '04:05')));
    assert.deepEqual(tomorrow, rating === 'again' ? ['song-a1-c'] : [], `${rating}: tomorrow morning`);
  }
});

test('the same rating on another module\'s guitar card still uses the 10-minute learning step', async () => {
  const { replica } = await setup();
  const other = createHost(replica, OTHER, { now: clock });
  await other.addItem('o1', { name: 'Spider drill' });
  await other.addCard('o1-c', 'o1', 'drill');
  t = ny('2026-11-02', '04:05');
  await other.reportRep('o1-c', 'good', 60_000);
  assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-02', '04:20'))), ['o1-c']);
});

test('a forgotten song comes back the next morning, not minutes later, and the lapse still counts', async () => {
  const { replica, host } = await setup();
  ok(await addSong(host, 'a1', 'Blackbird'));
  t = ny('2026-11-02', '04:05');
  ok(await rateSong(host, 'song-a1-c', 'good', 1000));
  t = ny('2026-11-10', '04:05');
  ok(await rateSong(host, 'song-a1-c', 'again', 1000));
  assert.deepEqual(served(sessionFor(replica.library, ny('2026-11-10', '04:30'))), []);
  const next = review(sessionFor(replica.library, ny('2026-11-11', '04:05')))!;
  assert.deepEqual(next.due.map((d) => [d.memory.cardId, d.memory.phase, d.memory.lapses]), [['song-a1-c', 'review', 1]]);
});
