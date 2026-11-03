/**
 * A replica is one user's log on one device: the in-memory log, saved to a
 * local store (offline first) and synced with the server. One replica per
 * signed-in user; stores are named per user, so accounts never mix.
 *
 * Writes go through record() only (append + save + mark for upload). Sync
 * pushes pending events, then pulls everything new; both sides are append
 * only, so a sync is a set union and can be retried at any time.
 *
 * Band members (Blake, 2026-11-03): a replica can also carry a read-only
 * shared layer, someone else's events this user may see (a band member's
 * copy of his owner's songs). It is kept in its own local store, pulled
 * with its own cursor, filtered by `accept`, never recorded to and never
 * uploaded. The library is projected from both; the log, export and upload
 * are this user's own events only. `writable` limits which event types this
 * user may record at all (a band member: ratings and his own settings).
 */
import { append, compareEvents, emptyLog, merge, RejectedEvent } from './log.ts';
import type { Log, Rejection } from './log.ts';
import { project } from './project.ts';
import type { Library } from './project.ts';
import type { EngineEvent, EventType } from './model.ts';

/** What a store holds: raw events (validated on load), upload queue, sync cursor. */
export interface StoredState {
  readonly events: readonly unknown[];
  readonly pending: readonly string[];
  readonly cursor: number;
}

/** One atomic save. */
export interface StoreChange {
  readonly add: readonly EngineEvent[];
  readonly pendingAdd: readonly string[];
  readonly pendingRemove: readonly string[];
  readonly cursor?: number;
}

/** Local persistence (IndexedDB in the browser, memory in tests). Append only. */
export interface EventStore {
  load(): Promise<StoredState>;
  save(change: StoreChange): Promise<void>;
}

/** The server side of sync. */
export interface Remote {
  /** Uploads events. Re-sending an event the server already has is a no-op. */
  push(events: readonly EngineEvent[]): Promise<void>;
  /** Events the server stored after `afterSeq`, oldest first, at most `limit`. */
  pull(afterSeq: number, limit: number): Promise<readonly { seq: number; event: unknown }[]>;
}

/** Someone else's events this user may read (see the top of this file). */
export interface SharedLayer {
  /** Where they are kept on this device: a store of their own, never uploaded. */
  readonly store: EventStore;
  /** Which events may be kept. Anything else the server sends is set aside and reported. */
  accept(event: EngineEvent): boolean;
}

export interface ReplicaOptions {
  readonly now?: () => number;
  /** Event types this user may record (and restore). Absent: every type. */
  readonly writable?: readonly EventType[];
  readonly shared?: SharedLayer;
}

export interface SyncReport {
  readonly pushed: number;
  readonly pulled: number;
  /** Server rows that failed validation. Reported, never stored. */
  readonly rejected: readonly Rejection[];
}

export class Replica {
  #log: Log;
  #library: Library | null = null;
  #pending: Set<string>;
  #cursor: number;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #store: EventStore;
  readonly #device: string;
  readonly #now: () => number;
  readonly #writable: ReadonlySet<string> | null;
  readonly #sharedLayer: SharedLayer | null;
  #shared: Log = emptyLog();
  #sharedCursor = 0;
  /** Stored events that failed validation on load (corruption). Never used. */
  readonly loadRejected: readonly Rejection[];

  private constructor(store: EventStore, device: string, state: StoredState, options: ReplicaOptions, shared: StoredState | null) {
    this.#store = store;
    this.#device = device;
    this.#now = options.now ?? Date.now;
    this.#writable = options.writable ? new Set(options.writable) : null;
    this.#sharedLayer = options.shared ?? null;
    const { log, rejected } = merge(emptyLog(), state.events);
    this.#log = log;
    const ids = new Set(log.map((e) => e.id));
    this.#pending = new Set(state.pending.filter((id) => ids.has(id)));
    this.#cursor = state.cursor;
    const all = [...rejected];
    if (shared && this.#sharedLayer) {
      const kept = this.#acceptShared(shared.events);
      this.#shared = kept.log;
      this.#sharedCursor = shared.cursor;
      all.push(...kept.rejected);
    }
    this.loadRejected = all;
  }

  static async open(store: EventStore, device: string, options: ReplicaOptions = {}): Promise<Replica> {
    const shared = options.shared ? await options.shared.store.load() : null;
    return new Replica(store, device, await store.load(), options, shared);
  }

  /** This user's own events. */
  get log(): Log {
    return this.#log;
  }

  /** The read-only shared events (empty without a shared layer). */
  get sharedLog(): Log {
    return this.#shared;
  }

  /** The projected library (own events and shared ones), recomputed only after either changes. */
  get library(): Library {
    this.#library ??= project(this.#shared.length === 0 ? this.#log : interleave(this.#log, this.#shared));
    return this.#library;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Records one event: validated, saved locally, queued for upload. Throws RejectedEvent if invalid. */
  record(body: unknown): Promise<EngineEvent> {
    return this.#serial(async () => {
      const refused = this.#refuses(body);
      if (refused) throw new RejectedEvent(refused);
      const { log, event } = append(this.#log, body, { device: this.#device, now: this.#now });
      await this.#store.save({ add: [event], pendingAdd: [event.id], pendingRemove: [] });
      this.#set(log);
      this.#pending.add(event.id);
      return event;
    });
  }

  /**
   * Restores events from a backup (an exported log). Each is validated;
   * ones already present are skipped; new ones are saved and queued for
   * upload. Nothing existing is ever replaced.
   */
  restore(events: readonly unknown[]): Promise<{ added: number; rejected: readonly Rejection[] }> {
    return this.#serial(async () => {
      const known = new Set(this.#log.map((e) => e.id));
      const refused: Rejection[] = [];
      const allowed = events.filter((raw) => {
        const reason = this.#refuses(raw);
        if (reason) refused.push({ event: raw, reason });
        return !reason;
      });
      const result = merge(this.#log, allowed);
      const added = result.log.filter((e) => !known.has(e.id));
      await this.#store.save({ add: added, pendingAdd: added.map((e) => e.id), pendingRemove: [] });
      this.#set(result.log);
      for (const e of added) this.#pending.add(e.id);
      return { added: added.length, rejected: [...refused, ...result.rejected] };
    });
  }

  /** The whole log as JSON, for backup or moving to another account. */
  exportJson(): string {
    return JSON.stringify({ format: 'zuniga-guitar-log', version: 1, events: this.#log });
  }

  /**
   * Pushes pending events, then pulls new ones. Safe to retry after any
   * failure. With `writable` set, a queued event of another type (recorded
   * on this device before it knew the account's role) is never sent: the
   * server would refuse it and hold up every upload after it. It leaves the
   * queue, stays on this device, and is reported.
   */
  sync(remote: Remote, batch = 500): Promise<SyncReport> {
    return this.#serial(async () => {
      let pushed = 0;
      const rejected: Rejection[] = [];
      while (this.#pending.size > 0) {
        const ids = [...this.#pending].slice(0, batch);
        const byId = new Map(this.#log.map((e) => [e.id, e]));
        const events = ids.map((id) => byId.get(id)!);
        const send = events.filter((e) => !this.#refuses(e));
        for (const e of events) if (this.#refuses(e)) rejected.push({ event: e, reason: 'not uploaded: this account can not hold it (kept on this device)' });
        if (send.length > 0) await remote.push(send);
        await this.#store.save({ add: [], pendingAdd: [], pendingRemove: ids });
        for (const id of ids) this.#pending.delete(id);
        pushed += send.length;
      }
      let pulled = 0;
      for (;;) {
        const rows = await remote.pull(this.#cursor, batch);
        if (rows.length === 0) break;
        // A server that doesn't move forward (bug or tampering) must not hang the app.
        if (!rows.some((r) => Number.isFinite(r.seq) && r.seq > this.#cursor)) break;
        const known = new Set(this.#log.map((e) => e.id));
        const result = merge(this.#log, rows.map((r) => r.event));
        const added = result.log.filter((e) => !known.has(e.id));
        const cursor = Math.max(this.#cursor, ...rows.map((r) => r.seq));
        await this.#store.save({ add: added, pendingAdd: [], pendingRemove: [], cursor });
        this.#set(result.log);
        this.#cursor = cursor;
        pulled += added.length;
        rejected.push(...result.rejected);
        if (rows.length < batch) break;
      }
      return { pushed, pulled, rejected };
    });
  }

  /**
   * Pulls the shared layer's new events (never pushes: they are not this
   * user's). Each is validated and must pass `accept`; anything else is
   * reported and never stored. Safe to retry after any failure.
   */
  syncShared(remote: Remote, batch = 500): Promise<SyncReport> {
    return this.#serial(async () => {
      const layer = this.#sharedLayer;
      if (!layer) return { pushed: 0, pulled: 0, rejected: [] };
      let pulled = 0;
      const rejected: Rejection[] = [];
      for (;;) {
        const rows = await remote.pull(this.#sharedCursor, batch);
        if (rows.length === 0) break;
        if (!rows.some((r) => Number.isFinite(r.seq) && r.seq > this.#sharedCursor)) break;
        const known = new Set(this.#shared.map((e) => e.id));
        const kept = this.#acceptShared(rows.map((r) => r.event), this.#shared);
        const added = kept.log.filter((e) => !known.has(e.id));
        const cursor = Math.max(this.#sharedCursor, ...rows.map((r) => r.seq));
        await layer.store.save({ add: added, pendingAdd: [], pendingRemove: [], cursor });
        this.#shared = kept.log;
        this.#library = null;
        this.#sharedCursor = cursor;
        pulled += added.length;
        rejected.push(...kept.rejected);
        if (rows.length < batch) break;
      }
      return { pushed: 0, pulled, rejected };
    });
  }

  /** Why this user may not record an event of this type, or null if they may. */
  #refuses(body: unknown): string | null {
    if (!this.#writable) return null;
    const type = typeof body === 'object' && body !== null ? (body as { type?: unknown }).type : undefined;
    return typeof type === 'string' && this.#writable.has(type) ? null : `this account can only record ${[...this.#writable].join(' and ')} events`;
  }

  /** Validates incoming shared events and keeps the ones the layer accepts. */
  #acceptShared(incoming: readonly unknown[], into: Log = emptyLog()): { log: Log; rejected: Rejection[] } {
    const checked = merge(emptyLog(), incoming);
    const rejected = [...checked.rejected];
    const ok = checked.log.filter((e) => {
      const keep = this.#sharedLayer!.accept(e);
      if (!keep) rejected.push({ event: e, reason: 'not shared with this account' });
      return keep;
    });
    const result = merge(into, ok);
    return { log: result.log, rejected: [...rejected, ...result.rejected] };
  }

  #set(log: Log) {
    this.#log = log;
    this.#library = null;
  }

  /** One operation at a time, so record() during a sync can't interleave. */
  #serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#queue.then(fn, fn);
    this.#queue = run.catch(() => undefined);
    return run;
  }
}

/**
 * Own events and shared ones in canonical order, for projecting. Both are
 * already validated and sorted. A shared event never replaces one of this
 * user's own (an id clash is only possible with forged data).
 */
function interleave(own: Log, shared: Log): Log {
  const ids = new Set(own.map((e) => e.id));
  const other = shared.filter((e) => !ids.has(e.id));
  const out: EngineEvent[] = [];
  let i = 0;
  let j = 0;
  while (i < own.length || j < other.length) {
    if (j >= other.length || (i < own.length && compareEvents(own[i]!, other[j]!) <= 0)) out.push(own[i++]!);
    else out.push(other[j++]!);
  }
  return Object.freeze(out);
}

/** A store kept in memory: for tests and for trying the app without saving. */
export function memoryStore(initial: Partial<StoredState> = {}): EventStore & { readonly state: StoredState } {
  let events = [...(initial.events ?? [])];
  let pending = new Set(initial.pending ?? []);
  let cursor = initial.cursor ?? 0;
  return {
    get state() {
      return { events, pending: [...pending], cursor };
    },
    async load() {
      return { events: [...events], pending: [...pending], cursor };
    },
    async save(change) {
      const ids = new Set(events.map((e) => (e as { id: string }).id));
      events = [...events, ...change.add.filter((e) => !ids.has(e.id))];
      for (const id of change.pendingAdd) pending.add(id);
      for (const id of change.pendingRemove) pending.delete(id);
      if (change.cursor !== undefined) cursor = change.cursor;
    },
  };
}
