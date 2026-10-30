import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, dayBegins, daysBetween, practiceDay } from '../src/day.ts';
import { buildQueue, DEFAULT_DAY_START, memoryOf, project, validateBody } from '../src/index.ts';
import type { EventOf, Rating } from '../src/index.ts';
import { card, device, item, record } from './helpers.ts';

const NY = DEFAULT_DAY_START; // America/New_York, 3:00am
const UTC_MIDNIGHT = { timeZone: 'UTC', hour: 0 };
const H = 60 * 60 * 1000;
/** An instant given as New York wall-clock time in a month with EDT (UTC-4). */
const edt = (date: string, hh: number, mm = 0) => Date.parse(`${date}T00:00:00Z`) + (hh + 4) * H + mm * 60_000;

test("Blake's default day starts at 3:00am New York time", () => {
  assert.deepEqual(NY, { timeZone: 'America/New_York', hour: 3 });
  assert.equal(practiceDay(edt('2026-10-15', 2, 59), NY), '2026-10-14');
  assert.equal(practiceDay(edt('2026-10-15', 3, 0), NY), '2026-10-15');
  assert.equal(practiceDay(edt('2026-10-15', 23, 50), NY), '2026-10-15');
});

test('practice days line up across both daylight-saving changes', () => {
  for (const date of ['2026-03-07', '2026-03-08', '2026-03-09', '2026-10-31', '2026-11-01', '2026-11-02']) {
    const begins = dayBegins(date, NY);
    assert.equal(practiceDay(begins, NY), date, `${date} start`);
    assert.equal(practiceDay(begins - 1, NY), addDays(date, -1), `${date} minus 1ms`);
  }
  // 3:00am is 07:00 UTC in summer and 08:00 UTC in winter.
  assert.equal(new Date(dayBegins('2026-10-31', NY)).toISOString(), '2026-10-31T07:00:00.000Z');
  assert.equal(new Date(dayBegins('2026-11-02', NY)).toISOString(), '2026-11-02T08:00:00.000Z');
});

test('date helpers', () => {
  assert.equal(daysBetween('2026-10-30', '2026-12-04'), 35);
  assert.equal(daysBetween('2026-12-04', '2026-10-30'), -35);
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
});

test('settings accept a valid day start and refuse a bad one', () => {
  const s = (dayStart: unknown) => ({ type: 'settings-set', settings: { desiredRetention: 0.9, windows: [], dayStart } });
  assert.ok(validateBody(s({ timeZone: 'America/New_York', hour: 3 })).ok);
  assert.equal(validateBody(s({ timeZone: 'Mars/Olympus', hour: 3 })).ok, false);
  assert.equal(validateBody(s({ timeZone: 'America/New_York', hour: 24 })).ok, false);
  assert.ok(validateBody({ type: 'settings-set', settings: { desiredRetention: 0.9, windows: [] } }).ok, 'older settings without dayStart still valid');
});

test('settings without a day start resolve to the default', () => {
  const log = record(device('phone'), [{ type: 'settings-set', settings: { desiredRetention: 0.85, windows: [] } }]);
  assert.deepEqual(project(log).settings.dayStart, NY);
});

function reviews(seq: [Rating, number][]): EventOf<'review'>[] {
  return seq.map(([rating, at], i) => ({ v: 1, id: `r${i}`, at, device: 'd', type: 'review', cardId: 'c', rating, durationMs: 1 }));
}

test('7:30pm and 8:30pm New York count as one day for FSRS (they were two UTC days)', () => {
  const evening = reviews([['easy', edt('2026-10-01', 9)], ['again', edt('2026-10-05', 19, 30)], ['good', edt('2026-10-05', 20, 30)]]);
  const ny = memoryOf('c', evening, 0.9, NY);
  const utc = memoryOf('c', evening, 0.9, UTC_MIDNIGHT);
  // Same reviews shifted to sit inside one UTC day: the New York result must match it.
  const shift = -12 * H;
  const sameUtcDay = memoryOf('c', evening.map((r) => ({ ...r, at: r.at + shift })), 0.9, UTC_MIDNIGHT);
  assert.equal(ny.stability, sameUtcDay.stability);
  assert.equal(ny.difficulty, sameUtcDay.difficulty);
  assert.notEqual(ny.stability, utc.stability, 'the boundary setting matters');
});

test('a review due at 7pm is in that morning\'s 4am session, not the night before', () => {
  const w = record(device('phone'), [item('i1'), card('c1', 'i1')]);
  const lib = project(w);
  const hist = reviews([['easy', edt('2026-10-01', 19)]]);
  const m = memoryOf('c1', hist, 0.9, NY);
  const dueDay = practiceDay(m.due!, NY);
  const withReviews = { ...lib, reviews: new Map([['c1', hist.map((r) => ({ ...r, cardId: 'c1' }))]]) };
  const morning = dayBegins(dueDay, NY) + H; // 4:00am on the due day
  assert.equal(buildQueue(withReviews, { now: morning }).due.length, 1);
  assert.equal(buildQueue(withReviews, { now: dayBegins(dueDay, NY) - H }).due.length, 0); // 2:00am, still yesterday
});
