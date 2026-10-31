/**
 * Recorder as an engine module (contract v1). A take is one module item:
 * its fields hold the metadata (title, time, length, type, size, prompt,
 * uploaded, archived); the audio lives in the device's blob store and, once
 * uploaded, in the user's private storage folder. Takes have no cards: they
 * are recordings, not things to schedule.
 *
 * Rename, archive and restore are new item-set events (the log keeps every
 * version). There is no hard delete, locally or on the server.
 *
 * Order matters for safety: audio is saved on the device before the take is
 * logged, so a logged take is never missing its audio on the device that
 * recorded it; and a take is marked uploaded only after the upload succeeded.
 */
import type { ModuleHost, ModuleManifest } from '../../contract.ts';
import type { Details } from '../../model.ts';
import type { Validation } from '../../validate.ts';
import type { BlobStore } from './blobs.ts';
import { baseType, checkTake, cleanTitle, isTakeKey, MAX_UPLOAD_BYTES, storagePath } from './core.ts';
import type { TakeMeta } from './core.ts';
import type { TakeStorage } from './storage.ts';

export const RECORDER: ModuleManifest = Object.freeze({ id: 'recorder', contract: 1, templates: Object.freeze([]) });

export interface Take extends TakeMeta {
  readonly takeId: string;
  readonly uploaded: boolean;
  readonly archived: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function parse(id: string, f: Details): Take | null {
  if (f.kind !== 'take') return null;
  const title = str(f.title), type = str(f.type);
  const recordedAt = num(f.recordedAt), durationMs = num(f.durationMs), bytes = num(f.bytes);
  if (title === undefined || type === undefined || recordedAt === undefined || durationMs === undefined || bytes === undefined) return null;
  const opt = <K extends string>(k: K, v: string | number | undefined) => (v === undefined ? {} : { [k]: v });
  return {
    takeId: id,
    title,
    type,
    recordedAt,
    durationMs,
    bytes,
    uploaded: f.uploaded === true,
    archived: f.archived === true,
    ...opt('prompt', str(f.prompt)),
    ...opt('runId', str(f.runId)),
    ...opt('index', num(f.index)),
    ...opt('of', num(f.of)),
    ...opt('goalId', str(f.goalId)),
    ...opt('blockId', str(f.blockId)),
  } as Take;
}

function fieldsOf(t: Take): Details {
  const { takeId: _, ...rest } = t;
  const out: Record<string, string | number | boolean> = { kind: 'take' };
  for (const [k, v] of Object.entries(rest)) if (v !== undefined) out[k] = v as string | number | boolean;
  return out;
}

/** Every take, newest first. Archived ones included (check `archived`). */
export function takes(host: ModuleHost): Take[] {
  return host
    .items()
    .flatMap((i) => {
      const t = parse(i.id, i.fields);
      return t ? [t] : [];
    })
    .sort((a, b) => b.recordedAt - a.recordedAt || (a.takeId < b.takeId ? -1 : 1));
}

export function takeById(host: ModuleHost, takeId: string): Take | undefined {
  return takes(host).find((t) => t.takeId === takeId);
}

/**
 * Keeps a new recording. `key` must be unique (the app passes a UUID). The
 * audio is saved on this device first, then the take is logged; it uploads
 * on the next sync.
 */
export async function saveTake(
  host: ModuleHost,
  blobs: BlobStore,
  key: string,
  meta: Omit<TakeMeta, 'bytes'>,
  audio: Blob,
): Promise<Validation<Take>> {
  if (!isTakeKey(key)) return { ok: false, error: 'take id: letters, digits and - only (at most 40)' };
  const takeId = `take-${key}`;
  if (host.items().some((i) => i.id === takeId)) return { ok: false, error: `take ${key} already exists` };
  const checked = checkTake({ ...meta, bytes: audio.size });
  if (!checked.ok) return checked;
  await blobs.put(takeId, { blob: audio, type: checked.value.type });
  const take: Take = { ...checked.value, takeId, uploaded: false, archived: false };
  await host.addItem(takeId, fieldsOf(take));
  return { ok: true, value: take };
}

async function update(host: ModuleHost, takeId: string, change: (t: Take) => Validation<Take>): Promise<Validation<Take>> {
  const t = takeById(host, takeId);
  if (!t) return { ok: false, error: `no take ${takeId}` };
  const next = change(t);
  if (!next.ok) return next;
  if (JSON.stringify(fieldsOf(next.value)) !== JSON.stringify(fieldsOf(t))) await host.addItem(takeId, fieldsOf(next.value));
  return next;
}

export function renameTake(host: ModuleHost, takeId: string, title: string): Promise<Validation<Take>> {
  return update(host, takeId, (t) => {
    const c = cleanTitle(title);
    return c.ok ? { ok: true, value: { ...t, title: c.value } } : c;
  });
}

/** Hides a take from the list. Its audio is kept, here and in storage. */
export function archiveTake(host: ModuleHost, takeId: string): Promise<Validation<Take>> {
  return update(host, takeId, (t) => ({ ok: true, value: { ...t, archived: true } }));
}

export function restoreTake(host: ModuleHost, takeId: string): Promise<Validation<Take>> {
  return update(host, takeId, (t) => ({ ok: true, value: { ...t, archived: false } }));
}

export interface UploadReport {
  readonly uploaded: number;
  /** Not recorded on this device: the device that recorded it uploads it. */
  readonly elsewhere: number;
  readonly failed: readonly { readonly takeId: string; readonly error: string }[];
}

/**
 * Uploads every take recorded here that is not in storage yet, oldest first.
 * Safe to retry: a file that already made it is detected and the take is
 * marked uploaded. A failure leaves the take queued for the next sync.
 */
export async function uploadPending(host: ModuleHost, blobs: BlobStore, storage: TakeStorage, userId: string): Promise<UploadReport> {
  let uploaded = 0;
  let elsewhere = 0;
  const failed: { takeId: string; error: string }[] = [];
  for (const t of takes(host).filter((x) => !x.uploaded).reverse()) {
    const audio = await blobs.get(t.takeId);
    if (!audio) {
      elsewhere++;
      continue;
    }
    if (audio.blob.size > MAX_UPLOAD_BYTES) {
      failed.push({ takeId: t.takeId, error: 'too large to upload; kept on this device' });
      continue;
    }
    try {
      await storage.upload(storagePath(userId, t.takeId, t.type), audio.blob, baseType(t.type)!);
    } catch (e) {
      failed.push({ takeId: t.takeId, error: (e as Error).message });
      continue;
    }
    await update(host, t.takeId, (x) => ({ ok: true, value: { ...x, uploaded: true } }));
    uploaded++;
  }
  return { uploaded, elsewhere, failed };
}

/**
 * The audio of a take: from this device if it is here, otherwise downloaded
 * from storage (then kept here for next time). Errors if neither is possible.
 */
export async function audioOf(host: ModuleHost, blobs: BlobStore, takeId: string, cloud: { storage: TakeStorage; userId: string } | null): Promise<Validation<Blob>> {
  const t = takeById(host, takeId);
  if (!t) return { ok: false, error: `no take ${takeId}` };
  const local = await blobs.get(takeId);
  if (local) return { ok: true, value: local.blob };
  if (!t.uploaded) return { ok: false, error: 'recorded on another device and not uploaded yet' };
  if (!cloud) return { ok: false, error: 'sign in to play takes from your other devices' };
  try {
    const blob = await cloud.storage.download(storagePath(cloud.userId, takeId, t.type));
    await blobs.put(takeId, { blob, type: t.type });
    return { ok: true, value: blob };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Takes saved so far for one improv run. */
export function runTakes(host: ModuleHost, runId: string): Take[] {
  return takes(host).filter((t) => t.runId === runId).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
}
