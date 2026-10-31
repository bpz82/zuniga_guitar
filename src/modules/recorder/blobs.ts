/**
 * Where the audio itself lives on this device. Takes' metadata goes in the
 * log (small JSON); the audio goes here, one record per take, until and after
 * it is uploaded (so takes play offline). One database per user
 * ("zg-takes-<userId>"), separate from the log's database so its schema never
 * changes. No delete path: archiving a take keeps its audio.
 */
export interface StoredBlob {
  readonly blob: Blob;
  readonly type: string;
}

export interface BlobStore {
  /** Saves audio for a take. Never overwrites: a second put for the same take is ignored. */
  put(takeId: string, value: StoredBlob): Promise<void>;
  get(takeId: string): Promise<StoredBlob | undefined>;
  has(takeId: string): Promise<boolean>;
}

export function memoryBlobStore(): BlobStore & { readonly size: number } {
  const m = new Map<string, StoredBlob>();
  return {
    get size() {
      return m.size;
    },
    async put(id, v) {
      if (!m.has(id)) m.set(id, v);
    },
    async get(id) {
      return m.get(id);
    },
    async has(id) {
      return m.has(id);
    },
  };
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

export function blobDatabaseName(userId: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(userId)) throw new Error('bad user id for local storage');
  return `zg-takes-${userId}`;
}

export async function indexedDbBlobStore(userId: string, factory: IDBFactory = indexedDB): Promise<BlobStore> {
  const open = factory.open(blobDatabaseName(userId), 1);
  open.onupgradeneeded = () => open.result.createObjectStore('takes');
  const db = await req(open);
  return {
    async put(id, v) {
      const tx = db.transaction('takes', 'readwrite');
      const r = tx.objectStore('takes').add(v, id); // add(): never overwrite
      r.onerror = (ev) => {
        if (r.error?.name === 'ConstraintError') ev.preventDefault();
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
      });
    },
    async get(id) {
      return (await req(db.transaction('takes').objectStore('takes').get(id))) as StoredBlob | undefined;
    },
    async has(id) {
      return (await req(db.transaction('takes').objectStore('takes').count(id))) > 0;
    },
  };
}
