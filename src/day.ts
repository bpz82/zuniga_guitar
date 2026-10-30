/**
 * Practice days. A practice day runs from settings.dayStart (3:00am in
 * America/New_York for Blake) to the same time the next day, so practice
 * at 11pm and 2am counts as the same day. Uses only the built-in Intl API.
 */
import type { DayStart } from './model.ts';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (f === undefined) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** Local time minus UTC, in ms, at instant t (e.g. -4h for New York in summer). */
export function tzOffset(t: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const p of formatter(timeZone).formatToParts(new Date(t))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  const wall = Date.UTC(parts.year!, parts.month! - 1, parts.day!, parts.hour!, parts.minute!, parts.second!);
  return wall - Math.floor(t / 1000) * 1000;
}

/**
 * Moves an instant so that its UTC calendar date is its practice day.
 * The scheduler feeds these to FSRS, which counts days by UTC date.
 */
export function practiceClock(t: number, dayStart: DayStart): number {
  return t + tzOffset(t, dayStart.timeZone) - dayStart.hour * HOUR;
}

/** The practice day an instant falls in, as "YYYY-MM-DD". */
export function practiceDay(t: number, dayStart: DayStart): string {
  return new Date(practiceClock(t, dayStart)).toISOString().slice(0, 10);
}

/** The instant a practice day begins (e.g. 3:00am local on that date). */
export function dayBegins(date: string, dayStart: DayStart): number {
  const wall = Date.parse(`${date}T00:00:00Z`) + dayStart.hour * HOUR;
  let t = wall - tzOffset(wall, dayStart.timeZone);
  t = wall - tzOffset(t, dayStart.timeZone); // second pass settles DST edges
  return t;
}

/** Whole days from date a to date b ("YYYY-MM-DD"); negative if b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
}

export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
}

/**
 * The instant a local clock time ("HH:MM") happens within a practice day.
 * Times earlier than the day start (e.g. 01:30 with a 3:00 start) fall on the
 * next calendar date, because the practice day runs past midnight.
 */
export function timeOnDay(date: string, hhmm: string, dayStart: DayStart): number {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const calendar = hh < dayStart.hour ? addDays(date, 1) : date;
  const wall = Date.parse(`${calendar}T00:00:00Z`) + hh * HOUR + mm * 60_000;
  let t = wall - tzOffset(wall, dayStart.timeZone);
  t = wall - tzOffset(t, dayStart.timeZone);
  return t;
}

/** Local clock time of an instant as minutes after midnight (0 to 1439). */
export function minuteOfDay(t: number, timeZone: string): number {
  const local = t + tzOffset(t, timeZone);
  return Math.floor((((local % DAY) + DAY) % DAY) / 60_000);
}

/** "HH:MM" to minutes after midnight. */
export function minutesOf(hhmm: string): number {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  return hh * 60 + mm;
}
