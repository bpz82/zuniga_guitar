/** Ear training, pure core: exemplars, grading, rhythm checking, mastery. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_SKILLS,
  checkRhythm,
  CONFUSABLE,
  CONTEXT_AFTER,
  FAMILIES,
  gradeChoice,
  gradeRhythm,
  INTERVAL_SEMIS,
  LADDER,
  levelProgress,
  MAJOR,
  makeTrial,
  MASTERY,
  medianLatency,
  QUALITY_SEMIS,
  rate,
  responseScore,
  RESOLUTION,
  rhythmPattern,
  rngFrom,
  scaffolding,
} from '../src/modules/ear/core.ts';
import type { NoteEvent, Skill, Trial } from '../src/modules/ear/core.ts';
import { cardIdOf } from '../src/modules/ear/practice.ts';

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 1);
const familyOf = (f: string) => ALL_SKILLS.filter((x) => x.family === f).map((x) => x.category);
const trial = (sk: Skill, seed: number, history: boolean[] = []) => makeTrial(sk, { unlocked: familyOf(sk.family), history }, seed);
const pitched = (es: readonly NoteEvent[]) => es.filter((e) => e.voice !== 'click' && e.voice !== 'accent');
const pc = (n: number) => ((n % 12) + 12) % 12;

test('seeded randomness: same seed, same exemplar; different seeds vary', () => {
  assert.deepEqual([rngFrom(5)(), rngFrom(5)()], [rngFrom(5)(), rngFrom(5)()]);
  const sk = ALL_SKILLS.find((x) => x.family === 'degree' && x.category === '6')!;
  assert.deepEqual(trial(sk, 42), trial(sk, 42));
  const tonics = new Set(SEEDS.map((sd) => trial(sk, sd).events[0]!.midi));
  const voices = new Set(SEEDS.map((sd) => trial(sk, sd).events.at(-1)!.voice));
  assert.ok(tonics.size >= 6, 'many keys');
  assert.ok(voices.size >= 2, 'more than one timbre');
});

test('the ladder: six levels, every family, unique skills, ids the log accepts', () => {
  assert.deepEqual(LADDER.map((l) => l.level), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...new Set(ALL_SKILLS.map((x) => x.family))].sort(), [...FAMILIES].sort());
  const ids = ALL_SKILLS.map(cardIdOf);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[A-Za-z0-9-]{1,64}$/);
  // Tonic-relative hearing comes before isolated intervals (research: the spine).
  const levelOf = (f: string) => Math.min(...LADDER.filter((l) => l.skills.some((x) => x.family === f)).map((l) => l.level));
  assert.ok(levelOf('degree') < levelOf('interval'));
  assert.ok(levelOf('rhythm') === 1, 'rhythm runs in parallel from day one');
  for (const f of FAMILIES) for (const c of familyOf(f)) if (f !== 'rhythm') assert.ok(familyOf(f).includes(CONFUSABLE[f][c]!), `${f}/${c} partner`);
});

test('every skill makes valid exemplars: answer among the choices, sane sounds', () => {
  for (const sk of ALL_SKILLS) {
    for (const sd of SEEDS.slice(0, 10)) {
      const t = trial(sk, sd);
      assert.ok(t.events.length > 0);
      if (sk.family !== 'rhythm') assert.ok(t.choices.some((c) => c.id === t.answer), `${sk.family}/${sk.category}`);
      for (const e of [...t.events, ...t.feedback]) {
        assert.ok(e.at >= 0 && e.dur > 0 && e.gain > 0 && e.gain <= 1, JSON.stringify(e));
        if (e.voice !== 'click' && e.voice !== 'accent') assert.ok(e.midi >= 24 && e.midi <= 100, `${sk.category} midi ${e.midi}`);
      }
    }
  }
});

test('choices are only the unlocked categories of the family (interleaved, not blocked)', () => {
  const sk = ALL_SKILLS.find((x) => x.family === 'interval' && x.category === 'm3')!;
  const t = makeTrial(sk, { unlocked: ['m2', 'M2', 'm3', 'M3'], history: [] }, 1);
  assert.deepEqual(t.choices.map((c) => c.id), ['m2', 'M2', 'm3', 'M3']);
});

test('direction: the second note really goes up, down or stays', () => {
  for (const sd of SEEDS) {
    for (const [cat, cmp] of [['up', 1], ['down', -1], ['same', 0]] as const) {
      const [a, b] = trial({ family: 'direction', category: cat, label: '' }, sd).events;
      assert.equal(Math.sign(b!.midi - a!.midi), cmp);
    }
  }
});

test('scale degree: the target is that degree of the key the cadence sets, then resolves to the tonic', () => {
  for (const d of [1, 2, 3, 4, 5, 6, 7]) {
    for (const sd of SEEDS.slice(0, 15)) {
      const t = trial({ family: 'degree', category: String(d), label: '' }, sd);
      const tonic = t.events[3]!.midi + 12; // the first bass note is the tonic an octave down
      assert.equal(pc(t.events.at(-1)!.midi - tonic), MAJOR[d - 1]);
      assert.equal(pc(t.feedback.at(-1)!.midi - tonic), 0, 'resolution ends on do');
      assert.equal(t.feedback.length, RESOLUTION[d - 1]!.length);
    }
  }
});

test('interval: the two notes are that many semitones apart, both directions occur', () => {
  for (const [cat, semis] of Object.entries(INTERVAL_SEMIS)) {
    const dirs = new Set<number>();
    for (const sd of SEEDS) {
      const ev = trial({ family: 'interval', category: cat, label: '' }, sd).events;
      const [a, b] = ev.slice(-2);
      assert.equal(Math.abs(b!.midi - a!.midi), semis);
      dirs.add(Math.sign(b!.midi - a!.midi));
    }
    assert.equal(dirs.size, 2, `${cat} up and down`);
  }
});

test('interval: heard in key context once established, never before', () => {
  const sk = { family: 'interval', category: 'P4', label: '' } as const;
  assert.ok(SEEDS.every((sd) => trial(sk, sd).events.length === 2), 'naked at first');
  const later = SEEDS.map((sd) => trial(sk, sd, Array(CONTEXT_AFTER).fill(true)));
  const withKey = later.filter((t) => t.events.length > 2).length;
  assert.ok(withKey > later.length / 3 && withKey < later.length, `context on most trials, not all (${withKey}/${later.length})`);
});

test('chord quality and function: the right triads and bass', () => {
  for (const [cat, shape] of Object.entries(QUALITY_SEMIS)) {
    const notes = trial({ family: 'quality', category: cat, label: '' }, 3).events.map((e) => e.midi).sort((a, b) => a - b);
    assert.deepEqual(notes.map((m) => m - notes[0]!), [...shape]);
  }
  const expected: Record<string, number[]> = { I: [0, 4, 7], ii: [0, 3, 7], iii: [0, 3, 7], IV: [0, 4, 7], V: [0, 4, 7], vi: [0, 3, 7], viio: [0, 3, 6] };
  for (const [cat, shape] of Object.entries(expected)) {
    const ev = trial({ family: 'function', category: cat, label: '' }, 11).events;
    const second = ev.filter((e) => Math.abs(e.at - 0.9) < 1e-9).map((e) => e.midi).sort((a, b) => a - b);
    const triad = second.slice(1); // lowest is the bass
    assert.deepEqual(triad.map((m) => m - triad[0]!), shape, cat);
    assert.equal(pc(second[0]! - triad[0]!), 0, `${cat} root in the bass`);
  }
});

test('meter: accents and subdivisions match duple, triple and compound', () => {
  for (const [cat, perBar] of [['duple', 4], ['triple', 6], ['compound', 6]] as const) {
    const ev = trial({ family: 'meter', category: cat, label: '' }, 9).events.filter((e) => e.voice === 'click' || e.voice === 'accent');
    assert.equal(ev.filter((e) => e.voice === 'accent').length, 4, 'one accent per bar, four bars');
    assert.equal(ev.length / 4, perBar);
  }
  // Duple vs compound differ in how the beat is split, not the beat count.
  const strong = (cat: string) => trial({ family: 'meter', category: cat, label: '' }, 9).events.filter((e) => e.gain >= 0.7 && (e.voice === 'click' || e.voice === 'accent')).length;
  assert.equal(strong('duple'), strong('compound'));
});

test('rhythm patterns: level 1 is quarters and eighths, level 2 adds rests and sixteenths', () => {
  for (const sd of SEEDS) {
    const p1 = rhythmPattern(rngFrom(sd), 1);
    assert.equal(p1[0], 0);
    assert.ok(p1.every((o) => o >= 0 && o < 4 && (o * 2) % 1 === 0));
    assert.ok(p1.some((o) => !Number.isInteger(o)), 'never four plain quarters');
    const p2 = rhythmPattern(rngFrom(sd), 2);
    const beats = new Set(p2.map(Math.floor));
    assert.ok(beats.size < 4 || p2.some((o) => (o * 2) % 1 !== 0), 'a rest or a sixteenth');
  }
});

test('scaffold mode after two wrong answers in a row: two choices (answer and its confusable), simpler stimulus', () => {
  assert.equal(scaffolding([false]), false);
  assert.equal(scaffolding([true, false, false]), true);
  assert.equal(scaffolding([false, false, true]), false);
  const t = trial({ family: 'interval', category: 'm3', label: '' }, 5, [false, false]);
  assert.equal(t.scaffold, true);
  assert.deepEqual(t.choices.map((c) => c.id).sort(), ['M3', 'm3']);
  const d = trial({ family: 'degree', category: '6', label: '' }, 5, [true, false, false]);
  assert.deepEqual(d.choices.map((c) => c.id), ['5', '6']);
});

test('rating mirrors the research cold-start rules', () => {
  assert.equal(rate(false, true, true, true), 'again');
  assert.equal(rate(true, false, true, true), 'hard', 'right after a replay');
  assert.equal(rate(true, true, false, true), 'good', 'right but slow');
  assert.equal(rate(true, true, true, false), 'good', 'fast but could be a lucky guess');
  assert.equal(rate(true, true, true, true), 'easy');
});

test('gradeChoice: details for the log, score stays 0 to 1', () => {
  const t = trial({ family: 'quality', category: 'minor', label: '' }, 1);
  const g = gradeChoice(t, { choice: 'minor', latencyMs: 900, replays: 0 }, { medianLatencyMs: 1200, previousCorrect: true });
  assert.equal(g.rating, 'easy');
  assert.deepEqual(Object.keys(g.details).sort(), ['answered', 'category', 'correct', 'family', 'latencyMs', 'replays', 'scaffold', 'score']);
  assert.equal(g.details.score, 1);
  const wrong = gradeChoice(t, { choice: 'major', latencyMs: 4000, replays: 2 }, { medianLatencyMs: 1200, previousCorrect: true });
  assert.deepEqual([wrong.correct, wrong.rating], [false, 'again']);
  assert.ok((wrong.details.score as number) >= 0 && (wrong.details.score as number) < 0.3);
  assert.equal(responseScore(true, 2400, 1200, 0, false), Math.round(((0.6 + 0.075 + 0.1 + 0.05) / 0.9) * 1000) / 1000);
  const scaff = gradeChoice({ ...t, scaffold: true }, { choice: 'minor', latencyMs: 500, replays: 0 }, { medianLatencyMs: 1200, previousCorrect: true });
  assert.equal(scaff.rating, 'hard', 'right only with scaffolding');
});

const task = { bpm: 80, onsets: [0, 1, 1.5, 2, 3], answerAt: 0, beats: 4 };
const beat = 60 / 80;
const at = (beats: number[], lagMs = 0) => beats.map((b) => b * beat + lagMs / 1000);

test('rhythm check: exact taps pass; a steady touch lag is removed', () => {
  assert.deepEqual(checkRhythm(task, at(task.onsets)), { correct: true, matched: 5, missed: 0, extra: 0, timingMs: 0, lagMs: 0 });
  const late = checkRhythm(task, at(task.onsets, 70));
  assert.equal(late.correct, true);
  assert.equal(late.lagMs, 70);
});

test('rhythm check: missing, extra, misplaced or hugely late taps fail', () => {
  assert.equal(checkRhythm(task, at([0, 1, 2, 3])).correct, false, 'missed the "and" of 2');
  assert.equal(checkRhythm(task, at([0, 1, 1.5, 2, 2.5, 3])).correct, false, 'an extra tap');
  assert.equal(checkRhythm(task, at([0, 1, 1.75, 2, 3])).correct, false, 'a sixteenth off');
  assert.equal(checkRhythm(task, at(task.onsets, 0.4 * beat * 1000)).correct, false, 'nearly half a beat late is a different rhythm');
  assert.equal(checkRhythm(task, []).correct, false);
});

test('gradeRhythm: logs the timing; tight and repeated-right is easy', () => {
  const t = trial({ family: 'rhythm', category: 'r1', label: '' }, 2);
  const taps = at(t.rhythm!.onsets, 20);
  const g = gradeRhythm(t, taps, 0, { previousCorrect: true });
  assert.deepEqual([g.correct, g.rating, g.details.lagMs, g.details.timingMs], [true, 'easy', 20, 0]);
  assert.equal(gradeRhythm(t, taps, 1, { previousCorrect: true }).rating, 'hard');
  assert.equal(gradeRhythm(t, [], 0, { previousCorrect: true }).rating, 'again');
  assert.equal(t.rhythm!.answerAt, 12 * beat, 'the learner taps in the fourth bar');
});

const DAY = 24 * 60 * 60 * 1000;
const answers = (n: number, rightEvery: number, start: number, gap = 60_000) =>
  Array.from({ length: n }, (_, i) => ({ at: start + i * gap, correct: (i + 1) % rightEvery !== 0 }));

test('mastery needs accuracy, every skill solid, and three separate sessions', () => {
  // 3 skills x 9 answers, all right, over three days.
  const solid = [0, 1, 2].map((k) => [0, 1, 2].flatMap((day) => answers(3, 999, day * DAY + k * 1000)));
  assert.equal(levelProgress(solid).mastered, true);
  const oneDay = [0, 1, 2].map((k) => answers(9, 999, k * 1000));
  assert.equal(levelProgress(oneDay).sessions, 1);
  assert.equal(levelProgress(oneDay).mastered, false, 'one long session is not retention');
  const weakSkill = solid.map((xs, k) => (k === 2 ? xs.map((a, i) => ({ ...a, correct: i < 6 })) : xs));
  assert.equal(levelProgress(weakSkill).mastered, false, 'one category much weaker');
  const few = [answers(3, 999, 0), answers(3, 999, DAY), answers(2, 999, 2 * DAY)];
  assert.equal(levelProgress(few).weakest, null);
  assert.equal(levelProgress(few).mastered, false);
  assert.equal(MASTERY.accuracy, 0.85);
});

test('rolling median latency needs three answers', () => {
  assert.equal(medianLatency([1000, 2000]), null);
  assert.equal(medianLatency([1000, 3000, 2000]), 2000);
  assert.equal(medianLatency([1000, 2000, 3000, 4000]), 2500);
});

test('a trial for an unknown skill is refused', () => {
  assert.throws(() => makeTrial({ family: 'degree', category: '9' }, { unlocked: [], history: [] }, 1), RangeError);
  const t: Trial = trial({ family: 'direction', category: 'up', label: '' }, 1);
  assert.throws(() => gradeRhythm(t, [], 0, { previousCorrect: false }), RangeError);
});
