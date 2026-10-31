/**
 * Songs I Already Know (Blake, 2026-10-31). A song is a title and nothing
 * else: one item (the title) and one guitar card. The app serves it in the
 * morning session through the normal queue, Blake plays it, then rates it
 * Again, Hard, Good or Easy. No chords, keys, tabs or links.
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
import type { Rating } from '../model.ts';
import type { Validation } from '../validate.ts';

export const SONGS: ModuleManifest = Object.freeze({
  id: 'songs',
  contract: 0,
  templates: Object.freeze([Object.freeze({ template: 'song', tags: Object.freeze(['guitar'] as const) })]),
});

export const MAX_TITLE = 200;
/** One paste adds at most this many songs (2 writes each, well inside the contract's hourly budget). */
export const MAX_PASTE = 200;

export interface Song {
  readonly itemId: string;
  readonly cardId: string;
  readonly title: string;
  readonly archived: boolean;
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

/** Every song, active and archived, in the order added. */
export function songs(host: ModuleHost): Song[] {
  const cards = new Map(host.cards().filter((c) => c.template === 'song').map((c) => [c.itemId, c]));
  return host.items().flatMap((i) => {
    const card = cards.get(i.id);
    if (!card || typeof i.fields.title !== 'string') return [];
    return [{ itemId: i.id, cardId: card.id, title: i.fields.title, archived: card.retired }];
  });
}

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
  await host.addItem(itemId, { title: t.value });
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
