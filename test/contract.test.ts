import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  chordSpelling,
  CONTRACT_VERSION,
  ContractViolation,
  createHost,
  deckEntries,
  MAX_WRITES_PER_HOUR,
  memoryStore,
  prompt,
  Replica,
  runModule,
  seedTestDeck,
  TEST_DECK,
} from '../src/index.ts';
import type { ModuleManifest } from '../src/index.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';
import { dayBegins } from '../src/day.ts';

let t = Date.UTC(2026, 10, 2, 14);
const clock = () => (t += 1000);
const SONGS: ModuleManifest = { id: 'songs', contract: 1, templates: [{ template: 'song-recall', tags: ['guitar'] }] };

async function setup() {
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const deck = createHost(replica, TEST_DECK, { now: clock });
  const songs = createHost(replica, SONGS, { now: clock });
  return { replica, deck, songs };
}

// ------------------------------------------------------------- test deck --

test('test deck: 78 fretboard notes and 24 chord spellings, all silent pocket cards', () => {
  const entries = deckEntries();
  assert.equal(entries.filter((e) => e.template === 'fret-note').length, 78);
  assert.equal(entries.filter((e) => e.template === 'chord-spelling').length, 24);
  assert.equal(new Set(entries.map((e) => e.cardId)).size, 102);
  assert.deepEqual(TEST_DECK.templates.map((x) => x.tags), [['pocket-silent'], ['pocket-silent']]);
});

test('fretboard answers are right', () => {
  const answer = (s: number, f: number) => deckEntries().find((e) => e.itemId === `td-fret-${s}-${f}`)!.fields.answer;
  assert.equal(answer(6, 0), 'E');
  assert.equal(answer(6, 5), 'A');
  assert.equal(answer(5, 2), 'B');
  assert.equal(answer(3, 1), 'G#/Ab');
  assert.equal(answer(2, 1), 'C');
  assert.equal(answer(1, 12), 'E');
});

test('chords are spelled with the right letters, not just the right pitches', () => {
  assert.equal(chordSpelling('C', 'major'), 'C E G');
  assert.equal(chordSpelling('F', 'major'), 'F A C');
  assert.equal(chordSpelling('Eb', 'major'), 'Eb G Bb');
  assert.equal(chordSpelling('F#', 'major'), 'F# A# C#');
  assert.equal(chordSpelling('Db', 'major'), 'Db F Ab');
  assert.equal(chordSpelling('F', 'minor'), 'F Ab C');
  assert.equal(chordSpelling('C#', 'minor'), 'C# E G#');
  assert.equal(chordSpelling('Bb', 'minor'), 'Bb Db F');
  assert.equal(chordSpelling('D#', 'minor'), 'D# F# A#');
  assert.equal(chordSpelling('G#', 'minor'), 'G# B D#');
});

test('seeding is idempotent, and two devices seed identical ids', async () => {
  const { replica, deck } = await setup();
  assert.equal(await seedTestDeck(deck), 102);
  const after = replica.log.length;
  assert.equal(await seedTestDeck(deck), 0);
  assert.equal(replica.log.length, after, 'nothing written twice');
  const other = await setup();
  await seedTestDeck(other.deck);
  assert.deepEqual([...other.replica.library.cards.keys()].sort(), [...replica.library.cards.keys()].sort());
});

test('prompts read naturally', async () => {
  const { replica, deck } = await setup();
  await seedTestDeck(deck);
  const lib = replica.library;
  const q = (cardId: string) => prompt(lib.cards.get(cardId)!, lib.items.get(lib.cards.get(cardId)!.itemId)!);
  assert.deepEqual(q('td-fret-6-5-c'), { question: 'String 6 (low E), fret 5: which note?', answer: 'A' });
  assert.deepEqual(q('td-chord-f-minor-c'), { question: 'Spell F minor.', answer: 'F Ab C' });
});

test('the test deck runs through the contract: new cards in the 1pm burst, reps recorded', async () => {
  const { replica, deck } = await setup();
  await seedTestDeck(deck);
  const onePm = dayBegins('2026-11-02', BLAKE_SETTINGS.dayStart) + 10 * 60 * 60 * 1000;
  const s = deck.session(onePm);
  assert.equal(s.due.length, 0);
  assert.equal(s.fresh.length, 102);
  await deck.reportRep(s.fresh[0]!, 'good', 4000);
  assert.equal(replica.library.reviews.get(s.fresh[0]!)?.length, 1);
});

// --------------------------------------------------------------- contract --

test('a module only sees its own items and cards', async () => {
  const { deck, songs } = await setup();
  await seedTestDeck(deck);
  await songs.addItem('song-1', { title: 'Wonderwall' });
  await songs.addCard('song-1-c', 'song-1', 'song-recall');
  assert.deepEqual(songs.items().map((i) => i.id), ['song-1']);
  assert.deepEqual(songs.cards().map((c) => c.id), ['song-1-c']);
  assert.equal(deck.items().length, 102);
  assert.ok(!deck.cards().some((c) => c.id === 'song-1-c'));
});

test("a module cannot touch another module's data, and is switched off for trying", async () => {
  const { replica, deck, songs } = await setup();
  await seedTestDeck(deck);
  const before = canonical(replica.log);
  await assert.rejects(songs.reportRep('td-fret-6-5-c', 'easy', 1000), ContractViolation);
  assert.equal(songs.enabled, false);
  await assert.rejects(songs.addItem('song-2', {}), /switched off/);
  assert.equal(canonical(replica.log), before, 'nothing got in');
  assert.ok(deck.enabled, 'the other module carries on');
  await deck.reportRep('td-fret-6-5-c', 'good', 1000);
});

test('each kind of overreach is refused', async () => {
  for (const attempt of [
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.addItem('td-fret-6-5', { hijack: true }),
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.addCard('x', 'td-fret-6-5', 'song-recall'),
    async (h: Awaited<ReturnType<typeof setup>>) => (await h.songs.addItem('s', {}), h.songs.addCard('td-fret-6-5-c', 's', 'song-recall')),
    async (h: Awaited<ReturnType<typeof setup>>) => (await h.songs.addItem('s', {}), h.songs.addCard('s-c', 's', 'not-declared')),
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.retireCard('td-fret-6-5-c'),
  ]) {
    const h = await setup();
    await seedTestDeck(h.deck);
    const deckCards = canonical([...h.replica.library.cards.values()].filter((c) => c.itemId.startsWith('td-')));
    await assert.rejects(attempt(h), ContractViolation);
    assert.equal(h.songs.enabled, false);
    assert.equal(canonical([...h.replica.library.cards.values()].filter((c) => c.itemId.startsWith('td-'))), deckCards);
  }
});

test('garbage from a module is rejected by the log and switches the module off', async () => {
  const { replica, deck } = await setup();
  await seedTestDeck(deck);
  const before = replica.log.length;
  await assert.rejects(deck.reportRep('td-fret-6-5-c', 'perfect' as never, 1000), ContractViolation);
  assert.equal(replica.log.length, before);
  assert.equal(deck.enabled, false);
});

test('reps on a retired card are refused', async () => {
  const { deck } = await setup();
  await seedTestDeck(deck);
  await deck.retireCard('td-fret-6-5-c');
  await assert.rejects(deck.reportRep('td-fret-6-5-c', 'good', 1000), /retired/);
});

test('crash boundary: a module that throws is switched off; the engine and other modules carry on', async () => {
  const { replica, deck, songs } = await setup();
  const r = await runModule(songs, () => {
    throw new Error('null is not an object');
  });
  assert.deepEqual(r, { ok: false, error: 'null is not an object' });
  assert.equal(songs.enabled, false);
  const again = await runModule(songs, () => 1);
  assert.deepEqual(again, { ok: false, error: 'songs is switched off: null is not an object' });
  const fine = await runModule(deck, () => seedTestDeck(deck));
  assert.deepEqual(fine, { ok: true, value: 102 });
  await replica.record({ type: 'played', minutes: 10 });
});

test('a runaway module is stopped by the write budget', async () => {
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  const host = createHost(replica, SONGS, { now: () => 0 });
  await host.addItem('s', {});
  for (let i = 1; i < MAX_WRITES_PER_HOUR; i++) await host.addItem('s', { n: i });
  await assert.rejects(host.addItem('s', { n: -1 }), /writes in an hour/);
  assert.equal(host.enabled, false);
  assert.equal(replica.log.length, MAX_WRITES_PER_HOUR);
});

test('contract v1 is locked: version, host surface and manifest shape are frozen (Blake, 2026-10-31)', async () => {
  assert.equal(CONTRACT_VERSION, 1);
  const { songs } = await setup();
  const surface = Object.keys(songs).sort();
  assert.deepEqual(
    surface,
    ['addCard', 'addItem', 'cards', 'disabledReason', 'enabled', 'items', 'moduleId', 'reportRep', 'retireCard', 'reviews', 'session'],
    'the host surface changed: that needs Blake\'s yes and a new contract version',
  );
  for (const m of [TEST_DECK, SONGS]) assert.deepEqual(Object.keys(m).sort(), ['contract', 'id', 'templates']);
  assert.equal(MAX_WRITES_PER_HOUR, 2000);
});
