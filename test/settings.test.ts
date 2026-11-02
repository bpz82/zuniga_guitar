import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  adoptDeviceTimeZone,
  append,
  changeSettings,
  dayBegins,
  DEFAULT_SETTINGS,
  emptyLog,
  nudgesBetween,
  project,
  settingsFromOnboarding,
  toggleNotifications,
  toggleWindowNotify,
  toggleAlwaysRemindMorning,
} from '../src/index.ts';
import type { EventBody, Log, Validation } from '../src/index.ts';
import { BLAKE_SETTINGS, BLAKE_SETTINGS_EVENT } from '../fixtures/blake.ts';

const ctx = (() => {
  let n = 0;
  let t = Date.UTC(2026, 10, 1, 12);
  return { device: 'phone', now: () => (t += 1000), newId: () => `e${++n}` };
})();
const ok = (r: Validation<EventBody>): EventBody => {
  if (!r.ok) assert.fail(r.error);
  return r.value;
};
const apply = (log: Log, body: EventBody) => append(log, body, ctx).log;

test('a new user starts with neutral defaults and notifications off', () => {
  const lib = project(emptyLog());
  assert.equal(lib.settings, DEFAULT_SETTINGS);
  assert.equal(lib.settings.notifications, false);
  assert.equal(lib.settings.dayStart.timeZone, 'UTC');
});

test("onboarding records the user's own schedule", () => {
  const body = ok(
    settingsFromOnboarding({
      timeZone: 'America/Chicago',
      dayStartHour: 5,
      morning: '06:15',
      duringWork: '12:00',
      afterWork: '18:00',
      workStart: '08:00',
      workEnd: '17:00',
      morningMinutes: 75,
      notifications: true,
    }),
  );
  const s = project(apply(emptyLog(), body)).settings;
  assert.deepEqual(s.dayStart, { timeZone: 'America/Chicago', hour: 5 });
  assert.deepEqual(s.windows.map((w) => [w.id, w.start]), [['morning', '06:15'], ['during-work', '12:00'], ['after-work', '18:00']], 'skipped windows stay skipped');
  assert.deepEqual(s.quietHours, { start: '08:00', end: '17:00' });
  assert.equal(s.morningMinutes, 75);
  assert.equal(s.notifications, true);
});

test('onboarding refuses bad answers and defaults notifications to off', () => {
  assert.equal(settingsFromOnboarding({ timeZone: 'Not/AZone', morning: '06:00' }).ok, false);
  assert.equal(settingsFromOnboarding({ timeZone: 'UTC', morning: '6am' }).ok, false);
  assert.equal(settingsFromOnboarding({ timeZone: 'UTC', workStart: '09:00' }).ok, false, 'work hours need both ends');
  const s = project(apply(emptyLog(), ok(settingsFromOnboarding({ timeZone: 'Europe/London', morning: '07:00' })))).settings;
  assert.equal(s.notifications, false);
});

test("Blake's schedule is just his settings event", () => {
  const s = project(apply(emptyLog(), BLAKE_SETTINGS_EVENT)).settings;
  assert.deepEqual(s, BLAKE_SETTINGS);
});

test('any setting can be changed at any time without losing the others', () => {
  let log = apply(emptyLog(), BLAKE_SETTINGS_EVENT);
  log = apply(log, ok(changeSettings(project(log), { morningMinutes: 90 })));
  log = apply(log, ok(changeSettings(project(log), { quietHours: { start: '11:00', end: '15:00' } })));
  const s = project(log).settings;
  assert.equal(s.morningMinutes, 90);
  assert.deepEqual(s.quietHours, { start: '11:00', end: '15:00' });
  assert.deepEqual(s.windows, BLAKE_SETTINGS.windows);
  assert.deepEqual(s.dayStart, BLAKE_SETTINGS.dayStart);
  assert.equal(changeSettings(project(log), { morningMinutes: 20 }).ok, false, 'still validated');
  assert.equal(log.length, 3, 'every change is a new event; history is kept');
});

const card: EventBody = { type: 'card-set', card: { id: 'c', itemId: 'i', template: 't', tags: ['pocket-silent', 'guitar'], retired: false } };
const withDueCard = (log: Log) => {
  log = apply(log, { type: 'item-set', item: { id: 'i', module: 'm', fields: {} } });
  log = apply(log, card);
  return log;
};

test('notification toggles: master switch and one per window', () => {
  let log = withDueCard(apply(emptyLog(), BLAKE_SETTINGS_EVENT));
  const day = (l: Log) => nudgesBetween(project(l), dayBegins('2026-11-02', BLAKE_SETTINGS.dayStart), dayBegins('2026-11-03', BLAKE_SETTINGS.dayStart)).map((n) => n.windowId);
  assert.deepEqual(day(log), ['morning', 'before-work', 'during-work', 'after-work']);

  log = apply(log, ok(toggleWindowNotify(project(log), 'during-work', false)));
  assert.deepEqual(day(log), ['morning', 'before-work', 'after-work']);
  assert.equal(project(log).settings.windows.find((w) => w.id === 'during-work')!.start, '13:00', 'window itself kept');

  log = apply(log, ok(toggleNotifications(project(log), false)));
  assert.deepEqual(day(log), []);
  log = apply(log, ok(toggleNotifications(project(log), true)));
  assert.deepEqual(day(log), ['morning', 'before-work', 'after-work'], 'per-window choice remembered');

  assert.equal(toggleWindowNotify(project(apply(emptyLog(), ok(settingsFromOnboarding({ timeZone: 'UTC', morning: '07:00' })))), 'after-work', true).ok, false);
});

test('a new user gets no notifications until they opt in', () => {
  const log = withDueCard(emptyLog());
  assert.deepEqual(nudgesBetween(project(log), Date.UTC(2026, 10, 2), Date.UTC(2026, 10, 3)), []);
});

test('the always-remind-morning switch is a normal settings edit', () => {
  let log = apply(emptyLog(), BLAKE_SETTINGS_EVENT);
  log = apply(log, ok(toggleAlwaysRemindMorning(project(log), false)));
  assert.equal(project(log).settings.alwaysRemindMorning, false);
  assert.deepEqual(project(log).settings.windows, BLAKE_SETTINGS.windows, 'nothing else changed');
  log = apply(log, ok(toggleAlwaysRemindMorning(project(log), true)));
  assert.equal(project(log).settings.alwaysRemindMorning, true);
});

test("settings never set: the device's time zone replaces the UTC default (the metronome was silenced through New York mornings)", () => {
  const fresh = project(emptyLog());
  const r = adoptDeviceTimeZone(fresh, 'America/New_York');
  assert.ok(r && r.ok);
  const lib = project(apply(emptyLog(), ok(r!)));
  assert.equal(lib.settings.dayStart.timeZone, 'America/New_York');
  assert.equal(lib.settings.dayStart.hour, DEFAULT_SETTINGS.dayStart.hour, 'only the zone changes');
  assert.deepEqual(lib.settings.quietHours, DEFAULT_SETTINGS.quietHours);
  assert.equal(adoptDeviceTimeZone(lib, 'Europe/London'), null, 'never again once settings are set');
});

test('time zone default: nothing to do for UTC devices, a bad zone, or settings already set', () => {
  const fresh = project(emptyLog());
  assert.equal(adoptDeviceTimeZone(fresh, 'UTC'), null);
  assert.equal(adoptDeviceTimeZone(fresh, ''), null);
  assert.equal(adoptDeviceTimeZone(fresh, 'Not/AZone'), null);
  const blake = project(apply(emptyLog(), BLAKE_SETTINGS_EVENT));
  assert.equal(adoptDeviceTimeZone(blake, 'Europe/London'), null, "Blake's own settings are never touched");
});
