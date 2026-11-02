/**
 * Theory and physics: the curriculum (2026-11-02): content rules, lesson
 * gating and the graduation rule, the migration from the superseded topic
 * deck, and the module through contract v1. The superseded deck's own
 * content rules are kept at the end (its cards stay in the log).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, dueToday, memoryStore, Replica, runModule, sessionFor, SONGS } from '../src/index.ts';
import type { ModuleHost, ReviewSegment, Session } from '../src/index.ts';
import { BOOK_TITLE, CHAPTERS, citation, DECK, TOPICS } from '../src/modules/theory/deck.ts';
import type { McCard } from '../src/modules/theory/deck.ts';
import { CURRICULUM_CHAPTERS, LESSON_CARDS, lessonCardById, LESSONS } from '../src/modules/theory/curriculum.ts';
import type { LessonCard, LessonMc } from '../src/modules/theory/curriculum.ts';
import {
  answerMc,
  cardIdOf,
  contentOf,
  currentLesson,
  EXTRAS,
  extras,
  GRADUATE_STABILITY_DAYS,
  itemIdOf,
  lessonStates,
  optionsFor,
  rateQa,
  seedTheory,
  setExtras,
  THEORY,
} from '../src/modules/theory/practice.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * 60_000;
};
let t = ny('2026-11-02', '13:05');
const clock = () => (t += 1000);
async function setup(seed = true) {
  t = ny('2026-11-02', '13:05');
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, THEORY, { now: clock });
  if (seed) await seedTheory(host, NY);
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
const lessonText = (n: number) => {
  const l = LESSONS[n - 1]!;
  return [l.title, ...l.reading, ...l.cards.flatMap(cardText)];
};
const cardText = (c: LessonCard | (typeof DECK)[number]) => [c.question, c.answer, ...(c.type === 'mc' ? [...c.wrong, c.why] : [])];
/** Answers a curriculum card right: Q/A with `rating`, multiple choice with its answer (Good). */
async function pass(host: ModuleHost, c: LessonCard, rating: 'hard' | 'good' | 'easy' = 'good') {
  if (c.type === 'qa') ok(await rateQa(host, cardIdOf(c.id), rating, 3000));
  else ok(await answerMc(host, cardIdOf(c.id), c.answer, 3000));
}

// ------------------------------------------------- curriculum: content --

test('one course from both books: 24 lessons in 5 chapters, in order, every lesson a reading and cards', () => {
  assert.equal(LESSONS.length, 24);
  LESSONS.forEach((l, i) => assert.equal(l.n, i + 1));
  assert.deepEqual(Object.keys(CURRICULUM_CHAPTERS).map(Number), [1, 2, 3, 4, 5]);
  for (let i = 1; i < LESSONS.length; i++) assert.ok(LESSONS[i]!.chapter >= LESSONS[i - 1]!.chapter, 'chapters run in order');
  for (const l of LESSONS) {
    assert.ok(l.reading.length >= 3, `lesson ${l.n} has a real reading`);
    assert.ok(l.cards.length >= 6 && l.cards.length <= 9, `lesson ${l.n}: ${l.cards.length} cards`);
    assert.ok(l.cards.some((c) => c.type === 'qa') && l.cards.some((c) => c.type === 'mc'), `lesson ${l.n}: both card types`);
    for (const c of l.cards) assert.equal(c.lesson, l.n);
  }
  assert.ok(LESSON_CARDS.length >= 150, `${LESSON_CARDS.length} cards`);
  assert.equal(new Set(LESSON_CARDS.map((c) => c.id)).size, LESSON_CARDS.length, 'unique ids');
  for (const c of LESSON_CARDS) {
    assert.match(c.id, /^l\d{2}-[a-z0-9-]+$/);
    assert.ok(cardIdOf(c.id).length <= 64, 'fits the log id limit');
    assert.equal(lessonCardById(c.id), c);
    assert.ok(!DECK.some((d) => d.id === c.id), 'never clashes with the superseded deck');
  }
});

test('both books are combined, not kept apart: most lessons draw on one, several on both', () => {
  const books = LESSONS.map((l) => new Set(l.cards.map((c) => c.source.book)));
  assert.ok(LESSON_CARDS.filter((c) => c.source.book === 'benade').length >= 50);
  assert.ok(LESSON_CARDS.filter((c) => c.source.book === 'winer').length >= 50);
  assert.ok(books.filter((b) => b.has('benade') && b.has('winer')).length >= 4, 'lessons that use both');
  // Musical acoustics leads into audio: the string and its music before rooms and recording.
  const firstWinerOnly = books.findIndex((b) => b.has('winer') && !b.has('benade') && b.size === 1);
  assert.ok(firstWinerOnly > 0);
});

test('every card keeps its citation as data: a real chapter of either book, or general with a note', () => {
  for (const c of LESSON_CARDS) {
    if (c.source.book === 'general') assert.ok(c.source.note.length > 5, c.id);
    else assert.ok(CHAPTERS[c.source.book][c.source.chapter], `${c.id}: chapter ${c.source.chapter}`);
  }
});

test('the sources are never in what the user reads: no book, author or publisher names in readings or cards', () => {
  for (const l of LESSONS) {
    for (const s of [l.title, ...l.reading, ...l.cards.flatMap(cardText)]) {
      assert.ok(!/benade|winer|audio expert|fundamentals of musical acoustics|dover|routledge|chapter \d|ch\. \d/i.test(s), `lesson ${l.n}: ${s.slice(0, 60)}`);
    }
  }
});

test('original wording only: no quoted passages, no reproduced figures, short self-contained cards', () => {
  for (const l of LESSONS) {
    for (const s of [...l.reading, ...l.cards.flatMap(cardText)]) {
      // Short scare quotes ("presence", "+10") are fine; a quoted passage is not.
      for (const m of s.matchAll(/"([^"]*)"|“([^”]*)”/g)) assert.ok((m[1] ?? m[2])!.length <= 12, `lesson ${l.n}: no quoted passages: ${m[0]}`);
      assert.ok(!/\b(figure|fig\.|table)\s*\d/i.test(s), `lesson ${l.n}: no reproduced figures`);
    }
    for (const c of l.cards) for (const s of cardText(c)) assert.ok(s.trim().length > 0 && s.length <= 400, `${c.id}: short`);
    for (const p of l.reading) assert.ok(p.length <= 900, `lesson ${l.n}: readable paragraphs`);
  }
});

test('starts from absolute basics: lesson 1 is what sound is, then frequency, then amplitude', () => {
  assert.deepEqual(LESSONS.slice(0, 3).map((l) => l.title), ['What sound is', 'Frequency, period and pitch', 'Amplitude and loudness']);
  assert.match(LESSONS[0]!.cards[0]!.question, /what is sound/i);
});

test('every term is defined before a card or reading uses it: no term shows up in a lesson before the one that teaches it', () => {
  // term -> the lesson whose reading defines it (a word-boundary match, any case).
  const TERMS: Record<string, number> = {
    'frequency': 2, 'hertz': 2, 'kHz': 2, 'period': 2, 'pitch': 2, 'octave': 2,
    'amplitude': 3, 'loudness': 3, 'decay': 3,
    'decibel': 4, 'dB': 4, 'power': 4, 'SPL': 4, 'inverse square': 4,
    'wavelength': 5, 'treble': 5,
    'sine': 6, 'phase': 6, 'polarity': 6, 'comb filter': 6,
    'partial': 7, 'fundamental': 7, 'harmonic': 7, 'overtone': 7, 'timbre': 7,
    'interval': 8, 'fifth': 8, 'fourth': 8, 'major third': 8, 'beats': 8,
    'cents': 9, 'semitone': 9,
    'node': 10, 'antinode': 10, 'mode': 10, 'vibrating length': 10,
    'tension': 11, 'scale length': 11,
    'natural harmonic': 12,
    'inharmonicity': 13, 'action': 13, 'intonation': 13, 'compensation': 13,
    'comma': 14, 'temperament': 14, 'just intonation': 14,
    'resonance': 15, 'natural frequenc': 15, 'damping': 15, 'soundboard': 15,
    'masking': 16, 'dB(A)': 16, 'equal-loudness': 16,
    'reverberation': 17, 'RT60': 17, 'room mode': 17, 'absorber': 17, 'diffuser': 17,
    'transducer': 18, 'voltage': 18, 'condenser': 18, 'cardioid': 18, 'humbucker': 18, 'pickup': 18,
    'preamp': 19, 'impedance': 19, 'direct injection': 19, 'balanced': 19, 'headroom': 19, 'clipping': 19, 'noise floor': 19, 'gain staging': 19,
    'equalizer': 20, 'EQ': 20, 'high-pass': 20, 'shelf': 20, 'Q': 20,
    'compressor': 21, 'threshold': 21, 'ratio': 21, 'attack': 7, 'release': 21, 'limiter': 21, 'noise gate': 21,
    'delay': 22, 'chorus': 22, 'flanger': 22, 'reverb': 22, 'pre-delay': 22, 'aux': 22, 'insert': 22,
    'sample rate': 23, 'Nyquist': 23, 'aliasing': 23, 'bit depth': 23, 'dBFS': 23, 'latency': 23,
    'bias': 24, 'tape hiss': 24, 'dbx': 24, 'bouncing': 24, 'azimuth': 24,
  };
  // Words that mean something else in plain English before they become terms.
  const ALLOWED: Record<string, RegExp> = {
    ratio: /ratio/i, // used plainly (ratios of pressure) from lesson 3 on
    delay: /delay/i, // plain English ("a delay shifts the phase") from lesson 6 on
    action: /action/i,
    release: /release/i,
    period: /period/i,
    bouncing: /bouncing/i, // sound bouncing between walls, long before tape bouncing
  };
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const problems: string[] = [];
  for (const [term, taught] of Object.entries(TERMS)) {
    // The term as a word, allowing simple endings (harmonics, filtering, frequencies), case-sensitive for short abbreviations.
    const word = new RegExp(`(^|[^A-Za-z])${esc(term)}(s|es|ing|ed|y|ies)?(?![A-Za-z])`, /[A-Z]/.test(term) && term.length <= 4 ? '' : 'i');
    const reading = LESSONS[taught - 1]!.reading.join(' ');
    assert.ok(word.test(reading), `"${term}" is defined in lesson ${taught}'s reading`);
    if (ALLOWED[term]) continue;
    for (let n = 1; n < taught; n++) if (lessonText(n).some((s) => word.test(s))) problems.push(`"${term}" used in lesson ${n}, taught in ${taught}`);
  }
  assert.deepEqual(problems, []);
});

test('multiple choice: four distinct options and an explanation', () => {
  for (const c of LESSON_CARDS.filter((x): x is LessonMc => x.type === 'mc')) {
    assert.equal(new Set([c.answer, ...c.wrong]).size, 4, c.id);
    assert.ok(c.why.length > 10, c.id);
  }
});

test('the numbers in the course check out', () => {
  const freq = (semisFromA4: number) => 440 * 2 ** (semisFromA4 / 12);
  const cents = (ratio: number) => 1200 * Math.log2(ratio);
  const c = 343;
  assert.equal(Math.round(c / 110 * 10) / 10, 3.1, '110 Hz wavelength');
  assert.equal(Math.round(c / 1000 * 100), 34, '1 kHz wavelength in cm');
  assert.equal(Math.round(c / 20), 17, '20 Hz wavelength');
  assert.equal(Math.round(c / 8), 43, 'first mode between walls 4 m apart');
  assert.equal(Math.round(freq(-29) * 10) / 10, 82.4, 'low E');
  assert.equal(Math.round(freq(-5) * 10) / 10, 329.6, 'high E');
  assert.equal(Math.round(freq(-31) * 10) / 10, 73.4, 'drop D');
  assert.equal(Math.round(freq(-5 + 22)), 1175, '22nd fret, high E: D6');
  assert.equal(Math.round(400 - cents(5 / 4)), 14, 'tempered third about 14 cents wide');
  assert.equal(Math.round((cents(3 / 2) - 700) * 10) / 10, 2, 'tempered fifth about 2 cents narrow');
  assert.equal(Math.round(cents((3 / 2) ** 12 / 2 ** 7) * 10) / 10, 23.5, 'Pythagorean comma');
  assert.equal(Math.round(cents((3 / 2) ** 4 / 4 / (5 / 4)) * 10) / 10, 21.5, 'syntonic comma');
  assert.equal(Math.round((25.5 / 24.75) ** 2 * 100 - 100), 6, 'longer scale: about 6% more tension');
  assert.equal(Math.round((1 - 2 ** (-1 / 12)) * 1000) / 10, 5.6, 'each fret: about 5.6% shorter');
  assert.equal(Math.round(2 ** (1 / 12) * 10000) / 10000, 1.0595);
  assert.equal(Math.round(20 * Math.log10(0.775 * 10 ** (4 / 20) / 10 ** (-10 / 20))), 12, '+4 dBu vs -10 dBV');
  assert.equal(Math.round(20 * Math.log10(2)), 6);
  assert.equal(Math.round(10 * Math.log10(2)), 3);
  assert.equal(Math.round(16 * 20 * Math.log10(2)), 96, '16-bit range');
  assert.equal(Math.round(24 * 20 * Math.log10(2)), 144, '24-bit range');
  assert.equal(Math.round(256 / 48_000 * 10_000) / 10, 5.3, '256-sample buffer at 48 kHz');
  assert.equal(85 + 3 * 3, 94, '94 dB(A) is three halvings: 8 h to 1 h');
});

// ----------------------------------------------- curriculum: the module --

test('a new log gets lesson 1 only, silent-pocket cards; the Extras are added switched off; seeding again adds nothing', async () => {
  const { replica, host } = await setup();
  const active = host.cards().filter((c) => !c.retired);
  assert.deepEqual(active.map((c) => c.id).sort(), LESSONS[0]!.cards.map((c) => cardIdOf(c.id)).sort());
  assert.ok(host.cards().every((c) => c.tags.length === 1 && c.tags[0] === 'pocket-silent'));
  assert.equal(replica.library.items.get(itemIdOf('l01-what-is-sound'))?.fields.lesson, 1);
  assert.deepEqual(extras(host), { total: EXTRAS.length, on: 0 });
  assert.equal(EXTRAS.length, 17);
  assert.ok(!host.cards().some((c) => DECK.some((d) => d.source.book !== 'general' && cardIdOf(d.id) === c.id)), 'the superseded book cards are never added to a new log');
  const n = replica.log.length;
  assert.equal(await seedTheory(host, NY), 0);
  assert.equal(replica.log.length, n, 'idempotent');
  assert.deepEqual(lessonStates(host, NY).slice(0, 3).map((s) => s.status), ['current', 'locked', 'locked']);
});

test('locked means locked: no card of a later lesson is ever served', async () => {
  const { replica } = await setup();
  const ids = served(sessionFor(replica.library, ny('2026-11-02', '13:05')));
  assert.ok(ids.some((id) => id.startsWith('th-l01-')));
  assert.ok(!ids.some((id) => /^th-l(0[2-9]|[12]\d)-/.test(id)));
});

test('graduation: right today is not enough; right again on a later day unlocks the next lesson', async () => {
  const { replica, host } = await setup();
  const lesson1 = LESSONS[0]!.cards;
  // Day 1: learn every card (Good, then Good again at the 10-minute step).
  for (const c of lesson1) await pass(host, c);
  t += 11 * 60_000;
  for (const c of lesson1) await pass(host, c);
  assert.equal(await seedTheory(host, NY), 0, 'not yet');
  assert.equal(currentLesson(host, NY)?.lesson.n, 1);
  assert.equal(currentLesson(host, NY)?.ready, 0, 'stability about 2 days, short of 7');
  // Two days later: right again.
  t = ny('2026-11-04', '13:05');
  for (const c of lesson1.slice(0, -1)) await pass(host, c);
  assert.equal(await seedTheory(host, NY), 0, 'one card still short: still locked');
  await pass(host, lesson1.at(-1)!);
  assert.equal(await seedTheory(host, NY), LESSONS[1]!.cards.length, 'lesson 2 unlocks');
  assert.deepEqual(lessonStates(host, NY).slice(0, 3).map((s) => s.status), ['graduated', 'current', 'locked']);
  assert.equal(replica.library.items.get(itemIdOf('l02-cycle'))?.fields.lesson, 2);
  assert.equal(await seedTheory(host, NY), 0, 'one lesson at a time: lesson 3 waits for lesson 2');
});

test('graduation: a wrong last answer holds the lesson; unlocking is permanent once given', async () => {
  const { host } = await setup();
  const lesson1 = LESSONS[0]!.cards;
  for (const c of lesson1) await pass(host, c);
  t += 11 * 60_000;
  for (const c of lesson1) await pass(host, c);
  t = ny('2026-11-04', '13:05');
  for (const c of lesson1.slice(1)) await pass(host, c);
  const first = lesson1[0]!;
  if (first.type === 'qa') ok(await rateQa(host, cardIdOf(first.id), 'again', 3000));
  else ok(await answerMc(host, cardIdOf(first.id), first.wrong[0], 3000));
  assert.equal(await seedTheory(host, NY), 0, 'the last answer was wrong');
  assert.equal(currentLesson(host, NY)?.ready, lesson1.length - 1);
  // Relearned the same day (its steps). A lapse costs stability, so it takes
  // two more on-time reviews to hold for a week again.
  t += 2 * 60_000;
  await pass(host, first);
  t += 11 * 60_000;
  await pass(host, first);
  t = ny('2026-11-06', '13:05');
  await pass(host, first);
  assert.equal(await seedTheory(host, NY), 0, 'not yet: rebuilding after the slip');
  t = ny('2026-11-10', '13:05');
  await pass(host, first);
  assert.ok((await seedTheory(host, NY)) > 0, 'graduates once it holds');
  // A later slip on lesson 1 does not lock lesson 2 again.
  t = ny('2026-11-20', '13:05');
  if (first.type === 'qa') ok(await rateQa(host, cardIdOf(first.id), 'again', 3000));
  else ok(await answerMc(host, cardIdOf(first.id), first.wrong[0], 3000));
  await seedTheory(host, NY);
  assert.equal(lessonStates(host, NY)[1]!.status, 'current');
  assert.ok(host.cards().some((c) => c.id === cardIdOf('l02-cycle') && !c.retired));
});

test(`the rule is FSRS stability of ${GRADUATE_STABILITY_DAYS} days: a Q/A card rated Easy the first time counts at once`, async () => {
  const { host } = await setup();
  const qa = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  await pass(host, qa, 'easy');
  assert.equal(currentLesson(host, NY)?.ready, 1);
  assert.equal(currentLesson(host, NY)?.started, 1);
});

test('migration from the topic deck: the book cards are retired and the Extras switched off, history kept; lesson 1 added', async () => {
  const { replica, host } = await setup(false);
  // The superseded deck as it was seeded on 2026-10-31, with some practice.
  for (const c of DECK) {
    await host.addItem(itemIdOf(c.id), { topic: c.topic });
    await host.addCard(cardIdOf(c.id), itemIdOf(c.id), c.type);
  }
  ok(await rateQa(host, cardIdOf('db-twice'), 'good', 1000));
  ok(await rateQa(host, cardIdOf('th-caged'), 'good', 1000));
  const added = await seedTheory(host, NY);
  assert.equal(added, LESSONS[0]!.cards.length);
  const active = host.cards().filter((c) => !c.retired).map((c) => c.id);
  assert.deepEqual(active.sort(), LESSONS[0]!.cards.map((c) => cardIdOf(c.id)).sort(), 'only lesson 1 is on');
  assert.equal(host.cards().length, DECK.length + LESSONS[0]!.cards.length, 'nothing deleted');
  assert.equal(replica.library.reviews.get(cardIdOf('db-twice'))?.length, 1, 'history kept');
  assert.deepEqual(extras(host), { total: 17, on: 0 });
  // Switched back on, the Extras stay on across launches.
  ok(await setExtras(host, true));
  assert.equal(await seedTheory(host, NY), 0);
  assert.deepEqual(extras(host), { total: 17, on: 17 });
  assert.equal(host.cards().filter((c) => !c.retired && DECK.some((d) => d.source.book !== 'general' && cardIdOf(d.id) === c.id)).length, 0, 'the book cards stay retired');
});

test('Extras: on and off, with their history; no writes when nothing changes', async () => {
  const { replica, host } = await setup();
  ok(await setExtras(host, true));
  ok(await rateQa(host, cardIdOf('th-caged'), 'good', 1000));
  assert.deepEqual(extras(host).on, 17);
  ok(await setExtras(host, false));
  assert.equal((await rateQa(host, cardIdOf('th-caged'), 'good', 1)).ok, false, 'off means off');
  const n = replica.log.length;
  ok(await setExtras(host, false));
  assert.equal(replica.log.length, n);
  ok(await setExtras(host, true));
  assert.equal(replica.library.reviews.get(cardIdOf('th-caged'))?.length, 1);
  assert.equal((await setExtras(host, 'yes' as unknown as boolean)).ok, false);
});

test('Q/A: rated Again to Easy; multiple choice: right is Good, wrong is Again; reviews record the lesson', async () => {
  const { replica, host } = await setup();
  const qa = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  const mc = LESSONS[0]!.cards.find((c): c is LessonMc => c.type === 'mc')!;
  ok(await rateQa(host, cardIdOf(qa.id), 'hard', 9000));
  assert.deepEqual(replica.library.reviews.get(cardIdOf(qa.id))!.map((r) => [r.rating, r.durationMs, r.details?.lesson]), [['hard', 9000, 1]]);
  assert.equal(ok(await answerMc(host, cardIdOf(mc.id), mc.answer, 4000)).correct, true);
  assert.equal(ok(await answerMc(host, cardIdOf(mc.id), mc.wrong[0], 4000)).correct, false);
  assert.deepEqual(replica.library.reviews.get(cardIdOf(mc.id))!.map((r) => [r.rating, r.details?.correct, r.details?.lesson]), [['good', true, 1], ['again', false, 1]]);
  assert.equal(contentOf(host, cardIdOf(qa.id)), qa);
});

test('wrong kinds of answers are refused, write nothing, and never trip the contract', async () => {
  const { replica, host } = await setup();
  const qa = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  const mc = LESSONS[0]!.cards.find((c): c is LessonMc => c.type === 'mc')!;
  const n = replica.log.length;
  assert.equal((await rateQa(host, cardIdOf(mc.id), 'good', 1)).ok, false, 'mc card rated like Q/A');
  assert.equal((await answerMc(host, cardIdOf(qa.id), 'x', 1)).ok, false, 'Q/A card answered like mc');
  assert.equal((await answerMc(host, cardIdOf(mc.id), 'Not an option', 1)).ok, false);
  assert.equal((await rateQa(host, cardIdOf('nope'), 'good', 1)).ok, false);
  assert.equal((await rateQa(host, cardIdOf('l02-cycle'), 'good', 1)).ok, false, 'a locked lesson\'s card is not in the log');
  assert.equal((await rateQa(host, cardIdOf(qa.id), 'perfect' as 'good', 1)).ok, false);
  assert.equal(replica.log.length, n);
  assert.ok(host.enabled);
});

test('options are shuffled per showing so the position is never the cue', () => {
  const c = LESSON_CARDS.find((x): x is LessonMc => x.type === 'mc')!;
  assert.deepEqual(optionsFor(c, 7), optionsFor(c, 7));
  assert.deepEqual([...optionsFor(c, 7)].sort(), [c.answer, ...c.wrong].sort());
  const places = new Set(Array.from({ length: 40 }, (_, i) => optionsFor(c, i + 1).indexOf(c.answer)));
  assert.equal(places.size, 4, 'the answer shows up in every position');
});

test('usable during work hours: served in the silent burst and every pocket window, never in the morning guitar session', async () => {
  const { replica } = await setup();
  for (const hhmm of ['13:05', '09:50', '16:35']) assert.ok(served(sessionFor(replica.library, ny('2026-11-02', hhmm))).some((id) => id.startsWith('th-')), hhmm);
  assert.ok(!served(sessionFor(replica.library, ny('2026-11-03', '04:05'))).some((id) => id.startsWith('th-')));
});

test('isolation: other modules cannot answer theory cards; a theory crash leaves them running', async () => {
  const { replica, host } = await setup();
  const songs = createHost(replica, SONGS, { now: clock });
  const qa = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  assert.equal(contentOf(songs, cardIdOf(qa.id)), undefined);
  assert.equal((await rateQa(songs, cardIdOf(qa.id), 'good', 1)).ok, false);
  const crash = await runModule(host, () => host.reportRep('song-x-c', 'good', 1));
  assert.equal(crash.ok, false);
  assert.ok(!host.enabled && songs.enabled);
});

test('dueToday counts due cards per module, whatever the window (the Cards badge)', async () => {
  const { replica, host } = await setup();
  assert.equal(dueToday(replica.library, t).get('theory') ?? 0, 0, 'new cards are not due');
  const [a, b, c] = LESSONS[0]!.cards.filter((x) => x.type === 'qa');
  const mc = LESSONS[0]!.cards.find((x): x is LessonMc => x.type === 'mc')!;
  ok(await answerMc(host, cardIdOf(mc.id), mc.wrong[0], 1000));
  ok(await rateQa(host, cardIdOf(a!.id), 'good', 1000));
  ok(await rateQa(host, cardIdOf(b!.id), 'easy', 1000));
  void c;
  // Two minutes later the missed card's 1-minute step is due; the Good one's 10-minute step is not; Easy is days away.
  assert.equal(dueToday(replica.library, t + 2 * 60_000).get('theory'), 1);
  // Its review day: the next morning (guitar session, no theory cards served), still counted.
  const morning = ny('2026-11-03', '04:05');
  assert.ok((dueToday(replica.library, morning).get('theory') ?? 0) >= 2);
  assert.ok(!served(sessionFor(replica.library, morning)).some((id) => id.startsWith('th-')));
});

// ------------------------------------- superseded topic deck (kept as data) --

test('superseded deck: 120 cards across ten topics, ids unchanged (their history stays in the log)', () => {
  assert.equal(DECK.length, 120);
  for (const { id } of TOPICS) assert.ok(DECK.filter((c) => c.topic === id).length >= 10, id);
  assert.equal(new Set(DECK.map((c) => c.id)).size, DECK.length, 'unique ids');
  for (const c of DECK) assert.match(cardIdOf(c.id), /^th-[a-z0-9-]{1,40}-c$/);
});

test('superseded deck: citations are still real chapters, or general', () => {
  for (const c of DECK) {
    if (c.source.book === 'general') assert.match(c.source.note, /not from Benade or Winer/, c.id);
    else assert.ok(CHAPTERS[c.source.book][c.source.chapter], `${c.id}: chapter ${c.source.chapter}`);
  }
  assert.equal(Object.keys(CHAPTERS.benade).length, 25);
  assert.equal(Object.keys(CHAPTERS.winer).length, 26);
  const pickup = DECK.find((c) => c.id === 'res-pickup')!;
  assert.equal(citation(pickup.source), `Source: ${BOOK_TITLE.winer}, ch. 17, Microphones and Pickups`);
});

test('superseded deck: original wording, four distinct options', () => {
  for (const c of DECK) {
    for (const s of cardText(c)) {
      assert.ok(!/["“”]/.test(s), `${c.id}: no quoted passages`);
      assert.ok(!/\b(figure|fig\.|table)\s*\d/i.test(s), `${c.id}: no reproduced figures`);
    }
  }
  for (const c of DECK.filter((x): x is McCard => x.type === 'mc')) assert.equal(new Set([c.answer, ...c.wrong]).size, 4, c.id);
});
