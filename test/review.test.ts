/**
 * Practice without the instrument (Blake, 2026-11-08): "Due today" and "Do
 * more", the chapter horizon for new cards, repeats once the new cards run
 * out, extra practice that cannot corrupt the scheduler, and the "Read in
 * Chapter" material for a card rated Hard or Don't know.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHost, dayBegins, isExtraNow, isExtraReview, memoryOf, memoryStore, nextReview, Replica, reviewCounts, scheduledReviews, DAILY_NEW_CARDS } from '../src/index.ts';
import type { ModuleHost, ReviewFilter } from '../src/index.ts';
import { LESSONS } from '../src/modules/theory/curriculum.ts';
import { answerMc, cardIdOf, CHAPTER_HORIZON, chapterFor, needsReading, newCardFilter, rateQa, seedTheory, THEORY } from '../src/modules/theory/practice.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 3600_000;
const at = (date: string, hour: number) => dayBegins(date, NY) + (hour - 3) * H;
let t = 0;

async function setup(day = '2026-11-09') {
  t = at(day, 10);
  const replica = await Replica.open(memoryStore(), 'phone', { now: () => (t += 1000) });
  await replica.record(BLAKE_SETTINGS_EVENT);
  const host = createHost(replica, THEORY, { now: () => t });
  await seedTheory(host, NY);
  const filter: ReviewFilter = { accept: (id) => id.startsWith('th-'), newOk: newCardFilter(host, NY) };
  return { replica, host, filter };
}

/** Rates a theory card the way the UI does: Q/A by rating; multiple choice right (good) or wrong (again). */
async function rate(host: ModuleHost, cardId: string, rating: 'again' | 'good', extra = false) {
  const content = LESSONS.flatMap((l) => l.cards).find((c) => cardIdOf(c.id) === cardId)!;
  const r = content.type === 'qa' ? await rateQa(host, cardId, rating, 4000, extra) : await answerMc(host, cardId, rating === 'again' ? content.wrong[0]! : content.answer, 4000, extra);
  assert.ok(r.ok, JSON.stringify(r));
}

test('Due today: new cards up to the daily allowance, then nothing more', async () => {
  const { replica, host, filter } = await setup();
  const seen = new Set<string>();
  for (let i = 0; i < DAILY_NEW_CARDS + 5; i++) {
    const pick = nextReview(replica.library, t, 'due', filter);
    if (!pick) break;
    assert.equal(pick.kind, 'new');
    assert.ok(filter.newOk(pick.cardId), 'inside the chapter horizon');
    assert.ok(!seen.has(pick.cardId));
    seen.add(pick.cardId);
    await rate(host, pick.cardId, 'good');
    t += 1000;
  }
  assert.equal(seen.size, DAILY_NEW_CARDS);
  assert.equal(nextReview(replica.library, t, 'due', filter), null, 'allowance spent, nothing due');
  assert.equal(reviewCounts(replica.library, t, filter).newToday, 0);
});

test('Do more: continues past the daily allowance with new cards, all within the horizon', async () => {
  const { replica, host, filter } = await setup();
  for (let i = 0; i < DAILY_NEW_CARDS + 4; i++) {
    const pick = nextReview(replica.library, t, 'more', filter)!;
    assert.equal(pick.kind, 'new');
    assert.ok(filter.newOk(pick.cardId));
    await rate(host, pick.cardId, 'good');
    t += 1000;
  }
  const counts = reviewCounts(replica.library, t, filter);
  assert.ok(counts.newTotal > 0, 'more new cards remain inside the horizon');
  assert.equal(counts.newToday, 0, 'but the daily allowance is spent');
});

test('Do more: once new cards are gone, learned cards repeat as extras, round and round', async () => {
  const { replica, host, filter } = await setup();
  const closed: ReviewFilter = { accept: filter.accept, newOk: () => false };
  // Learn three cards, then close the horizon so there are no new ones.
  const ids = LESSONS[0]!.cards.slice(0, 3).map((c) => cardIdOf(c.id));
  for (const id of ids) await rate(host, id, 'good');
  t += 1000;
  const shown = new Set<string>();
  const order: string[] = [];
  for (let i = 0; i < 7; i++) {
    const pick = nextReview(replica.library, t, 'more', closed, shown);
    if (!pick) break;
    if (pick.kind === 'due') { await rate(host, pick.cardId, 'good'); continue; }
    assert.equal(pick.kind, 'repeat');
    if (pick.cycle) shown.clear();
    shown.add(pick.cardId);
    order.push(pick.cardId);
    assert.ok(isExtraNow(replica.library, pick.cardId, t), 'a repeat is extra practice');
  }
  assert.ok(order.length >= 6, 'it never runs out');
  assert.deepEqual(new Set(order), new Set(ids), 'every learned card comes round');
});

test('extra reviews are logged but never reach the scheduler', async () => {
  const { replica, host } = await setup();
  const id = cardIdOf(LESSONS[0]!.cards[0]!.id);
  await rate(host, id, 'good');
  const before = memoryOf(id, replica.library.reviews.get(id)!, replica.library.settings.desiredRetention, NY, true);
  t += 60_000;
  await rate(host, id, 'again', true);
  await rate(host, id, 'again', true);
  const reviews = replica.library.reviews.get(id)!;
  assert.equal(reviews.length, 3, 'all three are in the log');
  assert.equal(reviews.filter(isExtraReview).length, 2);
  assert.equal(scheduledReviews(reviews).length, 1);
  const after = memoryOf(id, reviews, replica.library.settings.desiredRetention, NY, true);
  assert.deepEqual(after, before, 'stability and due date are untouched');
});

test('isExtraNow: false for a new or due card, true for a learned card that is not due', async () => {
  const { replica, host } = await setup();
  const id = cardIdOf(LESSONS[0]!.cards[0]!.id);
  assert.equal(isExtraNow(replica.library, id, t), false, 'new');
  await rate(host, id, 'good');
  t += 1000;
  assert.equal(isExtraNow(replica.library, id, t), true, 'learned, not due');
  t += 400 * 24 * H;
  assert.equal(isExtraNow(replica.library, id, t), false, 'long overdue: counts normally');
});

test('Read in Chapter: hard or again opens the card\'s own chapter, our own words, no links', async () => {
  assert.equal(needsReading('again'), true);
  assert.equal(needsReading('hard'), true);
  assert.equal(needsReading('good'), false);
  assert.equal(needsReading('easy'), false);
  const { host } = await setup();
  const lesson = LESSONS[0]!;
  const material = chapterFor(host, cardIdOf(lesson.cards[0]!.id))!;
  assert.equal(material.chapter, lesson.chapter);
  assert.deepEqual(material.lessons.filter((l) => l.relevant).map((l) => l.n), [lesson.n]);
  assert.deepEqual(material.lessons.map((l) => l.n), LESSONS.filter((l) => l.chapter === lesson.chapter).map((l) => l.n));
  for (const l of material.lessons) for (const line of l.reading) assert.doesNotMatch(line, /https?:|www\./i);
  assert.equal(chapterFor(host, 'not-a-theory-card'), undefined);
});
