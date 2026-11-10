/**
 * The three practice randomizers (Blake, 2026-11-08), every dimension:
 *   ear training: acoustic/electric AND vinyl/digital in one result; Beato is text only
 *   improvisation: acoustic/electric, 1 to 6 chords (6 max), and "Pick a new chord"
 *   metronome: exactly ONE of five workouts, plus a key every time
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BEATO_ALTERNATIVE,
  EAR_GUITARS,
  EAR_SOURCES,
  IMPROV_CHORDS,
  IMPROV_GUITARS,
  IMPROV_INSTRUCTION,
  KEYS,
  METRONOME_WORKOUTS,
  earSuggestion,
  improvSuggestion,
  metronomeSuggestion,
  pick,
  pickInt,
  randomEar,
  randomImprov,
  randomMetronome,
  seededRng,
} from '../src/index.ts';

const DRAWS = 5000;
const draws = <T>(f: (r: () => number) => T, seed = 7): T[] => {
  const rng = seededRng(seed);
  return Array.from({ length: DRAWS }, () => f(rng));
};

test('seeded generators repeat themselves; picks can never leave their list, even on a bad draw', () => {
  const a = seededRng(42);
  const b = seededRng(42);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
  assert.notEqual(seededRng(1)(), seededRng(2)());
  assert.equal(pick(['x', 'y', 'z'], () => 0), 'x');
  assert.equal(pick(['x', 'y', 'z'], () => 0.9999), 'z');
  assert.equal(pick(['x', 'y', 'z'], () => 1), 'z', 'a draw of exactly 1 stays on the list');
  assert.equal(pick(['x', 'y', 'z'], () => Number.NaN), 'x');
  assert.equal(pick(['x', 'y', 'z'], () => -3), 'x');
  assert.throws(() => pick([], () => 0));
  assert.equal(pickInt(1, 6, () => 0), 1);
  assert.equal(pickInt(1, 6, () => 0.99999), 6);
  assert.equal(pickInt(1, 6, () => 1), 6);
  assert.throws(() => pickInt(6, 1, () => 0));
});

// ------------------------------------------------------------ ear training --

test('ear: every result combines BOTH bullets, acoustic/electric AND vinyl/digital, like "Electric + vinyl"', () => {
  const all = draws((r) => randomEar(r));
  for (const s of all) {
    assert.match(s.text, /^(Acoustic|Electric) \+ (vinyl|digital)$/, s.text);
    assert.ok((EAR_GUITARS as readonly string[]).includes(s.guitar) && (EAR_SOURCES as readonly string[]).includes(s.source));
    assert.equal(s.text, `${s.guitar[0]!.toUpperCase()}${s.guitar.slice(1)} + ${s.source}`);
  }
  assert.deepEqual([...new Set(all.map((s) => s.text))].sort(), ['Acoustic + digital', 'Acoustic + vinyl', 'Electric + digital', 'Electric + vinyl'], 'all four combinations come up');
  assert.equal(earSuggestion('electric', 'vinyl').text, 'Electric + vinyl');
});

test('ear: Beato is a separate alternative, instruction text only: never part of the draw, no link', () => {
  const all = draws((r) => randomEar(r));
  for (const s of all) {
    assert.ok(!/beato/i.test(s.text), 'the draw never picks Beato');
    assert.equal(s.alternative, BEATO_ALTERNATIVE);
  }
  assert.match(BEATO_ALTERNATIVE, /Beato/);
  assert.match(BEATO_ALTERNATIVE, /^Or, instead of this: do a Rick Beato ear-training exercise\./);
  assert.ok(!/https?:|www\.|\.com|\.org|youtu/i.test(BEATO_ALTERNATIVE), 'no invented link');
});

test('ear: pressing Randomize again always changes the result', () => {
  const rng = seededRng(3);
  let prev = randomEar(rng);
  for (let i = 0; i < 500; i++) {
    const next = randomEar(rng, prev);
    assert.notEqual(next.text, prev.text);
    prev = next;
  }
});

// ------------------------------------------------------------ improvisation --

test('improv: acoustic/electric, 1 to 6 chords (never 0, never 7) and the words "Pick a new chord", all in one line', () => {
  const all = draws((r) => randomImprov(r));
  assert.deepEqual(IMPROV_CHORDS, { min: 1, max: 6 });
  for (const s of all) {
    assert.ok(Number.isInteger(s.chords) && s.chords >= 1 && s.chords <= 6, `${s.chords} chords`);
    assert.ok((IMPROV_GUITARS as readonly string[]).includes(s.guitar));
    assert.equal(s.instruction, 'Pick a new chord');
    assert.match(s.text, /^(Acoustic|Electric) · ([1-6]) chords? · Pick a new chord$/, s.text);
  }
  assert.deepEqual([...new Set(all.map((s) => s.chords))].sort(), [1, 2, 3, 4, 5, 6], 'every count from 1 to 6 comes up');
  assert.deepEqual([...new Set(all.map((s) => s.guitar))].sort(), ['acoustic', 'electric']);
  assert.equal(new Set(all.map((s) => s.text)).size, 12, '2 guitars x 6 counts');
  assert.equal(improvSuggestion('acoustic', 1).text, 'Acoustic · 1 chord · Pick a new chord', 'one chord, singular');
  assert.equal(IMPROV_INSTRUCTION, 'Pick a new chord');
});

test('improv: the chord count is bounded at 6 whatever the generator does; 0, 7 and fractions are refused', () => {
  for (const r of [0, 0.5, 0.9999999, 1, 2, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const s = randomImprov(() => r);
    assert.ok(s.chords >= 1 && s.chords <= 6, `rng ${r} gave ${s.chords}`);
  }
  assert.equal(randomImprov(() => 0.999999).chords, 6, 'six is the max');
  for (const bad of [0, 7, -1, 1.5, Number.NaN, 10]) assert.throws(() => improvSuggestion('electric', bad), RangeError);
});

test('improv: "Pick a new chord" is text only: the suggestion carries no chord and no button, only words', () => {
  const s = randomImprov(seededRng(1));
  assert.deepEqual(Object.keys(s).sort(), ['chords', 'guitar', 'instruction', 'text']);
  assert.ok(!/\b[A-G][#b♯♭]?(m|maj|min|dim|aug|sus)?[0-9]?\b/.test(s.text.replace(/Acoustic|Electric|chords?|Pick a new chord/g, '')), 'no chord name generated');
});

// --------------------------------------------------------------- metronome --

test('metronome: exactly ONE of the five workouts, plus a key every time', () => {
  const all = draws((r) => randomMetronome(r));
  assert.deepEqual(METRONOME_WORKOUTS.map((w) => w.label), ['Two-finger workout', 'Double-stop workout', 'Rhythm', 'Slide', 'Scales']);
  assert.equal(KEYS.length, 12);
  for (const s of all) {
    const named = METRONOME_WORKOUTS.filter((w) => s.text.includes(w.label));
    assert.equal(named.length, 1, `exactly one workout in "${s.text}"`);
    assert.equal(named[0]!.id, s.workout);
    assert.ok((KEYS as readonly string[]).includes(s.key), 'a key, every time');
    assert.equal(s.text, `${s.label} in ${s.key}`);
  }
  assert.deepEqual([...new Set(all.map((s) => s.workout))].sort(), ['double-stop', 'rhythm', 'scales', 'slide', 'two-finger']);
  assert.deepEqual([...new Set(all.map((s) => s.key))].sort(), [...KEYS].sort(), 'all twelve keys come up');
  assert.equal(new Set(all.map((s) => s.text)).size, 60, 'every workout in every key');
});

test('metronome: the draw reaches the first and last of each list; a bad generator stays on the lists; unknown values are refused', () => {
  assert.equal(randomMetronome(() => 0).text, 'Two-finger workout in C');
  assert.equal(randomMetronome(() => 0.99999).text, 'Scales in B');
  assert.equal(randomMetronome(() => 1).text, 'Scales in B');
  assert.equal(metronomeSuggestion('slide', 'F♯/G♭').text, 'Slide in F♯/G♭');
  assert.throws(() => metronomeSuggestion('tapping' as never, 'C'), RangeError);
  assert.throws(() => metronomeSuggestion('slide', 'H' as never), RangeError);
  const rng = seededRng(9);
  let prev = randomMetronome(rng);
  for (let i = 0; i < 300; i++) {
    const next = randomMetronome(rng, prev);
    assert.notEqual(next.text, prev.text, 'Randomize changes the result');
    prev = next;
  }
});
