/**
 * Supabase Storage adapter for takes: a private bucket ("takes"), one folder
 * per user. Row-level security on the server allows a user to add and read
 * files in their own folder only, and nobody to overwrite or delete
 * (supabase/migrations/20261031180000_takes_storage.sql). The app passes its
 * supabase-js client; only the calls typed here are used.
 */
export const TAKES_BUCKET = 'takes';

export interface TakeStorage {
  /** "exists" when the file is already there (an earlier upload got through). */
  upload(path: string, blob: Blob, type: string): Promise<'uploaded' | 'exists'>;
  download(path: string): Promise<Blob>;
}

type R<T> = PromiseLike<{ data: T | null; error: { message: string; statusCode?: string | number } | null }>;

export interface StorageClientLike {
  storage: {
    from(bucket: string): {
      upload(path: string, body: Blob, options: { contentType: string; upsert: false }): R<unknown>;
      download(path: string): R<Blob>;
    };
  };
}

const alreadyThere = (e: { message: string; statusCode?: string | number }) =>
  String(e.statusCode) === '409' || /already exists|duplicate/i.test(e.message);

export function supabaseTakeStorage(client: StorageClientLike): TakeStorage {
  const bucket = () => client.storage.from(TAKES_BUCKET);
  return {
    async upload(path, blob, type) {
      // upsert: false — the bucket allows adding, never overwriting.
      const { error } = await bucket().upload(path, blob, { contentType: type, upsert: false });
      if (!error) return 'uploaded';
      if (alreadyThere(error)) return 'exists';
      throw new Error(`Storage: ${error.message}`);
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) throw new Error(`Storage: ${error?.message ?? 'no data'}`);
      return data;
    },
  };
}
