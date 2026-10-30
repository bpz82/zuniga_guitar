/**
 * Browser storage for a replica: one IndexedDB database per signed-in user
 * ("zg-<userId>"), so two accounts on one device never share data. Every
 * save is a single transaction. Append only: there is no delete path.
 */
import type { EngineEvent } from '../model.ts';
import type { EventStore, StoreChange, StoredState } from '../replica.ts';

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
  });
}

export function databaseName(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('bad user id for local storage');
  return `zg-${userId}`;
}

export async function indexedDbStore(userId: string, factory: IDBFactory = indexedDB): Promise<EventStore> {
  const open = factory.open(databaseName(userId), 1);
  open.onupgradeneeded = () => {
    const db = open.result;
    db.createObjectStore('events', { keyPath: 'id' });
    db.createObjectStore('pending');
    db.createObjectStore('meta');
  };
  const db = await req(open);

  return {
    async load(): Promise<StoredState> {
      const tx = db.transaction(['events', 'pending', 'meta'], 'readonly');
      const [events, pending, cursor] = await Promise.all([
        req(tx.objectStore('events').getAll()),
        req(tx.objectStore('pending').getAllKeys()),
        req(tx.objectStore('meta').get('cursor')),
      ]);
      return { events, pending: pending.map(String), cursor: typeof cursor === 'number' ? cursor : 0 };
    },
    async save(change: StoreChange): Promise<void> {
      const tx = db.transaction(['events', 'pending', 'meta'], 'readwrite');
      const events = tx.objectStore('events');
      const pending = tx.objectStore('pending');
      // add(), not put(): an existing event is never overwritten.
      for (const e of change.add as EngineEvent[]) {
        const r = events.add(e);
        r.onerror = (ev) => {
          if (r.error?.name === 'ConstraintError') ev.preventDefault();
        };
      }
      for (const id of change.pendingAdd) pending.put(true, id);
      for (const id of change.pendingRemove) pending.delete(id);
      if (change.cursor !== undefined) tx.objectStore('meta').put(change.cursor, 'cursor');
      await done(tx);
    },
  };
}
