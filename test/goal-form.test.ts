/** Goal intake form, songwriting prompts, and the recorder's goal blocks (improv takes, songwriting). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { append, dayBegins, emptyLog, gigMemos, planGoals, project, sessionFor, validateBody } from '../src/index.ts';
import type { EventBody, Library, Log } from '../src/index.ts';
import { archiveGoal, checkInGoal, goalFromForm, tasksFromText } from '../src/goal-form.ts';
import type { GoalForm } from '../src/goal-form.ts';
import { PROMPTS, promptForDay } from '../src/modules/songwriting/prompts.ts';
import { improvFor, memoFor, songwritingFor } from '../src/modules/recorder/blocks.ts';
import { checkImprov } from '../src/modules/recorder/core.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const NY = BLAKE_SETTINGS.dayStart;
const H = 60 * 60 * 1000;
const ny = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return dayBegins(date, NY) + (h - 3) * H + m * 60_000;
};
const NOW = ny('2026-11-02', '09:00');

function lib(...bodies: EventBody[]): { log: Log; lib: Library } {
  let log = emptyLog();
  let n = 0;
  for (const b of [BLAKE_SETTINGS_EVENT, ...bodies]) log = append(log, b, { device: `d${n}`, now: () => NOW - 60_000 + n, newId: () => `e${++n}` }).log;
  return { log, lib: project(log) };
}
const ok = <T>(r: { ok: true; value: T } | { ok: false; error: string }): T => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const song = (id: string): EventBody => ({ type: 'item-set', item: { id, module: 'songs', fields: { title: id } } });

const RECORD: GoalForm = {
  kind: 'general',
  what: 'Write a new record',
  why: 'Ten new songs out by spring',
  deadline: '2027-03-01',
  tasks: [{ label: '10 min in Chord Chemistry', minutes: 10 }],
  songwriting: { minutes: 10, takes: 1 },
};

test('"write a new record by X": a deadline goal with a timed task and a daily songwriting prompt', () => {
  const body = ok(goalFromForm(RECORD, 'record', lib().lib, NOW));
  assert.ok(validateBody(body).ok);
  if (body.type !== 'goal-set') throw new Error('not a goal');
  const g = body.goal;
  assert.deepEqual([g.kind, g.deadline, g.dailyMinutes, g.archived], ['general', '2027-03-01', 20, false]);
  assert.deepEqual(g.blocks.map((b) => [b.id, b.kind, b.label, b.minutes]), [
    ['task-1', 'timed-task', '10 min in Chord Chemistry', 10],
    ['write', 'creative-prompt', 'Songwriting prompt', 10],
  ]);
  assert.deepEqual(g.blocks[1]!.params, { minutes: 10, takes: 1 });
});

test('a gig goal: set songs, guitar yoga, recall time, improv takes ramping from 5 to 10', () => {
  const l = lib(song('song-a'), song('song-b')).lib;
  const body = ok(
    goalFromForm(
      { kind: 'gig', what: 'Friday gig', why: 'First gig of the year', deadline: '2026-12-04', itemIds: ['song-a', 'song-b'], feel: 10, recall: 20, improv: { takes: 5, minutes: 1, rampTo: 10, rampDays: 14 } },
      'gig',
      l,
      NOW,
    ),
  );
  if (body.type !== 'goal-set') throw new Error('not a goal');
  assert.deepEqual(body.goal.blocks.map((b) => b.kind), ['feel-session', 'recall', 'improv-takes', 'gig-memo'], 'a gig gets the post-gig memo by default');
  assert.deepEqual(body.goal.itemIds, ['song-a', 'song-b']);
  assert.equal(body.goal.dailyMinutes, 35, 'the memo adds nothing to the daily minutes');
});

test('the form refuses anything vague, out of range or inconsistent, naming the field', () => {
  const l = lib().lib;
  const bad: [string, GoalForm, RegExp][] = [
    ['no blocks', (({ songwriting: _s, ...r }) => ({ ...r, tasks: [] }))(RECORD), /at least one/],
    ['empty task label', { ...RECORD, tasks: [{ label: ' ', minutes: 10 }] }, /timed task 1/],
    ['task too long', { ...RECORD, tasks: [{ label: 'x', minutes: 121 }] }, /timed task 1/],
    ['too many tasks', { ...RECORD, tasks: Array(6).fill({ label: 'x', minutes: 1 }) }, /at most 5/],
    ['songwriting takes', { ...RECORD, songwriting: { minutes: 10, takes: 6 } }, /songwriting/],
    ['improv takes', { ...RECORD, improv: { takes: 11, minutes: 1 } }, /improv/],
    ['ramp half given', { ...RECORD, improv: { takes: 5, minutes: 1, rampTo: 10 } }, /ramp/],
    ['ramp downward', { ...RECORD, improv: { takes: 5, minutes: 1, rampTo: 4, rampDays: 7 } }, /ramp/],
    ['recall with no songs', { ...RECORD, recall: 10 }, /songs/],
    ['unknown song', { ...RECORD, itemIds: ['song-nope'] }, /unknown/],
    ['past deadline', { ...RECORD, deadline: '2026-10-01' }, /already passed/],
    ['no what', { ...RECORD, what: '' }, /what/],
    ['bad kind', { ...RECORD, kind: 'party' as 'gig' }, /kind/],
  ];
  for (const [label, form, error] of bad) {
    const r = goalFromForm(form, 'g', l, NOW);
    assert.ok(!r.ok && error.test(r.error), `${label}: ${r.ok ? 'accepted' : r.error}`);
  }
});

test('check-ins and archiving re-save the goal; nothing is deleted', () => {
  const first = lib(ok(goalFromForm(RECORD, 'record', lib().lib, NOW)));
  const changed = ok(checkInGoal(first.lib, 'record', 30));
  assert.equal(changed.type === 'goal-set' && changed.goal.dailyMinutes, 30);
  assert.equal(checkInGoal(first.lib, 'record', -1).ok, false);
  const archived = ok(archiveGoal(first.lib, 'record'));
  assert.equal(archived.type === 'goal-set' && archived.goal.archived, true);
  assert.equal(archiveGoal(first.lib, 'nope').ok, false);
});

test('songwriting prompts: concrete, timed, recordable; one a day, no repeats until all have come up', () => {
  assert.ok(PROMPTS.length >= 20);
  assert.equal(new Set(PROMPTS.map((p) => p.id)).size, PROMPTS.length);
  for (const p of PROMPTS) {
    assert.ok(/record/i.test(p.text), `${p.id} says to record`);
    assert.ok(!/\bideas?\b/i.test(p.text), `${p.id} counts no "ideas"`);
    assert.ok(p.text.length <= 200 && p.minutes >= 5 && p.minutes <= 15);
    assert.ok(checkImprov({ prompt: p.text, takes: 1, minutes: p.minutes }).ok);
  }
  const days = Array.from({ length: PROMPTS.length }, (_, i) => promptForDay('g', 'write', `2026-11-${String(i + 1).padStart(2, '0')}`).id);
  assert.equal(new Set(days).size, PROMPTS.length, 'a full cycle without repeats');
  assert.equal(promptForDay('g', 'write', '2026-11-05'), promptForDay('g', 'write', '2026-11-05'), 'stable for the day on every device');
  assert.notEqual(promptForDay('a', 'write', '2026-11-05').id, promptForDay('b', 'write', '2026-11-05').id, 'two goals start in different places');
});

test('improv block: Blake\'s ramp (5 to 10 one-minute takes) climbs over the last days and hits 10 on gig day', () => {
  const block = { kind: 'improv-takes' as const, label: 'Improv takes', minutes: 5, params: { takes: 5, minutes: 1, rampTo: 10, rampDays: 10 } };
  const at = (daysLeft: number) => improvFor({ ...block, daysLeft })!.takes;
  assert.deepEqual([at(30), at(10), at(5), at(1), at(0)], [5, 5, 8, 10, 10]);
  assert.deepEqual(improvFor({ ...block, daysLeft: 20 }), { prompt: 'Improv takes', takes: 5, minutes: 1 });
});

test('improv and songwriting blocks read old or odd params leniently (older goals stored them freely)', () => {
  // The old test fixture shape: improv-takes with { takes: 5 } only.
  assert.deepEqual(improvFor({ kind: 'improv-takes', label: 'Improv takes', minutes: 5, params: { takes: 5 }, daysLeft: 3 }), { prompt: 'Improv takes', takes: 5, minutes: 1 });
  assert.deepEqual(improvFor({ kind: 'improv-takes', label: 'Jam', minutes: 12, daysLeft: 3 }), { prompt: 'Jam', takes: 3, minutes: 4 });
  assert.deepEqual(improvFor({ kind: 'improv-takes', label: 'Jam', minutes: 6, params: { takes: 99, minutes: -2, prompt: 'x\ny' }, daysLeft: 3 }), { prompt: 'Jam', takes: 10, minutes: 1 });
  assert.equal(improvFor({ kind: 'recall', label: 'x', minutes: 5, daysLeft: 3 }), null);
  const own = songwritingFor({ kind: 'creative-prompt', goalId: 'g', blockId: 'w', minutes: 10, params: { prompt: 'Finish the second verse of "Harbor". Record it.' } }, '2026-11-02')!;
  assert.deepEqual(own, { prompt: 'Finish the second verse of "Harbor". Record it.', takes: 1, minutes: 10 });
  const listed = songwritingFor({ kind: 'creative-prompt', goalId: 'g', blockId: 'w', minutes: 10 }, '2026-11-02')!;
  assert.equal(listed.prompt, promptForDay('g', 'w', '2026-11-02').text);
  assert.ok(checkImprov(listed).ok, 'always something the recorder accepts');
});

test('surfaced in the morning session: the goal\'s blocks appear with their params; a task-done ticks one off', () => {
  const goal = ok(goalFromForm(RECORD, 'record', lib().lib, NOW));
  const { log } = lib(goal);
  const morning = (l: Library) => sessionFor(l, ny('2026-11-03', '04:05')).segments.filter((s) => s.kind === 'block');
  const blocks = morning(project(log));
  assert.deepEqual(blocks.map((s) => s.kind === 'block' && [s.block.kind, s.block.minutes, s.done]), [
    ['timed-task', 10, false],
    ['creative-prompt', 10, false],
  ]);
  const write = blocks[1]!.kind === 'block' ? blocks[1]!.block : null;
  assert.ok(songwritingFor(write!, '2026-11-03'));
  const done = append(log, { type: 'task-done', goalId: 'record', blockId: 'write', durationMs: 600_000 }, { device: 'p', now: () => ny('2026-11-03', '04:20'), newId: () => 'done-1' }).log;
  assert.deepEqual(morning(project(done)).map((s) => s.kind === 'block' && s.done), [false, true]);
  assert.equal(planGoals(project(done), ny('2027-03-02', '04:05')).blocks.length, 0, 'expires cleanly after the deadline');
});

test('timed tasks typed in plain words: the minutes lead the line, the line is the label', () => {
  assert.deepEqual(ok(tasksFromText('10 min in Chord Chemistry\n\n 15 minutes on the bridge of Harbor ')), [
    { label: '10 min in Chord Chemistry', minutes: 10 },
    { label: '15 minutes on the bridge of Harbor', minutes: 15 },
  ]);
  const r = tasksFromText('10 min in Chord Chemistry\nwork on stuff');
  assert.ok(!r.ok && /line 2/.test(r.error));
  assert.deepEqual(ok(tasksFromText('')), []);
});

// ------------------------------------------------- post-gig memo (gig night) --

const GIG: GoalForm = { kind: 'gig', what: 'Friday gig', why: '', deadline: '2026-11-06', tasks: [{ label: '20 min run the set', minutes: 20 }] };

test('post-gig memo: shows on gig night by default (from 18:00 until the practice day ends), in any session', () => {
  const { lib: l } = lib(ok(goalFromForm(GIG, 'gig', lib().lib, NOW)));
  assert.deepEqual(gigMemos(l, ny('2026-11-05', '21:00')), [], 'not the night before');
  assert.deepEqual(gigMemos(l, ny('2026-11-06', '17:59')), [], 'not before gig night');
  const memo = gigMemos(l, ny('2026-11-06', '21:30'));
  assert.deepEqual(memo.map((b) => [b.goalId, b.blockId, b.kind, b.label]), [['gig', 'memo', 'gig-memo', 'Post-gig rundown memo']]);
  assert.equal(gigMemos(l, ny('2026-11-07', '01:30')).length, 1, 'after midnight is still gig night (the day ends at 3am)');
  assert.deepEqual(gigMemos(l, ny('2026-11-07', '03:30')), [], 'gone when the practice day ends');
  for (const hhmm of ['21:30', '23:59']) {
    const s = sessionFor(l, ny('2026-11-06', hhmm));
    assert.ok(s.segments.some((x) => x.kind === 'block' && x.block.kind === 'gig-memo' && !x.done), hhmm);
  }
  assert.deepEqual(memoFor(memo[0]!), { prompt: 'Post-gig rundown memo', takes: 1, minutes: 30 });
});

test('post-gig memo: not daily practice, ticked off once recorded, its time can be set, and it can be left out', () => {
  const { log, lib: l } = lib(ok(goalFromForm(GIG, 'gig', lib().lib, NOW)));
  assert.ok(!planGoals(l, ny('2026-11-06', '04:05')).blocks.some((b) => b.kind === 'gig-memo'), 'never in the morning split');
  const done = project(append(log, { type: 'task-done', goalId: 'gig', blockId: 'memo', durationMs: 300_000 }, { device: 'p', now: () => ny('2026-11-06', '23:00'), newId: () => 'm1' }).log);
  const seg = sessionFor(done, ny('2026-11-06', '23:30')).segments.find((x) => x.kind === 'block' && x.block.kind === 'gig-memo');
  assert.ok(seg && seg.kind === 'block' && seg.done);
  const late = ok(goalFromForm({ ...GIG, gigMemo: { from: '22:30' } }, 'late', lib().lib, NOW));
  const lateLib = lib(late).lib;
  assert.deepEqual(gigMemos(lateLib, ny('2026-11-06', '22:00')), []);
  assert.equal(gigMemos(lateLib, ny('2026-11-06', '22:30')).length, 1);
  const none = ok(goalFromForm({ ...GIG, gigMemo: false }, 'none', lib().lib, NOW));
  assert.ok(none.type === 'goal-set' && !none.goal.blocks.some((b) => b.kind === 'gig-memo'));
  assert.equal(goalFromForm({ ...GIG, gigMemo: { from: '9pm' } }, 'x', lib().lib, NOW).ok, false);
  assert.equal(goalFromForm({ ...RECORD, gigMemo: true }, 'x', lib().lib, NOW).ok, false, 'deadline goals have no gig');
  assert.equal(goalFromForm({ ...GIG, tasks: [] }, 'x', lib().lib, NOW).ok, false, 'a memo alone is not a plan');
});
