/** Ear training through the module contract: seeding, trials, answers, the ladder, isolation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, memoryStore, Replica, runModule, seedTestDeck, sessionFor, SONGS, TEST_DECK } from '../src/index.ts';
import type { ModuleHost } from '../src/index.ts';
import {
  advance,
  answerRhythm,
  answersOf,
  answerTrial,
  cardIdOf,
  currentLevel,
  EAR,
  earCards,
  minutesSince,
  nextEarCard,
  pickEarCard,
  progress,
  seedEar,
  trialFor,
  unlockNext,
} from '../src/modules/ear/practice.ts';
import { LADDER, MASTERY } from '../src/modules/ear/core.ts';
import type { Trial } from '../src/modules/ear/core.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * 60_000;
};
let t = ny('2026-11-02', '09:50');
const clock = () => (t += 1000);

async function setup() {
  t = ny('2026-11-02', '09:50');
  const replica = await Replica.open(memoryStore(), 'phone', { now: clock });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const ear = createHost(replica, EAR, { now: clock });
  await seedEar(ear);
  return { replica, ear };
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const trial = (ear: ModuleHost, cardId: string, seed = 7) => ok(trialFor(ear, cardId, seed));
const UP = cardIdOf({ family: 'direction', category: 'up' });

/** Answers one trial of a card, right or wrong. */
async function play(ear: ModuleHost, cardId: string, right: boolean, seed = 7) {
  const tr = trial(ear, cardId, seed);
  if (tr.rhythm) {
    const beat = 60 / tr.rhythm.bpm;
    return ok(await answerRhythm(ear, cardId, tr, right ? tr.rhythm.onsets.map((o) => o * beat) : [], 0, 20_000));
  }
  const choice = right ? tr.answer : tr.choices.find((c) => c.id !== tr.answer)!.id;
  return ok(await answerTrial(ear, cardId, tr, { choice, latencyMs: 1500, replays: 0 }, 8000));
}

test('seeding adds level 1 once: one item and one card per skill, sound pocket and guitar', async () => {
  const { replica, ear } = await setup();
  assert.equal(currentLevel(ear), 1);
  assert.deepEqual(earCards(ear).map((c) => c.cardId), LADDER[0]!.skills.map(cardIdOf));
  const n = replica.log.length;
  assert.equal(await seedEar(ear), 1);
  assert.equal(replica.log.length, n, 'idempotent');
  assert.deepEqual(replica.library.cards.get(UP)?.tags, ['pocket-sound', 'guitar']);
  assert.deepEqual(replica.library.items.get('ear-direction-up')?.fields, { family: 'direction', category: 'up', label: 'Up', level: 1 });
});

test('ear cards come up in sound bursts and the morning, never in quiet hours', async () => {
  const { replica, ear } = await setup();
  assert.ok(nextEarCard(ear, ny('2026-11-02', '09:50')));
  assert.ok(nextEarCard(ear, ny('2026-11-03', '04:05')));
  assert.equal(nextEarCard(ear, ny('2026-11-02', '13:05')), null, 'during work: silent only');
  assert.ok(sessionFor(replica.library, ny('2026-11-02', '16:35')).segments.some((s) => s.kind === 'review' && s.fresh.includes(UP)));
});

test('a trial offers only unlocked choices; unknown cards and bad seeds are refused', async () => {
  const { ear } = await setup();
  assert.deepEqual(trial(ear, UP).choices.map((c) => c.id), ['up', 'down', 'same']);
  assert.equal(trialFor(ear, 'ear-degree-6-c', 1).ok, false, 'not unlocked yet');
  assert.equal(trialFor(ear, UP, 1.5).ok, false);
});

test('an answer is one review with its details; FSRS gets the rating', async () => {
  const { replica, ear } = await setup();
  const out = await play(ear, UP, true);
  assert.equal(out.grade.rating, 'good');
  const [r] = replica.library.reviews.get(UP)!;
  assert.deepEqual([r!.rating, r!.durationMs, r!.details?.correct, r!.details?.family, r!.details?.answered], ['good', 8000, true, 'direction', 'up']);
  assert.equal((await play(ear, UP, false)).grade.rating, 'again');
  assert.deepEqual(answersOf(ear, UP).map((a) => a.correct), [true, false]);
  assert.ok(ear.enabled);
});

test('bad answers come back as errors, write nothing and never trip the contract', async () => {
  const { replica, ear } = await setup();
  const tr = trial(ear, UP);
  const n = replica.log.length;
  assert.equal((await answerTrial(ear, UP, tr, { choice: 'sideways', latencyMs: 1, replays: 0 }, 1)).ok, false);
  const other: Trial = trial(ear, cardIdOf({ family: 'direction', category: 'down' }));
  assert.equal((await answerTrial(ear, UP, other, { choice: 'down', latencyMs: 1, replays: 0 }, 1)).ok, false, 'trial of another card');
  assert.equal((await answerTrial(ear, 'ear-nope-c', tr, { choice: 'up', latencyMs: 1, replays: 0 }, 1)).ok, false);
  const rhythm = cardIdOf({ family: 'rhythm', category: 'r1' });
  assert.equal((await answerTrial(ear, rhythm, trial(ear, rhythm), { choice: 'r1', latencyMs: 1, replays: 0 }, 1)).ok, false);
  assert.equal((await answerRhythm(ear, rhythm, trial(ear, rhythm), Array(65).fill(0), 0, 1)).ok, false);
  assert.equal(replica.log.length, n);
  assert.ok(ear.enabled);
});

test('silly durations and latencies are clamped, not rejected', async () => {
  const { replica, ear } = await setup();
  const tr = trial(ear, UP);
  ok(await answerTrial(ear, UP, tr, { choice: 'up', latencyMs: Number.NaN, replays: -3 }, 99 * H));
  const r = replica.library.reviews.get(UP)![0]!;
  assert.deepEqual([r.durationMs, r.details?.latencyMs, r.details?.replays], [10 * 60 * 1000, 0, 0]);
});

test('rhythm is answered by tapping; the timing goes in the log', async () => {
  const { replica, ear } = await setup();
  const id = cardIdOf({ family: 'rhythm', category: 'r1' });
  const out = await play(ear, id, true);
  assert.equal(out.grade.correct, true);
  const d = replica.library.reviews.get(id)![0]!.details!;
  assert.deepEqual([d.correct, d.missed, d.extra, d.timingMs], [true, 0, 0, 0]);
  assert.equal((await play(ear, id, false)).grade.rating, 'again');
});

test('two wrong in a row puts the card in scaffold mode; a right answer ends it', async () => {
  const { ear } = await setup();
  await play(ear, UP, false);
  assert.equal(trial(ear, UP).scaffold, false);
  await play(ear, UP, false);
  const s = trial(ear, UP);
  assert.equal(s.scaffold, true);
  assert.equal(s.choices.length, 2);
  await play(ear, UP, true);
  assert.equal(trial(ear, UP).scaffold, false);
});

/** Answers every skill of the current level `per` times right, in one session at time `at`. */
async function session(ear: ModuleHost, at: number, per: number) {
  t = at;
  const level = currentLevel(ear);
  for (const sk of LADDER[level - 1]!.skills) for (let i = 0; i < per; i++) await play(ear, cardIdOf(sk), true, i + 1);
}

test('mastery: three sessions on separate days at 85%+ adds the next level by itself', async () => {
  const { ear } = await setup();
  await session(ear, ny('2026-11-02', '09:50'), 2);
  await session(ear, ny('2026-11-03', '09:50'), 2);
  assert.equal(currentLevel(ear), 1, 'two sessions are not enough');
  assert.equal(progress(ear).sessions, 2);
  await session(ear, ny('2026-11-04', '09:50'), 2);
  assert.equal(currentLevel(ear), 2);
  assert.ok(earCards(ear).some((c) => c.cardId === 'ear-degree-5-c'));
  assert.equal(await advance(ear), null, 'level 2 has no answers yet');
});

test('mastery is not reached by cramming one day or with a weak category', async () => {
  const { ear } = await setup();
  await session(ear, ny('2026-11-02', '09:50'), 8);
  assert.equal(currentLevel(ear), 1, 'one long session');
  const { ear: ear2 } = await setup();
  for (const day of ['2026-11-02', '2026-11-03', '2026-11-04']) {
    t = ny(day, '09:50');
    for (const sk of LADDER[0]!.skills) {
      for (let i = 0; i < 2; i++) await play(ear2, cardIdOf(sk), sk.category !== 'same' || i === 0, i + 1);
    }
  }
  assert.equal(currentLevel(ear2), 1, '"same" at 50% holds the level back');
  assert.ok(progress(ear2).weakest! < MASTERY.perSkillAccuracy);
});

test('unlocking by hand adds the next level; the top of the ladder says so', async () => {
  const { ear } = await setup();
  assert.equal(ok(await unlockNext(ear)), 2);
  for (let l = 3; l <= LADDER.length; l++) assert.equal(ok(await unlockNext(ear)), l);
  assert.equal((await unlockNext(ear)).ok, false);
  assert.equal(progress(ear).next, null);
  assert.equal(earCards(ear).length, LADDER.flatMap((l) => l.skills).length);
});

test('choices grow with the ladder: degrees interleave as more unlock', async () => {
  const { ear } = await setup();
  ok(await unlockNext(ear));
  assert.deepEqual(trial(ear, 'ear-degree-3-c').choices.map((c) => c.id), ['1', '3', '5']);
  ok(await unlockNext(ear));
  assert.deepEqual(trial(ear, 'ear-degree-3-c').choices.map((c) => c.id), ['1', '3', '5', '2', '4', '6', '7']);
});

test('a half-added level is repaired on the next launch', async () => {
  const { replica, ear } = await setup();
  await ear.addItem('ear-degree-1', { family: 'degree', category: '1', label: '1 · do', level: 2 });
  await ear.addCard('ear-degree-1-c', 'ear-degree-1', 'ear');
  assert.equal(currentLevel(ear), 1);
  assert.equal(await seedEar(ear), 2);
  assert.ok(replica.library.cards.has('ear-meter-triple-c'));
});

test('isolation: other modules cannot see or answer ear cards; an ear crash leaves them running', async () => {
  const { replica, ear } = await setup();
  const songs = createHost(replica, SONGS, { now: clock });
  const deck = createHost(replica, TEST_DECK, { now: clock });
  assert.equal(earCards(songs).length, 0);
  assert.equal((await answerTrial(songs, UP, trial(ear, UP), { choice: 'up', latencyMs: 1, replays: 0 }, 1)).ok, false);
  const crash = await runModule(ear, () => ear.reportRep('td-fret-6-0-c', 'good', 1));
  assert.equal(crash.ok, false);
  assert.equal(ear.enabled, false);
  ok(await runModule(deck, () => seedTestDeck(deck)));
  assert.ok(songs.enabled && deck.enabled);
});

test('minutes of ear training today (the research suggests about 18)', async () => {
  const { ear } = await setup();
  const since = ny('2026-11-02', '03:00');
  await play(ear, UP, true);
  await play(ear, UP, true);
  assert.equal(minutesSince(ear, since), Math.round((16_000 / 60_000) * 10) / 10);
  assert.equal(minutesSince(ear, ny('2026-11-03', '03:00')), 0);
});

test('ear answers sync: a second device sees the same level and answers', async () => {
  const { replica, ear } = await setup();
  await play(ear, UP, true);
  ok(await unlockNext(ear));
  const other = await Replica.open(memoryStore(), 'laptop', { now: clock });
  await other.restore(JSON.parse(replica.exportJson()).events);
  const there = createHost(other, EAR, { now: clock });
  assert.equal(currentLevel(there), 2);
  assert.deepEqual(answersOf(there, UP), answersOf(ear, UP));
});

test('practice more: with nothing due, the skill answered longest ago comes next, never the same one twice', async () => {
  const { ear } = await setup();
  for (const sk of LADDER[0]!.skills) await play(ear, cardIdOf(sk), true);
  // Days later nothing new is waiting, but practice is still on offer.
  const later = ny('2026-11-02', '16:35');
  const first = pickEarCard(ear, later, true);
  assert.ok(first);
  const second = pickEarCard(ear, later, true, first!);
  assert.ok(second && second !== first);
  assert.equal(pickEarCard(ear, later, false), null, 'no sound allowed (quiet hours): nothing');
  const oldest = LADDER[0]!.skills.map(cardIdOf);
  t = later;
  await play(ear, first!, true);
  assert.notEqual(pickEarCard(ear, later + 60_000, true, first!), first);
  assert.ok(oldest.includes(pickEarCard(ear, later + 60_000, true)!));
});
