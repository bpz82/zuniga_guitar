/** Theory and physics flashcards: the deck's content rules, and the module through contract v1. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, memoryStore, Replica, runModule, sessionFor, SONGS } from '../src/index.ts';
import type { ReviewSegment, Session } from '../src/index.ts';
import { BOOK_TITLE, CHAPTERS, citation, DECK, TOPICS } from '../src/modules/theory/deck.ts';
import type { McCard } from '../src/modules/theory/deck.ts';
import { answerMc, cardIdOf, contentOf, optionsFor, rateQa, seedTheory, setTopic, THEORY, topics } from '../src/modules/theory/practice.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * 60_000;
};
let t = ny('2026-11-02', '13:05');
const clock = () => (t += 1000);
async function setup() {
  t = ny('2026-11-02', '13:05');
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, THEORY, { now: clock });
  await seedTheory(host);
  return { replica, host };
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const served = (s: Session) => {
  const r = s.segments.find((x): x is ReviewSegment => x.kind === 'review');
  return [...(r?.due.map((d) => d.memory.cardId) ?? []), ...(r?.fresh ?? [])];
};
const text = (c: (typeof DECK)[number]) => [c.question, c.answer, ...(c.type === 'mc' ? [...c.wrong, c.why] : [])];

// ------------------------------------------------------------- content --

test('about 120 starter cards across all ten topics, both card types', () => {
  assert.equal(DECK.length, 120);
  for (const { id } of TOPICS) assert.ok(DECK.filter((c) => c.topic === id).length >= 10, id);
  assert.ok(DECK.filter((c) => c.type === 'mc').length >= 40);
  assert.ok(DECK.filter((c) => c.type === 'qa').length >= 40);
  assert.equal(new Set(DECK.map((c) => c.id)).size, DECK.length, 'unique ids');
  for (const c of DECK) assert.match(cardIdOf(c.id), /^th-[a-z0-9-]{1,40}-c$/);
});

test('every card cites its source: a real chapter of Benade or Winer, or says plainly it is general', () => {
  for (const c of DECK) {
    if (c.source.book === 'general') assert.match(c.source.note, /not from Benade or Winer/, c.id);
    else assert.ok(CHAPTERS[c.source.book][c.source.chapter], `${c.id}: chapter ${c.source.chapter}`);
  }
  assert.equal(Object.keys(CHAPTERS.benade).length, 25);
  assert.equal(Object.keys(CHAPTERS.winer).length, 26);
  assert.ok(DECK.filter((c) => c.source.book === 'benade').length >= 30);
  assert.ok(DECK.filter((c) => c.source.book === 'winer').length >= 30);
  const pickup = DECK.find((c) => c.id === 'res-pickup')!;
  assert.equal(citation(pickup.source), `Source: ${BOOK_TITLE.winer}, ch. 17, Microphones and Pickups`);
});

test('original wording only: no quotation marks anywhere, no copied-figure references', () => {
  for (const c of DECK) {
    for (const s of text(c)) {
      assert.ok(!/["“”]/.test(s), `${c.id}: no quoted passages`);
      assert.ok(!/\b(figure|fig\.|table)\s*\d/i.test(s), `${c.id}: no reproduced figures`);
      assert.ok(s.trim().length > 0 && s.length <= 400, `${c.id}: short, self-contained`);
    }
  }
});

test('multiple choice: four distinct options and an explanation', () => {
  for (const c of DECK.filter((x): x is McCard => x.type === 'mc')) {
    assert.equal(new Set([c.answer, ...c.wrong]).size, 4, c.id);
    assert.ok(c.why.length > 10, c.id);
  }
});

test('the numbers on the cards check out', () => {
  const freq = (semisFromA4: number) => 440 * 2 ** (semisFromA4 / 12);
  const cents = (ratio: number) => 1200 * Math.log2(ratio);
  assert.equal(Math.round(freq(-29) * 10) / 10, 82.4, 'low E');
  assert.equal(Math.round(freq(-5) * 10) / 10, 329.6, 'high E');
  assert.equal(Math.round(freq(-7 - 24 + 12 - 12)), 73, 'drop D');
  assert.equal(Math.round(freq(-41) * 10) / 10, 41.2, 'bass low E');
  assert.equal(Math.round(freq(-5 + 22)), 1175, '22nd fret, high E: D6');
  assert.equal(Math.round(400 - cents(5 / 4)), 14, 'tempered third about 14 cents sharp');
  assert.equal(Math.round((cents(3 / 2) - 700) * 10) / 10, 2, 'tempered fifth about 2 cents flat');
  assert.equal(Math.round(1000 - cents(7 / 4)), 31, '7th harmonic about 31 cents flat');
  assert.equal(Math.round(cents((3 / 2) ** 12 / 2 ** 7) * 10) / 10, 23.5, 'Pythagorean comma');
  assert.equal(Math.round(cents((3 / 2) ** 4 / 4 / (5 / 4)) * 10) / 10, 21.5, 'syntonic comma');
  assert.equal(Math.round((25.5 / 24.75) ** 2 * 100 - 100), 6, 'longer scale: about 6% more tension');
  assert.equal(Math.round((1 - 2 ** (-1 / 12)) * 1000) / 10, 5.6, 'each fret: about 5.6% shorter');
  assert.equal(Math.round(20 * Math.log10(0.775 * 10 ** (4 / 20) / 10 ** (-10 / 20)) * 10) / 10, 11.8, '+4 dBu vs -10 dBV');
  assert.equal(Math.round(20 * Math.log10(2)), 6);
  assert.equal(Math.round(10 * Math.log10(2)), 3);
});

// -------------------------------------------------------------- module --

test('seeding adds all 120 cards once, silent-pocket only, Q/A and multiple choice templates', async () => {
  const { replica, host } = await setup();
  assert.equal(host.cards().length, 120);
  assert.ok(host.cards().every((c) => c.tags.length === 1 && c.tags[0] === 'pocket-silent'));
  assert.equal(replica.library.items.get('th-res-pickup')?.fields.topic, 'resonance');
  assert.deepEqual(new Set(host.cards().map((c) => c.template)), new Set(['qa', 'mc']));
  const n = replica.log.length;
  assert.equal(await seedTheory(host), 0);
  assert.equal(replica.log.length, n, 'idempotent');
});

test('usable during work hours: served in the silent burst and every pocket window, never in the morning guitar session', async () => {
  const { replica } = await setup();
  for (const hhmm of ['13:05', '09:50', '16:35']) assert.ok(served(sessionFor(replica.library, ny('2026-11-02', hhmm))).some((id) => id.startsWith('th-')), hhmm);
  assert.ok(!served(sessionFor(replica.library, ny('2026-11-03', '04:05'))).some((id) => id.startsWith('th-')));
});

test('Q/A: rated Again to Easy; multiple choice: right is Good, wrong is Again', async () => {
  const { replica, host } = await setup();
  ok(await rateQa(host, cardIdOf('db-twice'), 'hard', 9000));
  assert.deepEqual(replica.library.reviews.get(cardIdOf('db-twice'))!.map((r) => [r.rating, r.durationMs, r.details?.topic]), [['hard', 9000, 'loudness']]);
  const mcCard = DECK.find((c) => c.id === 'comp-ratio') as McCard;
  assert.deepEqual(ok(await answerMc(host, cardIdOf('comp-ratio'), mcCard.answer, 4000)).correct, true);
  assert.deepEqual(ok(await answerMc(host, cardIdOf('comp-ratio'), mcCard.wrong[0], 4000)).correct, false);
  assert.deepEqual(replica.library.reviews.get(cardIdOf('comp-ratio'))!.map((r) => [r.rating, r.details?.correct]), [['good', true], ['again', false]]);
});

test('wrong kinds of answers are refused, write nothing, and never trip the contract', async () => {
  const { replica, host } = await setup();
  const n = replica.log.length;
  assert.equal((await rateQa(host, cardIdOf('comp-ratio'), 'good', 1)).ok, false, 'mc card rated like Q/A');
  assert.equal((await answerMc(host, cardIdOf('db-twice'), 'x', 1)).ok, false, 'Q/A card answered like mc');
  assert.equal((await answerMc(host, cardIdOf('comp-ratio'), 'Not an option', 1)).ok, false);
  assert.equal((await rateQa(host, cardIdOf('nope'), 'good', 1)).ok, false);
  assert.equal((await rateQa(host, cardIdOf('db-twice'), 'perfect' as 'good', 1)).ok, false);
  assert.equal(replica.log.length, n);
  assert.ok(host.enabled);
});

test('options are shuffled per showing so the position is never the cue', () => {
  const c = DECK.find((x) => x.id === 'harm-2-3') as McCard;
  assert.deepEqual(optionsFor(c, 7), optionsFor(c, 7));
  assert.deepEqual([...optionsFor(c, 7)].sort(), [c.answer, ...c.wrong].sort());
  const places = new Set(Array.from({ length: 40 }, (_, i) => optionsFor(c, i + 1).indexOf(c.answer)));
  assert.equal(places.size, 4, 'the answer shows up in every position');
});

test('cards by topic: turning a topic off retires its cards (not served); on restores them with their history', async () => {
  const { replica, host } = await setup();
  ok(await rateQa(host, cardIdOf('tape-hiss'), 'good', 1000));
  const off = ok(await setTopic(host, 'tape', false));
  assert.deepEqual([off.on, off.total], [0, 12]);
  t = ny('2026-11-20', '13:05');
  assert.ok(!served(sessionFor(replica.library, t)).some((id) => contentOf(host, id)?.topic === 'tape'));
  assert.equal((await rateQa(host, cardIdOf('tape-hiss'), 'good', 1)).ok, false, 'off means off');
  assert.equal(await seedTheory(host), 0, 'launching again does not switch it back on');
  assert.equal(topics(host).find((x) => x.topic === 'tape')!.on, 0);
  const on = ok(await setTopic(host, 'tape', true));
  assert.equal(on.on, 12);
  assert.ok(served(sessionFor(replica.library, t)).includes(cardIdOf('tape-hiss')), 'back, and due from its history');
  const n = replica.log.length;
  ok(await setTopic(host, 'tape', true));
  assert.equal(replica.log.length, n, 'no writes when nothing changes');
  assert.equal((await setTopic(host, 'astrology' as 'tape', true)).ok, false);
});

test('isolation: other modules cannot answer or toggle theory cards; a theory crash leaves them running', async () => {
  const { replica, host } = await setup();
  const songs = createHost(replica, SONGS, { now: clock });
  assert.equal(contentOf(songs, cardIdOf('db-twice')), undefined);
  assert.equal((await rateQa(songs, cardIdOf('db-twice'), 'good', 1)).ok, false);
  const crash = await runModule(host, () => host.reportRep('song-x-c', 'good', 1));
  assert.equal(crash.ok, false);
  assert.ok(!host.enabled && songs.enabled);
});
