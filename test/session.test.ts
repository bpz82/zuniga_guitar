import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  append,
  BURST_MINUTES,
  currentWindow,
  dayBegins,
  DEFAULT_SETTINGS,
  emptyLog,
  goalFromIntake,
  isQuiet,
  nudgesBetween,
  practiceDay,
  project,
  sessionFor,
  validateBody,
  windowsFor,
} from '../src/index.ts';
import type { BlockSegment, CardTag, EventBody, Intake, Library, Log, Rating, ReviewSegment, Session } from '../src/index.ts';
import { item } from './helpers.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const MIN = 60_000;
const DAY = 24 * H;
/** New York wall-clock time on a practice day (works across DST). */
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * MIN;
};

function writer() {
  let clock = ny('2026-10-01', '09:00');
  let n = 0;
  let log: Log = emptyLog();
  const ctx = { device: 'phone', now: () => clock, newId: () => `e${String(++n).padStart(5, '0')}` };
  const w = {
    at(ms: number) {
      clock = ms;
      return w;
    },
    add(...bodies: EventBody[]) {
      // Tests back-date events freely; a real device can't, so each event
      // here is recorded as its own device to keep the times exactly as written.
      for (const b of bodies) log = append(log, b, { ...ctx, device: `${ctx.device}-${log.length}` }).log;
      return w;
    },
    card(id: string, tags: CardTag[]) {
      return w.add(item(`i-${id}`), { type: 'card-set', card: { id, itemId: `i-${id}`, template: 't', tags, retired: false } });
    },
    rate(cardId: string, rating: Rating, ms: number) {
      return w.at(ms).add({ type: 'review', cardId, rating, durationMs: 3000 });
    },
    get lib(): Library {
      return project(log);
    },
  };
  log = append(log, BLAKE_SETTINGS_EVENT, ctx).log;
  return w;
}

const review = (s: Session) => s.segments.find((x): x is ReviewSegment => x.kind === 'review');
const blocks = (s: Session) => s.segments.filter((x): x is BlockSegment => x.kind === 'block');
const dueIds = (s: Session) => review(s)?.due.map((d) => d.memory.cardId) ?? [];

/** One card of each kind, all reviewed long enough ago to be due on 2026-11-02. */
function mixedDeck() {
  const w = writer();
  const t = ny('2026-10-20', '09:00');
  for (const [id, tags] of [
    ['g', ['guitar']],
    ['snd', ['pocket-sound']],
    ['sil', ['pocket-silent']],
    ['both', ['guitar', 'pocket-silent']],
  ] as [string, CardTag[]][]) {
    w.card(id, tags).rate(id, 'good', t).rate(id, 'good', t + 10 * MIN);
  }
  return w;
}

// ------------------------------------------------------------ settings ---

test("Blake's schedule is his own settings; the engine defaults are generic", () => {
  assert.deepEqual(
    BLAKE_SETTINGS.windows.map((w) => [w.id, w.start]),
    [['morning', '04:00'], ['before-work', '09:45'], ['during-work', '13:00'], ['after-work', '16:30']],
  );
  assert.deepEqual(BLAKE_SETTINGS.quietHours, { start: '10:30', end: '16:00' });
  assert.deepEqual(BLAKE_SETTINGS.dayStart, { timeZone: 'America/New_York', hour: 3 });
  assert.equal(DEFAULT_SETTINGS.dayStart.timeZone, 'UTC');
  assert.deepEqual(DEFAULT_SETTINGS.windows.map((w) => w.start), ['07:00', '08:30', '12:30', '17:30']);
  assert.equal(DEFAULT_SETTINGS.notifications, false, 'users opt in');
  assert.equal(DEFAULT_SETTINGS.morningMinutes, 60);
});

test('settings validation: morning at least an hour, sensible quiet hours', () => {
  const s = (extra: object) => ({ type: 'settings-set', settings: { desiredRetention: 0.9, windows: [], ...extra } });
  assert.ok(validateBody(s({ morningMinutes: 60, quietHours: { start: '10:30', end: '16:00' } })).ok);
  assert.equal(validateBody(s({ morningMinutes: 30 })).ok, false, 'spec: 1 hour minimum');
  assert.equal(validateBody(s({ quietHours: { start: '10:30', end: '10:30' } })).ok, false);
  assert.equal(validateBody(s({ quietHours: { start: '25:00', end: '16:00' } })).ok, false);
  assert.ok(validateBody(s({ quietHours: { start: '22:00', end: '06:00' } })).ok, 'may wrap midnight');
});

test('older settings events without the new fields get the defaults', () => {
  const lib = writer().add({ type: 'settings-set', settings: { desiredRetention: 0.85, windows: [{ id: 'morning', start: '05:00' }] } }).lib;
  assert.equal(lib.settings.morningMinutes, 60);
  assert.deepEqual(lib.settings.quietHours, DEFAULT_SETTINGS.quietHours);
  assert.deepEqual(lib.settings.windows, [{ id: 'morning', start: '05:00' }]);
});

// ------------------------------------------------------------- windows ---

test('windows land at the right New York times in summer and winter', () => {
  const lib = writer().lib;
  for (const [date, offset] of [['2026-10-30', 4], ['2026-11-30', 5]] as const) {
    const slots = windowsFor(lib, date);
    assert.deepEqual(
      slots.map((w) => [w.id, new Date(w.start).toISOString().slice(11, 16)]),
      [['morning', `0${4 + offset}:00`], ['before-work', `${String(9 + offset).padStart(2, '0')}:45`], ['during-work', `${13 + offset}:00`], ['after-work', `${16 + offset}:30`]],
      date,
    );
    assert.equal(slots.at(-1)!.end, dayBegins(date === '2026-10-30' ? '2026-10-31' : '2026-12-01', NY));
    for (let i = 0; i < slots.length - 1; i++) assert.equal(slots[i]!.end, slots[i + 1]!.start);
  }
});

test('which window am I in', () => {
  const lib = writer().lib;
  const at = (hhmm: string, date = '2026-11-02') => currentWindow(lib, ny(date, hhmm))!.id;
  assert.equal(at('03:30'), 'morning', 'up early: the morning session is already available');
  assert.equal(at('05:10'), 'morning');
  assert.equal(at('09:50'), 'before-work');
  assert.equal(at('13:05'), 'during-work');
  assert.equal(at('17:00'), 'after-work');
  const lateNight = ny('2026-11-02', '23:59') + 2 * H; // 1:59am, still the 2nd's practice day
  assert.equal(practiceDay(lateNight, NY), '2026-11-02');
  assert.equal(currentWindow(lib, lateNight)!.id, 'after-work');
});

test('quiet hours are 10:30 to 4:00pm; a custom wrap-around range works too', () => {
  const lib = writer().lib;
  assert.equal(isQuiet(lib, ny('2026-11-02', '10:29')), false);
  assert.equal(isQuiet(lib, ny('2026-11-02', '10:30')), true);
  assert.equal(isQuiet(lib, ny('2026-11-02', '15:59')), true);
  assert.equal(isQuiet(lib, ny('2026-11-02', '16:00')), false);
  const night = writer().add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, quietHours: { start: '22:00', end: '06:00' } } }).lib;
  assert.equal(isQuiet(night, ny('2026-11-02', '23:00')), true);
  assert.equal(isQuiet(night, ny('2026-11-02', '05:00')), true);
  assert.equal(isQuiet(night, ny('2026-11-02', '12:00')), false);
});

// ------------------------------------------------------------- bursts ----

test('each window serves only what it allows', () => {
  const lib = mixedDeck().lib;
  const at = (hhmm: string) => dueIds(sessionFor(lib, ny('2026-11-02', hhmm))).sort();
  assert.deepEqual(at('04:00'), ['both', 'g'], 'morning: guitar');
  assert.deepEqual(at('09:45'), ['both', 'sil', 'snd'], 'before work: sound and silent');
  assert.deepEqual(at('13:00'), ['both', 'sil'], 'during work: silent only');
  assert.deepEqual(at('16:30'), ['both', 'sil', 'snd'], 'after work: sound and silent');
});

test('at work nothing with sound is ever served, whatever the window', () => {
  const lib = mixedDeck().lib;
  const late = sessionFor(lib, ny('2026-11-02', '10:40')); // opened the 9:45 burst late, now at work
  assert.equal(late.windowId, 'before-work');
  assert.equal(late.mode, 'silent');
  assert.equal(late.quiet, true);
  assert.deepEqual(dueIds(late).sort(), ['both', 'sil']);
});

test('a pocket burst is time-boxed at 3 to 5 minutes with due cards first, then new ones', () => {
  const w = mixedDeck().card('new-sil', ['pocket-silent']);
  const s = sessionFor(w.lib, ny('2026-11-02', '13:00'));
  assert.equal(s.minutes, 5, 'spec: 3 to 5 minutes');
  assert.equal(s.minMinutes, 3);
  assert.deepEqual(BURST_MINUTES, { min: 3, max: 5 });
  assert.equal(s.segments.length, 1);
  assert.deepEqual(review(s)!.fresh, ['new-sil']);
});

test('a missed burst rolls forward: its cards are simply still due later, no catch-up', () => {
  const w = writer().card('sil', ['pocket-silent']);
  const t = ny('2026-10-20', '09:00');
  w.rate('sil', 'good', t).rate('sil', 'good', t + 10 * MIN);
  const lib = w.lib;
  for (const hhmm of ['09:45', '13:00', '16:30']) assert.deepEqual(dueIds(sessionFor(lib, ny('2026-11-02', hhmm))), ['sil'], hhmm);
  // Reviewed in the 4:30pm burst: gone for the rest of the day.
  w.rate('sil', 'good', ny('2026-11-02', '16:31'));
  assert.deepEqual(dueIds(sessionFor(w.lib, ny('2026-11-02', '16:40'))), []);
});

test('a learning step comes back within the same burst', () => {
  const w = writer().card('sil', ['pocket-silent']);
  const start = ny('2026-11-02', '13:00');
  w.rate('sil', 'again', start);
  assert.deepEqual(dueIds(sessionFor(w.lib, start + 30_000)), [], 'not yet');
  assert.deepEqual(dueIds(sessionFor(w.lib, start + MIN)), ['sil'], 'after its 1-minute step');
});

// ------------------------------------------------------------- morning ---

const gig = (over: Partial<Intake> = {}): Intake => ({
  kind: 'gig',
  what: 'Friday set',
  why: 'Gig',
  deadline: '2026-12-04',
  itemIds: ['i-g'],
  dailyMinutes: 30,
  weight: 2,
  blocks: [
    { id: 'yoga', kind: 'feel-session', label: 'Guitar yoga', minutes: 10 },
    { id: 'songs', kind: 'recall', label: 'Set songs', minutes: 15 },
    { id: 'chem', kind: 'timed-task', label: '10 min in Chord Chemistry', minutes: 5 },
  ],
  ...over,
});

function withGoal(w: ReturnType<typeof writer>, intake: Intake, id = 'gig') {
  const r = goalFromIntake(intake, id, w.lib, ny('2026-10-30', '09:00'));
  assert.ok(r.ok, r.ok ? '' : r.error);
  return w.at(ny('2026-10-30', '09:00')).add(r.value);
}

test('morning session: one hour, guitar yoga first, then reviews, then tasks', () => {
  const lib = withGoal(mixedDeck(), gig()).lib;
  const s = sessionFor(lib, ny('2026-11-02', '04:00'));
  assert.equal(s.mode, 'guitar');
  assert.equal(s.minutes, 60);
  assert.deepEqual(
    s.segments.map((x) => (x.kind === 'review' ? ['review', x.minutes] : [x.block.label, x.block.minutes])),
    [['Guitar yoga', 10], ['review', 45], ['10 min in Chord Chemistry', 5]],
    'recall 15 + 30 spare minutes go to reviews',
  );
  const total = s.segments.reduce((sum, x) => sum + (x.kind === 'review' ? x.minutes : x.block.minutes), 0);
  assert.equal(total, 60);
});

test('morning with no goals: the whole hour is reviews', () => {
  const s = sessionFor(mixedDeck().lib, ny('2026-11-02', '04:00'));
  assert.deepEqual(s.segments.map((x) => [x.kind, x.kind === 'review' ? x.minutes : 0]), [['review', 60]]);
});

test('goals asking for more than the morning are squeezed by weight; yoga is never squeezed', () => {
  const w = withGoal(mixedDeck(), gig({ dailyMinutes: 50 }));
  withGoal(w, { what: 'Theory', why: 'x', deadline: '2027-02-01', itemIds: [], dailyMinutes: 40, weight: 1, blocks: [{ id: 't', kind: 'timed-task', label: 'Theory', minutes: 40 }] }, 'theory');
  const s = sessionFor(w.lib, ny('2026-11-02', '04:00'));
  const yoga = blocks(s).find((b) => b.block.label === 'Guitar yoga')!;
  assert.equal(yoga.block.minutes, Math.round((10 * 50) / 30), 'yoga keeps its full scaled time');
  const total = s.segments.reduce((sum, x) => sum + (x.kind === 'review' ? x.minutes : x.block.minutes), 0);
  assert.equal(total, 60);
  assert.equal(s.segments[0]!.kind, 'block');
});

test('a longer morning can be set, and the extra time goes to reviews', () => {
  const w = mixedDeck().add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, morningMinutes: 90 } });
  assert.equal(review(sessionFor(w.lib, ny('2026-11-02', '04:00')))!.minutes, 90);
});

test("blocks done today are marked done; tomorrow they're fresh again", () => {
  const w = withGoal(mixedDeck(), gig());
  w.at(ny('2026-11-02', '04:05')).add({ type: 'feel-session', goalId: 'gig', durationMs: 600_000, note: 'Loose' });
  w.at(ny('2026-11-02', '04:50')).add({ type: 'task-done', goalId: 'gig', blockId: 'chem', durationMs: 300_000 });
  const today = sessionFor(w.lib, ny('2026-11-02', '05:00'));
  assert.deepEqual(blocks(today).map((b) => [b.block.label, b.done]), [['Guitar yoga', true], ['10 min in Chord Chemistry', true]]);
  const tomorrow = sessionFor(w.lib, ny('2026-11-03', '04:00'));
  assert.ok(blocks(tomorrow).every((b) => !b.done));
});

test("in a gig's final week the morning holds the full set run-through", () => {
  const s = sessionFor(withGoal(mixedDeck(), gig()).lib, ny('2026-12-01', '04:00'));
  assert.ok(blocks(s).some((b) => b.block.label === 'Full set run-through' && b.block.minutes === 15));
});

test('goal material comes first in the morning, but no other due card is hidden', () => {
  const lib = withGoal(mixedDeck(), gig({ itemIds: ['i-both'] })).lib;
  const ids = dueIds(sessionFor(lib, ny('2026-11-02', '04:00')));
  assert.deepEqual(ids, ['both', 'g']);
});

// ------------------------------------------------------- notifications ---

test('one gentle nudge per window, silent during work hours', () => {
  const lib = mixedDeck().lib;
  const from = dayBegins('2026-11-02', NY);
  const nudges = nudgesBetween(lib, from, dayBegins('2026-11-03', NY));
  assert.deepEqual(
    nudges.map((n) => [n.windowId, n.at === windowsFor(lib, '2026-11-02').find((w) => w.id === n.windowId)!.start, n.silent]),
    [['morning', true, false], ['before-work', true, false], ['during-work', true, true], ['after-work', true, false]],
  );
});

test('no nudge when there is nothing to do (except the morning, see below), and never twice for the same window', () => {
  const empty = writer().lib;
  assert.deepEqual(
    nudgesBetween(empty, dayBegins('2026-11-02', NY), dayBegins('2026-11-03', NY)).map((n) => n.windowId),
    ['morning'],
    'pocket windows with nothing to do stay quiet',
  );
  const lib = mixedDeck().lib;
  const t1 = ny('2026-11-02', '13:00');
  assert.equal(nudgesBetween(lib, t1 - MIN, t1).length, 1);
  assert.equal(nudgesBetween(lib, t1, t1 + 5 * MIN).length, 0, 'the next run does not repeat it');
  // A sender that was down all day only nudges for windows in its range; nothing is replayed later.
  assert.equal(nudgesBetween(lib, ny('2026-11-02', '17:00'), ny('2026-11-02', '23:00')).length, 0);
});

test('the morning reminder always fires, even with nothing due (Blake, 2026-10-31), unless turned off', () => {
  const w = writer();
  const day = () => nudgesBetween(w.lib, dayBegins('2026-11-02', NY), dayBegins('2026-11-03', NY));
  assert.deepEqual(day().map((n) => [n.windowId, n.at === ny('2026-11-02', '04:00'), n.silent]), [['morning', true, false]]);
  w.add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, alwaysRemindMorning: false } });
  assert.deepEqual(day(), [], 'off: back to only when something is due');
  w.add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, windows: BLAKE_SETTINGS.windows.map((x) => (x.id === 'morning' ? { ...x, notify: false } : x)) } });
  assert.deepEqual(day(), [], 'the morning window toggle still wins');
  w.add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, notifications: false } });
  assert.deepEqual(day(), [], 'the master switch still wins');
});

test('alwaysRemindMorning: on by default, validated strictly, and older settings events without it get the default', () => {
  assert.equal(DEFAULT_SETTINGS.alwaysRemindMorning, true);
  assert.equal(DEFAULT_SETTINGS.notifications, false, 'secure default: nothing is sent until the user opts in');
  assert.equal(validateBody({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, alwaysRemindMorning: 'yes' } }).ok, false);
  const { alwaysRemindMorning: _, ...older } = BLAKE_SETTINGS;
  const w = writer().add({ type: 'settings-set', settings: older });
  assert.equal(w.lib.settings.alwaysRemindMorning, true);
});

test('only silent cards due at 1pm means a silent nudge; only guitar cards due means no 1pm nudge', () => {
  const g = writer().card('g', ['guitar']);
  g.rate('g', 'good', ny('2026-10-20', '09:00')).rate('g', 'good', ny('2026-10-20', '09:10'));
  const ids = nudgesBetween(g.lib, dayBegins('2026-11-02', NY), dayBegins('2026-11-03', NY)).map((n) => n.windowId);
  assert.deepEqual(ids, ['morning']);
});

// -------------------------------------------------- done means (spec) ----

test('done means: a silent test deck runs a full day of morning plan, three pocket windows and nudges', () => {
  // Theory flashcards in silent pocket mode, plus one guitar card.
  const w = writer();
  for (let i = 0; i < 12; i++) w.card(`th${i}`, ['pocket-silent']);
  w.card('song', ['guitar']);
  const date = '2026-11-02';
  const day = (hhmm: string) => ny(date, hhmm);

  const nudges = nudgesBetween(w.lib, dayBegins(date, NY), dayBegins('2026-11-03', NY));
  assert.deepEqual(nudges.map((n) => n.windowId), ['morning', 'before-work', 'during-work', 'after-work']);

  const morning = sessionFor(w.lib, day('04:00'));
  assert.deepEqual(review(morning)!.fresh, ['song']);
  w.rate('song', 'good', day('04:10')).rate('song', 'good', day('04:20'));

  // Three bursts; each introduces four new theory cards and repeats any misses.
  let introduced = 0;
  for (const hhmm of ['09:45', '13:00', '16:30']) {
    const start = day(hhmm);
    const s = sessionFor(w.lib, start);
    assert.notEqual(s.mode, 'guitar');
    assert.ok(!review(s)!.fresh.includes('song') && !review(s)!.due.some((d) => d.memory.cardId === 'song'));
    for (const id of review(s)!.fresh.slice(0, 4)) {
      w.rate(id, introduced % 3 === 0 ? 'again' : 'good', start + (introduced % 4) * 20_000);
      introduced++;
    }
    // A minute later the misses are back for their learning step.
    const again = dueIds(sessionFor(w.lib, start + 2 * MIN));
    for (const id of again) w.rate(id, 'good', start + 3 * MIN);
  }
  assert.equal(introduced, 12);
  const evening = sessionFor(w.lib, day('20:00'));
  assert.deepEqual(review(evening)!.fresh, []);
  assert.ok(w.lib.reviews.size === 13);
});

test('the during-work window is silent even if quiet hours are changed to miss it', () => {
  const w = mixedDeck().add({ type: 'settings-set', settings: { ...BLAKE_SETTINGS, quietHours: { start: '22:00', end: '23:00' } } });
  const s = sessionFor(w.lib, ny('2026-11-02', '13:00'));
  assert.equal(s.quiet, false);
  assert.equal(s.mode, 'silent');
  assert.deepEqual(dueIds(s).sort(), ['both', 'sil']);
});

test('a window set after midnight belongs to the same practice day', () => {
  const w = writer().add({
    type: 'settings-set',
    settings: { ...BLAKE_SETTINGS, windows: BLAKE_SETTINGS.windows.map((x) => (x.id === 'after-work' ? { id: x.id, start: '01:30' } : x)) },
  });
  const slots = windowsFor(w.lib, '2026-11-02');
  const late = slots.at(-1)!;
  assert.equal(late.id, 'after-work');
  assert.equal(practiceDay(late.start, NY), '2026-11-02');
  assert.equal(new Date(late.start).toISOString(), '2026-11-03T06:30:00.000Z', '1:30am EST on the 3rd');
});

test('done marks match the goal as well as the block id', () => {
  const w = withGoal(mixedDeck(), gig());
  withGoal(w, { what: 'Theory', why: 'x', deadline: '2027-02-01', itemIds: [], dailyMinutes: 5, weight: 1, blocks: [{ id: 'chem', kind: 'timed-task', label: 'Theory chem', minutes: 5 }] }, 'theory');
  w.at(ny('2026-11-02', '04:50')).add({ type: 'task-done', goalId: 'theory', blockId: 'chem', durationMs: 300_000 });
  const s = sessionFor(w.lib, ny('2026-11-02', '05:00'));
  const byLabel = Object.fromEntries(blocks(s).map((b) => [b.block.label, b.done]));
  assert.equal(byLabel['Theory chem'], true);
  assert.equal(byLabel['10 min in Chord Chemistry'], false);
});
