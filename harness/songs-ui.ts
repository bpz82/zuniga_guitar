/**
 * Bare Songs I Already Know controls for the test harness: add a title,
 * paste a list, rename, archive and restore. No design. Practice happens in
 * today's lesson: the song is served, played, then rated.
 *
 * 2026-11-02 (Blake): rate every song without playing it (its baseline), and
 * attach a tab to a song (PDF, picture or plain text), saved on this device
 * and backed up when signed in; the tab opens from the song's row and from
 * the song being practised.
 *
 * 2026-11-03 (Blake): read only, for a band member. He sees his owner's
 * songs and tabs (and can download a tab), and rates each song: a baseline
 * first, then after playing it. Each row says when it is next due for him,
 * from his own ratings only. No adding, renaming, archiving or attaching:
 * those controls are not shown, and the server refuses them anyway.
 */
import { addSong, archiveSong, attachTab, MAX_TAB_BYTES, memoryOf, pasteSongs, rateBaseline, rateSong, renameSong, restoreSong, runModule, songs, tabFile, tabTypeOf, unratedSongs } from '../src/index.ts';
import type { DayStart, ModuleHost, Rating, Song, TabFiles, TabStorage, Validation } from '../src/index.ts';
import { hook, RATINGS } from './hooks.ts';
import type { Hook } from './hooks.ts';
import type { Sheets } from './sheets.ts';

const $ = <T extends HTMLElement = HTMLInputElement>(name: Hook) => hook<T>(name);
const newKey = () => crypto.randomUUID();
const RATING_LABEL: Readonly<Record<Rating, string>> = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

export interface TabPlaces {
  /** This device's tab files. */
  files(): TabFiles;
  /** Storage, when signed in. */
  cloud(): { storage: TabStorage; userId: string } | null;
  sheets: Sheets;
}

/** A band member's list (2026-11-03): read only, his own ratings, and when each song is next due for him. */
export interface ReadOnly {
  /** His retention and practice day, for when a song is next due. */
  schedule(): { retention: number; dayStart: DayStart };
  now(): number;
}

/** "Due now", or the day it is next due: "Next: Fri 6 Nov". From the reviewer's own ratings only. */
export function dueText(due: number | null, now: number, timeZone: string): string {
  if (due === null || due <= now) return 'Due now';
  return `Next: ${new Date(due).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone })}`;
}

export function setupSongs(host: ModuleHost, say: (s: string) => void, afterChange: () => Promise<void>, onPasted: () => void, tabs: TabPlaces, readOnly: ReadOnly | null = null) {
  /** Runs a songs action inside the crash boundary and reports the outcome. */
  const act = async <T>(fn: () => Promise<Validation<T>>, done: (value: T) => string) => {
    const r = await runModule(host, fn);
    if (!r.ok) say(`Songs switched off: ${r.error}`);
    else if (!r.value.ok) say(`Songs: ${r.value.error}`);
    else say(done(r.value.value));
    await afterChange();
  };

  // ---- tabs ----
  /** The song a picked file is for (one shared file picker). */
  let attachingTo: string | null = null;
  /** Object URL of the tab on show, freed when the viewer closes. */
  let shownUrl: string | null = null;
  const freeUrl = () => {
    if (shownUrl) URL.revokeObjectURL(shownUrl);
    shownUrl = null;
  };
  tabs.sheets.onClose('songtab', () => {
    freeUrl();
    $('songtab-view').replaceChildren();
  });

  const pick = (song: Song) => {
    attachingTo = song.itemId;
    const input = $('songtab-file');
    input.value = '';
    input.click();
  };

  const attach = async (file: File) => {
    const itemId = attachingTo;
    attachingTo = null;
    if (!itemId) return;
    const id = newKey();
    // Checked before the file is stored, so a refused file leaves nothing behind.
    const r = await runModule(host, async () => {
      const probe = await attachCheck(file);
      if (!probe.ok) return probe;
      await tabs.files().put(id, { blob: file, type: file.type });
      return attachTab(host, itemId, { id, name: file.name, type: file.type, bytes: file.size });
    });
    if (!r.ok) say(`Songs switched off: ${r.error}`);
    else if (!r.value.ok) say(`Tab: ${r.value.error}`);
    else say(`Tab added to "${r.value.value.title}"${tabs.cloud() ? '' : '; sign in to back it up'}`);
    await afterChange();
  };
  /** The same checks attachTab makes, without writing: type and size. */
  const attachCheck = async (file: File): Promise<Validation<true>> => {
    const t = tabTypeOf(file.name, file.type);
    if (!t.ok) return t;
    if (file.size <= 0) return { ok: false, error: 'the file is empty' };
    if (file.size > MAX_TAB_BYTES) return { ok: false, error: `a tab can be at most ${MAX_TAB_BYTES / 1024 / 1024} MB` };
    return { ok: true, value: true };
  };

  /** Opens a song's tab in the viewer. */
  const showTab = async (itemId: string) => {
    const pending = readOnly ? songs(host).find((s) => s.itemId === itemId && s.tab && !s.tab.uploaded) : undefined;
    if (pending) return say(`Tab: "${pending.title}" isn't shared yet. It is still waiting to be backed up from your band leader's device.`);
    const r = await runModule(host, () => tabFile(host, tabs.files(), itemId, tabs.cloud()));
    if (!r.ok) return say(`Songs switched off: ${r.error}`);
    if (!r.value.ok) return say(`Tab: ${r.value.error}`);
    const { tab, blob } = r.value.value;
    const song = songs(host).find((s) => s.itemId === itemId);
    freeUrl();
    shownUrl = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: tab.type }));
    $('songtab-title').textContent = song ? `${song.title}: tab` : 'Tab';
    let view: HTMLElement;
    if (tab.type === 'text/plain') {
      view = document.createElement('pre');
      view.textContent = await blob.text();
    } else if (tab.type === 'application/pdf') {
      const frame = document.createElement('iframe');
      frame.src = shownUrl;
      frame.title = tab.name;
      view = frame;
    } else {
      const img = document.createElement('img');
      img.src = shownUrl;
      img.alt = `Tab for ${song?.title ?? 'the song'}`;
      view = img;
    }
    view.dataset.zg = 'songtab-content';
    $('songtab-view').replaceChildren(view);
    const open = $<HTMLAnchorElement>('songtab-open');
    open.href = shownUrl;
    open.download = tab.name;
    tabs.sheets.open('songtab');
  };

  // ---- rows ----
  const row = (song: Song) => {
    const li = document.createElement('li');
    li.dataset.zg = 'song';
    li.append(song.title, ' ');
    if (!song.archived) {
      if (song.tab) {
        const view = document.createElement('button');
        view.dataset.zg = 'song-tab';
        view.textContent = 'Tab';
        view.onclick = () => void showTab(song.itemId);
        li.append(view, ' ');
      }
      const add = document.createElement('button');
      add.dataset.zg = 'song-tab-attach';
      add.textContent = song.tab ? 'New tab' : 'Add tab';
      add.onclick = () => pick(song);
      li.append(add, ' ');
    }
    const rename = document.createElement('button');
    rename.dataset.zg = 'song-rename';
    rename.textContent = 'Rename';
    rename.onclick = () => {
      const title = window.prompt('New title', song.title);
      if (title !== null) void act(() => renameSong(host, song.itemId, title), (s) => `Renamed to "${s.title}"`);
    };
    const toggle = document.createElement('button');
    if (song.archived) {
      toggle.dataset.zg = 'song-restore';
      toggle.textContent = 'Restore';
      toggle.onclick = () => void act(() => restoreSong(host, song.itemId), (s) => `Restored "${s.title}"`);
    } else {
      toggle.dataset.zg = 'song-archive';
      toggle.textContent = 'Archive';
      toggle.onclick = () => void act(() => archiveSong(host, song.itemId), (s) => `Archived "${s.title}" (history kept; Restore brings it back)`);
    }
    li.append(rename, ' ', toggle);
    return li;
  };

  /** A band member's row: the title, the tab, when it is next due for him and, once rated, his four ratings. */
  const memberRow = (song: Song, due: number | null) => {
    const li = document.createElement('li');
    li.dataset.zg = 'song';
    li.dataset.card = song.cardId;
    li.append(song.title, ' ');
    if (song.tab) {
      const view = document.createElement('button');
      view.dataset.zg = 'song-tab';
      view.textContent = 'Tab';
      view.onclick = () => void showTab(song.itemId);
      li.append(view, ' ');
    }
    const when = document.createElement('span');
    when.dataset.zg = 'song-due';
    const rated = host.reviews(song.cardId).length > 0;
    when.textContent = rated ? dueText(due, readOnly!.now(), readOnly!.schedule().dayStart.timeZone) : 'Not rated yet (rate it above)';
    li.append(when);
    if (rated) {
      for (const rating of RATINGS as readonly Rating[]) {
        const b = document.createElement('button');
        b.dataset.zg = 'song-rate';
        b.dataset.rating = rating;
        b.textContent = RATING_LABEL[rating];
        b.onclick = () => void act(() => rateSong(host, song.cardId, rating, 0), (s) => `"${s.title}": ${RATING_LABEL[rating]}`);
        li.append(b);
      }
    }
    return li;
  };

  /** When a song is next due for this reviewer (null: never rated). Songs skip learning steps. */
  const dueOf = (song: Song): number | null => {
    const { retention, dayStart } = readOnly!.schedule();
    return memoryOf(song.cardId, host.reviews(song.cardId), retention, dayStart, false).due;
  };

  /** A song waiting for its baseline: the title and the four ratings. */
  const baselineRow = (song: Song) => {
    const li = document.createElement('li');
    li.dataset.zg = 'baseline-song';
    li.dataset.card = song.cardId;
    const name = document.createElement('span');
    name.textContent = song.title;
    li.append(name);
    for (const rating of RATINGS as readonly Rating[]) {
      const b = document.createElement('button');
      b.dataset.zg = 'baseline-rate';
      b.dataset.rating = rating;
      b.textContent = RATING_LABEL[rating];
      b.onclick = () => void act(() => rateBaseline(host, song.cardId, rating), (s) => `"${s.title}" starts at ${RATING_LABEL[rating]}`);
      li.append(b);
    }
    return li;
  };

  return {
    showTab,
    render() {
      if (!host.enabled) {
        $('songs-list').replaceChildren();
        $('songs-archived').replaceChildren();
        $('songs-baseline').hidden = true;
        return;
      }
      const all = songs(host);
      if (readOnly) {
        // Rated songs soonest due first, then the ones still waiting for his baseline. Archived songs are not his to see.
        const rows = all.filter((s) => !s.archived).map((s) => ({ s, due: dueOf(s), rated: host.reviews(s.cardId).length > 0 }));
        rows.sort((a, b) => Number(b.rated) - Number(a.rated) || (a.due ?? 0) - (b.due ?? 0));
        $('songs-list').replaceChildren(...rows.map((r) => memberRow(r.s, r.due)));
        $('songs-archived').replaceChildren();
      } else {
        $('songs-list').replaceChildren(...all.filter((s) => !s.archived).map(row));
        $('songs-archived').replaceChildren(...all.filter((s) => s.archived).map(row));
      }
      const waiting = unratedSongs(host);
      $('songs-baseline').hidden = waiting.length === 0;
      $('baseline-status').textContent = `${waiting.length} ${waiting.length === 1 ? 'song' : 'songs'} to rate.`;
      $('baseline-list').replaceChildren(...waiting.map(baselineRow));
    },
    wire() {
      if (readOnly) {
        // Nothing to add, paste or attach: those controls are hidden, and do nothing if shown.
        for (const h of ['songs-new-label', 'songs-add', 'open-songs-paste', 'songs-archive'] as const) $(h).hidden = true;
        return;
      }
      $('songs-add').onclick = () => {
        const input = $('songs-new');
        void act(() => addSong(host, newKey(), input.value), (s) => ((input.value = ''), `Added "${s.title}"`));
      };
      $('songs-paste-add').onclick = () => {
        const box = $<HTMLTextAreaElement>('songs-paste');
        void act(
          () => pasteSongs(host, box.value, newKey),
          (r) => ((box.value = ''), onPasted(), `Added ${r.added.length} songs${r.skipped.length ? `; skipped ${r.skipped.length} already listed` : ''}`),
        );
      };
      $('songtab-file').onchange = () => {
        const file = $('songtab-file').files?.[0];
        if (file) void attach(file);
      };
    },
  };
}
