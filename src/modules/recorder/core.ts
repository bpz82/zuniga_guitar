/**
 * Recorder, pure core (Blake, 2026-10-31): audio formats, take metadata
 * checks, storage paths, and timed improv prompts ("improvise 3 songs, a
 * 5-minute window each, saved separately"). No browser APIs here.
 */
import type { Validation } from '../../validate.ts';

// ------------------------------------------------------------- formats ---

/**
 * Formats MediaRecorder may produce, in preference order: Chrome/Firefox
 * record Opus in WebM; Safari (iPhone) records AAC in MP4.
 */
export const RECORD_FORMATS: readonly string[] = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];

/** Stored types (no codec parameters) and the file extension each is uploaded with. */
export const AUDIO_TYPES: Readonly<Record<string, string>> = {
  'audio/webm': 'webm',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/aac': 'aac',
};

/** The first format this browser can record, or null (no recording possible). */
export function pickFormat(isSupported: (type: string) => boolean): string | null {
  return RECORD_FORMATS.find((t) => isSupported(t)) ?? null;
}

/** "audio/webm;codecs=opus" -> "audio/webm". Null if not an audio type we store. */
export function baseType(mime: string): string | null {
  const base = String(mime).split(';')[0]!.trim().toLowerCase();
  return base in AUDIO_TYPES ? base : null;
}

// --------------------------------------------------------------- limits ---

/** Longest single take. Keeps every take well inside the bucket's file size limit. */
export const MAX_TAKE_MS = 30 * 60 * 1000;
/** The storage bucket's per-file limit (the migration sets the same number). */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
/** A shorter take is a stray tap, not a recording: not saved. */
export const MIN_TAKE_MS = 1000;
export const MAX_TITLE = 200;

// ----------------------------------------------------------------- takes ---

/** What a saved take records about itself (stored as a module item's fields). */
export interface TakeMeta {
  readonly title: string;
  /** Epoch ms when recording started. */
  readonly recordedAt: number;
  readonly durationMs: number;
  /** Base audio type, e.g. "audio/webm". */
  readonly type: string;
  readonly bytes: number;
  /** Set when the take came from an improv prompt or a goal block. */
  readonly prompt?: string;
  readonly runId?: string;
  readonly index?: number;
  readonly of?: number;
  readonly goalId?: string;
  readonly blockId?: string;
}

const CONTROL = /[\u0000-\u001f\u007f]/;
const ID = /^[A-Za-z0-9-]{1,40}$/;

export function cleanTitle(raw: unknown): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'title must be text' };
  const t = raw.replace(/[ \t]+/g, ' ').trim();
  if (t.length === 0) return { ok: false, error: 'title is empty' };
  if (t.length > MAX_TITLE) return { ok: false, error: `title is longer than ${MAX_TITLE} characters` };
  if (CONTROL.test(t)) return { ok: false, error: 'title has a line break or control character' };
  return { ok: true, value: t };
}

/** Checks everything about a new take before anything is stored. */
export function checkTake(m: TakeMeta): Validation<TakeMeta> {
  const title = cleanTitle(m.title);
  if (!title.ok) return title;
  if (!Number.isInteger(m.recordedAt) || m.recordedAt < Date.UTC(2020, 0, 1)) return { ok: false, error: 'recordedAt must be a time' };
  if (!Number.isInteger(m.durationMs) || m.durationMs < MIN_TAKE_MS) return { ok: false, error: 'take is too short to keep' };
  if (m.durationMs > MAX_TAKE_MS + 5000) return { ok: false, error: `take is longer than ${MAX_TAKE_MS / 60000} minutes` };
  const type = baseType(m.type);
  if (!type) return { ok: false, error: `not an audio type we keep: ${String(m.type).slice(0, 40)}` };
  if (!Number.isInteger(m.bytes) || m.bytes <= 0) return { ok: false, error: 'the recording is empty' };
  if (m.prompt !== undefined) {
    const p = cleanTitle(m.prompt);
    if (!p.ok) return { ok: false, error: `prompt: ${p.error}` };
  }
  for (const k of ['runId', 'goalId', 'blockId'] as const) {
    const v = m[k];
    if (v !== undefined && (typeof v !== 'string' || !/^[A-Za-z0-9_:-]{1,64}$/.test(v))) return { ok: false, error: `${k} is not a valid id` };
  }
  if ((m.index === undefined) !== (m.of === undefined)) return { ok: false, error: 'index and of go together' };
  if (m.index !== undefined && (!Number.isInteger(m.index) || !Number.isInteger(m.of) || m.index < 1 || m.index > m.of! || m.of! > 20)) {
    return { ok: false, error: 'index must be 1 to of (at most 20)' };
  }
  return { ok: true, value: { ...m, title: title.value, type } };
}

/** Where a take lives in the private bucket: "<userId>/<takeId>.<ext>". The first folder is the owner (RLS checks it). */
export function storagePath(userId: string, takeId: string, type: string): string {
  if (!/^[0-9a-f-]{36}$/.test(userId)) throw new RangeError('storage needs a signed-in user id');
  if (!/^take-[A-Za-z0-9-]{1,40}$/.test(takeId)) throw new RangeError(`bad take id ${takeId}`);
  const ext = AUDIO_TYPES[baseType(type) ?? ''];
  if (!ext) throw new RangeError(`bad audio type ${type}`);
  return `${userId}/${takeId}.${ext}`;
}

export const isTakeKey = (key: string) => ID.test(key);

// -------------------------------------------------------- improv prompts ---

/** A timed prompt: N takes, each with its own window, saved separately. */
export interface ImprovPrompt {
  readonly prompt: string;
  readonly takes: number;
  /** Window per take; recording stops by itself when it runs out. */
  readonly minutes: number;
}

export const IMPROV_LIMITS = Object.freeze({ takes: { min: 1, max: 10 }, minutes: { min: 1, max: 30 } });
/** Default from Blake's example. */
export const DEFAULT_IMPROV: ImprovPrompt = Object.freeze({ prompt: 'Improvise a song', takes: 3, minutes: 5 });

export function checkImprov(p: ImprovPrompt): Validation<ImprovPrompt> {
  const prompt = cleanTitle(p.prompt);
  if (!prompt.ok) return { ok: false, error: `prompt: ${prompt.error}` };
  const { takes, minutes } = IMPROV_LIMITS;
  if (!Number.isInteger(p.takes) || p.takes < takes.min || p.takes > takes.max) return { ok: false, error: `takes: ${takes.min} to ${takes.max}` };
  if (!Number.isInteger(p.minutes) || p.minutes < minutes.min || p.minutes > minutes.max) return { ok: false, error: `minutes: ${minutes.min} to ${minutes.max}` };
  return { ok: true, value: { prompt: prompt.value, takes: p.takes, minutes: p.minutes } };
}

/** The title each take of a run gets: "Improvise a song · take 2 of 3". */
export function takeTitle(prompt: string, index: number, of: number): string {
  return of > 1 ? `${prompt} · take ${index} of ${of}` : prompt;
}

/** Where a run stands: which take is next, and whether it is finished. */
export function runState(p: ImprovPrompt, saved: number): { next: number | null; done: boolean } {
  return saved >= p.takes ? { next: null, done: true } : { next: saved + 1, done: false };
}
