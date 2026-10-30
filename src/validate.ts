/**
 * Strict validation for everything that enters the log, whether from this
 * device or from sync. Anything malformed is rejected, never "repaired":
 * unknown fields, wrong types, out-of-range numbers, oversized strings.
 * This is the gate that stops a broken module or a bad sync row from
 * corrupting the log.
 */
import {
  ACTIVE_BLOCK_KINDS,
  CARD_TAGS,
  DEFERRED_BLOCK_KINDS,
  EVENT_TYPES,
  RATINGS,
  SCHEMA_VERSION,
  WINDOW_IDS,
} from './model.ts';
import type { BlockKind, EngineEvent, EventBody } from './model.ts';

export type Validation<T> = { ok: true; value: T } | { ok: false; error: string };

const MAX_ID = 64;
const MAX_TEXT = 2_000;
const MAX_NOTE = 10_000;
const MAX_LIST = 5_000;
const MAX_DETAIL_KEYS = 32;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;
const BLOCK_KINDS: readonly BlockKind[] = [...ACTIVE_BLOCK_KINDS, ...DEFERRED_BLOCK_KINDS];

class Invalid extends Error {}

type Obj = Record<string, unknown>;

function fail(path: string, why: string): never {
  throw new Invalid(`${path}: ${why}`);
}

function obj(v: unknown, path: string, required: readonly string[], optional: readonly string[] = []): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object');
  const o = v as Obj;
  for (const k of Object.keys(o)) {
    if (!required.includes(k) && !optional.includes(k)) fail(`${path}.${k}`, 'unknown field');
  }
  for (const k of required) if (!(k in o)) fail(`${path}.${k}`, 'missing');
  return o;
}

function str(v: unknown, path: string, max = MAX_TEXT, min = 0): string {
  if (typeof v !== 'string') fail(path, 'must be a string');
  if (v.length < min) fail(path, `must be at least ${min} characters`);
  if (v.length > max) fail(path, `must be at most ${max} characters`);
  return v;
}

const id = (v: unknown, path: string) => str(v, path, MAX_ID, 1);

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'must be a finite number');
  if (v < min || v > max) fail(path, `must be between ${min} and ${max}`);
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  const n = num(v, path, min, max);
  if (!Number.isInteger(n)) fail(path, 'must be an integer');
  return n;
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'must be true or false');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) {
    fail(path, `must be one of ${allowed.join(', ')}`);
  }
  return v as T;
}

function list<T>(v: unknown, path: string, each: (x: unknown, p: string) => T, max = MAX_LIST): T[] {
  if (!Array.isArray(v)) fail(path, 'must be a list');
  if (v.length > max) fail(path, `must have at most ${max} entries`);
  return v.map((x, i) => each(x, `${path}[${i}]`));
}

function details(v: unknown, path: string): Record<string, string | number | boolean> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'must be an object');
  const entries = Object.entries(v as Obj);
  if (entries.length > MAX_DETAIL_KEYS) fail(path, `must have at most ${MAX_DETAIL_KEYS} keys`);
  const out: Record<string, string | number | boolean> = {};
  for (const [k, x] of entries) {
    str(k, `${path} key`, MAX_ID, 1);
    if (typeof x === 'string') out[k] = str(x, `${path}.${k}`);
    else if (typeof x === 'number') out[k] = num(x, `${path}.${k}`, -Number.MAX_VALUE, Number.MAX_VALUE);
    else if (typeof x === 'boolean') out[k] = x;
    else fail(`${path}.${k}`, 'must be a string, number or boolean');
  }
  return out;
}

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function date(v: unknown, path: string): string {
  const s = str(v, path, 10);
  if (!DATE.test(s)) fail(path, 'must be a date YYYY-MM-DD');
  return s;
}

function time(v: unknown, path: string): string {
  const s = str(v, path, 5);
  if (!TIME.test(s)) fail(path, 'must be a time HH:MM');
  return s;
}

const retention = (v: unknown, path: string) => num(v, path, 0.7, 0.99);
const duration = (v: unknown, path: string) => int(v, path, 0, MAX_DURATION_MS);

function item(v: unknown, p: string) {
  const o = obj(v, p, ['id', 'module', 'fields']);
  return { id: id(o.id, `${p}.id`), module: id(o.module, `${p}.module`), fields: details(o.fields, `${p}.fields`) };
}

function card(v: unknown, p: string) {
  const o = obj(v, p, ['id', 'itemId', 'template', 'tags', 'retired']);
  const tags = list(o.tags, `${p}.tags`, (x, q) => oneOf(x, q, CARD_TAGS), CARD_TAGS.length);
  if (tags.length === 0) fail(`${p}.tags`, 'needs at least one tag');
  if (new Set(tags).size !== tags.length) fail(`${p}.tags`, 'has duplicates');
  return {
    id: id(o.id, `${p}.id`),
    itemId: id(o.itemId, `${p}.itemId`),
    template: id(o.template, `${p}.template`),
    tags,
    retired: bool(o.retired, `${p}.retired`),
  };
}

function block(v: unknown, p: string) {
  const o = obj(v, p, ['id', 'kind', 'label', 'minutes'], ['params']);
  return {
    id: id(o.id, `${p}.id`),
    kind: oneOf(o.kind, `${p}.kind`, BLOCK_KINDS),
    label: str(o.label, `${p}.label`, 200, 1),
    minutes: int(o.minutes, `${p}.minutes`, 1, 600),
    ...(o.params === undefined ? {} : { params: details(o.params, `${p}.params`) }),
  };
}

function goal(v: unknown, p: string) {
  const o = obj(
    v,
    p,
    ['id', 'kind', 'what', 'why', 'deadline', 'itemIds', 'dailyMinutes', 'weight', 'blocks', 'archived'],
    ['targetRetention'],
  );
  const blocks = list(o.blocks, `${p}.blocks`, block, 50);
  if (new Set(blocks.map((b) => b.id)).size !== blocks.length) fail(`${p}.blocks`, 'block ids must be unique');
  return {
    id: id(o.id, `${p}.id`),
    kind: oneOf(o.kind, `${p}.kind`, ['general', 'gig'] as const),
    what: str(o.what, `${p}.what`, 500, 1),
    why: str(o.why, `${p}.why`, MAX_TEXT),
    deadline: date(o.deadline, `${p}.deadline`),
    itemIds: list(o.itemIds, `${p}.itemIds`, id),
    dailyMinutes: int(o.dailyMinutes, `${p}.dailyMinutes`, 0, 24 * 60),
    weight: num(o.weight, `${p}.weight`, 0.01, 100),
    ...(o.targetRetention === undefined ? {} : { targetRetention: retention(o.targetRetention, `${p}.targetRetention`) }),
    blocks,
    archived: bool(o.archived, `${p}.archived`),
  };
}

function timeZone(v: unknown, path: string): string {
  const s = str(v, path, 64, 1);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: s });
  } catch {
    fail(path, 'must be a known IANA time zone, e.g. America/New_York');
  }
  return s;
}

function dayStart(v: unknown, p: string) {
  const o = obj(v, p, ['timeZone', 'hour']);
  return { timeZone: timeZone(o.timeZone, `${p}.timeZone`), hour: int(o.hour, `${p}.hour`, 0, 23) };
}

function settings(v: unknown, p: string) {
  const o = obj(v, p, ['desiredRetention', 'windows'], ['dayStart']);
  const windows = list(
    o.windows,
    `${p}.windows`,
    (x, q) => {
      const w = obj(x, q, ['id', 'start']);
      return { id: oneOf(w.id, `${q}.id`, WINDOW_IDS), start: time(w.start, `${q}.start`) };
    },
    WINDOW_IDS.length,
  );
  if (new Set(windows.map((w) => w.id)).size !== windows.length) fail(`${p}.windows`, 'window ids must be unique');
  return {
    desiredRetention: retention(o.desiredRetention, `${p}.desiredRetention`),
    windows,
    ...(o.dayStart === undefined ? {} : { dayStart: dayStart(o.dayStart, `${p}.dayStart`) }),
  };
}

/** Validates an event body (no metadata). Returns a clean copy. */
function body(v: unknown, p: string): EventBody {
  if (typeof v !== 'object' || v === null) fail(p, 'must be an object');
  const type = oneOf((v as Obj).type, `${p}.type`, EVENT_TYPES);
  switch (type) {
    case 'item-set': {
      const o = obj(v, p, ['type', 'item']);
      return { type, item: item(o.item, `${p}.item`) };
    }
    case 'card-set': {
      const o = obj(v, p, ['type', 'card']);
      return { type, card: card(o.card, `${p}.card`) };
    }
    case 'goal-set': {
      const o = obj(v, p, ['type', 'goal']);
      return { type, goal: goal(o.goal, `${p}.goal`) };
    }
    case 'settings-set': {
      const o = obj(v, p, ['type', 'settings']);
      return { type, settings: settings(o.settings, `${p}.settings`) };
    }
    case 'review': {
      const o = obj(v, p, ['type', 'cardId', 'rating', 'durationMs'], ['details']);
      return {
        type,
        cardId: id(o.cardId, `${p}.cardId`),
        rating: oneOf(o.rating, `${p}.rating`, RATINGS),
        durationMs: duration(o.durationMs, `${p}.durationMs`),
        ...(o.details === undefined ? {} : { details: details(o.details, `${p}.details`) }),
      };
    }
    case 'feel-session': {
      const o = obj(v, p, ['type', 'durationMs', 'note'], ['goalId']);
      return {
        type,
        ...(o.goalId === undefined ? {} : { goalId: id(o.goalId, `${p}.goalId`) }),
        durationMs: duration(o.durationMs, `${p}.durationMs`),
        note: str(o.note, `${p}.note`, MAX_NOTE),
      };
    }
    case 'task-done': {
      const o = obj(v, p, ['type', 'goalId', 'blockId', 'durationMs']);
      return {
        type,
        goalId: id(o.goalId, `${p}.goalId`),
        blockId: id(o.blockId, `${p}.blockId`),
        durationMs: duration(o.durationMs, `${p}.durationMs`),
      };
    }
    case 'played': {
      const o = obj(v, p, ['type', 'minutes']);
      return { type, minutes: int(o.minutes, `${p}.minutes`, 1, 24 * 60) };
    }
  }
}

function run<T>(f: () => T): Validation<T> {
  try {
    return { ok: true, value: f() };
  } catch (e) {
    if (e instanceof Invalid) return { ok: false, error: e.message };
    throw e;
  }
}

/** Validates what a caller wants to record (no id, time or device yet). */
export function validateBody(v: unknown): Validation<EventBody> {
  return run(() => body(v, 'event'));
}

// Earliest plausible timestamp (2020-01-01) and a generous future bound.
const MIN_AT = Date.UTC(2020, 0, 1);
const MAX_AT = Date.UTC(2200, 0, 1);

/** Validates a complete stored event, e.g. one arriving from sync. */
export function validateEvent(v: unknown): Validation<EngineEvent> {
  return run(() => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) fail('event', 'must be an object');
    const { v: version, id: eid, at, device, ...rest } = v as Obj;
    if (version !== SCHEMA_VERSION) fail('event.v', `must be ${SCHEMA_VERSION}`);
    const meta = {
      v: SCHEMA_VERSION,
      id: id(eid, 'event.id'),
      at: int(at, 'event.at', MIN_AT, MAX_AT),
      device: id(device, 'event.device'),
    } as const;
    return { ...meta, ...body(rest, 'event') } as EngineEvent;
  });
}
