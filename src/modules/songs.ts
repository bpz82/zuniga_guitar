/**
 * Songs I Already Know (Blake, 2026-10-31). A song is a title: one item (the
 * title) and one guitar card. The app serves it in the morning session
 * through the normal queue, Blake plays it, then rates it Again, Hard, Good
 * or Easy. No chords, keys or links.
 *
 * Tabs (Blake, 2026-11-02): a song can carry one tab file (PDF, picture or
 * plain text). The file stays on this device and is backed up to the user's
 * own folder in Storage; the log keeps only its name, type, size and whether
 * it is uploaded. Replacing a tab adds a new file; nothing is deleted.
 *
 * Baseline ratings (Blake, 2026-11-02): a song never played in the app can be
 * rated straight from the list, without playing it first. That rating is its
 * first review, so it sets the starting memory state in the scheduler (a
 * review with details { baseline: true }).
 *
 * Archiving retires the card: it stops being scheduled, its history stays
 * in the log forever, and restoring brings it back with that history. There
 * is no hard delete: the log is append-only, and Blake asked for archive.
 *
 * Every write is checked here first, so a bad title comes back as an error
 * for the user and never reaches the contract (which would switch the
 * module off). The module only ever touches the engine through its host.
 */
import type { ModuleHost, ModuleManifest } from '../contract.ts';
import type { Details, Rating } from '../model.ts';
import type { Validation } from '../validate.ts';

export const SONGS: ModuleManifest = Object.freeze({
  id: 'songs',
  contract: 1,
  templates: Object.freeze([Object.freeze({ template: 'song', tags: Object.freeze(['guitar'] as const) })]),
});

export const MAX_TITLE = 200;
/** One paste adds at most this many songs (2 writes each, well inside the contract's hourly budget). */
export const MAX_PASTE = 200;

export interface SongTab {
  /** Stable id; names the file on this device and in Storage. */
  readonly id: string;
  /** The file's name as picked, for showing. */
  readonly name: string;
  /** One of TAB_TYPES. */
  readonly type: TabType;
  readonly bytes: number;
  /** Backed up to Storage. */
  readonly uploaded: boolean;
}

export interface Song {
  readonly itemId: string;
  readonly cardId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly tab?: SongTab;
}

const ITEM_PREFIX = 'song-';
const cardIdOf = (itemId: string) => `${itemId}-c`;
const KEY = /^[A-Za-z0-9-]{1,40}$/;
// Control characters (tabs, newlines, NUL...) never belong in a title.
const CONTROL = /[\u0000-\u001f\u007f]/;

/** Trims and collapses spaces. Errors for an empty, too long or control-character title. */
export function cleanTitle(raw: string): Validation<string> {
  if (typeof raw !== 'string') return { ok: false, error: 'title must be text' };
  const title = raw.replace(/[ \t]+/g, ' ').trim();
  if (title.length === 0) return { ok: false, error: 'title is empty' };
  if (title.length > MAX_TITLE) return { ok: false, error: `title is longer than ${MAX_TITLE} characters` };
  if (CONTROL.test(title)) return { ok: false, error: 'title has a line break or control character' };
  return { ok: true, value: title };
}

const sameTitle = (a: string, b: string) => a.toLocaleLowerCase() === b.toLocaleLowerCase();

function tabOf(fields: Details): SongTab | undefined {
  const { tab, tabName, tabType, tabBytes, tabUploaded } = fields;
  if (typeof tab !== 'string' || typeof tabName !== 'string' || typeof tabBytes !== 'number') return undefined;
  if (!(TAB_TYPES as readonly string[]).includes(String(tabType))) return undefined;
  return { id: tab, name: tabName, type: tabType as TabType, bytes: tabBytes, uploaded: tabUploaded === true };
}

/** Every song, active and archived, in the order added. */
export function songs(host: ModuleHost): Song[] {
  const cards = new Map(host.cards().filter((c) => c.template === 'song').map((c) => [c.itemId, c]));
  return host.items().flatMap((i) => {
    const card = cards.get(i.id);
    if (!card || typeof i.fields.title !== 'string') return [];
    const tab = tabOf(i.fields);
    return [{ itemId: i.id, cardId: card.id, title: i.fields.title, archived: card.retired, ...(tab ? { tab } : {}) }];
  });
}

/** An item's fields as they stand, so an edit changes only what it means to. */
const fieldsOf = (host: ModuleHost, itemId: string): Details => host.items().find((i) => i.id === itemId)?.fields ?? {};

export function songByCard(host: ModuleHost, cardId: string): Song | undefined {
  return songs(host).find((s) => s.cardId === cardId);
}

function find(host: ModuleHost, itemId: string): Validation<Song> {
  const song = songs(host).find((s) => s.itemId === itemId);
  return song ? { ok: true, value: song } : { ok: false, error: `no song ${itemId}` };
}

/**
 * Adds one song. `key` must be stable and unique, e.g. crypto.randomUUID()
 * from the app. Refuses a title already in the list (archived included: restore that one).
 */
export async function addSong(host: ModuleHost, key: string, rawTitle: string): Promise<Validation<Song>> {
  const t = cleanTitle(rawTitle);
  if (!t.ok) return t;
  if (!KEY.test(key)) return { ok: false, error: 'song id: letters, digits and - only (at most 40)' };
  const existing = songs(host).find((s) => sameTitle(s.title, t.value));
  if (existing) return { ok: false, error: `"${existing.title}" is already ${existing.archived ? 'in the archive (restore it)' : 'in your songs'}` };
  const itemId = ITEM_PREFIX + key;
  if (host.items().some((i) => i.id === itemId)) return { ok: false, error: `song id ${key} is taken` };
  const cardId = cardIdOf(itemId);
  await host.addItem(itemId, { title: t.value });
  await host.addCard(cardId, itemId, 'song');
  return { ok: true, value: { itemId, cardId, title: t.value, archived: false } };
}

export interface PasteReport {
  readonly added: readonly Song[];
  /** Titles already in the list or repeated in the paste. Not added. */
  readonly skipped: readonly string[];
}

/**
 * Bulk add: one title per line. Blank lines are ignored and duplicates are
 * skipped. All lines are checked before anything is written: if any line is
 * bad, nothing is added and the error names the line.
 */
export async function pasteSongs(host: ModuleHost, text: string, newKey: () => string): Promise<Validation<PasteReport>> {
  if (typeof text !== 'string') return { ok: false, error: 'paste must be text' };
  const lines = text.split(/\r\n|\r|\n/);
  const titles: string[] = [];
  for (const [i, line] of lines.entries()) {
    if (line.trim() === '') continue;
    const t = cleanTitle(line);
    if (!t.ok) return { ok: false, error: `line ${i + 1}: ${t.error}` };
    titles.push(t.value);
  }
  if (titles.length === 0) return { ok: false, error: 'nothing to add' };
  const known = songs(host).map((s) => s.title);
  const fresh: string[] = [];
  const skipped: string[] = [];
  for (const title of titles) {
    if ([...known, ...fresh].some((k) => sameTitle(k, title))) skipped.push(title);
    else fresh.push(title);
  }
  if (fresh.length > MAX_PASTE) return { ok: false, error: `at most ${MAX_PASTE} new songs per paste (this one has ${fresh.length})` };
  const added: Song[] = [];
  for (const title of fresh) {
    const r = await addSong(host, newKey(), title);
    if (!r.ok) return { ok: false, error: `${title}: ${r.error} (${added.length} added before this)` };
    added.push(r.value);
  }
  return { ok: true, value: { added, skipped } };
}

/** Changes a song's title. Its practice history is untouched. */
export async function renameSong(host: ModuleHost, itemId: string, rawTitle: string): Promise<Validation<Song>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  const t = cleanTitle(rawTitle);
  if (!t.ok) return t;
  const clash = songs(host).find((s) => s.itemId !== itemId && sameTitle(s.title, t.value));
  if (clash) return { ok: false, error: `"${clash.title}" is already ${clash.archived ? 'in the archive' : 'in your songs'}` };
  if (song.value.title === t.value) return song;
  // Keep the other fields (the tab) when renaming.
  await host.addItem(itemId, { ...fieldsOf(host, itemId), title: t.value });
  return { ok: true, value: { ...song.value, title: t.value } };
}

/** Archives a song: no longer served, history kept. Undo with restoreSong. */
export async function archiveSong(host: ModuleHost, itemId: string): Promise<Validation<Song>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  if (!song.value.archived) await host.retireCard(song.value.cardId);
  return { ok: true, value: { ...song.value, archived: true } };
}

/** Brings an archived song back into practice, with its history. */
export async function restoreSong(host: ModuleHost, itemId: string): Promise<Validation<Song>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  if (song.value.archived) await host.addCard(song.value.cardId, itemId, 'song');
  return { ok: true, value: { ...song.value, archived: false } };
}

/** Logs one play of a song: Blake's rating and how long it took. */
export async function rateSong(host: ModuleHost, cardId: string, rating: Rating, durationMs: number): Promise<Validation<Song>> {
  const song = songByCard(host, cardId);
  if (!song) return { ok: false, error: `no song card ${cardId}` };
  if (song.archived) return { ok: false, error: `"${song.title}" is archived` };
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) return { ok: false, error: `bad rating ${String(rating)}` };
  const ms = Math.round(Math.min(Math.max(0, Number.isFinite(durationMs) ? durationMs : 0), 24 * 60 * 60 * 1000));
  await host.reportRep(cardId, rating, ms);
  return { ok: true, value: song };
}

// ------------------------------------------------- baseline (2026-11-02) --

/** Active songs never rated: the ones still waiting for a baseline. */
export function unratedSongs(host: ModuleHost): Song[] {
  return songs(host).filter((s) => !s.archived && host.reviews(s.cardId).length === 0);
}

/**
 * A song's starting rating, given without playing it. Only for a song never
 * rated before: after that, ratings come from playing it in practice.
 */
export async function rateBaseline(host: ModuleHost, cardId: string, rating: Rating): Promise<Validation<Song>> {
  const song = songByCard(host, cardId);
  if (!song) return { ok: false, error: `no song card ${cardId}` };
  if (song.archived) return { ok: false, error: `"${song.title}" is archived` };
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) return { ok: false, error: `bad rating ${String(rating)}` };
  if (host.reviews(cardId).length > 0) return { ok: false, error: `"${song.title}" already has a rating; it is in practice now` };
  await host.reportRep(cardId, rating, 0, { baseline: true });
  return { ok: true, value: song };
}

// ----------------------------------------------------- tabs (2026-11-02) --

/** File types a tab may be, each with the extension it is stored under. */
export const TAB_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'text/plain'] as const;
export type TabType = (typeof TAB_TYPES)[number];
const EXTENSION: Readonly<Record<TabType, string>> = {
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'text/plain': 'txt',
};
/** File name endings accepted when the browser gives no type (common for tab and chord files). */
const BY_EXTENSION: Readonly<Record<string, TabType>> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  txt: 'text/plain', tab: 'text/plain', crd: 'text/plain', chopro: 'text/plain', cho: 'text/plain', pro: 'text/plain',
};
/** The Storage bucket allows the same (supabase/migrations/20261102120000_tabs_storage.sql). */
export const MAX_TAB_BYTES = 20 * 1024 * 1024;
export const MAX_TAB_NAME = 200;

/** Which tab type a picked file is, from its type or, failing that, its name. */
export function tabTypeOf(name: string, type: string): Validation<TabType> {
  const base = String(type).split(';')[0]!.trim().toLowerCase();
  if ((TAB_TYPES as readonly string[]).includes(base)) return { ok: true, value: base as TabType };
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(String(name))?.[1]?.toLowerCase();
  const byExt = ext ? BY_EXTENSION[ext] : undefined;
  // No useful type from the browser, or a text type for a text-tab file (".tab" may come as text/x-...).
  if (byExt && (base === '' || base === 'application/octet-stream' || (byExt === 'text/plain' && base.startsWith('text/') && base !== 'text/html'))) return { ok: true, value: byExt };
  return { ok: false, error: 'a tab must be a PDF, a picture (PNG, JPEG, WebP, GIF) or plain text' };
}

/** Where a tab lives in Storage: "<user id>/tab-<id>.<ext>", in the user's own folder. */
export function tabPath(userId: string, tab: Pick<SongTab, 'id' | 'type'>): string {
  return `${userId}/tab-${tab.id}.${EXTENSION[tab.type]}`;
}

/** Attaches a tab (or replaces the one there) once its file is saved on this device. */
export async function attachTab(host: ModuleHost, itemId: string, file: { id: string; name: string; type: string; bytes: number }): Promise<Validation<Song>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  if (!KEY.test(file.id)) return { ok: false, error: 'tab id: letters, digits and - only (at most 40)' };
  const type = tabTypeOf(file.name, file.type);
  if (!type.ok) return type;
  if (!Number.isInteger(file.bytes) || file.bytes <= 0) return { ok: false, error: 'the file is empty' };
  if (file.bytes > MAX_TAB_BYTES) return { ok: false, error: `a tab can be at most ${MAX_TAB_BYTES / 1024 / 1024} MB` };
  const name = String(file.name).replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_TAB_NAME) || 'tab';
  const tab: SongTab = { id: file.id, name, type: type.value, bytes: file.bytes, uploaded: false };
  await host.addItem(itemId, { ...fieldsOf(host, itemId), tab: tab.id, tabName: tab.name, tabType: tab.type, tabBytes: tab.bytes, tabUploaded: false });
  return { ok: true, value: { ...song.value, tab } };
}

/** Songs whose tab is not backed up yet. */
export function pendingTabs(host: ModuleHost): Song[] {
  return songs(host).filter((s) => s.tab && !s.tab.uploaded);
}

/** Marks a song's tab as backed up (only if it is still that song's tab). */
export async function markTabUploaded(host: ModuleHost, itemId: string, tabId: string): Promise<Validation<Song>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  if (song.value.tab?.id !== tabId) return { ok: false, error: 'that tab was replaced' };
  if (song.value.tab.uploaded) return song;
  await host.addItem(itemId, { ...fieldsOf(host, itemId), tabUploaded: true });
  return { ok: true, value: { ...song.value, tab: { ...song.value.tab, uploaded: true } } };
}

/** Where tab files are kept on this device (the recorder's blob store shape). */
export interface TabFiles {
  put(id: string, value: { blob: Blob; type: string }): Promise<void>;
  get(id: string): Promise<{ blob: Blob; type: string } | undefined>;
}
/** Storage for tab files (the recorder's storage adapter shape). */
export interface TabStorage {
  upload(path: string, blob: Blob, type: string): Promise<'uploaded' | 'exists'>;
  download(path: string): Promise<Blob>;
}

/** Uploads every tab saved on this device and not yet backed up. */
export async function uploadPendingTabs(host: ModuleHost, files: TabFiles, storage: TabStorage, userId: string): Promise<{ uploaded: number; failed: { title: string; error: string }[] }> {
  let uploaded = 0;
  const failed: { title: string; error: string }[] = [];
  for (const s of pendingTabs(host)) {
    const tab = s.tab!;
    const file = await files.get(tab.id);
    if (!file) continue; // attached on another device: that device uploads it
    try {
      await storage.upload(tabPath(userId, tab), file.blob, tab.type);
    } catch (e) {
      failed.push({ title: s.title, error: (e as Error).message });
      continue;
    }
    const r = await markTabUploaded(host, s.itemId, tab.id);
    if (r.ok) uploaded++;
  }
  return { uploaded, failed };
}

/** A song's tab file: from this device, or downloaded from Storage (then kept here). */
export async function tabFile(host: ModuleHost, files: TabFiles, itemId: string, cloud: { storage: TabStorage; userId: string } | null): Promise<Validation<{ tab: SongTab; blob: Blob }>> {
  const song = find(host, itemId);
  if (!song.ok) return song;
  const tab = song.value.tab;
  if (!tab) return { ok: false, error: `"${song.value.title}" has no tab` };
  const local = await files.get(tab.id);
  if (local) return { ok: true, value: { tab, blob: local.blob } };
  if (!tab.uploaded) return { ok: false, error: 'this tab was added on another device and is not backed up yet' };
  if (!cloud) return { ok: false, error: 'sign in to see tabs from your other devices' };
  try {
    const blob = await cloud.storage.download(tabPath(cloud.userId, tab));
    await files.put(tab.id, { blob, type: tab.type });
    return { ok: true, value: { tab, blob } };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
