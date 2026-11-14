/**
 * Theory and physics: the curriculum (2026-11-02; rebuilt 2026-11-13 into
 * nine chapters with the electric guitar on stage at chapter 3 and music
 * theory at chapter 4): content rules, card id stability, the chapter
 * horizon (2026-11-08: guided exploration) and the graduation rule, the
 * migrations, and the module through contract v1. The superseded deck's own
 * content rules are kept at the end (its cards stay in the log).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, dueToday, memoryStore, Replica, runModule, sessionFor, SONGS } from '../src/index.ts';
import type { ModuleHost, ReviewSegment, Session } from '../src/index.ts';
import { BOOK_TITLE, CHAPTERS, citation, DECK, TOPICS } from '../src/modules/theory/deck.ts';
import type { McCard } from '../src/modules/theory/deck.ts';
import { CURRICULUM_CHAPTERS, EXTRA_CARDS, LESSON_CARDS, lessonCardById, LESSONS, RETIRED_COURSE_IDS } from '../src/modules/theory/curriculum.ts';
import type { LessonCard, LessonMc } from '../src/modules/theory/curriculum.ts';
import {
  answerMc,
  CHAPTER_HORIZON,
  cardIdOf,
  chapterFor,
  contentOf,
  currentLesson,
  EXTRA_ANCHOR,
  EXTRAS,
  extras,
  GRADUATE_STABILITY_DAYS,
  horizon,
  itemIdOf,
  lessonStates,
  needsReading,
  newCardFilter,
  optionsFor,
  rateQa,
  seedTheory,
  setExtras,
  THEORY,
} from '../src/modules/theory/practice.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';
import { COURSE_IDS_2026_11_12 } from '../fixtures/course-ids-2026-11-12.ts';

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
const cardText = (c: LessonCard | (typeof DECK)[number]) => [c.question, c.answer, ...(c.type === 'mc' ? [...c.wrong, c.why] : [])];
const lessonText = (n: number) => {
  const l = LESSONS[n - 1]!;
  return [l.title, ...l.reading, ...[...l.cards, ...l.extras].flatMap(cardText)];
};
const byTitle = (title: string) => {
  const l = LESSONS.find((x) => x.title === title);
  assert.ok(l, `no lesson "${title}"`);
  return l;
};
/** Answers a curriculum card right: Q/A with `rating`, multiple choice with its answer (Good). */
async function pass(host: ModuleHost, c: LessonCard, rating: 'hard' | 'good' | 'easy' = 'good') {
  if (c.type === 'qa') ok(await rateQa(host, cardIdOf(c.id), rating, 3000));
  else ok(await answerMc(host, cardIdOf(c.id), c.answer, 3000));
}
/** The superseded deck's ids that are back in the course or the Extras (2026-11-13), history and all. */
const BACK_FROM_DECK = [
  'th-c-to-g', 'res-cable', 'sig-pre-post', 'sig-ground-loop',
  'th-relative', 'th-major', 'th-minor', 'th-dim', 'th-inversion', 'th-dom7', 'th-maj7', 'th-dorian', 'th-mixolydian', 'th-lydian', 'th-caged', 'th-e-shape-3', 'th-a-shape-5', 'th-caged-next',
  'temp-syntonic', 'rev-early', 'res-out-of-phase', 'res-piezo', 'sig-snr', 'sig-gain-staging', 'rng-bass', 'rng-top', 'eq-notch', 'rng-presence',
  'tape-one-side', 'tape-xlii-type', 'tape-type2-settings', 'tape-type2-vs-1', 'tape-dbx-cal', 'db-exposure', 'harm-7th', 'db-dbu',
];

// ------------------------------------------------- curriculum: content --

test('one course: 44 lessons in 9 chapters, in order, every lesson a reading and 6 to 9 cards of both types', () => {
  assert.equal(LESSONS.length, 44);
  LESSONS.forEach((l, i) => assert.equal(l.n, i + 1));
  assert.deepEqual(Object.keys(CURRICULUM_CHAPTERS).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  for (let i = 1; i < LESSONS.length; i++) assert.ok(LESSONS[i]!.chapter >= LESSONS[i - 1]!.chapter, 'chapters run in order');
  for (const ch of Object.keys(CURRICULUM_CHAPTERS).map(Number)) assert.ok(LESSONS.some((l) => l.chapter === ch), `chapter ${ch} has lessons`);
  for (const l of LESSONS) {
    assert.ok(l.reading.length >= 3, `lesson ${l.n} has a real reading`);
    assert.ok(l.cards.length >= 6 && l.cards.length <= 9, `lesson ${l.n}: ${l.cards.length} cards`);
    assert.ok(l.cards.some((c) => c.type === 'qa') && l.cards.some((c) => c.type === 'mc'), `lesson ${l.n}: both card types`);
    for (const c of [...l.cards, ...l.extras]) assert.equal(c.lesson, l.n, `${c.id} knows its lesson`);
  }
  assert.equal(LESSON_CARDS.length, 343);
  assert.equal(EXTRA_CARDS.length, 4);
});

test('chapter order (Blake, 2026-11-13): the electric guitar on stage is chapter 3, music theory chapter 4; the course does not end on cassette', () => {
  const chapterOf = (n: number) => CURRICULUM_CHAPTERS[n];
  assert.equal(chapterOf(3), 'The electric guitar on stage');
  assert.equal(chapterOf(4), 'Music theory for guitarists');
  assert.deepEqual(LESSONS.filter((l) => l.chapter === 3).map((l) => l.title), [
    'The electric signal chain and the amp', 'Distortion: clipping as tone', 'Pedals, cables and their order', 'Delay, tempo and modulation',
    'Feedback, monitors and the stage', 'Loud stages and your ears', 'Hum, DI and miking the amp',
  ]);
  assert.equal(LESSONS.at(-1)!.title, 'Recording guitar at home');
  assert.ok(LESSONS.some((l) => /cassette/i.test(l.title)), 'the cassette lesson stays');
  assert.ok(!/cassette|tape/i.test(LESSONS.at(-1)!.title));
  // The horizon paces: no chapter is more than seven lessons, so three chapters ahead is never the whole course.
  for (const ch of Object.keys(CURRICULUM_CHAPTERS).map(Number)) assert.ok(LESSONS.filter((l) => l.chapter === ch).length <= 7, `chapter ${ch}`);
  assert.ok(LESSONS.filter((l) => l.chapter <= 1 + CHAPTER_HORIZON).length <= LESSONS.length / 2, 'a new log opens at most half the course');
});

test('the electric chapter covers the gigging guitarist\'s topics, each in a reading', () => {
  const text = LESSONS.filter((l) => l.chapter === 3).flatMap((l) => l.reading).join(' ');
  for (const topic of [/clipping/i, /overdrive/i, /preamp/i, /power amp/i, /4, 8 or 16 Ω/, /100 W/i, /pedal/i, /true-bypass/i, /buffer/i, /capacitance/i, /60,000 ÷ BPM/, /dotted eighth/i, /tremolo/i, /phaser/i, /spring reverb/i, /feedback/i, /notch/i, /wedge/i, /in-ear/i, /pre-fader/i, /stage volume/i, /earplugs/i, /dB\(A\)/i, /ground loop/i, /DI/i, /SM57/i, /3:1 rule/i, /polarity/]) {
    assert.match(text, topic);
  }
});

test('the music theory chapter covers what an intermediate player expects, each in a reading', () => {
  const text = LESSONS.filter((l) => l.chapter === 4).flatMap((l) => l.reading).join(' ');
  for (const topic of [/major scale/i, /key signature/i, /relative minor/i, /diatonic/i, /Nashville/i, /12-bar/i, /circle of fifths/i, /capo/i, /Dorian/i, /Mixolydian/i, /Lydian/i, /pentatonic/i, /blues scale/i, /maj7/i, /sus2/i, /add9/i, /CAGED/]) {
    assert.match(text, topic);
  }
});

test('card ids are stable: every id from before the rebuild is still in the course, an Extra, or retired; ids are unique', () => {
  const all = [...LESSON_CARDS, ...EXTRA_CARDS];
  const ids = new Set(all.map((c) => c.id));
  assert.equal(ids.size, all.length, 'unique ids');
  assert.equal(COURSE_IDS_2026_11_12.length, 170);
  for (const id of COURSE_IDS_2026_11_12) assert.ok(ids.has(id) || RETIRED_COURSE_IDS.includes(id), `${id} kept`);
  for (const id of RETIRED_COURSE_IDS) assert.ok(!ids.has(id), `retired ${id} is never reused`);
  assert.deepEqual([...RETIRED_COURSE_IDS], ['l19-double-voltage']);
  for (const c of all) {
    assert.ok(/^(l\d{2}|gig\d|mus\d|rec\d)-[a-z0-9-]+$/.test(c.id) || BACK_FROM_DECK.includes(c.id), c.id);
    assert.ok(cardIdOf(c.id).length <= 64, 'fits the log id limit');
    assert.equal(lessonCardById(c.id), c);
  }
  // Superseded-deck ids are reused only for those exact cards, and keep their card type (the log stores it).
  assert.deepEqual(all.filter((c) => DECK.some((d) => d.id === c.id)).map((c) => c.id).sort(), [...BACK_FROM_DECK].sort());
  for (const id of BACK_FROM_DECK) assert.equal(lessonCardById(id)!.type, DECK.find((d) => d.id === id)!.type, id);
});

test('every card, Extras included, has a lesson with a reading, so Read in Chapter always works', () => {
  for (const c of [...LESSON_CARDS, ...EXTRA_CARDS]) {
    const l = LESSONS[c.lesson - 1]!;
    assert.ok(l.cards.includes(c) || l.extras.includes(c), c.id);
    assert.ok(l.reading.join(' ').length > 200, c.id);
  }
});

test('both books are combined, not kept apart; the gig and theory chapters add general sources', () => {
  const books = LESSONS.map((l) => new Set(l.cards.map((c) => c.source.book)));
  assert.ok(LESSON_CARDS.filter((c) => c.source.book === 'benade').length >= 50);
  assert.ok(LESSON_CARDS.filter((c) => c.source.book === 'winer').length >= 50);
  assert.ok(books.filter((b) => b.has('benade') && b.has('winer')).length >= 4, 'lessons that use both');
});

test('every card keeps its citation as data: a real chapter of either book, or general with a note', () => {
  for (const c of [...LESSON_CARDS, ...EXTRA_CARDS]) {
    if (c.source.book === 'general') assert.ok(c.source.note.length > 5, c.id);
    else assert.ok(CHAPTERS[c.source.book][c.source.chapter], `${c.id}: chapter ${c.source.chapter}`);
  }
});

test('the sources are never in what the user reads: no book, author or publisher names in readings or cards', () => {
  for (const l of LESSONS) {
    for (const s of lessonText(l.n)) {
      assert.ok(!/benade|winer|audio expert|fundamentals of musical acoustics|dover|routledge|chapter \d|ch\. \d/i.test(s), `lesson ${l.n}: ${s.slice(0, 60)}`);
    }
  }
});

test('original wording only: no quoted passages, no reproduced figures, short self-contained cards', () => {
  for (const l of LESSONS) {
    for (const s of lessonText(l.n).slice(1)) {
      // Short scare quotes ("presence", "+10") are fine; a quoted passage is not.
      for (const m of s.matchAll(/"([^"]*)"|“([^”]*)”/g)) assert.ok((m[1] ?? m[2])!.length <= 12, `lesson ${l.n}: no quoted passages: ${m[0]}`);
      assert.ok(!/\b(figure|fig\.|table)\s*\d/i.test(s), `lesson ${l.n}: no reproduced figures`);
    }
    for (const c of [...l.cards, ...l.extras]) for (const s of cardText(c)) assert.ok(s.trim().length > 0 && s.length <= 400, `${c.id}: short`);
    for (const p of l.reading) assert.ok(p.length <= 900, `lesson ${l.n}: readable paragraphs`);
  }
});

test('starts from absolute basics, with a guitar in the first lesson', () => {
  assert.deepEqual(LESSONS.slice(0, 3).map((l) => l.title), ['What sound is', 'Frequency, period and pitch', 'Amplitude and loudness']);
  assert.match(LESSONS[0]!.cards[0]!.question, /what is sound/i);
  assert.ok(LESSONS[0]!.reading.some((p) => /guitar string/.test(p)) && LESSONS[0]!.cards.some((c) => /amp/.test(c.question)), 'a guitar hook from the start');
});

test('every term is defined before a card or reading uses it: no term shows up in a lesson before the one that teaches it', () => {
  // term -> the title of the lesson whose reading defines it (a word-boundary match, any case).
  const TERMS: Record<string, string> = {};
  const at = (title: string, ...terms: string[]) => terms.forEach((x) => (TERMS[x] = title));
  at('Frequency, period and pitch', 'frequency', 'hertz', 'kHz', 'period', 'pitch', 'octave', 'treble');
  at('Amplitude and loudness', 'amplitude', 'loudness', 'decay');
  at('Decibels', 'decibel', 'dB', 'power', 'SPL', 'inverse square');
  at('Sine waves and phase', 'sine', 'phase');
  at('Adding sounds: cancellation, polarity and comb filtering', 'polarity', 'comb filter');
  at('Partials, harmonics and timbre', 'partial', 'fundamental', 'harmonic', 'overtone', 'timbre', 'attack');
  at('Intervals and beats', 'interval', 'fifth', 'fourth', 'major third', 'beats');
  at('How we hear pitch: semitones and cents', 'cents', 'semitone');
  at('The electric signal chain and the amp', 'pickup', 'voltage', 'gain', 'preamp', 'impedance', 'equalizer', 'EQ');
  at('Distortion: clipping as tone', 'clipping', 'headroom', 'noise floor', 'noise gate', 'threshold');
  at('Pedals, cables and their order', 'compressor', 'reverb', 'resonance', 'buffer');
  at('Delay, tempo and modulation', 'chorus', 'flanger', 'tremolo');
  at('Feedback, monitors and the stage', 'aux', 'fader', 'monitor');
  at('Loud stages and your ears', 'dB(A)');
  at('Hum, DI and miking the amp', 'direct injection', 'balanced', 'ground loop');
  at('The major scale and keys', 'key signature', 'tonic', 'enharmonic');
  at('Chords from the scale', 'diatonic', 'triad', 'Nashville');
  at('The circle of fifths, inversions and the capo', 'circle of fifths', 'capo');
  at('Pentatonics, the blues scale and modes', 'pentatonic', 'Mixolydian');
  at('CAGED: chord shapes across the neck', 'CAGED', 'barre');
  at('The vibrating string', 'node', 'antinode', 'vibrating length');
  at('Length, tension and frets', 'tension', 'scale length');
  at('Where you pluck, and harmonics you play', 'natural harmonic', 'pinch');
  at('Real strings and intonation', 'inharmonicity', 'intonation', 'compensation');
  at('Tuning systems and temperament', 'comma', 'temperament', 'just intonation');
  at('Resonance and the guitar body', 'natural frequenc', 'damping', 'soundboard');
  at('Hearing: sensitivity and masking', 'masking', 'equal-loudness');
  at('Wavelength', 'wavelength', 'diffraction');
  at('Rooms', 'reverberation', 'RT60', 'room mode', 'absorber', 'diffuser');
  at('Microphones', 'transducer', 'condenser', 'cardioid');
  at('Guitar pickups', 'humbucker', 'piezo');
  at('Signal levels and gain staging', 'gain staging', 'signal-to-noise');
  at('EQ', 'high-pass', 'low-pass', 'shelf', 'Q');
  at('Limiters, gates and compressor pedals', 'limiter');
  at('Reverb and routing in the mix', 'pre-delay', 'insert');
  at('Recording on tape', 'bias', 'tape hiss', 'dbx');
  at('The cassette 4-track', 'azimuth', 'bouncing');
  at('Digital audio', 'sample rate', 'Nyquist', 'aliasing', 'bit depth', 'dBFS', 'latency');
  at('Recording guitar at home', 'reamp');
  // Words that mean something else in plain English (or music) before they become terms.
  const ALLOWED = new Set(['ratio', 'delay', 'action', 'release', 'period', 'bouncing', 'mode']);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const problems: string[] = [];
  for (const [term, title] of Object.entries(TERMS)) {
    const taught = byTitle(title).n;
    // The term as a word, allowing simple endings (harmonics, filtering, frequencies), case-sensitive for short abbreviations.
    const word = new RegExp(`(^|[^A-Za-z])${esc(term)}(s|es|ing|ed|y|ies)?(?![A-Za-z])`, /[A-Z]/.test(term) && term.length <= 4 ? '' : 'i');
    const reading = LESSONS[taught - 1]!.reading.join(' ');
    assert.ok(word.test(reading), `"${term}" is defined in lesson ${taught}'s reading`);
    if (ALLOWED.has(term)) continue;
    for (let n = 1; n < taught; n++) if (lessonText(n).some((s) => word.test(s))) problems.push(`"${term}" used in lesson ${n}, taught in ${taught}`);
  }
  assert.deepEqual(problems, []);
});

test('multiple choice: four distinct options and an explanation', () => {
  for (const c of [...LESSON_CARDS, ...EXTRA_CARDS].filter((x): x is LessonMc => x.type === 'mc')) {
    assert.equal(new Set([c.answer, ...c.wrong]).size, 4, c.id);
    assert.ok(c.why.length > 10, c.id);
  }
});

test('review fixes (2026-11-13): the corrected facts read right', () => {
  const get = (id: string) => lessonCardById(id)!;
  assert.match(get('l05-walls').answer, /mass law/, 'bass passes walls by transmission, not by bending');
  assert.match(get('l05-corners').answer, /bend/, 'corners are diffraction');
  assert.match(get('l20-guitar-high-pass').answer, /60 to 80 Hz/);
  assert.ok(!/80 to 100 Hz/.test(LESSONS.flatMap((l) => l.reading).join(' ')), 'no 80 to 100 Hz high-pass advice');
  assert.ok(!/exactly halfway/.test(LESSONS.flatMap((l) => l.reading).join(' ')), '12th fret at half the scale length, not exactly halfway to the saddle');
  assert.ok(!/beat-free/.test([get('l14-just').answer, ...LESSONS.flatMap((l) => l.reading)].join(' ')));
  assert.equal(get('l12-pick-thumb').answer, 'A stiff pick with a small, sharp tip');
  assert.ok(!/thin, hard pick/.test(JSON.stringify(LESSONS)));
  assert.match(get('res-cable').answer, /lower in frequency/);
  assert.equal(get('l19-pro-home').lesson, byTitle('Signal levels and gain staging').n);
  assert.ok(EXTRA_CARDS.includes(get('l19-pro-home')), 'dBu and dBV arithmetic is an Extra now');
  // Bundled cards are split: each half is its own card.
  for (const [a, b] of [['l01-compression', 'l01-rarefaction'], ['l08-thirds', 'l08-minor-third'], ['l16-masking', 'l16-masking-upward'], ['l23-sample', 'l23-sample-rate'], ['l24-dbx', 'l24-dbx-hiss'], ['th-dom7', 'mus4-g7'], ['l22-insert-aux', 'l22-aux-reverb'], ['l24-bounce', 'l24-bounce-cost'], ['l24-azimuth', 'l24-azimuth-off']] as const) {
    assert.ok(get(a) && get(b), `${a} / ${b}`);
  }
  // The flanger is told apart from its real neighbours, and slapback from near values.
  assert.deepEqual([...(get('l22-flanger') as LessonMc).wrong], ['A chorus', 'A phaser', 'A vibrato']);
  assert.ok((get('l22-slapback') as LessonMc).wrong.every((w) => !/5 seconds|1 ms$/.test(w)));
});

test('multiple choice: the right answer is not given away by being much the longest option', () => {
  const tells: string[] = [];
  for (const c of [...LESSON_CARDS, ...EXTRA_CARDS].filter((x): x is LessonMc => x.type === 'mc')) {
    const longestWrong = Math.max(...c.wrong.map((w) => w.length));
    if (c.answer.length > 2 * longestWrong && c.answer.length > 30) tells.push(c.id);
  }
  assert.deepEqual(tells, []);
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
  assert.equal(Math.round(freq(-41) * 10) / 10, 41.2, 'bass low E');
  assert.equal(Math.round(freq(-5) * 10) / 10, 329.6, 'high E');
  assert.equal(Math.round(freq(-31) * 10) / 10, 73.4, 'drop D');
  assert.equal(Math.round(freq(-34)), 62, '7-string low B');
  assert.equal(Math.round(freq(-5 + 22)), 1175, '22nd fret, high E: D6');
  assert.equal(Math.round(400 - cents(5 / 4)), 14, 'tempered third about 14 cents wide');
  assert.equal(Math.round((cents(3 / 2) - 700) * 10) / 10, 2, 'tempered fifth about 2 cents narrow');
  assert.equal(Math.round(1000 - cents(7 / 4)), 31, '7th harmonic about 31 cents below the tempered minor seventh');
  assert.equal(Math.round(cents((3 / 2) ** 12 / 2 ** 7) * 10) / 10, 23.5, 'Pythagorean comma');
  assert.equal(Math.round(cents((3 / 2) ** 4 / 4 / (5 / 4)) * 10) / 10, 21.5, 'syntonic comma');
  assert.equal(Math.round((25.5 / 24.75) ** 2 * 100 - 100), 6, 'longer scale: about 6% more tension');
  assert.equal(Math.round((1 - (2 ** (-2 / 12)) ** 2) * 100), 21, 'a whole step down: about 21% less tension');
  assert.equal(Math.round((2 ** (1 / 12)) ** 2 * 100 - 100), 12, 'a semitone up: about 12% more tension');
  assert.equal(Math.round((1 - 2 ** (-1 / 12)) * 1000) / 10, 5.6, 'each fret: about 5.6% shorter');
  assert.ok(1 - 2 ** (-4 / 12) > 1 / 5 && 1 - 2 ** (-3 / 12) < 1 / 5, 'the 5th harmonic sits just behind the 4th fret');
  assert.ok(Math.abs(1 - 2 ** (-9 / 12) - 2 / 5) < 0.01, 'and near the 9th');
  assert.equal(Math.round(2 ** (1 / 12) * 10000) / 10000, 1.0595);
  assert.equal(Math.round(20 * Math.log10(0.775 * 10 ** (4 / 20) / 10 ** (-10 / 20))), 12, '+4 dBu vs -10 dBV');
  assert.equal(Math.round(20 * Math.log10(2)), 6);
  assert.equal(Math.round(10 * Math.log10(2)), 3, '100 W against 50 W');
  assert.equal(Math.round(10 * Math.log10(10)), 10, 'ten times the power for twice as loud');
  assert.equal(Math.round(20 * Math.log10(3) * 10) / 10, 9.5, '3:1 rule: the copy about 9 dB down');
  assert.equal((8 * 8) / (8 + 8), 4, 'two 8-ohm cabs in parallel');
  assert.equal(60_000 / 120, 500, 'one beat at 120 BPM');
  assert.equal((60_000 / 120) * 0.75, 375, 'dotted eighth at 120 BPM');
  assert.equal(Math.round(16 * 20 * Math.log10(2)), 96, '16-bit range');
  assert.equal(Math.round(24 * 20 * Math.log10(2)), 144, '24-bit range');
  assert.equal(Math.round(256 / 48_000 * 10_000) / 10, 5.3, '256-sample buffer at 48 kHz');
  assert.equal(85 + 3 * 3, 94, '94 dB(A) is three halvings: 8 h to 1 h');
  assert.equal((8 * 60) / 2 ** ((100 - 85) / 3), 15, '100 dB(A): 15 minutes');
});

// ----------------------------------------------- curriculum: the module --

/** The lessons open for a log with nothing graduated: chapter 1 and the CHAPTER_HORIZON chapters after it. */
const OPEN = LESSONS.filter((l) => l.chapter <= 1 + CHAPTER_HORIZON);
const OPEN_IDS = OPEN.flatMap((l) => l.cards.map((c) => cardIdOf(c.id))).sort();
const BEYOND = LESSONS.filter((l) => l.chapter > 1 + CHAPTER_HORIZON);
/** The first card past the horizon of a new log. */
const FAR = BEYOND[0]!.cards[0]!;
const EXTRA_IDS = EXTRAS.map((c) => cardIdOf(c.id));
/** Takes every card of these lessons through three on-time answers (today, minutes later, then days later), so they graduate. */
async function graduate(host: ModuleHost, lessons: readonly number[], start: string, later: string) {
  t = ny(start, '13:05');
  for (const n of lessons) for (const c of LESSONS[n - 1]!.cards) await pass(host, c);
  t += 11 * 60_000;
  for (const n of lessons) for (const c of LESSONS[n - 1]!.cards) await pass(host, c);
  t = ny(later, '13:05');
  for (const n of lessons) for (const c of LESSONS[n - 1]!.cards) await pass(host, c);
}

test('a new log gets every open lesson (chapter 1 and three chapters ahead), silent-pocket cards; the Extras are added switched off; seeding again adds nothing', async () => {
  const { replica, host } = await setup();
  const active = host.cards().filter((c) => !c.retired);
  assert.deepEqual(active.map((c) => c.id).sort(), OPEN_IDS);
  assert.equal(CHAPTER_HORIZON, 3, 'Blake: two or three chapters ahead; three');
  assert.ok(host.cards().every((c) => c.tags.length === 1 && c.tags[0] === 'pocket-silent'));
  assert.equal(replica.library.items.get(itemIdOf('l01-what-is-sound'))?.fields.lesson, 1);
  assert.equal(replica.library.items.get(itemIdOf('th-caged'))?.fields.lesson, byTitle('CAGED: chord shapes across the neck').n, 'a deck card back in the course is added under its lesson');
  assert.deepEqual(extras(host), { total: EXTRAS.length, on: 0 });
  assert.equal(EXTRAS.length, 4);
  assert.ok(!host.cards().some((c) => !c.retired && DECK.some((d) => cardIdOf(d.id) === c.id) && !OPEN_IDS.includes(c.id)), 'no other superseded card is switched on');
  const n = replica.log.length;
  assert.equal(await seedTheory(host, NY), 0);
  assert.equal(replica.log.length, n, 'idempotent');
  const states = lessonStates(host, NY);
  assert.deepEqual(states.slice(0, 3).map((s) => s.status), ['current', 'open', 'open']);
  assert.deepEqual(states.filter((s) => s.lesson.chapter > 4).map((s) => s.status), Array(BEYOND.length).fill('locked'));
  assert.deepEqual(horizon(host, NY), { current: LESSONS[0], chapter: 1, last: 4 });
});

test('beyond the horizon means locked: chapters 5 to 9 are not in the log or served; chapters 1 to 4 are', async () => {
  const { replica } = await setup();
  const ids = served(sessionFor(replica.library, ny('2026-11-02', '13:05')));
  assert.ok(ids.some((id) => id.startsWith('th-l01-')));
  assert.ok(ids.some((id) => id.startsWith('th-gig')), 'the electric chapter (3) is open from the start');
  assert.ok(ids.some((id) => id.startsWith('th-mus')), 'three chapters ahead of chapter 1 is chapter 4');
  const far = new Set(BEYOND.flatMap((l) => l.cards.map((c) => cardIdOf(c.id))));
  assert.ok(!ids.some((id) => far.has(id)));
});

test('graduation: right today is not enough; right again on a later day graduates the lesson and the next becomes current', async () => {
  const { host } = await setup();
  const lesson1 = LESSONS[0]!.cards;
  for (const c of lesson1) await pass(host, c);
  t += 11 * 60_000;
  for (const c of lesson1) await pass(host, c);
  assert.equal(currentLesson(host, NY)?.lesson.n, 1);
  assert.equal(currentLesson(host, NY)?.ready, 0, 'stability about 2 days, short of 7');
  t = ny('2026-11-04', '13:05');
  for (const c of lesson1.slice(0, -1)) await pass(host, c);
  assert.equal(currentLesson(host, NY)?.lesson.n, 1, 'one card still short');
  await pass(host, lesson1.at(-1)!);
  assert.deepEqual(lessonStates(host, NY).slice(0, 3).map((s) => s.status), ['graduated', 'current', 'open']);
  assert.equal(await seedTheory(host, NY), 0, 'still chapter 1: the horizon has not moved');
});

test('the horizon moves with progress: once chapter 1 graduates, chapter 2 is current and chapter 5 opens', async () => {
  const { replica, host } = await setup();
  const chapter1 = LESSONS.filter((l) => l.chapter === 1).map((l) => l.n);
  await graduate(host, chapter1, '2026-11-02', '2026-11-04');
  const ch2 = LESSONS.find((l) => l.chapter === 2)!;
  assert.equal(currentLesson(host, NY)?.lesson.n, ch2.n);
  assert.deepEqual(horizon(host, NY), { current: ch2, chapter: 2, last: 5 });
  const chapter5 = LESSONS.filter((l) => l.chapter === 5);
  assert.equal(await seedTheory(host, NY), chapter5.flatMap((l) => l.cards).length, 'chapter 5 opens');
  assert.equal(await seedTheory(host, NY), 0);
  assert.ok(host.cards().some((c) => c.id === cardIdOf(FAR.id) && !c.retired));
  assert.equal(replica.library.items.get(itemIdOf(FAR.id))?.fields.lesson, chapter5[0]!.n);
});

test('graduation: a wrong last answer holds the lesson; cards already open are never taken away', async () => {
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
  assert.equal(currentLesson(host, NY)?.lesson.n, 1, 'the last answer was wrong');
  assert.equal(currentLesson(host, NY)?.ready, lesson1.length - 1);
  t += 2 * 60_000;
  await pass(host, first);
  t += 11 * 60_000;
  await pass(host, first);
  t = ny('2026-11-06', '13:05');
  await pass(host, first);
  assert.equal(currentLesson(host, NY)?.lesson.n, 1, 'not yet: rebuilding after the slip');
  t = ny('2026-11-10', '13:05');
  await pass(host, first);
  assert.equal(currentLesson(host, NY)?.lesson.n, 2, 'graduates once it holds');
  t = ny('2026-11-20', '13:05');
  if (first.type === 'qa') ok(await rateQa(host, cardIdOf(first.id), 'again', 3000));
  else ok(await answerMc(host, cardIdOf(first.id), first.wrong[0], 3000));
  await seedTheory(host, NY);
  assert.equal(lessonStates(host, NY)[0]!.status, 'current');
  assert.deepEqual(host.cards().filter((c) => !c.retired).map((c) => c.id).sort(), OPEN_IDS);
});

test('new cards are served only inside the horizon, even for cards already in the log', async () => {
  const { host } = await setup();
  const filter = newCardFilter(host, NY);
  assert.equal(filter(cardIdOf(LESSONS[0]!.cards[0]!.id)), true);
  assert.equal(filter(cardIdOf(OPEN.at(-1)!.cards[0]!.id)), true);
  // A chapter-5 card put in the log by hand (as a device on an older build might have): in the log, but not served as new.
  await host.addItem(itemIdOf(FAR.id), { lesson: FAR.lesson });
  await host.addCard(cardIdOf(FAR.id), itemIdOf(FAR.id), FAR.type);
  assert.equal(newCardFilter(host, NY)(cardIdOf(FAR.id)), false);
  assert.equal(newCardFilter(host, NY)('song-x-c'), true, 'cards outside the course are not limited by the horizon');
});

test(`the rule is FSRS stability of ${GRADUATE_STABILITY_DAYS} days: a Q/A card rated Easy the first time counts at once`, async () => {
  const { host } = await setup();
  const qa = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  await pass(host, qa, 'easy');
  assert.equal(currentLesson(host, NY)?.ready, 1);
  assert.equal(currentLesson(host, NY)?.started, 1);
});

test('migration from the topic deck: the book cards are retired and the Extras switched off, history kept; the open lessons added, deck cards back in them switched on', async () => {
  const { replica, host } = await setup(false);
  // The superseded deck as it was seeded on 2026-10-31, with some practice.
  for (const c of DECK) {
    await host.addItem(itemIdOf(c.id), { topic: c.topic });
    await host.addCard(cardIdOf(c.id), itemIdOf(c.id), c.type);
  }
  ok(await rateQa(host, cardIdOf('db-twice'), 'good', 1000));
  ok(await rateQa(host, cardIdOf('th-caged'), 'good', 1000));
  const fromDeckOpen = OPEN_IDS.filter((id) => DECK.some((d) => cardIdOf(d.id) === id)).length;
  const newExtras = EXTRAS.filter((e) => !DECK.some((d) => d.id === e.id)).length;
  const added = await seedTheory(host, NY);
  assert.equal(added, OPEN_IDS.length - fromDeckOpen + newExtras);
  const active = host.cards().filter((c) => !c.retired).map((c) => c.id);
  assert.deepEqual(active.sort(), OPEN_IDS, 'only the open lessons are on');
  assert.equal(host.cards().length, DECK.length + OPEN_IDS.length - fromDeckOpen + newExtras, 'nothing deleted');
  assert.equal(replica.library.reviews.get(cardIdOf('db-twice'))?.length, 1, 'history kept');
  assert.equal(replica.library.reviews.get(cardIdOf('th-caged'))?.length, 1, 'th-caged is a course card now, with its history');
  assert.deepEqual(extras(host), { total: EXTRAS.length, on: 0 });
  ok(await setExtras(host, true));
  assert.equal(await seedTheory(host, NY), 0);
  assert.deepEqual(extras(host), { total: EXTRAS.length, on: EXTRAS.length }, 'switched on, the Extras stay on across launches');
  const bookOn = host.cards().filter((c) => !c.retired && DECK.some((d) => d.source.book !== 'general' && cardIdOf(d.id) === c.id));
  assert.ok(bookOn.every((c) => OPEN_IDS.includes(c.id) || EXTRA_IDS.includes(c.id)), 'the other book cards stay retired');
});

test('the 2026-11-13 rebuild on a log from before it: retired course cards go off, moved cards keep their history, old Extras come back as course cards, the Extras choice is kept', async () => {
  for (const extrasWereOn of [false, true]) {
    const { replica, host } = await setup(false);
    // A log as the 2026-11-12 app left it: chapters 1 to 4 of the old course, and the 17 old Extras.
    const add = async (id: string, retired = false) => {
      await host.addItem(itemIdOf(id), { lesson: 1 });
      await host.addCard(cardIdOf(id), itemIdOf(id), (lessonCardById(id) ?? DECK.find((d) => d.id === id))?.type ?? 'mc');
      if (retired) await host.retireCard(cardIdOf(id));
    };
    for (const id of COURSE_IDS_2026_11_12.filter((x) => Number(x.slice(1, 3)) <= 17)) await add(id);
    await add('l19-double-voltage');
    await add('l19-pro-home');
    for (const d of DECK.filter((x) => x.source.book === 'general')) await add(d.id, !extrasWereOn);
    for (const d of DECK.filter((x) => x.source.book !== 'general')) await add(d.id, true);
    ok(await rateQa(host, cardIdOf('l05-walls'), 'good', 1000));
    ok(await rateQa(host, cardIdOf('l13-hard-pick'), 'good', 1000));
    await seedTheory(host, NY);
    const card = (id: string) => replica.library.cards.get(cardIdOf(id));
    assert.equal(card('l19-double-voltage')?.retired, true, 'taken out of the course');
    assert.equal(card('l19-pro-home')?.retired, !extrasWereOn, 'moved to the Extras: follows the Extras choice');
    assert.equal(card('db-exposure')?.retired, !extrasWereOn);
    assert.equal(card('harm-7th')?.retired, !extrasWereOn, 'a retired book card that is an Extra now');
    assert.equal(card('th-caged')?.retired, false, 'an old Extra now in chapter 4: on');
    assert.equal(card('tape-xlii-type')?.retired, extrasWereOn ? false : true, 'an old Extra in chapter 9: only on if it already was');
    assert.equal(card('th-dorian')?.retired, false, 'a retired book card back in chapter 4');
    assert.equal(card('rev-early')?.retired, true, 'a retired book card in chapter 6 waits for its lesson');
    assert.equal(card('l05-walls')?.retired, false, 'a card in a moved lesson keeps its id and state');
    assert.equal(replica.library.reviews.get(cardIdOf('l05-walls'))?.length, 1);
    assert.equal(lessonCardById('l05-walls')!.lesson, byTitle('Wavelength').n);
    const n = replica.log.length;
    assert.equal(await seedTheory(host, NY), 0);
    assert.equal(replica.log.length, n, 'settles in one pass');
  }
});

test('Extras: on and off together, with their history; no writes when nothing changes; each has a chapter to read', async () => {
  const { replica, host } = await setup();
  assert.ok(EXTRAS.some((c) => c.id === EXTRA_ANCHOR));
  ok(await setExtras(host, true));
  ok(await rateQa(host, cardIdOf('db-exposure'), 'good', 1000));
  assert.equal(extras(host).on, EXTRAS.length);
  assert.equal(chapterFor(host, cardIdOf('l19-pro-home'))?.chapter, 7, 'an Extra opens its lesson\'s chapter');
  ok(await setExtras(host, false));
  assert.equal((await rateQa(host, cardIdOf('db-exposure'), 'good', 1)).ok, false, 'off means off');
  const n = replica.log.length;
  ok(await setExtras(host, false));
  assert.equal(await seedTheory(host, NY), 0);
  assert.equal(replica.log.length, n);
  ok(await setExtras(host, true));
  assert.equal(replica.library.reviews.get(cardIdOf('db-exposure'))?.length, 1);
  assert.equal((await setExtras(host, 'yes' as unknown as boolean)).ok, false);
  // Extras never hold a lesson back.
  for (const l of LESSONS) for (const e of l.extras) assert.ok(!l.cards.includes(e));
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
  assert.equal((await rateQa(host, cardIdOf(FAR.id), 'good', 1)).ok, false, 'a card beyond the horizon is not in the log');
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
  const [a, b] = LESSONS[0]!.cards.filter((x) => x.type === 'qa');
  const mc = LESSONS[0]!.cards.find((x): x is LessonMc => x.type === 'mc')!;
  ok(await answerMc(host, cardIdOf(mc.id), mc.wrong[0], 1000));
  ok(await rateQa(host, cardIdOf(a!.id), 'good', 1000));
  ok(await rateQa(host, cardIdOf(b!.id), 'easy', 1000));
  // Two minutes later the missed card's 1-minute step is due; the Good one's 10-minute step is not; Easy is days away.
  assert.equal(dueToday(replica.library, t + 2 * 60_000).get('theory'), 1);
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
