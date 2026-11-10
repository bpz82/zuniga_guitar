/** Teach (2026-11-03): the day's lesson deck and the objectives popup from the current chapter. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, memoryStore, Replica } from '../src/index.ts';
import { LESSONS } from '../src/modules/theory/curriculum.ts';
import { CHAPTER_HORIZON, cardIdOf, currentLesson, newCardFilter, rateQa, seedTheory, THEORY } from '../src/modules/theory/practice.ts';
import { chapterLine, teachDeck, teachObjectives } from '../harness/home/teach.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const at = (date: string, h: number) => dayBegins(date, NY) + (h - 3) * 3600_000;
let t = 0;
async function setup(start = at('2026-11-03', 4)) {
  t = start;
  const replica = await Replica.open(memoryStore(), 'phone', { now: () => (t += 1000) });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, THEORY, { now: () => t });
  await seedTheory(host, NY);
  return { replica, host };
}

test('the deck is the curriculum, whatever the window: new cards in teaching order, lesson 1 first, even in the morning guitar session', async () => {
  const { replica, host } = await setup(at('2026-11-03', 4)); // 4am: guitar session, no theory cards there
  const deck = teachDeck(replica.library, t, THEORY.id, newCardFilter(host, NY));
  const open = LESSONS.filter((l) => l.chapter <= 1 + CHAPTER_HORIZON).flatMap((l) => l.cards.map((c) => cardIdOf(c.id)));
  assert.deepEqual(deck.fresh, open, 'every open lesson, in teaching order: learning ahead is allowed');
  assert.deepEqual(deck.fresh.slice(0, LESSONS[0]!.cards.length), LESSONS[0]!.cards.map((c) => cardIdOf(c.id)));
  assert.deepEqual(deck.due, []);
  assert.deepEqual(teachDeck(replica.library, t, THEORY.id, () => false).fresh, [], 'a card the horizon does not allow is not served new');
});

test('answered cards come back as due on Teach; nothing from other modules', async () => {
  const { replica, host } = await setup();
  const first = LESSONS[0]!.cards.find((c) => c.type === 'qa')!;
  const r = await rateQa(host, cardIdOf(first.id), 'again', 1000);
  assert.ok(r.ok);
  const deck = teachDeck(replica.library, t + 2 * 60_000, THEORY.id);
  assert.deepEqual(deck.due, [cardIdOf(first.id)]);
  assert.ok(!deck.fresh.includes(cardIdOf(first.id)));
  assert.ok([...deck.due, ...deck.fresh].every((id) => id.startsWith('th-')));
});

test('objectives for a new lesson: read it, learn its cards, and what moves the course on', async () => {
  const { host } = await setup();
  const state = currentLesson(host, NY)!;
  assert.equal(chapterLine(state), 'Chapter 1 · Sound itself · lesson 1 of 6');
  assert.deepEqual(teachObjectives(state, { due: 0, fresh: 8 }).map((o) => o.text), [
    'Read the lesson: What sound is',
    'Learn 8 new cards',
    'Make all 8 cards solid to move on to Lesson 2 · Frequency, period and pitch (0 of 8 so far)',
  ]);
  assert.equal(teachObjectives(state, { due: 0, fresh: 8 }, 4).at(-1)!.text, 'You can learn ahead: chapters up to 4 are open');
  assert.match(teachObjectives(state, { due: 0, fresh: 8 }, 9).at(-1)!.text, /chapters up to 5 are open/, 'never past the last chapter');
});

test('objectives once started: due reviews; nothing due explains that the later day moves on; the last lesson finishes the course', async () => {
  const { host } = await setup();
  const started = { ...currentLesson(host, NY)!, started: 8, ready: 3 };
  assert.deepEqual(teachObjectives(started, { due: 1, fresh: 0 }).map((o) => o.kind), ['deck', 'block']);
  assert.match(teachObjectives(started, { due: 1, fresh: 0 })[0]!.text, /^Review 1 card due$/);
  const waiting = teachObjectives(started, { due: 0, fresh: 0 });
  assert.match(waiting.at(-1)!.text, /later day.*moves the course on/);
  const last = { ...started, lesson: LESSONS.at(-1)! };
  assert.match(teachObjectives(last, { due: 0, fresh: 2 }).at(-1)!.text, /to finish the course/);
  assert.deepEqual(teachObjectives(null, { due: 2, fresh: 0 }).map((o) => o.text), ['Every lesson has graduated.', 'Review 2 cards due']);
  assert.equal(teachObjectives({ ...started, ready: 8 }, { due: 0, fresh: 0 }).find((o) => o.kind === 'block')!.done, true);
});
