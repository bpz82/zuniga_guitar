/**
 * A replica is one user's log on one device: the in-memory log, saved to a
 * local store (offline first) and synced with the server. One replica per
 * signed-in user; stores are named per user, so accounts never mix.
 *
 * Writes go through record() only (append + save + mark for upload). Sync
 * pushes pending events, then pulls everything new; both sides are append
 * only, so a sync is a set union and can be retried at any time.
 */
import { append, emptyLog, merge } from './log.ts';
import type { Log, Rejection } from './log.ts';
import { project } from './project.ts';
import type { Library } from './project.ts';
import type { EngineEvent } from './model.ts';

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
  /** Stored events that failed validation on load (corruption). Never used. */
  readonly loadRejected: readonly Rejection[];

  private constructor(store: EventStore, device: string, state: StoredState, now: () => number) {
    this.#store = store;
    this.#device = device;
    this.#now = now;
    const { log, rejected } = merge(emptyLog(), state.events);
    this.#log = log;
    this.loadRejected = rejected;
    const ids = new Set(log.map((e) => e.id));
    this.#pending = new Set(state.pending.filter((id) => ids.has(id)));
    this.#cursor = state.cursor;
  }

  static async open(store: EventStore, device: string, options: { now?: () => number } = {}): Promise<Replica> {
    return new Replica(store, device, await store.load(), options.now ?? Date.now);
  }

  get log(): Log {
    return this.#log;
  }

  /** The projected library, recomputed only after the log changes. */
  get library(): Library {
    this.#library ??= project(this.#log);
    return this.#library;
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** Records one event: validated, saved locally, queued for upload. Throws RejectedEvent if invalid. */
  record(body: unknown): Promise<EngineEvent> {
    return this.#serial(async () => {
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
      const result = merge(this.#log, events);
      const added = result.log.filter((e) => !known.has(e.id));
      await this.#store.save({ add: added, pendingAdd: added.map((e) => e.id), pendingRemove: [] });
      this.#set(result.log);
      for (const e of added) this.#pending.add(e.id);
      return { added: added.length, rejected: result.rejected };
    });
  }

  /** The whole log as JSON, for backup or moving to another account. */
  exportJson(): string {
    return JSON.stringify({ format: 'zuniga-guitar-log', version: 1, events: this.#log });
  }

  /** Pushes pending events, then pulls new ones. Safe to retry after any failure. */
  sync(remote: Remote, batch = 500): Promise<SyncReport> {
    return this.#serial(async () => {
      let pushed = 0;
      while (this.#pending.size > 0) {
        const ids = [...this.#pending].slice(0, batch);
        const byId = new Map(this.#log.map((e) => [e.id, e]));
        await remote.push(ids.map((id) => byId.get(id)!));
        await this.#store.save({ add: [], pendingAdd: [], pendingRemove: ids });
        for (const id of ids) this.#pending.delete(id);
        pushed += ids.length;
      }
      let pulled = 0;
      const rejected: Rejection[] = [];
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
