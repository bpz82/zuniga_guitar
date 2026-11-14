import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canonical,
  chordSpelling,
  CONTRACT_VERSION,
  ContractViolation,
  createHost,
  deckEntries,
  diatonicChords,
  FRETBOARD_DECK,
  FRETBOARD_DECK_NAME,
  fretDiagram,
  keySignature,
  majorScale,
  openStages,
  RETIRED_DECK_CARDS,
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

// ------------------------------------------------- Fretboard and chords --
// The built-in deck (module id test-deck), rebuilt 2026-11-13 as a staged,
// two-direction fretboard trainer with chords beyond triads.

/** Cards a new log gets: stage 1 of both tracks. */
const STAGE_ONE = deckEntries().filter((e) => e.stage === 1).length;

test('Fretboard and chords: both directions on the neck, patterns, chords beyond triads; ids unique; all silent pocket cards', () => {
  const entries = deckEntries();
  const of = (t: string) => entries.filter((e) => e.template === t);
  assert.equal(FRETBOARD_DECK_NAME, 'Fretboard and chords');
  assert.equal(FRETBOARD_DECK, TEST_DECK);
  assert.equal(TEST_DECK.id, 'test-deck', 'the module id stays: items in the log carry it');
  assert.equal(of('fret-note').length, 72, '6 strings, open to fret 11: fret 12 is one pattern card now');
  assert.equal(of('find-note').length, 66, 'every fretted note below 12 on every string, found by name');
  assert.ok(of('fret-pattern').length >= 8);
  assert.equal(of('chord-spelling').length, 24 + 24 + 24 + 36, 'triads, power and diminished, sus2 and sus4, maj7 7 m7');
  assert.ok(of('key-spelling').length >= 12 + 5);
  assert.equal(new Set(entries.map((e) => e.cardId)).size, entries.length, 'unique card ids');
  assert.equal(new Set(entries.map((e) => e.itemId)).size, entries.length, 'unique item ids');
  for (const e of entries) assert.ok(e.cardId.length <= 64 && e.cardId === `${e.itemId}-c`, e.cardId);
  assert.ok(TEST_DECK.templates.every((x) => x.tags.length === 1 && x.tags[0] === 'pocket-silent'));
  assert.ok(entries.every((e) => TEST_DECK.templates.some((t) => t.template === e.template)), 'every template declared');
});

test('Fretboard and chords: no duplicate fret-12 cards, retired ids never reused, both directions agree', () => {
  const entries = deckEntries();
  const ids = new Set(entries.map((e) => e.cardId));
  assert.ok(!entries.some((e) => e.template === 'fret-note' && e.fields.fret === 12));
  for (const id of RETIRED_DECK_CARDS) assert.ok(!ids.has(id), id);
  assert.deepEqual([...RETIRED_DECK_CARDS].sort(), ['td-chord-ds-minor-c', ...[1, 2, 3, 4, 5, 6].map((s) => `td-fret-${s}-12-c`)].sort());
  // Every find-note card points at the fret whose fret-note card names that note.
  for (const f of entries.filter((e) => e.template === 'find-note')) {
    const back = entries.find((e) => e.template === 'fret-note' && e.fields.string === f.fields.string && e.fields.fret === f.fields.answer)!;
    assert.equal(back.fields.answer, f.fields.note, f.cardId);
  }
  // Each string has a find card for every note but its open one.
  for (const s of [1, 2, 3, 4, 5, 6]) assert.equal(entries.filter((e) => e.template === 'find-note' && e.fields.string === s).length, 11);
});

test('fretboard answers are right', () => {
  const answer = (s: number, f: number) => deckEntries().find((e) => e.itemId === `td-fret-${s}-${f}`)!.fields.answer;
  assert.equal(answer(6, 0), 'E');
  assert.equal(answer(6, 5), 'A');
  assert.equal(answer(5, 2), 'B');
  assert.equal(answer(3, 1), 'G#/Ab');
  assert.equal(answer(2, 1), 'C');
  assert.equal(answer(1, 11), 'D#/Eb');
  const find = (id: string) => deckEntries().find((e) => e.itemId === id)!.answer;
  assert.equal(find('td-find-5-d'), 'Fret 5');
  assert.equal(find('td-find-6-c'), 'Fret 8');
  assert.equal(find('td-find-2-c'), 'Fret 1');
  assert.equal(find('td-find-3-b'), 'Fret 4');
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
  assert.equal(chordSpelling('Eb', 'minor'), 'Eb Gb Bb');
  assert.equal(chordSpelling('G#', 'minor'), 'G# B D#');
  assert.equal(chordSpelling('G', '7'), 'G B D F');
  assert.equal(chordSpelling('C', 'maj7'), 'C E G B');
  assert.equal(chordSpelling('A', 'm7'), 'A C E G');
  assert.equal(chordSpelling('Bb', '7'), 'Bb D F Ab');
  assert.equal(chordSpelling('B', 'dim'), 'B D F');
  assert.equal(chordSpelling('C#', 'dim'), 'C# E G');
  assert.equal(chordSpelling('D', 'sus2'), 'D E A');
  assert.equal(chordSpelling('D', 'sus4'), 'D G A');
  assert.equal(chordSpelling('E', 'power'), 'E B');
});

test('keys: signatures and diatonic chords', () => {
  assert.equal(keySignature('C'), 'No sharps or flats');
  assert.equal(keySignature('G'), '1 sharp: F#');
  assert.equal(keySignature('E'), '4 sharps: F# C# G# D#');
  assert.equal(keySignature('F'), '1 flat: Bb');
  assert.equal(keySignature('Db'), '5 flats: Bb Eb Ab Db Gb');
  assert.equal(keySignature('F#'), '6 sharps: F# C# G# D# A# E#');
  assert.equal(diatonicChords('G'), 'G Am Bm C D Em F#dim');
  assert.equal(diatonicChords('E'), 'E F#m G#m A B C#m D#dim');
  assert.deepEqual(majorScale('A'), ['A', 'B', 'C#', 'D', 'E', 'F#', 'G#']);
});

test('staged: a new log gets stage 1 of each track only; seeding is idempotent and identical on two devices', async () => {
  const { replica, deck } = await setup();
  assert.equal(await seedTestDeck(deck), STAGE_ONE);
  assert.equal(STAGE_ONE, 6 + 2 + 24, 'open strings and two patterns; the 24 triads');
  assert.deepEqual(openStages(deck), { neck: 1, chords: 1 });
  const after = replica.log.length;
  assert.equal(await seedTestDeck(deck), 0);
  assert.equal(replica.log.length, after, 'nothing written twice');
  const other = await setup();
  await seedTestDeck(other.deck);
  assert.deepEqual([...other.replica.library.cards.keys()].sort(), [...replica.library.cards.keys()].sort());
});

test('staged: the next stage of a track opens once every card before it has been answered right at least once', async () => {
  const { deck } = await setup();
  await seedTestDeck(deck);
  const neck1 = deckEntries().filter((e) => e.track === 'neck' && e.stage === 1);
  for (const e of neck1.slice(1)) await deck.reportRep(e.cardId, 'good', 1000);
  await deck.reportRep(neck1[0]!.cardId, 'again', 1000);
  assert.equal(await seedTestDeck(deck), 0, 'a card only ever missed holds the stage');
  await deck.reportRep(neck1[0]!.cardId, 'hard', 1000);
  const stage2 = deckEntries().filter((e) => e.track === 'neck' && e.stage === 2).length;
  assert.equal(await seedTestDeck(deck), stage2, 'neck stage 2 opens');
  assert.deepEqual(openStages(deck), { neck: 2, chords: 1 }, 'the chords track moves on its own');
  assert.ok(deck.cards().some((c) => c.id === 'td-find-6-c-c'), 'both directions arrive together');
});

test('a log from the old 102-card deck: its cards stay (history kept), fret 12 and D# minor are switched off, E-flat minor is added', async () => {
  const { replica, deck } = await setup();
  // The 2026-10-30 deck as it was seeded.
  for (const s of [6, 5, 4, 3, 2, 1]) for (let f = 0; f <= 12; f++) {
    await deck.addItem(`td-fret-${s}-${f}`, { string: s, fret: f });
    await deck.addCard(`td-fret-${s}-${f}-c`, `td-fret-${s}-${f}`, 'fret-note');
  }
  await deck.addItem('td-chord-ds-minor', { root: 'D#', quality: 'minor', answer: 'D# F# A#' });
  await deck.addCard('td-chord-ds-minor-c', 'td-chord-ds-minor', 'chord-spelling');
  await deck.reportRep('td-fret-6-12-c', 'good', 1000);
  await seedTestDeck(deck);
  const card = (id: string) => replica.library.cards.get(id);
  for (const id of RETIRED_DECK_CARDS) assert.equal(card(id)?.retired, true, id);
  assert.equal(replica.library.reviews.get('td-fret-6-12-c')?.length, 1, 'history kept');
  assert.equal(card('td-fret-4-7-c')?.retired, false, 'cards of later stages already in the log stay');
  assert.equal(card('td-chord-eb-minor-c')?.retired, false);
  const lib = replica.library;
  const old = { ...lib.items.get('td-fret-6-12')!, fields: { string: 6, stringName: 'low E', fret: 12, answer: 'E' } };
  assert.deepEqual(prompt(lib.cards.get('td-fret-6-12-c')!, old), { question: 'String 6 (low E), fret 12: which note?', answer: 'E' }, 'a retired card still reads from its own fields');
});

test('prompts read naturally, from the code; neck cards come with a small text fretboard', async () => {
  const { deck } = await setup();
  await seedTestDeck(deck);
  const e = (id: string) => deckEntries().find((x) => x.cardId === id)!;
  const q = (id: string) => {
    const x = e(id);
    const p = prompt({ id: x.cardId, itemId: x.itemId, template: x.template, tags: ['pocket-silent'], retired: false }, { id: x.itemId, module: 'test-deck', fields: x.fields });
    return { question: p.question, answer: p.answer, diagram: p.diagram };
  };
  assert.deepEqual({ ...q('td-fret-6-5-c'), diagram: undefined }, { question: 'String 6 (low E), fret 5: which note?', answer: 'A', diagram: undefined });
  assert.equal(q('td-fret-5-0-c').question, 'String 5 (A), open: which note?', 'open, not fret 0');
  assert.deepEqual({ ...q('td-chord-f-minor-c'), diagram: undefined }, { question: 'Spell F minor.', answer: 'F Ab C', diagram: undefined });
  assert.equal(q('td-find-5-d-c').question, 'Find D on string 5 (A), below fret 12.');
  assert.equal(q('td-chord-g-7-c').question, 'Spell G7 (dominant 7).');
  assert.equal(q('td-key-g-chords-c').answer, 'G Am Bm C D Em F#dim');
  const d = q('td-fret-6-5-c').diagram!.split('\n');
  assert.equal(d.length, 7, 'a header and six strings');
  assert.match(d[6]!, /^E .*-●-/, 'the low E row marks the note');
  assert.equal(d.filter((l) => l.includes('●')).length, 1);
  assert.match(fretDiagram(5, 0).split('\n')[5]!, /^A ●‖/, 'an open string is marked at the nut');
  assert.equal(q('td-chord-f-minor-c').diagram, undefined);
});

test('the deck runs through the contract: new cards in the 1pm burst, reps recorded', async () => {
  const { replica, deck } = await setup();
  await seedTestDeck(deck);
  const onePm = dayBegins('2026-11-02', BLAKE_SETTINGS.dayStart) + 10 * 60 * 60 * 1000;
  const s = deck.session(onePm);
  assert.equal(s.due.length, 0);
  assert.equal(s.fresh.length, STAGE_ONE);
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
  assert.equal(deck.items().length, STAGE_ONE);
  assert.ok(!deck.cards().some((c) => c.id === 'song-1-c'));
});

test("a module cannot touch another module's data, and is switched off for trying", async () => {
  const { replica, deck, songs } = await setup();
  await seedTestDeck(deck);
  const before = canonical(replica.log);
  await assert.rejects(songs.reportRep('td-fret-6-0-c', 'easy', 1000), ContractViolation);
  assert.equal(songs.enabled, false);
  await assert.rejects(songs.addItem('song-2', {}), /switched off/);
  assert.equal(canonical(replica.log), before, 'nothing got in');
  assert.ok(deck.enabled, 'the other module carries on');
  await deck.reportRep('td-fret-6-0-c', 'good', 1000);
});

test('each kind of overreach is refused', async () => {
  for (const attempt of [
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.addItem('td-fret-6-0', { hijack: true }),
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.addCard('x', 'td-fret-6-0', 'song-recall'),
    async (h: Awaited<ReturnType<typeof setup>>) => (await h.songs.addItem('s', {}), h.songs.addCard('td-fret-6-0-c', 's', 'song-recall')),
    async (h: Awaited<ReturnType<typeof setup>>) => (await h.songs.addItem('s', {}), h.songs.addCard('s-c', 's', 'not-declared')),
    async (h: Awaited<ReturnType<typeof setup>>) => h.songs.retireCard('td-fret-6-0-c'),
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
  await assert.rejects(deck.reportRep('td-fret-6-0-c', 'perfect' as never, 1000), ContractViolation);
  assert.equal(replica.log.length, before);
  assert.equal(deck.enabled, false);
});

test('reps on a retired card are refused', async () => {
  const { deck } = await setup();
  await seedTestDeck(deck);
  await deck.retireCard('td-fret-6-0-c');
  await assert.rejects(deck.reportRep('td-fret-6-0-c', 'good', 1000), /retired/);
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
  assert.deepEqual(fine, { ok: true, value: STAGE_ONE });
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
