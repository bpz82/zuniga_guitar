/**
 * The append-only event log.
 *
 * A Log is an immutable, sorted, deep-frozen list of validated events.
 * There is deliberately no update or delete function anywhere in the engine:
 * the only ways in are append() (validated, engine-stamped) and merge()
 * (validated, union by id). Every event handed out is frozen, so no caller,
 * including a module, can alter history in memory.
 */
import { validateBody, validateEvent } from './validate.ts';
import { SCHEMA_VERSION } from './model.ts';
import type { EngineEvent } from './model.ts';

export type Log = readonly EngineEvent[];

export interface AppendContext {
  /** Stable id for this device. */
  readonly device: string;
  /** Clock, injectable for tests. Defaults to Date.now. */
  readonly now?: () => number;
  /** Id generator, injectable for tests. Defaults to crypto.randomUUID. */
  readonly newId?: () => string;
}

export class RejectedEvent extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`Event rejected: ${reason}`);
    this.name = 'RejectedEvent';
    this.reason = reason;
  }
}

/** A remote event merge() refused, and why. Nothing is silently dropped. */
export interface Rejection {
  readonly event: unknown;
  readonly reason: string;
}

const EMPTY: Log = Object.freeze([]);

export function emptyLog(): Log {
  return EMPTY;
}

/** Canonical order: time, then id. Total and identical on every device. */
export function compareEvents(a: EngineEvent, b: EngineEvent): number {
  return a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Records a new event. Throws RejectedEvent if the body is invalid. */
export function append(log: Log, body: unknown, ctx: AppendContext): { log: Log; event: EngineEvent } {
  const checked = validateBody(body);
  if (!checked.ok) throw new RejectedEvent(checked.error);
  const candidate = {
    v: SCHEMA_VERSION,
    id: (ctx.newId ?? (() => crypto.randomUUID()))(),
    at: stamp(log, ctx.device, (ctx.now ?? Date.now)()),
    device: ctx.device,
    ...checked.value,
  };
  // Re-validate the stamped event so bad metadata (clock, device) can't slip in.
  const full = validateEvent(candidate);
  if (!full.ok) throw new RejectedEvent(full.error);
  const event = deepFreeze(full.value);
  if (log.some((e) => e.id === event.id)) throw new RejectedEvent(`duplicate id ${event.id}`);
  return { log: insertSorted(log, event), event };
}

/**
 * Merges incoming events (e.g. from sync) into a log.
 * - Union by id; duplicates collapse.
 * - Invalid incoming events are rejected and reported, never stored.
 * - An event already in the log is never replaced. A different event that
 *   claims an existing id (only possible with corrupt or forged data, since
 *   ids are UUIDs) is rejected and reported for a human to look at.
 */
export function merge(log: Log, incoming: readonly unknown[]): { log: Log; rejected: Rejection[] } {
  const byId = new Map<string, EngineEvent>(log.map((e) => [e.id, e]));
  const rejected: Rejection[] = [];
  for (const raw of incoming) {
    const checked = validateEvent(raw);
    if (!checked.ok) {
      rejected.push({ event: raw, reason: checked.error });
      continue;
    }
    const event = checked.value;
    const existing = byId.get(event.id);
    if (existing === undefined) {
      byId.set(event.id, deepFreeze(event));
      continue;
    }
    if (canonical(existing) === canonical(event)) continue;
    rejected.push({ event: raw, reason: `id conflict on ${event.id}: existing event kept, incoming rejected` });
  }
  const events = [...byId.values()].sort(compareEvents);
  return { log: Object.freeze(events), rejected };
}

/** Folds the log in canonical order. The only way state is derived. */
export function replay<S>(log: Log, reducer: (state: S, event: EngineEvent) => S, initial: S): S {
  let state = initial;
  for (const event of log) state = reducer(state, event);
  return state;
}

/** Stable JSON with sorted keys: equal content gives an equal string. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * A device's events must sort in the order it recorded them, or "latest
 * wins" could pick an older setting: two saves in the same millisecond, or a
 * clock that steps backwards. So a new event is stamped at least 1ms after
 * this device's previous event. Other devices' clocks are not touched.
 */
function stamp(log: Log, device: string, clock: number): number {
  for (let i = log.length - 1; i >= 0; i--) {
    const e = log[i]!;
    if (e.device === device) return Number.isFinite(clock) ? Math.max(clock, e.at + 1) : clock;
  }
  return clock;
}

function insertSorted(log: Log, event: EngineEvent): Log {
  // Usually the newest event goes last; scan back from the end.
  let i = log.length;
  while (i > 0 && compareEvents(log[i - 1]!, event) > 0) i--;
  return Object.freeze([...log.slice(0, i), event, ...log.slice(i)]);
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}
